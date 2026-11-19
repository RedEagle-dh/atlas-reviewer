import { describe, expect, test } from "bun:test";
import type { ChangeBlock } from "../../../core/types";
import { buildRows, nextChange, type Row, type RowOptions, sameRow } from "./rows";

const removed = (n: number) =>
	Array.from({ length: n }, (_, i) => [[`old ${i}`, 0]] as [string, number][]);
const opts = (patch: Partial<RowOptions> = {}): RowOptions => ({
	mode: "full",
	showRemoved: true,
	context: 2,
	pinned: new Set(),
	plain: false,
	...patch,
});

/** A compact picture of the rows: `5` a line, `5m`/`5a` a changed line, `-0` a removed line, `x3` a marker, `[1-4]` a fold, `*` an anchor. */
function picture(rows: readonly Row[]): string {
	return rows
		.map((r) => {
			if (r.kind === "fold") return `[${r.from}-${r.to}]`;
			const star = r.anchor ? "*" : "";
			if (r.kind === "removed") return `-${r.index}${star}`;
			if (r.kind === "removal-marker") return `x${r.count}${star}`;
			return `${r.line}${r.change === "modified" ? "m" : r.change === "added" ? "a" : ""}${star}`;
		})
		.join(" ");
}

/** The lines `from`..`to`, as a set of pinned lines. */
const lines = (from: number, to: number): Set<number> =>
	new Set(Array.from({ length: to - from + 1 }, (_, i) => from + i));

/** 30 lines with one added line, 15: in "Nur Änderungen" `[1-12] 13 14 15a* 16 17 [18-30]`. */
const ONE_CHANGE: ChangeBlock[] = [{ start: 15, count: 1, removed: [] }];

// 12 lines; block 0 replaces lines 3-4 (2 removed), block 1 adds line 8, block 2 removes 2 lines before 11.
const CHANGES: ChangeBlock[] = [
	{ start: 3, count: 2, removed: removed(2) },
	{ start: 8, count: 1, removed: [] },
	{ start: 11, count: 0, removed: removed(2) },
];

describe("buildRows", () => {
	test("whole file: removed lines stand above the lines that replaced them", () => {
		expect(picture(buildRows(12, CHANGES, opts()))).toBe(
			"1 2 -0* -1 3m 4m 5 6 7 8a* 9 10 -0* -1 11 12",
		);
	});

	test("hiding removed lines marks a pure deletion and anchors replaced blocks on their first line", () => {
		expect(picture(buildRows(12, CHANGES, opts({ showRemoved: false })))).toBe(
			"1 2 3m* 4m 5 6 7 8a* 9 10 x2* 11 12",
		);
	});

	test("only changes: unchanged stretches beyond the context fold", () => {
		const rows = buildRows(30, [{ start: 15, count: 1, removed: [] }], opts({ mode: "changes" }));
		expect(picture(rows)).toBe("[1-12] 13 14 15a* 16 17 [18-30]");
	});

	test("short stretches between changes do not fold", () => {
		expect(picture(buildRows(12, CHANGES, opts({ mode: "changes", context: 1 })))).toBe(
			"1 2 -0* -1 3m 4m 5 6 7 8a* 9 10 -0* -1 11 12",
		);
	});

	test("an opened fold shows its lines", () => {
		const rows = buildRows(30, ONE_CHANGE, opts({ mode: "changes", pinned: lines(18, 30) }));
		expect(picture(rows)).toBe("[1-12] 13 14 15a* 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30");
	});

	test("a deletion at the end of the file comes after the last line", () => {
		const rows = buildRows(3, [{ start: 4, count: 0, removed: removed(1) }], opts());
		expect(picture(rows)).toBe("1 2 3 -0*");
	});

	test("a plain file (added, deleted, unchanged) has every line and no marks", () => {
		expect(
			picture(
				buildRows(3, [{ start: 1, count: 3, removed: [] }], opts({ plain: true, mode: "changes" })),
			),
		).toBe("1 2 3");
	});

	test("an empty file has no rows", () => {
		expect(buildRows(0, [], opts())).toEqual([]);
	});

	test("a block clamped by truncation marks only the lines that exist", () => {
		expect(picture(buildRows(3, [{ start: 2, count: 5, removed: [] }], opts()))).toBe("1 2a* 3a");
	});
});

