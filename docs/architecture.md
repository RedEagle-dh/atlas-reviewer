# How review-atlas is built

For working on the tool itself. Using it is the [README](../README.md).

It is a small framework: a review is one file, and a new language, a new way to resolve an import
or another highlighter is one file plus one line of registration.

## Architecture

Three layers, and one contract between them:

```
src/core/     no HTTP, no DOM — usable as a library
  types.ts      THE contract: ReviewConfig, ReviewMeta, ReviewModel, FileView, ViewedState,
                ReviewComment, …
  define.ts     defineReview(), loadReview(), defaults
  glob.ts       the glob matcher
  source.ts     RepoSource: one commit (ls-tree, blobs, ONE `git cat-file --batch` for bulk reads)
  diff.ts       one --name-status, one --numstat, ONE -U0 patch → change blocks per file
  classify.ts   categories and their default rules
  imports/
    extract.ts  Extractor interface; TypeScript/JavaScript (compiler API) and CSS (@import)
    resolve.ts  Resolver chain: relative → tsconfig paths → workspace packages
    analyze.ts  parse the WHOLE head commit once (disk cache by blob sha), resolve every import
  graph.ts      edges, units, reading order, cycles (Tarjan)
  build.ts      buildRange() / buildReviewModel(review, rangeId)
  highlight.ts  Highlighter interface + shiki (light and dark colour per token)
  file-view.ts  buildFileView(): highlighted lines, change blocks, imports, importers
  state.ts      "viewed" marks, one JSON file per review
  comments.ts   review comments, one JSON file per review; the limits and the checks of a draft
  session.ts    ReviewSession: caches models per (range, base sha, head sha), analyses per head
                sha, highlighted blobs by sha; answers the questions of the contract
src/server/   main.ts (Bun.serve, the UI as an HTML import) and api.ts (thin handlers)
src/ui/       React 19, Tailwind CSS, shadcn/ui on Base UI, @xyflow/react + dagre; imports from
              core ONLY types (`import type`)
bin/          the CLI
reviews/      review files: `example.review.ts` is a template, `local/` is git-ignored
```

`src/core` imports nothing from `server` or `ui`; `ui` imports from `core` only types, and of the
packages only those the browser needs (React, React Flow, dagre, and what the shadcn/ui components
are made of: `UI_PACKAGES` in `src/layers.test.ts`) and no builtin, so nothing of git, the
filesystem, shiki or the TypeScript compiler reaches the browser bundle. `src/layers.test.ts`
enforces all three. Where the UI needs one of core's small rules it keeps a commented copy
(`neighbours.ts`: the strength order of import kinds; `level.ts`: Tarjan; `lib/comments.ts`: the
limits of a comment).

Data lives in `.review-atlas/` inside the tool directory (git-ignored): `state/<review id>.json`
(the "viewed" marks), `comments/<review id>.json` (the comments) and `cache/imports.json`
(extraction results by blob sha). The two stores keep nothing in memory: every request reads its
file first, so a second server of the same review (on another port) does not write an older
list over a newer one. A comments file that was read but holds no list is moved aside
(`….unreadable-<time>`), never written over; a store file that cannot be read at all (no
permission, a directory in its place) stays as it is, and the request fails (500 `internal`).

### How a model is built

1. Resolve the range's refs to commit shas (the merge base when `mergeBase`).
2. `RepoSource.open` lists both commits (`git ls-tree -r -z -l`); one `--name-status -z`, one
   `--numstat -z` and one `-U0` patch give the changed files with status and change blocks
   (added, modified, deleted, renamed with and without change, binary, no newline at end, any
   path). A text file's +/− counts are the sums of its blocks (git's `--numstat` aligns a few
   files one line differently from its own patch). "Binary" is a property of the content (git's
   NUL heuristic, the same the file view uses): the diff runs with `--attr-source=<empty tree>`
   and no attributes file, because git takes `.gitattributes` from the working tree even when it
   diffs two commits, and a text file marked `-diff` would otherwise come out binary, with no
   lines, and classified as an asset.
