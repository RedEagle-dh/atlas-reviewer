/**
 * THE contract between core, server and UI. Everything the UI shows comes through the five
 * answers below (`ReviewMeta`, `ReviewModel`, `FileView`, `ViewedState`, `CommentsState`). The UI
 * imports this file with `import type` only, so nothing of git or the filesystem reaches the
 * browser bundle.
 *
 * The review configuration types (what a `*.review.ts` file contains) live here too, so there
 * is exactly one place that names the shapes of this tool.
 */

// ---------------------------------------------------------------------------------------------
// Review configuration (a `*.review.ts` file)
// ---------------------------------------------------------------------------------------------

export interface ReviewConfig {
	/** Slug; names the state file. */
	id: string;
	title: string;
	description?: string;
	/** Absolute, or relative to the review file. */
	repo: string;
	/** The first is the default. */
	ranges: RangeConfig[];
	/** Files of these categories are never part of the review. */
	excludeCategories?: string[];
	/** Visible when the page opens; default `["logic"]`. */
	defaultCategories?: string[];
	/** Checked BEFORE the built-in rules; first match wins. */
	categories?: CategoryRule[];
	/** Globs: never part of the review, whatever their category. */
	exclude?: string[];
	/** Ordered = reading order; first match wins; the rest goes to the chapter "rest". */
	chapters?: ChapterConfig[];
	/** Title of the chapter "rest" (files no chapter matches); default: the UI's own word. */
	restTitle?: string;
	/**
	 * Globs over import specifiers that are known not to resolve, e.g. generated files that are
	 * not committed (`./.next/types/**`; a leading `./` may be left out). `atlas:check` lists them
	 * apart and does not fail on them.
	 */
	expectedUnresolved?: string[];
}

export interface RangeConfig {
	id: string;
	label: string;
	/** Any git revision: branch, tag, sha. */
	base: string;
	/** Defaults to `HEAD`. */
	head?: string;
	/** When true the base is `git merge-base <base> <head>`. */
	mergeBase?: boolean;
	note?: string;
}

export interface CategoryRule {
	category: string;
	/** UI label; for a built-in category it replaces the UI's own word. */
	label?: string;
	/** Globs (see `glob.ts`), matched against the repo path. */
	match: string[];
}

export interface ChapterConfig {
	id: string;
	title: string;
	summary?: string;
	match: string[];
}

// ---------------------------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------------------------

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

/** Strongest first: an edge that has a value import is a value edge. */
export type ImportKind = "value" | "re-export" | "dynamic" | "side-effect" | "type";

// ---------------------------------------------------------------------------------------------
// GET /api/review
// ---------------------------------------------------------------------------------------------

export interface ReviewMeta {
	id: string;
	title: string;
	description?: string;
	/** Basename of the repository directory. */
	repoName: string;
	/** Absolute path of the repository. */
	repoPath: string;
	/** In configured order; the first is the default range. */
	ranges: { id: string; label: string; note?: string }[];
	/**
	 * Only the categories that are not excluded, in classification order. `label` only when the
	 * review file gives one: the words for the built-in ids live in the UI (`src/ui/strings.ts`).
	 */
	categories: { id: string; label?: string; defaultVisible: boolean }[];
	/**
	 * In reading order, the rest chapter (`id: "rest"`) last. `title` is missing only for the rest
	 * chapter when the review gives no `restTitle` (the UI has its own word for it).
	 */
	chapters: { id: string; title?: string; summary?: string }[];
}

// ---------------------------------------------------------------------------------------------
// GET /api/model?range=<id>
// ---------------------------------------------------------------------------------------------

export interface ReviewModel {
	range: {
		id: string;
		label: string;
		note?: string;
		/** `ref` as configured; `sha` is the resolved commit (the merge base when `mergeBase`). */
		base: { ref: string; sha: string };
		head: { ref: string; sha: string };
		mergeBase: boolean;
	};
	/** Every changed file that is not excluded — ALL categories — sorted by path. */
	files: ChangedFile[];
	/**
	 * Imports between two entries of `files`; one edge per (from, to); sorted by from, to. An edge
	 * that touches a deleted file comes from the base commit: the import as it was before the change
	 * (the deleted file's own imports, and the files that imported it then).
	 */
	edges: Edge[];
	/** Paths of `files`: chapter order, inside a chapter dependencies first. */
	readingOrder: string[];
	/**
	 * Import cycles among `files`: each entry is one strongly connected component of the edge
	 * graph (two or more files, or one file that imports itself), its paths sorted. An edge
	 * `a → b` lies on a cycle exactly when `a` and `b` are in the same entry. All edge kinds
	 * count, type-only ones included.
	 */
	cycles: string[][];
	/** Category → how many changed files were left out (by category or by an `exclude` glob). */
	excluded: Record<string, number>;
	/** Relative, alias and workspace specifiers of `files` that resolve to no file. */
	unresolved: { from: string; specifier: string; line: number }[];
	/** ISO timestamp. */
	generatedAt: string;
}

