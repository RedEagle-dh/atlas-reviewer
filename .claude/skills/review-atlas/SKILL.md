---
name: review-atlas
description: Write or adjust a review file (`*.review.ts`) for review-atlas, the local tool that shows the changes of a git branch in the browser as a map of the changed files plus a reader where the reviewer comments lines for a coding agent. Use when the user wants to review a branch, PR or commit range with review-atlas / "the atlas", asks for a review file, ranges, chapters or a reading order for a branch, or says things like "Review-Datei für Branch X", "mach mir einen Atlas für den Branch", "review.ts schreiben", "Kapitel fürs Review", "Leseordnung für den PR". Covers where the file goes, every field, the glob and category rules, and checking the file with `check` until it is clean. No knowledge of the tool's source is needed.
---

# Writing a review-atlas review file

review-atlas reads a repository **only through git** (two commits, never the working tree) and
shows the files changed between them in the browser: a **map** (chapters → folders → files, with
arrows for imports) and a **reader** with the changed lines marked, where the reviewer comments
lines and copies all comments as one prompt for a coding agent.

A review file says: which repository, which ranges (`base..head`), which changed files are left
out or hidden at first, and the **chapters**: the order in which a human reads the change. Your job
is a file that `check` accepts and whose chapters lead from the foundation of the change to its
consumers. Everything you need about the tool is on this page; do not read the tool's source. Do
read the code of the repository under review: that is where the reading order comes from.

## Locate the tool

`<atlas>` below is the review-atlas checkout: the directory that holds `bin/review-atlas.ts`.
`<skill>` is this skill's own directory. Find `<atlas>` in this order and take the first that
holds `bin/review-atlas.ts`:

1. `$REVIEW_ATLAS_DIR`, when it is set.
2. `realpath "<skill>/../../.."`: the skill is the one inside the checkout
   (`<atlas>/.claude/skills/review-atlas/`), used there or linked from elsewhere.
3. Ask the user. An installed skill (`skills add` copies it to `~/.agents/skills/`) does not know
   where the checkout is. Suggest they set `export REVIEW_ATLAS_DIR=<path>` in their shell
   profile, so the next run finds it.

