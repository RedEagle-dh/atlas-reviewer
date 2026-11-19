import { describe, expect, test } from "bun:test";
import type { ReviewComment } from "../../core/types";
import { commentsByPath } from "./comments";
import {
	lineMarks,
	MARK_ANCHOR,
	MARK_COMMENT,
	MARK_SELECTED,
	pinnedLines,
	placeComments,
	rangeOf,
	spanOf,
	threadHeight,
} from "./threads";

let written = 0;
/** A comment on `a.ts`; each one a second later than the one before. */
const comment = (text: string, line?: number, endLine?: number): ReviewComment => {
	const at = new Date(Date.UTC(2026, 0, 1, 12, 0, written++)).toISOString();
	return {
		id: `c${written}`,
		path: "a.ts",
		text,
		range: "r",
		head: "a".repeat(40),
		createdAt: at,
		updatedAt: at,
		...(line === undefined ? {} : { line }),
		...(endLine === undefined ? {} : { endLine }),
	};
};
/** As the page holds a file's comments: in the order of `commentsByPath`. */
const ofFile = (...comments: ReviewComment[]): readonly ReviewComment[] =>
	commentsByPath(comments).get("a.ts") ?? [];
const texts = (comments: readonly ReviewComment[] | undefined): string[] =>
	(comments ?? []).map((c) => c.text);

describe("rangeOf, spanOf", () => {
	test("a line, a range, and none for a comment on the whole file", () => {
		expect(rangeOf(comment("x", 42))).toEqual({ from: 42, to: 42 });
		expect(rangeOf(comment("x", 42, 45))).toEqual({ from: 42, to: 45 });
		expect(rangeOf(comment("x"))).toBeNull();
	});

	test("a selection in either direction is the same range", () => {
		expect(spanOf(3, 9)).toEqual({ from: 3, to: 9 });
		expect(spanOf(9, 3)).toEqual({ from: 3, to: 9 });
		expect(spanOf(4, 4)).toEqual({ from: 4, to: 4 });
	});
});

describe("placeComments", () => {
	test("a comment hangs below the last of its lines", () => {
		const placed = placeComments(
			ofFile(comment("one line", 4), comment("a range", 6, 9), comment("the first line", 1)),
			20,
		);
		expect([...placed.threads.keys()].sort((a, b) => a - b)).toEqual([1, 4, 9]);
		expect(texts(placed.threads.get(9))).toEqual(["a range"]);
		expect(placed.file).toEqual([]);
	});

	test("comments that end on the same line stack in the order they were written", () => {
		// A range that ends on line 9, written between two comments on line 9 alone.
		const placed = placeComments(
			ofFile(comment("first", 9), comment("second, a range", 5, 9), comment("third", 9)),
			20,
		);
		expect(texts(placed.threads.get(9))).toEqual(["first", "second, a range", "third"]);
		expect(placed.threads.size).toBe(1);
	});

	test("comments on the whole file are shown with the file, in the order they were written", () => {
		const placed = placeComments(ofFile(comment("a"), comment("in the code", 3), comment("b")), 20);
		expect(texts(placed.file)).toEqual(["a", "b"]);
		expect(texts(placed.threads.get(3))).toEqual(["in the code"]);
	});

	test("a comment whose lines are gone joins the file's comments, after those on the whole file", () => {
		const placed = placeComments(
			ofFile(
				comment("beyond the end", 30),
				comment("on the file"),
				comment("ends beyond the end", 18, 25),
				comment("on the last line", 20),
			),
			20,
		);
		expect(texts(placed.file)).toEqual(["on the file", "ends beyond the end", "beyond the end"]);
		expect([...placed.threads.keys()]).toEqual([20]);
	});

	test("a file without lines (binary, empty) has every comment with the file", () => {
		const placed = placeComments(ofFile(comment("was line 1", 1), comment("whole")), 0);
		expect(texts(placed.file)).toEqual(["whole", "was line 1"]);
		expect(placed.threads.size).toBe(0);
		expect(placeComments([], 0)).toEqual({ threads: new Map(), file: [] });
	});
});

describe("lineMarks", () => {
	test("each line gets the marks of everything that covers it", () => {
		const marks = lineMarks(
			[
				{ from: 2, to: 4 },
				{ from: 4, to: 4 },
			],
			[{ from: 4, to: 6 }],
			6,
		);
		expect([...marks].sort(([a], [b]) => a - b)).toEqual([
			[2, MARK_COMMENT],
			[3, MARK_COMMENT],
			[4, MARK_COMMENT | MARK_SELECTED],
			[5, MARK_SELECTED],
			[6, MARK_SELECTED | MARK_ANCHOR],
		]);
	});

	test("lines without a mark are not in the map, so their rows are given the same nothing", () => {
		const marks = lineMarks([{ from: 10, to: 10 }], [], null);
		expect(marks.get(9)).toBeUndefined();
		expect(marks.size).toBe(1);
		expect(lineMarks([], [], null).size).toBe(0);
	});

	test("the same input gives the same numbers: a row whose mark did not change is not drawn again", () => {
		const input = [[{ from: 1, to: 300 }], [{ from: 7, to: 9 }], 7] as const;
		expect([...lineMarks(...input)]).toEqual([...lineMarks(...input)]);
	});
});

describe("pinnedLines", () => {
	test("what the reader opened, and every line of a commented or selected range", () => {
		const pinned = pinnedLines(new Set([1, 2, 3]), [
			{ from: 10, to: 12 },
			{ from: 12, to: 12 },
			{ from: 40, to: 40 },
		]);
		expect([...pinned].sort((a, b) => a - b)).toEqual([1, 2, 3, 10, 11, 12, 40]);
	});

	test("without ranges it is the opened set itself, which a memo can rely on", () => {
		const opened = new Set([5]);
		expect(pinnedLines(opened, [])).toBe(opened);
		expect(pinnedLines(opened, [{ from: 5, to: 5 }])).not.toBe(opened);
	});
});

describe("threadHeight", () => {
	test("nothing below a line takes no room", () => {
		expect(threadHeight([], false)).toBe(0);
	});

	test("more text, more cards and an open composer each take more room", () => {
		const short = comment("Why?", 3);
		const long = comment(`${"word ".repeat(80)}\n\nsecond paragraph`, 3);
		const one = threadHeight([short], false);
		expect(one).toBeGreaterThan(60);
		expect(threadHeight([long], false)).toBeGreaterThan(one + 80);
		expect(threadHeight([short, short], false)).toBeGreaterThan(2 * one - 20);
		expect(threadHeight([short], true)).toBeGreaterThan(one + 100);
		expect(threadHeight([], true)).toBeGreaterThan(100);
	});
});