export interface ChangedFile {
	path: string;
	/** Set for a renamed file. */
	oldPath?: string;
	status: FileStatus;
	added: number;
	deleted: number;
	binary: boolean;
	category: string;
	/** Chapter id; `"rest"` when none matches. */
	chapter: string;
	/**
	 * Dir of the nearest workspace `package.json`, else the top-level dir; `"."` for a root file.
	 * For a deleted file the packages of the base commit count.
	 */
	unit: string;
	/** Highlighter language id. */
	language: string | null;
	/** Blob sha at head (null when deleted). */
	blob: string | null;
	/**
	 * Blob sha at base (null when added). A deleted file is "viewed" at this sha, so the viewed
	 * key of a file is `blob ?? baseBlob`.
	 */
	baseBlob: string | null;
	/** Unchanged repo files it imports / that import it (distinct files; at base for a deleted file). */
	outside: { imports: number; importers: number };
}

export interface Edge {
	from: string;
	to: string;
	/** The strongest kind of all import statements `from` has for `to`. */
	kind: ImportKind;
	/** Union of the imported names, in source order. */
	names: string[];
	/** Line of the first import statement. */
	line: number;
}

// ---------------------------------------------------------------------------------------------
// GET /api/file?range=<id>&path=<repo path>[&base=<sha>&head=<sha>]
// ---------------------------------------------------------------------------------------------

/**
 * Any file of the head commit, changed or not (or of the base commit for a deleted file). With
 * `base` and `head` (the shas of the model the page shows) the answer is 409 `range-moved` when
 * the range has moved on since, so a page never mixes two states of the branch.
 */
export interface FileView {
	path: string;
	oldPath?: string;
	status: FileStatus | "unchanged";
	category: string;
	language: string | null;
	/** Bytes of the blob. */
	size: number;
	binary: boolean;
	/** True when the file was above the highlight limits: plain text, cut to the limits. */
	truncated: boolean;
	/** Head content (base content for a deleted file). */
	lines: TokenLine[];
	/** Colour table for the tokens: `[light, dark]` CSS colours. Index 0 is the plain text colour. */
	palette: [light: string, dark: string][];
	/**
	 * Sorted by `start`; empty for an unchanged file. An added (or deleted) file has ONE block
	 * over all its lines with no removed lines.
	 */
	changes: ChangeBlock[];
	/** False when no extractor reads this kind of file: then `imports` is empty for lack of knowledge. */
	importsRead: boolean;
	/**
	 * Every import statement of this file, in source order. A deleted file's imports are resolved
	 * against the base commit; targets are given as head paths (a renamed target by its new path).
	 */
	imports: ImportRef[];
	/**
	 * Every repo file that imports this one, one entry per importing file, sorted by path. Includes
	 * deleted files that imported it at base; for a deleted file, the files that imported it at base.
	 */
	importers: ImporterRef[];
}

/** `colour` indexes `FileView.palette`; `fontStyle` is a bit set: 1 italic, 2 bold, 4 underline, 8 strikethrough. */
export type Token = [text: string, colour: number, fontStyle?: number];
export type TokenLine = Token[];

export interface ChangeBlock {
	/** 1-based head line where the block begins (may be `lines.length + 1` for a deletion at the end). */
	start: number;
	/** Head lines it covers; 0 = pure deletion BEFORE line `start`. */
	count: number;
	/** The base lines this block replaced (highlighted). */
	removed: TokenLine[];
}

export type ImportWhere = "review" | "unchanged" | "excluded" | "external" | "unresolved";

export interface ImportRef {
	line: number;
	specifier: string;
	kind: ImportKind;
	names: string[];
	/** Repo path when it resolves into the repository. */
	target: string | null;
	/** The target's category (`logic`, `test`, …) when it resolves into the repository. */
	category?: string;
	where: ImportWhere;
	/** npm package name (or `bun:` / `node:` builtin) for "external". */
	package?: string;
}

export interface ImporterRef {
	path: string;
	where: "review" | "unchanged" | "excluded";
	/** The importer's category (`logic`, `test`, …), so the UI can say why an importer is left out. */
	category: string;
	/** Strongest kind over the importer's statements for this file. */
	kind: ImportKind;
	names: string[];
	/** Line of the importer's first import statement for this file. */
	line: number;
}

// ---------------------------------------------------------------------------------------------
// GET /api/state → ViewedState; PUT /api/state ViewedUpdate → ViewedState
// ---------------------------------------------------------------------------------------------

/** Path → blob sha it was viewed at. Per review, not per range. */
export interface ViewedState {
	viewed: Record<string, string>;
}

