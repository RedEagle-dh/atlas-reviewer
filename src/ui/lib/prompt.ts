/**
 * The prompt: a review's comments as one text the reader copies and gives to a coding agent,
 * each comment with its place as `path:line` and the lines it is about.
 *
 * Its words are ENGLISH whatever the UI speaks (agents are prompted in English), and all of them
 * live in `P` below: one place to change them.
 */
import type { ReviewComment } from "../../core/types";
import { locationOf, sortComments } from "./comments";

export interface PromptContext {
	repoName: string;
	/** `ReviewModel.range` fits. */
	range: { label: string; base: { ref: string; sha: string }; head: { ref: string; sha: string } };
	/** `ReviewModel.readingOrder`: the comments are listed in it (see `sortComments`). */
	readingOrder: readonly string[];
	/** The language id of a quote's code fence (`ChangedFile.language`); without one the fence is bare. */
	languageOf?: (path: string) => string | null;
}

type Commit = { ref: string; sha: string };

/** As git abbreviates a commit. */
const sha7 = (sha: string): string => sha.slice(0, 7);

const P = {
	intro: (repo: string, range: string, count: number) =>
		count === 1
			? `I reviewed the changes in \`${repo}\` (${range}) and left 1 comment. Please address it:`
			: `I reviewed the changes in \`${repo}\` (${range}) and left ${count} comments. Please work through them one by one:`,
	range: (label: string, base: Commit, head: Commit) =>
		`${label}: ${base.ref} ${sha7(base.sha)} → ${head.ref} ${sha7(head.sha)}`,
	change: (one: boolean) => `- If ${one ? "the" : "a"} comment asks for a change, make it.`,
	question: (one: boolean) =>
		`- If ${one ? "the" : "a"} comment asks a question, answer it — and leave the code alone unless the answer shows that something is wrong.`,
	paths: "- Paths are relative to the repository root.",
	lines: (head: string) =>
		` Line numbers refer to commit ${sha7(head)}; if the code has moved since, the quoted lines show what is meant.`,
	outro: (one: boolean) =>
		one
			? "When you are done, summarise what you changed or answered."
			: "When you are done, summarise per comment what you changed or answered.",
	wholeFile: "whole file",
	deletedFile: (base: string) => `deleted file — its last version is at commit ${sha7(base)}`,
	deletedLines: (base: string) =>
		`deleted file — line numbers of its last version, at commit ${sha7(base)}`,
	atCommit: (head: string) => `at commit ${sha7(head)}`,
	firstLines: (quoted: number, all: number) => `(first ${quoted} of ${all} lines)`,
};

/** `## 2. src/a.ts:42-45 (at commit 1a2b3c4)`; the number only when there is more than one comment. */
function heading(comment: ReviewComment, number: number | null, context: PromptContext): string {
	const onLines = comment.line !== undefined;
	const notes: string[] = [];
	if (!onLines) notes.push(P.wholeFile);
	// What the comment recorded when it was written, whatever range the page shows now: a file
	// its range deleted is read from the base, and that is where the agent finds it.
	if (comment.base !== undefined)
		notes.push(onLines ? P.deletedLines(comment.base) : P.deletedFile(comment.base));
	else if (comment.head !== context.range.head.sha) notes.push(P.atCommit(comment.head));
	const place = `${locationOf(comment)}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`;
	return number === null ? `## ${place}` : `## ${number}. ${place}`;
}

/**
 * The lines a comment is about, as a code block: its fence longer than any run of backticks in
 * the code, so nothing in the code can end it. `null` when there is nothing to quote.
 */
function quote(comment: ReviewComment, language: string | null): string | null {
	const { snippet, line } = comment;
	if (snippet === undefined) return null;
	const code = snippet.trimEnd();
	if (code === "") return null;
	let longest = 0;
	for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
	const fence = "`".repeat(Math.max(3, longest + 1));
	const block = `${fence}${language ?? ""}\n${code}\n${fence}`;
	const quoted = snippet.split("\n").length;
	const all = line === undefined ? 0 : (comment.endLine ?? line) - line + 1;
	return quoted < all ? `${block}\n${P.firstLines(quoted, all)}` : block;
}

/**
 * The text for the agent; `""` without comments. Blocks (the introduction, then per comment its
 * place, its lines and its text) with one blank line between them and one newline at the end.
 * A comment's text and lines are given as they are: only whitespace at their end is dropped.
 */
export function buildPrompt(comments: readonly ReviewComment[], context: PromptContext): string {
	if (comments.length === 0) return "";
	const sorted = sortComments(comments, context.readingOrder);
	const one = sorted.length === 1;
	const { range } = context;
	const anyLine = sorted.some((comment) => comment.line !== undefined);
	const blocks = [
		P.intro(context.repoName, P.range(range.label, range.base, range.head), sorted.length),
		[P.change(one), P.question(one), `${P.paths}${anyLine ? P.lines(range.head.sha) : ""}`].join(
			"\n",
		),
		P.outro(one),
	];
	for (const [index, comment] of sorted.entries()) {
		blocks.push(heading(comment, one ? null : index + 1, context));
		const lines = quote(comment, context.languageOf?.(comment.path) ?? null);
		if (lines !== null) blocks.push(lines);
		blocks.push(comment.text.trimEnd());
	}
	return `${blocks.join("\n\n")}\n`;
}
