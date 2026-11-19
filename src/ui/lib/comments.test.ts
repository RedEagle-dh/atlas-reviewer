import { describe, expect, test } from "bun:test";
import * as core from "../../core/comments";
import type { ReviewComment, TokenLine } from "../../core/types";
import {
	commentsByPath,
	isOutdated,
	lineText,
	locationOf,
	MAX_COMMENT_SNIPPET,
	MAX_COMMENT_TEXT,
	SNIPPET_LINES,
	snippetOf,
	sortComments,
} from "./comments";

/** A line as the server sends it: several tokens, an empty line none. */
const tokens = (text: string): TokenLine =>
	text === ""
		? []
		: [
				[text.slice(0, 3), 1],
				[text.slice(3), 0, 2],
			];
const file = (...texts: string[]): TokenLine[] => texts.map(tokens);
const numbered = (count: number): TokenLine[] =>
	file(...Array.from({ length: count }, (_, i) => `line ${i + 1}`));

let written = 0;
/** A comment; each one a second later than the one before unless `createdAt` says otherwise. */
const comment = (path: string, place: Partial<ReviewComment> = {}): ReviewComment => {
	const at = new Date(Date.UTC(2026, 0, 1, 12, 0, written++)).toISOString();
	return {
		id: `c${written}`,
		path,
		text: "text",
		range: "r",
		head: "a".repeat(40),
		createdAt: at,
		updatedAt: at,
		...place,
	};
};

describe("the limits", () => {
	test("are the server's", () => {
		expect(MAX_COMMENT_TEXT).toBe(core.MAX_COMMENT_TEXT);
		expect(MAX_COMMENT_SNIPPET).toBe(core.MAX_COMMENT_SNIPPET);
	});
});

describe("lineText", () => {
	test("joins a line's tokens; an empty line is empty", () => {
		expect(lineText(tokens("\tconst a = 1;"))).toBe("\tconst a = 1;");
		expect(lineText([])).toBe("");
	});
});

describe("snippetOf", () => {
	const lines = file("const a = 1;", "", "\tif (a) {", "\t\treturn `a`;", "\t}");

	test("one line, or the lines from `line` to `endLine`, as they are", () => {
		expect(snippetOf(lines, 3)).toBe("\tif (a) {");
		expect(snippetOf(lines, 3, 3)).toBe("\tif (a) {");
		expect(snippetOf(lines, 1, 4)).toBe("const a = 1;\n\n\tif (a) {\n\t\treturn `a`;");
		expect(snippetOf(lines, 2)).toBe("");
		expect(snippetOf(lines, 2, 3)).toBe("\n\tif (a) {");
	});

	test("ends where the file ends; a line the file does not have gives nothing", () => {
		expect(snippetOf(lines, 4, 9)).toBe("\t\treturn `a`;\n\t}");
		expect(snippetOf(lines, 6, 8)).toBe("");
		expect(snippetOf(lines, 0, 2)).toBe("");
		expect(snippetOf([], 1)).toBe("");
	});

	test("at most the first SNIPPET_LINES lines", () => {
		const snippet = snippetOf(numbered(200), 11, 130);
		expect(snippet.split("\n")).toHaveLength(SNIPPET_LINES);
		expect(snippet.startsWith("line 11\nline 12\n")).toBe(true);
		expect(snippet.endsWith("\nline 40")).toBe(true);
		expect(snippetOf(numbered(200), 11, 40)).toBe(snippet);
	});

	test("never longer than the server takes: whole lines, and a first line that is too long is cut", () => {
		const long = file("a".repeat(5000), "b".repeat(2999), "c", "d");
		// 5000 + 1 + 2999 = 8000 fits exactly; the next line would not.
		expect(snippetOf(long, 1, 4)).toBe(`${"a".repeat(5000)}\n${"b".repeat(2999)}`);
		expect(snippetOf(long, 1, 4)).toHaveLength(MAX_COMMENT_SNIPPET);
		// One character more, counting the newline between the lines, does not.
		expect(snippetOf(file("a".repeat(5000), "b".repeat(3000)), 1, 2)).toBe("a".repeat(5000));
		const minified = file("x".repeat(20_000), "y");
		expect(snippetOf(minified, 1, 2)).toBe("x".repeat(MAX_COMMENT_SNIPPET));
	});
});