3. The whole head commit is parsed once (every file an extractor accepts; ~2 200 files in the
   monorepo it was built against) through one `cat-file --batch`; extraction results are cached on disk by
   `<extractor id>:<extension>:<blob sha>`, so a second start only resolves. Every import is
   resolved, which gives the unchanged files a changed file imports and the unchanged files that
   import it. When the range deletes files, the base commit is parsed the same way (mostly from
   the cache): a deleted file's imports are resolved against the commit it lived in, and the
   files that imported it then are known. Its relations are given in head paths (a renamed
   target by its new path) and become edges like any other; an edge that touches a deleted file
   is a relation "before the change" (dotted on the map). Its unit comes from the base commit's
   packages, so a deleted package is still a package.
4. Classify, drop excluded categories and `exclude` globs, assign chapters and units, build one
   edge per (importer, imported) between review files (the strongest kind wins:
   value > re-export > dynamic > side-effect > type), the reading order and the cycles (strongly
   connected components). Reading order: chapters in order; inside a chapter the strongly
   connected components are sorted topologically, smallest path first, so a file never comes
   before what it imports unless both lie on one cycle; inside a cycle the file with the fewest
   unplaced dependencies goes first, then by path.

The session keeps a model while the refs stay put; every request re-resolves the refs (two or
three `git rev-parse`/`merge-base` calls), so new commits give a new model on the next request.
`GET /api/model` carries both shas. The page sends them back with every `/api/file` request, and
the blob it shows with every "Gesehen": when the range has moved on, the answer is 409
`range-moved` instead of a file of another state or a mark for content the reader has not seen
(a new comment carries the two commits the same way).
The page then loads the model again and says so ("Der Bereich hat neue Commits …").

Measured on a TypeScript monorepo (2 696 files at head, 2 208 parsed, a range of 468 changed files):
cold first build 1.6–1.7 s (extraction ~1.4 s; whole process ~2.0 s, ~210 MB RSS), warm 0.2 s
(whole process 0.6 s, ~135 MB RSS). `atlas` is `ready` about 0.4 s after start. `/api/file` for a
1 600-line file: 0.5 s the first time (shiki loads its grammar), then a few ms from the
in-memory cache.

### The contract (`src/core/types.ts`)

