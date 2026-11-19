/**
 * Small, pure facts about review comments: the lines a comment quotes, whether the code under it
 * has changed since, how its place is written, and the order comments are listed in.
 */
import type { ReviewComment, TokenLine } from "../../core/types";

/** A comment quotes at most this many of its lines. */
export const SNIPPET_LINES = 30;

/**
 * The server's limits (`src/core/comments.ts`), in characters as `String.length` counts them.
 * The UI takes only types from core, so the numbers are repeated here; a test holds them equal.
 */
export const MAX_COMMENT_TEXT = 10_000;
export const MAX_COMMENT_SNIPPET = 8_000;

export function lineText(tokens: TokenLine): string {
	let text = "";
	for (const [part] of tokens) text += part;
	return text;
}

/**
 * The text of the lines `line`..`endLine` (1-based, inclusive), joined by "\n": what a comment
 * on them quotes. At most SNIPPET_LINES lines, and whole lines only as far as the server's limit
 * for a snippet reaches; a first line that is longer than the limit by itself is cut.
 */
export function snippetOf(lines: readonly TokenLine[], line: number, endLine = line): string {
	const first = lines[line - 1];
	if (first === undefined) return "";
	let snippet = lineText(first).slice(0, MAX_COMMENT_SNIPPET);
	const last = Math.min(endLine, line + SNIPPET_LINES - 1, lines.length);
	for (let n = line + 1; n <= last; n++) {
		const text = lineText(lines[n - 1] ?? []);
		if (snippet.length + 1 + text.length > MAX_COMMENT_SNIPPET) break;
		snippet += `\n${text}`;
	}
	return snippet;
}

/**
 * True when the lines a comment quotes read differently now, or are no longer there: the code
 * has changed since the comment was written. A comment without a snippet (on a whole file) is
 * never outdated. `lines` are the file's lines as the file page shows them.
 */
export function isOutdated(comment: ReviewComment, lines: readonly TokenLine[]): boolean {
	if (comment.snippet === undefined || comment.line === undefined) return false;
	if ((comment.endLine ?? comment.line) > lines.length) return true;
	return snippetOf(lines, comment.line, comment.endLine) !== comment.snippet;
}

/** `src/a.ts`, `src/a.ts:42`, `src/a.ts:42-45`: the form editors and coding agents understand. */
export function locationOf(comment: Pick<ReviewComment, "path" | "line" | "endLine">): string {
	if (comment.line === undefined) return comment.path;
	if (comment.endLine === undefined) return `${comment.path}:${comment.line}`;
	return `${comment.path}:${comment.line}-${comment.endLine}`;
}

/** Inside a file: the comments on the whole file first, then by line, then as they were written. */
function byPlace(a: ReviewComment, b: ReviewComment): number {
	if (a.line !== b.line) {
		if (a.line === undefined) return -1;
		if (b.line === undefined) return 1;
		return a.line - b.line;
	}
	return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/**
 * The order comments are read in: files in reading order, files outside it (unchanged files a
 * reader commented on) after them by path; inside a file see `byPlace`.
 */
export function sortComments(
	comments: readonly ReviewComment[],
	readingOrder: readonly string[],
): ReviewComment[] {
	const rank = new Map(readingOrder.map((path, index) => [path, index]));
	return [...comments].sort((a, b) => {
		if (a.path === b.path) return byPlace(a, b);
		const [ra, rb] = [rank.get(a.path), rank.get(b.path)];
		if (ra !== undefined && rb !== undefined) return ra - rb;
		if (ra !== undefined) return -1;
		if (rb !== undefined) return 1;
		return a.path < b.path ? -1 : 1;
	});
}

/**
 * The comments of each file, a file's list in the order of `byPlace`. The files come in the
 * order they first appear in `comments`: give it `sortComments(…)` for reading order.
 */
export function commentsByPath(comments: readonly ReviewComment[]): Map<string, ReviewComment[]> {
	const byPath = new Map<string, ReviewComment[]>();
	for (const comment of comments) {
		const list = byPath.get(comment.path);
		if (list) list.push(comment);
		else byPath.set(comment.path, [comment]);
	}
	for (const list of byPath.values()) list.sort(byPlace);
	return byPath;
}