describe("isOutdated", () => {
	const lines = file("const a = 1;", "const b = 2;", "const c = 3;");

	test("false while the commented lines read as they did", () => {
		expect(isOutdated(comment("a.ts", { line: 2, snippet: "const b = 2;" }), lines)).toBe(false);
		expect(
			isOutdated(
				comment("a.ts", { line: 2, endLine: 3, snippet: "const b = 2;\nconst c = 3;" }),
				lines,
			),
		).toBe(false);
		// An empty line has an empty snippet, which is a snippet.
		expect(isOutdated(comment("a.ts", { line: 2, snippet: "" }), file("a", "", "c"))).toBe(false);
	});

	test("true when they read differently, have moved, or are no longer there", () => {
		expect(isOutdated(comment("a.ts", { line: 2, snippet: "const b = 20;" }), lines)).toBe(true);
		expect(isOutdated(comment("a.ts", { line: 1, snippet: "const b = 2;" }), lines)).toBe(true);
		expect(isOutdated(comment("a.ts", { line: 2, snippet: "" }), lines)).toBe(true);
		expect(isOutdated(comment("a.ts", { line: 4, snippet: "const d = 4;" }), lines)).toBe(true);
		expect(
			isOutdated(
				comment("a.ts", { line: 3, endLine: 4, snippet: "const c = 3;\nconst d = 4;" }),
				lines,
			),
		).toBe(true);
		expect(isOutdated(comment("a.ts", { line: 1, snippet: "const a = 1;" }), [])).toBe(true);
	});

	test("a comment without a snippet is never outdated", () => {
		expect(isOutdated(comment("a.ts"), lines)).toBe(false);
		expect(isOutdated(comment("a.ts", { line: 9 }), lines)).toBe(false);
		expect(isOutdated(comment("a.ts"), [])).toBe(false);
	});

	test("a long comment is compared by the lines its snippet holds, but all its lines must be there", () => {
		const before = numbered(200);
		const long = comment("a.ts", { line: 11, endLine: 130, snippet: snippetOf(before, 11, 130) });
		expect(isOutdated(long, before)).toBe(false);
		// Beyond the snippet a change goes unseen …
		expect(isOutdated(long, before.with(99, tokens("changed")))).toBe(false);
		// … inside it, or with the end cut off, it shows.
		expect(isOutdated(long, before.with(39, tokens("changed")))).toBe(true);
		expect(isOutdated(long, before.slice(0, 120))).toBe(true);
	});
});

describe("locationOf", () => {
	test("the path, with the line or the lines after a colon", () => {
		expect(locationOf(comment("src/a.ts"))).toBe("src/a.ts");
		expect(locationOf(comment("src/a.ts", { line: 42 }))).toBe("src/a.ts:42");
		expect(locationOf(comment("src/a.ts", { line: 42, endLine: 45 }))).toBe("src/a.ts:42-45");
	});
});

describe("sortComments", () => {
	const order = ["src/core/b.ts", "src/core/a.ts", "src/ui/c.ts"];

	test("files in reading order, files outside it after them by path", () => {
		const comments = [
			comment("z/unchanged.ts"),
			comment("src/ui/c.ts"),
			comment("a/unchanged.ts"),
			comment("src/core/a.ts"),
			comment("src/core/b.ts"),
		];
		expect(sortComments(comments, order).map((c) => c.path)).toEqual([
			"src/core/b.ts",
			"src/core/a.ts",
			"src/ui/c.ts",
			"a/unchanged.ts",
			"z/unchanged.ts",
		]);
		expect(sortComments(comments, []).map((c) => c.path)).toEqual([
			"a/unchanged.ts",
			"src/core/a.ts",
			"src/core/b.ts",
			"src/ui/c.ts",
			"z/unchanged.ts",
		]);
	});

	test("inside a file: the whole file first, then by line, then as they were written", () => {
		const comments = [
			comment("src/core/a.ts", { line: 30, text: "30" }),
			comment("src/core/a.ts", { line: 4, endLine: 90, text: "4, first" }),
			comment("src/core/a.ts", { text: "file, first" }),
			comment("src/core/a.ts", { line: 4, text: "4, second" }),
			comment("src/core/a.ts", { text: "file, second" }),
			comment("src/core/b.ts", { line: 100, text: "b" }),
			comment("src/core/a.ts", {
				line: 4,
				text: "4, earliest",
				createdAt: "2025-12-31T00:00:00.000Z",
			}),
		];
		const sorted = sortComments(comments, order);
		expect(sorted.map((c) => c.text)).toEqual([
			"b",
			"file, first",
			"file, second",
			"4, earliest",
			"4, first",
			"4, second",
			"30",
		]);
		// A new list; the one given stays as it was.
		expect(comments[0]?.text).toBe("30");
		expect(sortComments([], order)).toEqual([]);
	});

	test("comments written in the same instant stay in the order they came", () => {
		const createdAt = "2026-01-01T00:00:00.000Z";
		const comments = ["one", "two", "three"].map((text) =>
			comment("src/core/a.ts", { line: 1, text, createdAt }),
		);
		expect(sortComments(comments, order).map((c) => c.text)).toEqual(["one", "two", "three"]);
	});
});

describe("commentsByPath", () => {
	test("a list per file in its order of place; the files as they first appear", () => {
		const comments = [
			comment("b.ts", { line: 7, text: "b 7" }),
			comment("a.ts", { line: 2, text: "a 2" }),
			comment("b.ts", { text: "b file" }),
			comment("a.ts", { line: 1, text: "a 1" }),
		];
		const byPath = commentsByPath(comments);
		expect([...byPath.keys()]).toEqual(["b.ts", "a.ts"]);
		expect(byPath.get("b.ts")?.map((c) => c.text)).toEqual(["b file", "b 7"]);
		expect(byPath.get("a.ts")?.map((c) => c.text)).toEqual(["a 1", "a 2"]);
		expect(byPath.get("c.ts")).toBeUndefined();
		expect([...commentsByPath(sortComments(comments, ["a.ts", "b.ts"])).keys()]).toEqual([
			"a.ts",
			"b.ts",
		]);
		expect(commentsByPath([]).size).toBe(0);
	});
});
