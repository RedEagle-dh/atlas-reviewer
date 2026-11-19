/**
 * The rows of the code view: head lines, the base lines a change block replaced (shown inline
 * above the block), markers for removals that are hidden, and folds for unchanged stretches in
 * the mode "Nur Änderungen". Pure, so the subtle parts (where removed lines go, which stretches
 * fold) are tested apart from the rendering.
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
	/** `from` lines of folds the reader opened. */
	unfolded: ReadonlySet<number>;
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

	let line = 1;
	while (line <= lineCount) {
		if (options.mode === "full" || keep.has(line) || before.has(line)) {
			pushLine(line);
			line++;
			continue;
		}
		let end = line;
		while (end + 1 <= lineCount && !keep.has(end + 1) && !before.has(end + 1)) end++;
		if (end - line + 1 < MIN_FOLD || options.unfolded.has(line)) {
			for (let l = line; l <= end; l++) pushLine(l);
		} else {
			rows.push({ kind: "fold", from: line, to: end });
		}
		line = end + 1;
	}
	rows.push(...(before.get(lineCount + 1) ?? []));
	return rows;
}