| Endpoint                                                                               | Answer                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/review`                                                                      | `ReviewMeta`: title, repo, ranges (with note), the non-excluded categories with `defaultVisible` (and a `label` only when the review gives one), the chapters incl. the rest chapter `rest` (a `title` only when the review gives `restTitle`)                                                                        |
| `GET /api/model?range=<id>`                                                            | `ReviewModel`: range with base/head ref and sha, `files` (every changed, non-excluded file, ALL categories), `edges` (also those of deleted files, from the base commit), `readingOrder`, `cycles`, `excluded` counts, `unresolved`, `generatedAt`                                                                    |
| `GET /api/file?range=<id>&path=<repo path>[&base=<sha>&head=<sha>]`                    | `FileView` of ANY file of the head commit (or a deleted file of the base): token lines + `[light, dark]` palette, change blocks with the removed base lines, `importsRead`, imports (target, category, where, package), importers (with category). 409 `range-moved` when `base`/`head` are no longer the range's     |
| `GET /api/state`                                                                       | `ViewedState`: path → blob sha it was viewed at                                                                                                                                                                                                                                                                       |
| `PUT /api/state` `{ path, viewed, range?, blob? }`                                     | `ViewedState` after the change; 409 `range-moved` (nothing written) when `blob` is no longer the file's blob in the range                                                                                                                                                                                             |
| `GET /api/comments`                                                                    | `CommentsState`: the review's comments in the order they were written                                                                                                                                                                                                                                                 |
| `POST /api/comments` `{ path, line?, endLine?, snippet?, text, range?, head?, base? }` | `CommentsState` after it, the new comment last. The server makes the id and the timestamps and records the range's head commit (for a file the range deletes also its base commit); 404 `not-found` when `path` is no file of the range; 409 `range-moved` (nothing written) when `head` or `base` is not the range's |
| `PUT /api/comments/:id` `{ text }`                                                     | `CommentsState` after the edit; 404 `not-found` for an unknown id                                                                                                                                                                                                                                                     |
| `DELETE /api/comments/:id`, `DELETE /api/comments`                                     | `CommentsState` without that comment (an unknown id is no error), or without any                                                                                                                                                                                                                                      |

No `range` means the review's first range. Every error is `{ error, message }` (`ApiErrorBody`)
with `error` one of `bad-request` (400), `unknown-range` (404), `not-found` (404: unknown path —
never a read from disk —, unknown endpoint or method), `range-moved` (409), `internal` (500). A
request body has to be sent as `content-type: application/json` (a page of another site cannot
send that without asking first, so only the review's own page writes); a body above the limit is
turned away by Bun with a bare 413. A file counts as viewed while its current blob
(`ChangedFile.blob`, or `baseBlob` for a deleted file) equals the recorded sha. The browser half
of the contract is `src/ui/api.ts` (the typed client).

A comment is on lines of a file (`line`, `endLine`) or on the whole file (neither). It keeps the
commented lines as text (`snippet`, at most the first 30 lines) and the head commit it was written
at (for a file its range deletes also the base commit, whose version the line numbers belong
to): the prompt quotes the lines and names the commit, and the file page marks a comment whose
lines have changed since.
`src/ui/lib/prompt.ts` (`buildPrompt`) turns the comments into the text the reader copies — the
one place where its (English) words live.

Rendering rules the data follows: `Token = [text, colour, fontStyle?]`, `colour` indexes
`palette` (index 0 = plain text colour), `fontStyle` bits 1 italic, 2 bold, 4 underline. A change
block covers `count` head lines from `start`; `count: 0` is a pure deletion before line `start`.
An added (or deleted) file has ONE block over all its lines and no removed lines. A file above
1.5 MB or 20 000 lines comes as plain text, cut, `truncated: true`; a binary file has no lines.

## Extending it

Each of these is one file plus one line:

- **A review**: a new `reviews/<name>.review.ts` (see above; `reviews/local/<name>.review.ts`
  for a private repository), then `bun run atlas:check <that file>`.
- **A category or chapter rule**: one entry in the review file's `categories` / `chapters`.
- **A language (an `Extractor`)**: a file exporting an `Extractor`, added to
  `DEFAULT_EXTRACTORS` in `src/core/imports/extract.ts` (the first extractor whose `test`
  accepts a path handles it). `id` names the extractor in the disk cache: bump it when its output
  changes.

  ```ts
  // src/core/imports/extract-python.ts
  import type { Extractor } from "./extract";
  export const pythonExtractor: Extractor = {
  	id: "python@1",
  	test: (path) => path.endsWith(".py"),
  	extract: (_path, code) => /* → RawImport[]: { specifier, line, kind, names } */ [],
  };
  // extract.ts: export const DEFAULT_EXTRACTORS = [typescriptExtractor, cssExtractor, pythonExtractor];
  ```

  Also add the extension to `SOURCE_EXTENSIONS` (classify) if it is not there, and to the
  highlighter's table if shiki should colour it.
- **A way to resolve a specifier (a `Resolver`)**: a file exporting a `ResolverFactory`
  (`(repo: RepoFiles) => Resolver`), added to `DEFAULT_RESOLVERS` in
  `src/core/imports/resolve.ts` at the place in the chain where it should be asked. A resolver
  answers `{ kind: "file", path }`, `{ kind: "external", package }`, `{ kind: "unresolved",
  resolver }` ("mine, but no such file" — this makes `atlas:check` fail) or `undefined` ("not
  mine"). `RepoFiles` gives the commit's file list and the text of every `package.json` /
  `tsconfig*.json` / `jsconfig*.json` and of what their `extends` and `references` name; probe
  against it with `probe()`, never against the disk. Resolution is not cached, so no cache to
  bump.

  The shipped chain: relative paths; `paths`/`baseUrl` of the nearest `tsconfig.json` or
  `jsconfig.json` (through `extends`; for a solution-style config with `references`, the
  referenced project whose `include` takes the file); workspace packages (`exports` with
  conditions, subpaths and `*`, then `module`/`main`, then `src/index`). What no resolver claims
  is an npm package (or a `node:`/`bun:` builtin) only when it can be one by npm's naming rules:
  `@/lib/utils`, `~/lib` or `#internal` that nobody understood are unresolved, so `atlas:check`
  fails on them instead of calling them packages.