describe("pinned lines (a comment, an open composer, an opened fold) never fold", () => {
	const changes = (pinned: Iterable<number>) =>
		picture(buildRows(30, ONE_CHANGE, opts({ mode: "changes", pinned: new Set(pinned) })));

	test("a pinned line inside a folded stretch stays, and the stretch folds on both sides of it", () => {
		expect(changes([6])).toBe("[1-5] 6 [7-12] 13 14 15a* 16 17 [18-30]");
		expect(changes([24])).toBe("[1-12] 13 14 15a* 16 17 [18-23] 24 [25-30]");
	});

	test("every line of a pinned range stays", () => {
		expect(changes(lines(21, 24))).toBe("[1-12] 13 14 15a* 16 17 18 19 20 21 22 23 24 [25-30]");
	});

	test("what is left next to a pinned line and is too short for a fold is shown", () => {
		// 1-3 and 10-12 are three lines each: below MIN_FOLD.
		expect(changes([4, 9])).toBe("1 2 3 4 [5-8] 9 10 11 12 13 14 15a* 16 17 [18-30]");
		expect(changes([1, 30])).toBe("1 [2-12] 13 14 15a* 16 17 [18-29] 30");
	});

	test("a line pinned inside an opened fold leaves the lines around it open", () => {
		// The reader opened 18-30 and then wrote a comment on line 22.
		expect(changes([...lines(18, 30), 22])).toBe(changes(lines(18, 30)));
	});

	test("a pinned line that is shown anyway, or is not a line of the file, changes nothing", () => {
		const none = changes([]);
		expect(changes([15])).toBe(none);
		expect(changes([13, 17])).toBe(none);
		expect(changes([0, 31, 400])).toBe(none);
	});

	test("nothing folds in the whole file or in a plain file: pins change nothing there", () => {
		const pinned = new Set([6, 24]);
		expect(buildRows(12, CHANGES, opts({ pinned }))).toEqual(buildRows(12, CHANGES, opts()));
		expect(buildRows(30, [], opts({ mode: "changes", plain: true, pinned }))).toEqual(
			buildRows(30, [], opts({ mode: "changes", plain: true })),
		);
	});

	test("a pin and the rows of a deletion each hold their own line open", () => {
		// One line was removed before line 20; with no context only that spot stays, and the pin.
		const deletion: ChangeBlock[] = [{ start: 20, count: 0, removed: removed(1) }];
		const rows = buildRows(
			30,
			deletion,
			opts({ mode: "changes", context: 0, pinned: new Set([8]) }),
		);
		expect(picture(rows)).toBe("[1-7] 8 [9-19] -0* 20 [21-30]");
	});
});

describe("sameRow", () => {
	test("rows built twice from the same input are the same, row by row", () => {
		const a = buildRows(12, CHANGES, opts({ mode: "changes", context: 0 }));
		const b = buildRows(12, CHANGES, opts({ mode: "changes", context: 0 }));
		expect(a).not.toBe(b);
		expect(a.every((row, i) => sameRow(row, b[i] ?? row) && row !== b[i])).toBe(true);
	});

	test("a pin changes only the rows around it", () => {
		const before = buildRows(30, ONE_CHANGE, opts({ mode: "changes" }));
		const after = buildRows(30, ONE_CHANGE, opts({ mode: "changes", pinned: new Set([24]) }));
		expect(picture(before)).toBe("[1-12] 13 14 15a* 16 17 [18-30]");
		expect(picture(after)).toBe("[1-12] 13 14 15a* 16 17 [18-23] 24 [25-30]");
		expect(after.map((row, i) => (before[i] ? sameRow(row, before[i]) : false))).toEqual([
			true,
			true,
			true,
			true,
			true,
			true,
			false,
			false,
			false,
		]);
	});

	test("every field counts, and a row is never the same as one of another kind", () => {
		const line: Row = { kind: "line", line: 3, change: "added", block: 1, anchor: true };
		expect(sameRow(line, { ...line })).toBe(true);
		for (const other of [
			{ ...line, line: 4 },
			{ ...line, change: "modified" as const },
			{ ...line, block: 2 },
			{ ...line, anchor: false },
		])
			expect(sameRow(line, other)).toBe(false);
		const removedRow: Row = { kind: "removed", block: 1, index: 0, anchor: true };
		const marker: Row = { kind: "removal-marker", block: 1, count: 2, anchor: true };
		const fold: Row = { kind: "fold", from: 3, to: 9 };
		expect(sameRow(removedRow, { ...removedRow })).toBe(true);
		expect(sameRow(removedRow, { ...removedRow, index: 1 })).toBe(false);
		expect(sameRow(marker, { ...marker })).toBe(true);
		expect(sameRow(marker, { ...marker, count: 3 })).toBe(false);
		expect(sameRow(fold, { ...fold })).toBe(true);
		expect(sameRow(fold, { ...fold, to: 10 })).toBe(false);
		const all = [line, removedRow, marker, fold];
		for (const a of all) for (const b of all) expect(sameRow(a, b)).toBe(a === b);
	});
});