export interface ViewedUpdate {
	path: string;
	viewed: boolean;
	/** Range whose head (or base, for a deleted file) gives the blob sha; default: the first range. */
	range?: string;
	/**
	 * The blob the page shows (`ChangedFile.blob ?? baseBlob`). When it is no longer the file's
	 * blob in the range, nothing is written and the answer is 409 `range-moved`.
	 */
	blob?: string;
}

// ---------------------------------------------------------------------------------------------
// GET /api/comments → CommentsState; POST /api/comments CommentDraft → CommentsState;
// PUT /api/comments/:id CommentEdit → CommentsState; DELETE /api/comments/:id → CommentsState;
// DELETE /api/comments → CommentsState (empty)
// ---------------------------------------------------------------------------------------------

/**
 * A review comment: on lines of a file, or on the file as a whole. Per review, like the viewed
 * marks. The reader collects them and hands them to a coding agent as one prompt.
 */
export interface ReviewComment {
	/** Made by the server. */
	id: string;
	/** Repo path (the head path; the base path of a deleted file). */
	path: string;
	/**
	 * First commented line, 1-based, as the file page numbers them (head lines; base lines of a
	 * deleted file). Absent: a comment on the whole file.
	 */
	line?: number;
	/** Last commented line (inclusive) when more than one; absent: just `line`. */
	endLine?: number;
	/**
	 * The commented lines as text when the comment was written (at most the first SNIPPET_LINES
	 * of them, see `src/ui/lib/comments.ts`): what a prompt quotes, and how the place is found
	 * again after the code moved. Only with `line`.
	 */
	snippet?: string;
	/** Trimmed, never empty. */
	text: string;
	/**
	 * The range the comment was written in, and that range's head commit then: the commit its
	 * line numbers belong to (the one the writer's page showed, see `CommentDraft.head`).
	 */
	range: string;
	head: string;
	/**
	 * Only for a comment on a file that its range deletes: the range's base commit then. The file
	 * as the writer saw it, and so the comment's line numbers, are that commit's (at `head` there
	 * is no such file). Recorded by the server, so a prompt can say it whatever range is shown.
	 */
	base?: string;
	/** ISO timestamps; `updatedAt` moves when the text is edited. */
	createdAt: string;
	updatedAt: string;
}

/** In the order they were written. */
export interface CommentsState {
	comments: ReviewComment[];
}

/**
 * Body of `POST /api/comments`. The server makes `id` and the timestamps, records the range's
 * head commit of that moment as the comment's `head` and trims `text`; the new comment is the
 * LAST entry of the answer. 400 `bad-request` when a field breaks a rule (the message names it):
 * `path` a non-empty string, `line` and `endLine` positive integers, `endLine` only with `line`
 * and not before it, `text` not empty and at most 10 000 characters, `snippet` at most 8 000
 * (the limits are constants of `src/core/comments.ts`), `range` a string, `head` a non-empty
 * string. 404 `unknown-range`; 409 `range-moved` when `head` is not the range's head commit
 * (checked before the path: a moved range is said first); 404 `not-found` when `path` is no file
 * of the range's head commit and no deleted file of its base (never a read from disk). Unknown
 * fields are ignored.
 */
export interface CommentDraft {
	path: string;
	line?: number;
	/** Stored only when it is after `line`. */
	endLine?: number;
	/** Stored only with `line`. */
	snippet?: string;
	text: string;
	/** Default: the first range. */
	range?: string;
	/**
	 * The head commit of the model the page shows (`ReviewModel.range.head.sha`): the commit the
	 * draft's line numbers belong to. When the range has moved on since, nothing is written and
	 * the answer is 409 `range-moved`, so a comment never names lines of a commit its writer did
	 * not see. Without it the comment is recorded at whatever the range's head is.
	 */
	head?: string;
	/**
	 * The base commit of that model (`ReviewModel.range.base.sha`), checked the same way: a
	 * deleted file is read from the base, so its lines move when the base does.
	 */
	base?: string;
}

/**
 * Body of `PUT /api/comments/:id`: the new text, under the rules of `CommentDraft.text`. 404
 * `not-found` for an unknown id. (`DELETE` of an unknown id is no error: the comment is gone
 * either way.)
 */
export interface CommentEdit {
	text: string;
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/**
 * Body of every non-2xx answer of `/api/*`. `range-moved` (409): the branch has new commits
 * since the page loaded its model (a file, a viewed mark or a comment of the older state).
 * `bad-request` (400) also for a request body that is not sent as `application/json`: only the
 * review's own page can send that type, a page of another site cannot (see `jsonBody` in
 * `src/server/api.ts`). The one answer without this body: a request body above the server's
 * size limit (above a comment at its limits) is turned away by Bun itself, 413 with no body.
 */
export interface ApiErrorBody {
	error: "bad-request" | "unknown-range" | "not-found" | "range-moved" | "internal";
	message: string;
}
