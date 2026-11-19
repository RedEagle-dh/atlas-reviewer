/**
 * The rows of the code view: head lines, the base lines a change block replaced (shown inline
 * above the block), markers for removals that are hidden, and folds for unchanged stretches in
 * the mode "Nur Änderungen"; and which change block `n` / `p` go to. Pure, so the subtle parts
 * (where removed lines go, which stretches fold, what never folds, the step at the end of the
 * page) are tested apart from the rendering.
 */
import type { ChangeBlock } from "../../../core/types";

export type Row =
	/** A head line (1-based). `change`: the block it belongs to replaced lines (`modified`) or only added (`added`). */
	| {
			kind: "line";
			line: number;
			change: "added" | "modified" | null;
			block: number | null;
			anchor: boolean;
	  }
	/** A base line the block replaced (index into `ChangeBlock.removed`). */
	| { kind: "removed"; block: number; index: number; anchor: boolean }
	/** Lines were removed here but are hidden ("Entferntes zeigen" is off) and no head line marks the spot. */
	| { kind: "removal-marker"; block: number; count: number; anchor: boolean }
	/** Head lines `from`..`to` (inclusive), folded. */
	| { kind: "fold"; from: number; to: number };

export interface RowOptions {
	/** `changes`: unchanged stretches fold, `context` lines around each block stay. */
	mode: "full" | "changes";
	showRemoved: boolean;
	/** Lines kept around a change in the mode `changes`. */
	context: number;
	/**
	 * Head lines that never fold in the mode `changes`: the lines of a fold the reader opened, a
	 * line with a comment, a line under an open composer. Lines, not folds: a fold is whatever
	 * stretch is left between them, so a comment written inside an opened fold leaves the lines
	 * around it open.
	 */
	pinned: ReadonlySet<number>;
	/** No change marks at all (added, deleted or unchanged file): every line, plain. */
	plain: boolean;
}

/** Folds shorter than this are not worth a click: their lines are shown. */
export const MIN_FOLD = 4;

export function buildRows(
	lineCount: number,
	changes: readonly ChangeBlock[],
	options: RowOptions,
): Row[] {
	if (options.plain) {
		return Array.from({ length: lineCount }, (_, i) => ({
			kind: "line" as const,
			line: i + 1,
			change: null,
			block: null,
			anchor: false,
		}));
	}

	// Which block marks each head line, and what goes before a line (removed lines, markers).
	const blockOf = new Map<number, number>();
	const before = new Map<number, Row[]>();
	changes.forEach((block, b) => {
		const pending: Row[] = [];
		if (block.removed.length > 0) {
			if (options.showRemoved)
				for (let index = 0; index < block.removed.length; index++)
					pending.push({ kind: "removed", block: b, index, anchor: index === 0 });
			else if (block.count === 0)
				pending.push({
					kind: "removal-marker",
					block: b,
					count: block.removed.length,
					anchor: true,
				});
		}
		const at = Math.min(block.start, lineCount + 1);
		before.set(at, [...(before.get(at) ?? []), ...pending]);
		for (let line = block.start; line < block.start + block.count && line <= lineCount; line++)
			blockOf.set(line, b);
	});

	const anchored = new Set<number>();
	for (const rows of before.values())
		for (const row of rows)
			if ((row.kind === "removed" || row.kind === "removal-marker") && row.anchor)
				anchored.add(row.block);

	// Lines that stay visible in the mode `changes`.
	const keep = new Set<number>();
	if (options.mode === "changes") {
		for (const block of changes) {
			const first = block.start - options.context;
			const last =
				block.start + Math.max(block.count, 1) - 1 + options.context - (block.count === 0 ? 1 : 0);
			for (let line = Math.max(1, first); line <= Math.min(lineCount, last); line++) keep.add(line);
		}
	}

	const rows: Row[] = [];
	const pushLine = (line: number) => {
		rows.push(...(before.get(line) ?? []));
		const block = blockOf.get(line);
		if (block === undefined) {
			rows.push({ kind: "line", line, change: null, block: null, anchor: false });
			return;
		}
		const isAnchor = !anchored.has(block);
		if (isAnchor) anchored.add(block);
		const removed = changes[block]?.removed.length ?? 0;
		rows.push({
			kind: "line",
			line,
			change: removed > 0 ? "modified" : "added",
			block,
			anchor: isAnchor,
		});
	};

	const stays = (l: number) => keep.has(l) || before.has(l) || options.pinned.has(l);
	let line = 1;
	while (line <= lineCount) {
		if (options.mode === "full" || stays(line)) {
			pushLine(line);
			line++;
			continue;
		}
		let end = line;
		while (end + 1 <= lineCount && !stays(end + 1)) end++;
		if (end - line + 1 < MIN_FOLD) {
			for (let l = line; l <= end; l++) pushLine(l);
		} else {
			rows.push({ kind: "fold", from: line, to: end });
		}
		line = end + 1;
	}
	rows.push(...(before.get(lineCount + 1) ?? []));
	return rows;
}

/**
 * True when two rows show the same thing. The rows are built anew whenever a line is pinned, but
 * most of them come out as they were: a row that is the same need not be rendered again.
 */
export function sameRow(a: Row, b: Row): boolean {
	if (a === b) return true;
	switch (a.kind) {
		case "line":
			return (
				b.kind === "line" &&
				a.line === b.line &&
				a.change === b.change &&
				a.block === b.block &&
				a.anchor === b.anchor
			);
		case "removed":
			return (
				b.kind === "removed" && a.block === b.block && a.index === b.index && a.anchor === b.anchor
			);
		case "removal-marker":
			return (
				b.kind === "removal-marker" &&
				a.block === b.block &&
				a.count === b.count &&
				a.anchor === b.anchor
			);
		case "fold":
			return b.kind === "fold" && a.from === b.from && a.to === b.to;
	}
}

/**
 * Which change block `n` (`direction` 1) or `p` (-1) goes to, from where the blocks' anchor rows
 * are on screen: the first block below (the last one above) the landing place, the line a block
 * is scrolled to. `tops` are the anchors' upper edges in the order of the blocks, `current` is
 * the block the last press went to. Returns -1 when there is no such block.
 */
export function nextChange(
	tops: readonly number[],
	landing: number,
	direction: 1 | -1,
	current: number | null,
	atEnd: boolean,
): number {
	// A block that sits at the landing place already is the next one, unless it is the current
	// one: with "Zusammenhang" closed the first row of the code is exactly there.
	const waiting = (top: number, i: number) => i !== current && Math.abs(top - landing) <= 2;
	const index =
		direction === 1
			? tops.findIndex((top, i) => top > landing + 2 || waiting(top, i))
			: tops.findLastIndex((top, i) => top < landing - 2 || waiting(top, i));
	// At its end the page cannot scroll further: the last blocks stay below the landing place, and
	// where they are no longer says which one is next. There the step is counted from `current`.
	if (atEnd && current !== null) {
		if (direction === 1 && index !== -1 && index <= current)
			return current + 1 < tops.length ? current + 1 : -1;
		if (direction === -1 && current - 1 > index) return current - 1;
	}
	return index;
}