describe("anchors (where `n` / `p` jump to: `data-anchor` in the code view)", () => {
	test("one row per block carries its anchor: the row the block starts at", () => {
		const rows = buildRows(12, CHANGES, opts());
		const anchors = rows.flatMap((row, i) =>
			row.kind !== "fold" && row.anchor && row.block !== null ? [[row.block, i]] : [],
		);
		expect(anchors).toEqual([
			[0, 2],
			[1, 9],
			[2, 12],
		]);
	});
});

describe("nextChange (the block `n` / `p` go to)", () => {
	// The landing place is at 140; a block that was scrolled to sits exactly there.
	const LANDING = 140;

	test("by position: the first block below the landing place, the last one above it", () => {
		const tops = [-300, 20, 400, 900];
		expect(nextChange(tops, LANDING, 1, null, false)).toBe(2);
		expect(nextChange(tops, LANDING, -1, null, false)).toBe(1);
	});

	test("the block that was just scrolled to is skipped in both directions", () => {
		const tops = [-300, 140, 400];
		expect(nextChange(tops, LANDING, 1, 1, false)).toBe(2);
		expect(nextChange(tops, LANDING, -1, 1, false)).toBe(0);
	});

	test("a block that sits at the landing place without being the current one is next", () => {
		// "Zusammenhang" closed: the first row of the code is where a block lands.
		const tops = [140, 180, 700];
		expect(nextChange(tops, LANDING, 1, null, false)).toBe(0);
		expect(nextChange(tops, LANDING, 1, 0, false)).toBe(1);
	});

	test("after scrolling by hand the position counts, not the last block", () => {
		// Block 3 was the last one; the reader scrolled back up to above block 1.
		const tops = [-50, 300, 600, 1400];
		expect(nextChange(tops, LANDING, 1, 3, false)).toBe(1);
		expect(nextChange(tops, LANDING, -1, 3, false)).toBe(0);
	});

	test("at the end of the page `n` steps on through blocks that cannot reach the landing place", () => {
		// Blocks 2 and 3 are in the last lines: both stay below the landing place.
		const tops = [-900, -400, 500, 540];
		expect(nextChange(tops, LANDING, 1, 1, true)).toBe(2);
		expect(nextChange(tops, LANDING, 1, 2, true)).toBe(3);
		expect(nextChange(tops, LANDING, 1, 3, true)).toBe(-1);
	});

	test("at the end of the page `p` steps back one block at a time", () => {
		const tops = [-900, -400, 500, 540];
		expect(nextChange(tops, LANDING, -1, 3, true)).toBe(2);
		expect(nextChange(tops, LANDING, -1, 2, true)).toBe(1);
	});

	test("a page too short to scroll walks through every block and stops at both ends", () => {
		const tops = [300, 340, 500];
		expect(nextChange(tops, LANDING, 1, null, true)).toBe(0);
		expect(nextChange(tops, LANDING, 1, 0, true)).toBe(1);
		expect(nextChange(tops, LANDING, 1, 1, true)).toBe(2);
		expect(nextChange(tops, LANDING, 1, 2, true)).toBe(-1);
		expect(nextChange(tops, LANDING, -1, 2, true)).toBe(1);
		expect(nextChange(tops, LANDING, -1, 1, true)).toBe(0);
		expect(nextChange(tops, LANDING, -1, 0, true)).toBe(-1);
	});

	test("no block in that direction, or none at all", () => {
		expect(nextChange([-300, 20], LANDING, 1, null, false)).toBe(-1);
		expect(nextChange([400, 900], LANDING, -1, null, false)).toBe(-1);
		expect(nextChange([], LANDING, 1, null, true)).toBe(-1);
	});
});
