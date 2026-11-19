import { describe, expect, test } from "bun:test";
import type { ReviewComment, TokenLine } from "../../core/types";
import { snippetOf } from "./comments";
import { buildPrompt, type PromptContext } from "./prompt";

const BASE = "1234567890abcdef1234567890abcdef12345678";
const HEAD = "89abcdef0123456789abcdef0123456789abcdef";
const EARLIER = "fedcba9876543210fedcba9876543210fedcba98";

const context: PromptContext = {
	repoName: "review-atlas",
	range: { label: "Branch", base: { ref: "main", sha: BASE }, head: { ref: "HEAD", sha: HEAD } },
	readingOrder: ["src/core/session.ts", "src/server/api.ts", "src/old.ts", "docs/notes.txt"],
	languageOf: (path) => (path.endsWith(".ts") ? "typescript" : null),
	statusOf: (path) => (path === "src/old.ts" ? "deleted" : "modified"),
};

let written = 0;
const comment = (path: string, text: string, place: Partial<ReviewComment> = {}): ReviewComment => {
	const at = new Date(Date.UTC(2026, 0, 1, 12, 0, written++)).toISOString();
	return {
		id: `c${written}`,
		path,
		text,
		range: "branch",
		head: HEAD,
		createdAt: at,
		updatedAt: at,
		...place,
	};
};

/** The lines of a text, joined: an expected prompt is written line by line. */
const text = (...lines: string[]): string => lines.join("\n");

const INTRO = (count: number) => [
	`I reviewed the changes in \`review-atlas\` (Branch: main 1234567 → HEAD 89abcde) and left ${count} comments. Please work through them one by one:`,
	"",
	"- If a comment asks for a change, make it.",
	"- If a comment asks a question, answer it — and leave the code alone unless the answer shows that something is wrong.",
	"- Paths are relative to the repository root. Line numbers refer to commit 89abcde; if the code has moved since, the quoted lines show what is meant.",
	"",
	"When you are done, summarise per comment what you changed or answered.",
	"",
];

