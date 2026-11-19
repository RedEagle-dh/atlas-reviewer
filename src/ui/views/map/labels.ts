/**
 * Node sizes from their names: a file or context node is as wide as its name needs, up to a cap;
 * beyond it the name is cut in the middle (`master-dat…models.ts`), so its start and its
 * extension stay readable. A group node widens so that its title takes at most two lines. Pure:
 * the map passes a measure of its real fonts, tests pass a fake.
 */

import { NODE_SIZE } from "./layout";
import type { LevelNode } from "./level";

/** Width in px of a text in one of the map's label styles. */
export type Measure = (text: string, style: "file" | "context" | "group" | "small") => number;

/** The widest a file node grows. */
export const MAX_NODE_WIDTH = 300;
/** A context node names a chapter (`2 SDK: was ein Paket enthalten darf`): it may grow wider. */
export const MAX_CONTEXT_WIDTH = 340;
const MAX_GROUP_WIDTH = 260;
const MIN_CONTEXT_WIDTH = 120;

/**
 * Horizontal room around the name, as nodes.tsx draws it: padding and borders, a status or viewed
 * mark of 16 px with its gap of 6 px, a little spare for the rounding of text widths.
 */
const BOX = 20 + 2;
const MARK = 16 + 6;
/** A file: its status before the name, its viewed mark after it. */
const FILE_CHROME = BOX + 2 * MARK + 2;
/** A context group: the gap to its count (the count itself is measured). */
const CONTEXT_GROUP_CHROME = BOX + 8 + 6;
/** A context file: its status before the name. */
const CONTEXT_FILE_CHROME = BOX + MARK + 2;
const GROUP_CHROME = BOX + 4;
/** Two lines hold less than twice one line: words wrap whole. */
const TWO_LINES = 1.6;

/** `text`, or as much of its start and end as fits around a `…`. */
export function fitText(text: string, max: number, measure: (text: string) => number): string {
	if (measure(text) <= max) return text;
	let low = 0;
	let high = text.length;
	const cut = (keep: number) => {
		const head = Math.ceil(keep / 2);
		return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
	};
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (measure(cut(mid)) <= max) low = mid;
		else high = mid - 1;
	}
	return cut(low);
}

export interface NodeLabel {
	width: number;
	height: number;
	/** The name as drawn (cut in the middle when it is too long). */
	text: string;
}

/**
 * Size and drawn name of every node. `name`: the full name the node shows (a context group's
 * label with its chapter number, a file name); `index`: an own chapter node's number (drawn
 * apart); `hint`: a context file's directory, `count`: a context group's number of files.
 */
export function labelNodes(
	nodes: readonly {
		node: LevelNode;
		name: string;
		index?: string;
		hint?: string;
		count?: string;
	}[],
	measure: Measure,
): Map<string, NodeLabel> {
	const out = new Map<string, NodeLabel>();
	for (const { node, name, index = "", hint = "", count = "" } of nodes) {
		if (node.context) {
			const extra =
				node.kind === "group"
					? measure(count, "small")
					: Math.max(0, measure(hint, "small") - measure(name, "context"));
			const chrome = node.kind === "group" ? CONTEXT_GROUP_CHROME : CONTEXT_FILE_CHROME;
			const room = MAX_CONTEXT_WIDTH - chrome - (node.kind === "group" ? extra : 0);
			const text = fitText(name, room, (t) => measure(t, "context"));
			const width = Math.min(
				MAX_CONTEXT_WIDTH,
				Math.max(MIN_CONTEXT_WIDTH, Math.ceil(measure(text, "context") + extra + chrome)),
			);
			out.set(node.id, { ...NODE_SIZE.context, width, text });
		} else if (node.kind === "file") {
			const text = fitText(name, MAX_NODE_WIDTH - FILE_CHROME, (t) => measure(t, "file"));
			const width = Math.min(
				MAX_NODE_WIDTH,
				Math.max(NODE_SIZE.file.width, Math.ceil(measure(text, "file") + FILE_CHROME)),
			);
			out.set(node.id, { ...NODE_SIZE.file, width, text });
		} else {
			// Wide enough for the title in two lines (nodes.tsx clamps it there; the node's tooltip
			// has it whole when even the widest node is not enough).
			const indexWidth = index ? measure(index, "group") + 6 : 0;
			const needed = measure(name, "group") / TWO_LINES + indexWidth + GROUP_CHROME;
			const width = Math.min(MAX_GROUP_WIDTH, Math.max(NODE_SIZE.group.width, Math.ceil(needed)));
			out.set(node.id, { ...NODE_SIZE.group, width, text: name });
		}
	}
	return out;
}