Commands (need [Bun](https://bun.sh); work from any directory):

```sh
bun <atlas>/bin/review-atlas.ts check <review-file> [--range <id>]
bun <skill>/files.ts <atlas> <review-file> [<range id>]
bun <atlas>/bin/review-atlas.ts serve <review-file> [--range <id>] [--port 4610] [--open]
```

Inside `<atlas>` the first and last are `bun run atlas:check <file>` and `bun run atlas <file>`.

- `check` builds one range (the first, or `--range <id>`) and prints counts: files per category
  and chapter, imports, cycles. Exit 0: fine. Exit 1: the file does not load or is invalid (every
  problem is listed), a git ref or the repository does not exist, or an import is unresolved that
  `expectedUnresolved` does not list. Exit 2: wrong arguments or an unknown `--range` id.
  (`--cold` ignores the tool's import cache; you never need it for writing a review file.)
- `files.ts` (next to this page) lists every changed file of the range in reading order, one per
  line, tab-separated: chapter, category, path; the left-out files last as `(left out)`. Then
  the imports against the reading order: for each pair of chapters where a file of the earlier
  one imports a file of the later one, how many file pairs and one example. Use it to see where a
  file landed and whether the chapter order follows the imports. If it fails after an update of
  the tool, `check` still works; go on without it.
- `serve` runs until stopped (Ctrl-C) and prints the URL, by default `http://127.0.0.1:4610`. Do
  not start it unless the user asks; hand them the command. If they ask, run it in the background.

## Where the file goes

Put it at `<atlas>/reviews/local/<id>.review.ts` (create `reviews/local/` if missing). That
directory is git-ignored: a review file names a local path and describes a project's layout,
which must not end up in the tool's repository. `<atlas>/reviews/` itself is tracked; only the
template `example.review.ts` belongs there.

```ts
import { defineReview } from "../../src/core/define"; // from reviews/local/
export default defineReview({ /* … */ });
```

A file anywhere else imports `defineReview` by absolute path: `"<atlas>/src/core/define"`. The
file must `export default defineReview({ … })`.

**`id` is the key of the reviewer's work.** Viewed marks and comments are stored in
`<atlas>/.review-atlas/{state,comments}/<id>.json`. When you edit an existing review, never change
its `id` (the marks and comments would be gone from the page); for a new review pick an id no
other review file uses (two reviews with one id share marks and comments).

## Procedure

1. **Find repository and range.** Ask only what you cannot find out: the repository (absolute
   path), the branch or commits to review, what they are compared with (usually the default
   branch). Verify every ref you plan to use: `git -C <repo> rev-parse --verify '<ref>^{commit}'`.
2. **See what changed.** For a branch against main:
   `git -C <repo> diff --name-status main...<branch>` (three dots: since the merge base, the same
   as `mergeBase: true`). For a commit range the user names ("from abc123 to HEAD"):
   `git -C <repo> diff --name-status abc123 HEAD`. Then `git -C <repo> log --oneline <base>..<head>`:
   it tells you whether further ranges help (see Ranges).
3. **Write a minimal file** (template A below) and run `check`. Read the lines `category`,
   `left out` and `logic/unit`.
4. **Add chapters** (see Chapters) and `categories` rules, run `check` and `files.ts` again.
   Repeat until `check` exits 0, no chapter of the first range has 0 files, and the last chapter
   (`rest`) holds only what you mean it to. Run `check --range <id>` for every further range: it
   must exit 0 too, but a narrower range may leave some chapters empty, that is fine.
5. **Hand over:** the file's path, the chapters with their file counts, every decision the
   reviewer should know about (files moved to a category, `expectedUnresolved` entries, cycles,
   ranges you added on your own), and the command `bun run atlas <file> --open` (inside `<atlas>`).

## Every field

```ts
defineReview({
	id: "feature-x",            // required; slug: ^[a-z0-9][a-z0-9._-]*$ (case-insensitive)
	title: "Feature X",         // required; the page title
	repo: "/abs/path/to/repo",  // required; absolute, or relative to the review file
	ranges: [                   // required; at least one; the first is the default
		{
			id: "branch",           // required; slug; unique among the ranges
			label: "Whole branch",  // required; shown in the range switcher
			base: "main",           // required; any git revision: branch, tag, sha, origin/main
			head: "feature-x",      // optional; default "HEAD"
			mergeBase: true,        // optional; base becomes `git merge-base base head`
			note: "…",              // optional; one line under the label in the range switcher
		},
	],
	excludeCategories: ["test", "migration", "generated", "asset"], // never in the review
	defaultCategories: ["logic"], // visible when the page opens (default ["logic"]); others one click away
	categories: [{ category: "test", label: "Tests", match: ["**/testing.ts"] }], // before the built-ins
	exclude: ["vendor/**"],       // globs never in the review, whatever their category
	chapters: [{ id: "core", title: "Core", summary: "One sentence.", match: ["packages/core/**"] }],
	restTitle: "Wiring",          // title of the last chapter (files no chapter matches)
	expectedUnresolved: ["./.next/types/**"], // import specifiers known not to resolve
	description: "…",             // optional; stored, not shown on the page
});
```

Checked on load; `check` lists every violation and exits 1:

- `id`, `title`, `repo` are non-empty strings; range and chapter ids are slugs and unique. Keep
  chapter ids at 10 characters or fewer, or `check`'s table goes out of line.
- Every `match`, `exclude`, `excludeCategories`, `defaultCategories`, `expectedUnresolved` is a
  **list** of strings: `match: "src/**"` is an error, `match: ["src/**"]` is right.
- `excludeCategories` and `defaultCategories` name known categories: the built-in ids below, or an
  id introduced by a `categories` rule. A category in `defaultCategories` must not be excluded.
- The chapter id `rest` is reserved.

## Ranges

- `head` defaults to `HEAD`: whatever is checked out in `repo` **at the moment the page builds**.
  When the branch is not checked out there, or the user may switch branches, set
  `head: "<branch>"`. A range that must never move (a review of fixed commits) takes a sha as
  `head`. Uncommitted changes are never shown.
- `base` is resolved on its own, not relative to `head`: with `head: "feature-x"` the last commit
  is `base: "feature-x~1"`, not `"HEAD~1"`.
- `mergeBase: true` compares with the point where the branch left `base`: only what the branch
  did, like a pull request. Without it, both trees are compared directly, and whatever `base` got
  after the branch forked shows up as reverted. For "branch against main" always set it. When
  `base` is a commit on the branch itself (an ancestor of `head`), it makes no difference; leave
  it out.
- `X~N` follows first parents only: on a branch with merge commits it may not exist (`unknown
  git ref`). Prefer a sha then.
- Refs are resolved on every build: new commits on the branch appear without editing the file.

Useful ranges (put first the one the reviewer wants most):

```ts
{ id: "branch", label: "Whole branch", base: "main", mergeBase: true },
{ id: "last", label: "Last commit", base: "feature-x~1", head: "feature-x" },
{ id: "since-review", label: "Since the last review", base: "3f2a91c", note: "What came after the review of 12 Nov." },
// The branch starts with mechanical commits (rename, formatting): skip them.
{ id: "logic", label: "Without the rename", base: "<sha of the last mechanical commit>", note: "The commits before only rename packages." },
```

Add ranges the user did not ask for only when the log clearly suggests them, and say so.

## Globs

Matched against repo paths (`/`-separated, relative to the repository root); a leading `./` or
`/` in a pattern is ignored.

| Pattern            | Matches                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `apps/web/**`      | everything below `apps/web/`                                        |
| `**/*.md`          | Markdown files at any depth                                         |
| `*.md`             | Markdown files **at the root only**                                 |
| `src/lib`          | only a **file** of that exact path; a directory needs `src/lib/**`  |
| `**/{a,b}.ts`      | `a.ts` or `b.ts` anywhere (alternatives may nest and contain globs) |
| `src/*/index.ts`   | `*` stays inside one segment; `?` is one character                  |

- No negation (`!`) and no character classes (`[` and `]` are literal). To carve something out,
  put a more specific rule before the general one: the first match wins, in chapters and in
  categories alike.
- A dot is an ordinary character: `*` matches `.env`.
- A deleted file is matched by its old path, a renamed one by its new path.
- A glob that matches nothing is **not** reported. Only a `0` in `check`'s table (or the missing
  file in `files.ts`) shows it.

## Categories

Every changed file gets one category. The review's own `categories` rules are tried first, in
order; then the built-in rules, in this order. The first match wins.

| id          | built-in rule                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `generated` | lockfiles (`bun.lock`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `go.sum`, `flake.lock`, …), `*.snap`, `*.gen.*`, `*.generated.*`, `*.min.{js,css}`, `*.{js,css}.map` |
| `migration` | `**/drizzle/**`, `**/migrations/**`                                                                                                      |
| `docs`      | `**/*.md`, `**/*.mdx`, and **everything** below a root `docs/` (images too)                                                              |
| `test`      | `*.test.*`, `*.spec.*`, `*.testing.*`, and everything below a `__tests__/`, `test/`, `tests/`, `testing/`, `fixtures/` or `e2e/` directory |
| `locale`    | `**/locales/**`, `**/i18n/**/*.json`                                                                                                     |
| `asset`     | images, fonts, audio/video, archives, `pdf`, `wasm`, `svg`, …, and any other binary file                                                |
| `config`    | `package.json`, `tsconfig*.json`, `jsconfig*.json`, `biome.json`, `turbo.json`, `deno.json`, `components.json`, `*.config.*`, dotfiles and anything in a dot directory, `*.{yml,yaml,toml,ini,jsonc}`, `Dockerfile*`, `Makefile`, `helm/**`, `.github/**`, `.env*` |
| `logic`     | source files: ts/tsx/js/jsx/mjs/cjs, vue/svelte/astro, css/scss/sass/less, html, sh, py, rb, go, rs, java, kt, swift, c/cpp, cs, php, sql, graphql, lua, nix |
| `other`     | everything else (any other `.json`, `.txt`, unknown extensions)                                                                          |

- Order matters for binaries: an image below `docs/` is `docs`, one in a `fixtures/` directory is
  `test`. When such images should be left out, add a rule (`{ category: "asset", match: ["docs/**/*.png"] }`).
- `excludeCategories`: left out entirely (`check` counts them under `left out`). The usual choice
  is `["test", "migration", "generated", "asset"]`. When the user wants to review tests or schema
  changes, leave `test` (or `migration`) out of `excludeCategories`.
- `defaultCategories`: shown when the page opens; every other non-excluded category is one click
  away (docs, config, locale by default).
- `categories` moves files into a category. Typical: test helpers the built-in rules take for
  `logic` (`**/testing.ts`, a fixture outside a `fixtures/` directory), generated code whose name
  does not say so (`src/gen/**` → `generated`). Write a short comment why next to a single file.
  A new id makes a new category (`{ category: "infra", label: "Infrastruktur", match: ["terraform/**"] }`),
  which may then appear in `excludeCategories` / `defaultCategories`. `label` replaces the word
  the page shows (the page's own words are German).
- Custom rules come first, so a broad one (`apps/api/**` → `api`) also swallows the tests in
  there. Keep them narrow.
- `exclude` drops files by path whatever their category: vendored code, big data files.

## Chapters: the reading order

Every changed file (of any category, not only `logic`) lands in the **first** chapter whose
`match` matches it; files no chapter matches land in a last chapter `rest` (titled `restTitle`,
else the page's word "Übrige"). The order of `chapters` is the reading order (`j`/`k` on the page
follow it). Inside a chapter the tool orders the files itself: what is imported comes before what
imports it. `summary` is shown in the sidebar and on the map. Chapters are shared by all ranges.

Without chapters every file lands in `rest`: the map groups by package and folder, and the reading
order is the import order over the whole change (ties by path). That is fine for a small change
(about 15 files or fewer).

How to cut chapters:

1. Start from `check`'s `logic/unit` line and the diff's file list. A unit is the directory of the
   nearest `package.json` that has a `name`, the root's not counted; without one, the top-level
   directory (`src`, `bin`, …).
2. **Foundation first, consumers last.** Ask what the change is about and what a reader must know
   before the rest makes sense: shared types and libraries, the data model, then the server, then
   clients and UI, then wiring (entry points, app setup). When files in A import files in B, B's
   chapter comes first. `files.ts` lists the imports that run against your order; move chapters
   until the remaining ones are few or deliberate (a chapter put first on purpose, an example or
   an overview, may well import later ones). To understand what a file does, read it in the
   repository under review (`git -C <repo> show <head>:<path>`).
3. Split a package with more than about 25 files by concern, unless its files are uniform (a
   folder of generated UI primitives, of similar handlers): one chapter reads better then. Fold a
   chapter of one or two files into its neighbour. Aim for 4–12 chapters.
4. **Order is precedence too.** A specific chapter (`apps/web/src/lib/**`) must come before the
   general one (`apps/web/**`), or the general one takes its files; so the specific one is also
   read first. When that is the wrong reading order, make the general chapter's `match` narrower
   instead of relying on a catch-all.
5. Single files may be named: an entry point or a config that belongs to a concept
   (`"apps/api/src/app.ts"`) can join that concept's chapter.
6. Docs and config are hidden when the page opens (unless in `defaultCategories`), and the sidebar
   leaves out a chapter with no visible file: a chapter of only docs or config does not show
   until those categories are switched on. Let them ride along with the code they belong to, or
   leave them to `rest`.
7. `title` says what the reader learns ("Data model", "How a payment is retried"), not just a
   folder name. `summary` is one sentence: what this part does or why it changed.
8. Write titles, summaries, labels and notes in the language the reviewer works in; the page
   itself is German.

## Reading `check`'s output

For template B below, it looks like this:

```
review  Billing v2 (billing-v2)
repo    /Users/me/code/platform
range   branch — Whole branch: main (merge base) 1a2b3c4d5e .. feat/billing-v2 9f8e7d6c5b

files   96 changed: 84 in the review, 12 left out
  status:     modified 50 · added 30 · deleted 4
  category:   logic 74 · config 5 · docs 3 · migration 2
  left out:   test 10 · generated 2
  logic/unit: apps/api 30 · apps/web 28 · packages/billing 12 · packages/db 4
  chapters:
     1 model         6  Data model  (logic 4 · migration 2)
     2 domain       13  Billing rules  (logic 12 · docs 1)
     3 api          32  API  (logic 30 · config 2)
     4 web-core      9  Web: data and state  (logic 9)
     5 web          21  Web: screens  (logic 19 · config 2)
     6 rest          3  Tooling and docs  (docs 2 · config 1)

edges   140 between review files (18 type-only)
  kind:       value 115 · type 18 · re-export 5 · dynamic 2
  outside:    61 imports of unchanged files, 23 importers among unchanged files

unresolved 0 (relative, alias, workspace)
only tests import 0 logic file(s) (package entry points not counted)
external  14 npm packages, 2 builtins (imported by review files)
  …
cycles  0
```

What each part asks of you:

- `range`: are base and head the commits you meant? `(merge base)` appears with `mergeBase`.
- `files N changed: X in the review, Y left out`: `status`, `category`, `logic/unit` and the
  chapter table count only the X files in the review; `left out` counts the Y. X = 0 means a
  wrong range. Several hundred: think about more `exclude`s and a finer chapter cut, and tell the
  user.
- `category`: many `other` are files with unknown extensions; add a `categories` rule if they
  matter. `logic` files that are really generated get a `generated` rule.
- `left out`: make sure nothing the reviewer wants is excluded.
- `chapters`: a `0` is a glob that matches nothing, or a chapter whose files an earlier one took
  (`files.ts` shows where they went). A big `rest` means a missing chapter, unless you mean it
  (then give it a `restTitle`).
- `edges`: imports between review files; `kind` splits them (`type` = type-only, drawn dashed);
  `outside` says how much the change touches unchanged code. Information only.
- `unresolved N` (exit 1): relative, alias or workspace imports of review files that point at no
  file, listed with `file:line`. If the target is generated and not committed (framework type
  output, codegen), add the specifier pattern to `expectedUnresolved` (a leading `./` may be left
  out); `check` then lists it apart and passes. If the import is really broken in the branch, do
  not hide it: tell the user, it is a finding.
- `only tests import N logic file(s) — add them to the review's test rule?`: the listed files are
  most likely test helpers; look at them, then add them to a `{ category: "test", match: [ … ] }`
  rule.
- `cycles`: import cycles among the review files, drawn magenta on the map. Nothing to fix in the
  review file; mention them to the user.
- `external`, `repo`, `timing`: information only.

## Templates

A. Minimal, for a small branch:

```ts
import { defineReview } from "../../src/core/define";

export default defineReview({
	id: "fix-login-timeout",
	title: "Login timeout fix",
	repo: "/Users/me/code/shop",
	ranges: [{ id: "branch", label: "Whole branch", base: "main", head: "fix/login-timeout", mergeBase: true }],
	excludeCategories: ["test", "migration", "generated", "asset"],
	defaultCategories: ["logic"],
});
```

B. A monorepo branch with chapters:

```ts
import { defineReview } from "../../src/core/define";

export default defineReview({
	id: "billing-v2",
	title: "Billing v2",
	repo: "/Users/me/code/platform",
	ranges: [
		{ id: "branch", label: "Whole branch", base: "main", head: "feat/billing-v2", mergeBase: true },
		{ id: "last", label: "Last commit", base: "feat/billing-v2~1", head: "feat/billing-v2" },
	],
	excludeCategories: ["test", "generated", "asset"], // migrations stay: the schema change matters
	defaultCategories: ["logic", "migration"],
	categories: [
		{
			category: "test",
			match: [
				"**/testing.ts",
				// Sample invoices; only *.test.ts import them.
				"packages/billing/src/samples.ts",
			],
		},
	],
	exclude: ["packages/billing/vendor/**"],
	chapters: [
		{ id: "model", title: "Data model", summary: "Plans, subscriptions and invoices as tables.", match: ["packages/db/**"] },
		{ id: "domain", title: "Billing rules", summary: "Proration, taxes and the invoice run.", match: ["packages/billing/**"] },
		{ id: "api", title: "API", summary: "Endpoints and webhooks that use the new rules.", match: ["apps/api/**"] },
		{ id: "web-core", title: "Web: data and state", match: ["apps/web/src/lib/**", "apps/web/src/hooks/**"] },
		{ id: "web", title: "Web: screens", summary: "Checkout and the account's billing page.", match: ["apps/web/**"] },
	],
	restTitle: "Tooling and docs",
});
```