describe("buildPrompt", () => {
	test("no comments, no prompt", () => {
		expect(buildPrompt([], context)).toBe("");
	});

	test("the whole text, character for character", () => {
		const comments = [
			comment("src/server/api.ts", "Why not look at the content-length first?", {
				line: 42,
				endLine: 43,
				snippet:
					"\tconst text = await req.text();\n\tif (text.length > MAX_BODY) return tooLarge();",
			}),
			comment("src/server/api.ts", "Please say in the header what `guarded` is for."),
			comment("src/core/session.ts", "Rename this to `commentStore`.", {
				line: 7,
				snippet: "\tprivate readonly store: CommentStore;",
			}),
		];
		expect(buildPrompt(comments, context)).toBe(
			text(
				"I reviewed the changes in `review-atlas` (Branch: main 1234567 → HEAD 89abcde) and left 3 comments. Please work through them one by one:",
				"",
				"- If a comment asks for a change, make it.",
				"- If a comment asks a question, answer it — and leave the code alone unless the answer shows that something is wrong.",
				"- Paths are relative to the repository root. Line numbers refer to commit 89abcde; if the code has moved since, the quoted lines show what is meant.",
				"",
				"When you are done, summarise per comment what you changed or answered.",
				"",
				"## 1. src/core/session.ts:7",
				"",
				"```typescript",
				"\tprivate readonly store: CommentStore;",
				"```",
				"",
				"Rename this to `commentStore`.",
				"",
				"## 2. src/server/api.ts (whole file)",
				"",
				"Please say in the header what `guarded` is for.",
				"",
				"## 3. src/server/api.ts:42-43",
				"",
				"```typescript",
				"\tconst text = await req.text();",
				"\tif (text.length > MAX_BODY) return tooLarge();",
				"```",
				"",
				"Why not look at the content-length first?",
				"",
			),
		);
	});

	test("one comment: the singular, and no number", () => {
		const one = comment("src/server/api.ts", "Why 64 KiB?", {
			line: 51,
			snippet: "const MAX_BODY = 64 * 1024;",
		});
		expect(buildPrompt([one], context)).toBe(
			text(
				"I reviewed the changes in `review-atlas` (Branch: main 1234567 → HEAD 89abcde) and left 1 comment. Please address it:",
				"",
				"- If the comment asks for a change, make it.",
				"- If the comment asks a question, answer it — and leave the code alone unless the answer shows that something is wrong.",
				"- Paths are relative to the repository root. Line numbers refer to commit 89abcde; if the code has moved since, the quoted lines show what is meant.",
				"",
				"When you are done, summarise what you changed or answered.",
				"",
				"## src/server/api.ts:51",
				"",
				"```typescript",
				"const MAX_BODY = 64 * 1024;",
				"```",
				"",
				"Why 64 KiB?",
				"",
			),
		);
	});

	test("without a comment on lines nothing is said about line numbers", () => {
		expect(buildPrompt([comment("src/server/api.ts", "Split this file.")], context)).toBe(
			text(
				"I reviewed the changes in `review-atlas` (Branch: main 1234567 → HEAD 89abcde) and left 1 comment. Please address it:",
				"",
				"- If the comment asks for a change, make it.",
				"- If the comment asks a question, answer it — and leave the code alone unless the answer shows that something is wrong.",
				"- Paths are relative to the repository root.",
				"",
				"When you are done, summarise what you changed or answered.",
				"",
				"## src/server/api.ts (whole file)",
				"",
				"Split this file.",
				"",
			),
		);
	});

	test("what is said at a place: a deleted file, another commit, both", () => {
		const comments = [
			comment("src/old.ts", "Was this still used?", { line: 5, snippet: "export const old = 1;" }),
			comment("src/old.ts", "Why delete it?"),
			comment("src/old.ts", "And this?", { line: 9, endLine: 12, head: EARLIER }),
			comment("src/server/api.ts", "An earlier state.", { line: 3, head: EARLIER }),
			comment("src/server/api.ts", "The file, earlier.", { head: EARLIER }),
			comment("src/old.ts", "Gone, earlier.", { head: EARLIER }),
		];
		expect(buildPrompt(comments, context)).toBe(
			text(
				...INTRO(6),
				"## 1. src/server/api.ts (whole file; at commit fedcba9)",
				"",
				"The file, earlier.",
				"",
				"## 2. src/server/api.ts:3 (at commit fedcba9)",
				"",
				"An earlier state.",
				"",
				"## 3. src/old.ts (whole file; deleted file)",
				"",
				"Why delete it?",
				"",
				"## 4. src/old.ts (whole file; deleted file; at commit fedcba9)",
				"",
				"Gone, earlier.",
				"",
				"## 5. src/old.ts:5 (deleted file — line numbers of the old version)",
				"",
				"```typescript",
				"export const old = 1;",
				"```",
				"",
				"Was this still used?",
				"",
				"## 6. src/old.ts:9-12 (deleted file — line numbers of the old version; at commit fedcba9)",
				"",
				"And this?",
				"",
			),
		);
	});

	test("the comments in reading order, numbered across files; files outside it last", () => {
		const comments = [
			comment("z/unchanged.ts", "outside"),
			comment("src/server/api.ts", "api 9", { line: 9 }),
			comment("src/core/session.ts", "session 3", { line: 3 }),
			comment("src/server/api.ts", "api file"),
			comment("src/core/session.ts", "session 1", { line: 1 }),
		];
		const headings = buildPrompt(comments, context)
			.split("\n")
			.filter((line) => line.startsWith("## "));
		expect(headings).toEqual([
			"## 1. src/core/session.ts:1",
			"## 2. src/core/session.ts:3",
			"## 3. src/server/api.ts (whole file)",
			"## 4. src/server/api.ts:9",
			"## 5. z/unchanged.ts (whole file)",
		]);
	});

	test("a fence without a language when none is known, and longer than any run of backticks in the code", () => {
		const comments = [
			comment("docs/notes.txt", "Plain text.", { line: 1, snippet: "just words" }),
			comment("src/server/api.ts", "A template string.", {
				line: 2,
				endLine: 4,
				snippet: "const doc = `\n```ts\n`````;",
			}),
			comment("src/server/api.ts", "Inline code.", { line: 8, snippet: "const a = `a`;" }),
		];
		expect(
			buildPrompt(comments, { ...context, languageOf: () => null })
				.split("\n")
				.slice(8),
		).toEqual([
			"## 1. src/server/api.ts:2-4",
			"",
			"``````",
			"const doc = `",
			"```ts",
			"`````;",
			"``````",
			"",
			"A template string.",
			"",
			"## 2. src/server/api.ts:8",
			"",
			"```",
			"const a = `a`;",
			"```",
			"",
			"Inline code.",
			"",
			"## 3. docs/notes.txt:1",
			"",
			"```",
			"just words",
			"```",
			"",
			"Plain text.",
			"",
		]);
		// No `languageOf` at all is the same as one that knows nothing.
		const { languageOf: _none, statusOf: _unknown, ...bare } = context;
		expect(buildPrompt(comments, bare)).toBe(
			buildPrompt(comments, { ...context, languageOf: () => null }),
		);
	});

	test("a comment on more lines than its snippet holds says how many are quoted", () => {
		const lines: TokenLine[] = Array.from({ length: 200 }, (_, i) => [[`line ${i + 1}`, 0]]);
		const long = comment("src/server/api.ts", "Too long, split it.", {
			line: 11,
			endLine: 130,
			snippet: snippetOf(lines, 11, 130),
		});
		const exact = comment("src/server/api.ts", "Fine.", {
			line: 150,
			endLine: 179,
			snippet: snippetOf(lines, 150, 179),
		});
		const prompt = buildPrompt([long, exact], context).split("\n");
		expect(prompt.slice(8, 12)).toEqual([
			"## 1. src/server/api.ts:11-130",
			"",
			"```typescript",
			"line 11",
		]);
		expect(prompt.slice(40, 46)).toEqual([
			"line 40",
			"```",
			"(first 30 of 120 lines)",
			"",
			"Too long, split it.",
			"",
		]);
		// Thirty of thirty lines: nothing to say.
		expect(prompt.slice(-5)).toEqual(["line 179", "```", "", "Fine.", ""]);
		expect(prompt).not.toContain("(first 30 of 30 lines)");
	});

	test("text and code as they are; only whitespace at their end is dropped", () => {
		const comments = [
			comment(
				"src/server/api.ts",
				"First line.\n\n    indented <b>&amp;</b> \\n *stars*\n## not a heading of ours\t \n\n",
				{
					line: 1,
					endLine: 4,
					snippet: '\n\tif (a < b && c) {  \n\t\treturn "<&>";\n\n',
				},
			),
			// Empty lines: nothing to quote, so no empty fence.
			comment("src/server/api.ts", "Why the gap?", { line: 20, endLine: 21, snippet: "\n" }),
		];
		expect(buildPrompt(comments, context)).toBe(
			text(
				...INTRO(2),
				"## 1. src/server/api.ts:1-4",
				"",
				"```typescript",
				"",
				"\tif (a < b && c) {  ",
				'\t\treturn "<&>";',
				"```",
				"",
				"First line.",
				"",
				"    indented <b>&amp;</b> \\n *stars*",
				"## not a heading of ours",
				"",
				"## 2. src/server/api.ts:20-21",
				"",
				"Why the gap?",
				"",
			),
		);
	});

	test("one blank line between blocks and one newline at the end, whatever the comments hold", () => {
		const comments = [
			comment("src/server/api.ts", "one\n\n\n", { line: 1, snippet: "a\n\n\n" }),
			comment("src/core/session.ts", "two   "),
			comment("src/old.ts", "three", { line: 2, endLine: 80, snippet: "b", head: EARLIER }),
		];
		const prompt = buildPrompt(comments, context);
		expect(prompt.endsWith("three\n")).toBe(true);
		expect(prompt.endsWith("\n\n")).toBe(false);
		expect(prompt).not.toContain("\n\n\n");
		expect(prompt).not.toMatch(/[ \t]\n/);
	});
});