- **Another highlighter**: a file exporting a `Highlighter` (`languageFor(path)`,
  `highlight(code, language)` → token lines + palette), used instead of `createShikiHighlighter()`
  in `ReviewSession`'s constructor (`src/core/session.ts`), or passed as
  `new ReviewSession(review, { highlighter })` / `startServer(review, { highlighter })`.
- **A page in the UI**: see the UI section.

Not built on purpose: a plugin loader, a config schema library, more extension points.

## Bundling and styling the UI

The server imports `src/ui/index.html` (`import ui from "../ui/index.html"`) and serves it at `/`
through `Bun.serve({ routes })`; Bun bundles the TSX and the CSS itself, no Vite. The stylesheet
is Tailwind CSS v4, compiled while Bun bundles by `bun-plugin-tailwind`, which `bunfig.toml`
registers (`[serve.static]`). Bun reads that file from the working directory when the process
starts: `bun run atlas` runs in the tool directory, and `serve` started from elsewhere runs
itself again from there (and passes SIGINT, SIGTERM and SIGHUP on to that server). Tailwind sees the class names of every file in the bundle's module
graph.

There is ONE entry stylesheet, `src/ui/styles/globals.css` (imported by `main.tsx`): the
shadcn/ui theme (style `base-nova`, base colour neutral) as CSS variables for light and `.dark`,
the tool's own colours (`added`, `modified`, `deleted`, `renamed`, `cycle`, `edge`,
`edge-strong`: `text-added`, `bg-deleted/15`, …), and the imports of what utilities do not fit,
in the components layer: React Flow's sheet, `code.css` (the rows of the code view) and `map.css`
(React Flow's internals, the lines). Two things this pipeline does that a stylesheet has to know:
`color-mix()` inside a custom property is flattened to its first colour (put it in a normal
declaration, or use an opacity utility), and `light-dark()` is rewritten (use the tokens and
`.dark`).

The components in `src/ui/components/ui/` are generated by the shadcn CLI in the Base UI flavour
(`components.json`; `bunx --bun shadcn@latest add <name>`), formatted by Biome and not linted.
Composition goes through Base UI's `render` prop. Four of them are changed on purpose and say so
in a comment: `toggle.tsx` (a pressed toggle can be told from an unpressed one in the light
theme), `sidebar.tsx` (its screen-reader words come from `strings.ts`), `alert-dialog.tsx` (a
backdrop also when it opens from inside a sheet) and `sonner.tsx` (the theme comes from the app,
the typeface from the page). `@/` is `src/ui/`
(`paths` in `tsconfig.json`).

## UI

React 19, hash routing, no state library; Tailwind CSS and shadcn/ui (Base UI) for the looks.
Everything the UI shows comes from the answers of the contract; `src/ui` imports from `src/core`
only types.

```
src/ui/
  index.html  main.tsx      entry: the stylesheet, <App/>; index.html sets the theme before paint
  app.tsx                   loads ReviewMeta and the model of the current range, provides the
                            theme, AtlasContext and the comments, renders the shell (shadcn
                            sidebar + inset) and the view the route names
  router.ts                 Route = { view, path, query }; parseHash / formatHash; mapRoute,
                            fileRoute and their readers (pure, router.test.ts)
  api.ts                    typed client of the endpoints
  strings.ts                EVERY word the UI shows (German); another language is another copy
  state/
    atlas.ts                AtlasContext: meta, model, visible files, reading order, viewed marks
                            (optimistic PUT), go() / href() that keep the range
    comments.tsx            CommentsProvider / useComments(): the review's comments, changed
                            only through the server
    composer.ts             the comment being written (place and text) and unsaved edits: they
                            outlive a rebuilt page
    route.ts                useRoute() (useSyncExternalStore on the hash), navigate()
    resource.ts             useResource(): loading / error with retry / value, with a cache
    prefs.ts                choices kept in localStorage: theme, categories (per review), toggles
    keys.ts                 single-key shortcuts that stay out of text fields and dialogs
  lib/                      pure helpers: files.ts (viewed mark, sizes), fuzzy.ts (search),
                            tree.ts (sidebar folder tree), comments.ts (snippet, outdated,
                            order), threads.ts (which comments hang below which line),
                            prompt.ts (the prompt), clipboard.ts, platform.ts (⌘ or Strg),
                            storage.ts (guarded localStorage)
  components/               AppSidebar (Kapitel / Ordner, progress), SiteHeader (categories,
                            search, comments, theme), RangeSwitch (in the sidebar's head; in
                            the header while the sidebar is closed), SearchPalette, marks
                            (status, +/−, size bar, viewed, progress), states (loading, notice,
                            error)
  components/comments/      CommentEditor, CommentCard, Composer (the editor in the code or
                            above it), CommentsPanel (the sheet: list, prompt, copy)
  components/ui/            the shadcn/ui components (generated)
  views/
    index.ts                the view registry: first hash segment → component
    map/                    grouping.ts → level.ts → layout.ts (pure, tested) → MapView.tsx,
                            nodes.tsx (React Flow nodes and the one edge type)
    file/                   rows.ts, neighbours.ts (pure, tested) → FilePage.tsx (header,
                            keys), Neighbourhood.tsx ("Zusammenhang"), CodeView.tsx
  styles/                   globals.css (Tailwind, theme, tokens), code.css, map.css
```

**Routes.** `#/map/<group id>[?by=dirs][&focus=<path>]`, `#/file/<repo path>[?line=<n>]`, and
`&range=<id>` on any of them (absent = the first range). Path segments are URI-encoded but keep
their `/`. Back/forward and reload work everywhere because the hash is the only navigation state;
everything else (theme, visible categories, sidebar tab, map direction, code mode, wrap,
"Entferntes zeigen") is a per-viewer choice in `localStorage`. Back and forward also return to
the reading position: every history entry gets a key in `history.state`, and `state/route.ts`
keeps the scroll of the main area and the map's viewport per key; an entry reached by
back/forward gets them back once its view has rendered (a `?line=` link still wins).

**Light and dark.** The page follows the system; the theme menu offers system, light and dark.
`useTheme()` (`state/prefs.ts`) writes `class="dark"` on `<html>`, the script in `index.html`
does the same before the first paint, and every colour is a theme token with a value for each.
React Flow takes the resolved theme as `forceColorMode`, and the code's token colours come from
the file's palette as one `.cN { color: light-dark(…) }` rule per entry, in a `<style>` the view
writes at run time.

### The map

The map is a drill-down through a group tree (`grouping.ts`): "Kapitel" (chapters in reading order
→ directories below each chapter's common prefix) or "Pakete & Ordner" (units → directories). A
chain of single directories collapses into one node (`src/modules/plugins`), and a directory with
one file is no group: the file stands one level up with its directory as hint. A group id is what
the URL carries; `locateGroup` resolves any id, also a collapsed directory, and the map then
rewrites the URL to the group that shows it.

A level (`level.ts`) is the current group's children plus **context**: for every ancestor level
the sibling groups and files that import or are imported by something inside the group (siblings
without such a connection are only counted: "7 Nachbargruppen ohne Verbindung ausgeblendet").
Every file-to-file import is lifted to the two nodes that contain its files and counted; imports
inside one node vanish, imports between two context nodes are not drawn, two opposite edges
become one line with two arrowheads (`12⇄3`). Dashed = every import behind the line is
type-only; dotted = a relation before the change (to or from a deleted file). Width grows with
the count. A line is a cycle (magenta, `↻` on its label) only where that is true: between two of
the group's own nodes that lie in one strongly connected component of the own nodes; whenever an
import behind it joins two files of one file cycle (`model.cycles`); and for a ⇄ pair or a
context link used both ways. Context nodes never join the component search: one of them lumps
unrelated directories together (`packages/ui` imports the SDK, the SDK imports
`packages/shared`, both in "Modul-Registry"), and a loop through it is no loop between files.

The layout (`layout.ts`) has two stages. Inside a frame, dagre lays the group's own connected
nodes out in layers, left to right: with "Grundlagen links" an imported node stands left of its
importer (dagre gets every import reversed; "Grundlagen rechts" mirrors it). Count labels get
their own layer, so they never sit on a node. A line never runs under a node: dagre gives it a
point in every layer it crosses, where no node of that layer is; the line runs horizontally
through each layer's band at that point, leaves and enters a node at the side facing the next
layer, and bends only in the gaps between bands (a curve with horizontal tangents at every
point, which stays inside its gap; `layout.test.ts` checks this on random levels). Nodes without
an edge inside the frame stand in a block of rows below the drawing, in the level's order
(chapters by number). Outside the frame, the context nodes stand in a column on the "Grundlagen"
side (what the group mainly imports) and on the other side (what mainly imports it), each at the
height of the nodes it is connected with, with ONE line per context node to the frame; the lines
to the single nodes inside are drawn while one end is hovered. Keeping context out of dagre is
what keeps a dense level readable: otherwise every file of a module folder that imports
`packages/shared` adds a long line across all layers.

Nodes are sized to their names (`labels.ts`, measured on a canvas in the UI font, `--font-sans`;
the `FONTS` table in `MapView.tsx` and the classes in `nodes.tsx` have to name the same sizes and
weights): a file or
context node grows up to 300 / 340 px and cuts a longer name in the middle (`installed-mod…
-name.ts`), a chapter node widens so its title fits in two lines.

The first view is as large as fits, but never below a readable zoom (0.72; 0.6 on a level of up
to 15 nodes). When even that does not show the whole drawing, it starts at the "Grundlagen"
side, and a minimap and a note ("Nicht alles im Blick …") say there is more. "Einpassen" fits
everything, out of the minimap's corner. Hovering a node dims everything that is not connected
to it and names the strongest relations, in a tooltip placed where it covers the fewest of the
nodes that stay lit.

### The file page

Header (sticky): the path (every directory opens the map at that folder), status, +/−, chapter,
"Gesehen" (`v`), "Datei kommentieren" (`c`), previous / next file in reading order (`k` / `j`),
"Auf der Karte zeigen" (the map of the file's group with the file marked), copy. "Zusammenhang" (`neighbours.ts`) merges the
import statements per target and splits both sides into changed files, changed files that the
review leaves out (with their category) and unchanged files; the last two sit behind toggles. An
importer opens at the line of its import statement. For a file no extractor reads (Markdown, a
dotfile) that nothing imports, it is one line saying so.

The code (`rows.ts` + `CodeView.tsx`): the base lines a block replaced stand above it in red
("Entferntes zeigen"); replaced lines are marked ochre, purely added lines green, in the gutter
and as a tint; a pure deletion with the removed lines hidden leaves a marker row. "Nur Änderungen"
folds unchanged stretches beyond three lines of context into "… 48 unveränderte Zeilen" (a click
opens one; a `?line=` inside a fold opens it). `n` / `p` scroll the next / previous block to
three lines below the header, so the lines before it stay in view; the counter starts over when
the rows change ("Nur Änderungen", "Entferntes zeigen"). An added, deleted or unchanged file is
shown plain, with a badge. Rows are
rendered in chunks of 150 with `content-visibility: auto`, which keeps the 1 589-line
`plugins/service.ts` smooth (60 scroll steps of 500 px: 95th percentile frame 16.8 ms) while
find-in-page still sees every line.

Comments (`components/comments/`, `lib/threads.ts`): a "+" in the gutter of a numbered line
opens an editor below it (drag over lines for a range, one listener on the code view for all
rows); a saved comment is a card below its last line, and commented lines never fold (`pinned` in
`rows.ts`). A comment whose lines have changed since says so (`isOutdated`); one whose lines are
gone moves to the comments on the whole file, which sit between "Zusammenhang" and the code. The
"Kommentare" sheet of the header lists them all in reading order and copies them as one prompt
(`buildPrompt`; `lib/clipboard.ts` falls back to `execCommand` outside a secure context). A new
comment carries the two commits the page shows: when the branch has moved on, the server answers
409, the model is loaded again and the editor keeps its text. A draft remembers the commit its
lines were read off (the head; the base for a file the range deletes) and says so when the page
reads them off another one since. The sheet asks the server again when it opens and when the tab
comes back, so a comment written in another tab is in the prompt; until the answer is there it
does not copy or delete, and when no answer comes it says that its list may be behind.

### Adding a page (a view with a route)

One file and one line. The view gets the route; `useAtlas()` gives it the review, the model,
the visible files, the viewed marks and `go()` / `href()`; its words go into `strings.ts`.

```tsx
// src/ui/views/stats/StatsView.tsx
import { useAtlas } from "../../state/atlas";
import { S } from "../../strings";
import type { ViewProps } from "../index";

export function StatsView(_props: ViewProps) {
	const { visible } = useAtlas();
	return <section className="stats">{S.files(visible.length)}</section>;
}

// src/ui/views/index.ts
export const VIEWS = { map: MapView, file: FilePage, stats: StatsView };
```

It is reachable at `#/stats`; link to it with `href({ view: "stats", path: "", query: {} })`.
It is styled with utilities and the components in `components/ui`; what utilities do not fit goes
into a sheet that `globals.css` imports.

### How the UI was checked

`bun test` covers the pure parts: routes, fuzzy search, the folder tree, the group tree (chapters
and units, collapsing, single-file directories, locating ids), levels (context, lifting, pairs,
cycles that are true, hover neighbourhood), the layout (direction, no overlaps, frame, wrapped
context columns, unconnected nodes below the drawing, no line under a foreign node on random
levels, tooltip placement), node labels (measured widths, middle cuts), the code rows (removed
lines, markers, folds, anchors), the neighbourhood, and the comments (snippets, order, the
prompt, the store). The core is also tested end to end on a
temporary git repository (`src/core/range.test.ts`: added, modified, renamed and deleted files, a
deleted workspace package, a `-diff` text file, a moved range). The views were driven in Chromium
against a real review with Playwright (not a dependency of the tool): drill-down and
breadcrumb, back/forward with the reading position, reload on a deep link, `j k v n p`, an
importer opening at its line, the viewed mark surviving a reload, a moved range (intercepted
answers), range switch, category toggle, search, folds, theme, sidebar, and the loading, error,
unknown-path, binary and truncated states, comments (lines, ranges, whole files, the copied
prompt), in light and dark at 1440 and 1100 px.
