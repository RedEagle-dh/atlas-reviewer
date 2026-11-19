/**
 * Lays out one map level in two stages.
 *
 * 1. Inside the frame: the current group's own nodes and the edges among them, by dagre, in
 *    layers. Direction "ltr" ("Grundlagen links"): what is imported stands left of what imports
 *    it; dagre puts an edge's tail left of its head, so each import `a → b` enters dagre as
 *    `b → a`. Nodes without an edge inside the frame do not go through dagre: they would pile up
 *    in its first layer, between the connected nodes. They form a block of rows below the
 *    drawing, in the level's order (chapters in reading order, then paths).
 *
 *    Edges never run under a node: dagre gives each edge a point in every layer it crosses (a
 *    dummy, or its label), placed where no node of that layer is. The line runs horizontally
 *    through each layer's band at that point and bends only in the gaps between the bands, where
 *    there are no nodes; it leaves and enters a node at the side that faces the next layer. A
 *    curve with horizontal tangents at every point (not a B-spline, which cuts corners) keeps
 *    each bend inside its gap.
 * 2. Outside the frame: the context nodes in a column on the "Grundlagen" side (what the group
 *    mainly imports) and one on the other side (what mainly imports the group), each next to the
 *    nodes it is connected with. One line per context node runs to the frame; the lines to the
 *    single nodes inside (details) are drawn on hover.
 *
 * Keeping context out of dagre is what keeps a dense level readable: a module folder whose every
 * file imports `packages/shared` would otherwise get one long line per file across all layers.
 */
import { type EdgeLabel, Graph, type GraphLabel, layout, type NodeLabel } from "@dagrejs/dagre";
import type { ContextLink, Drawing, DrawnEdge, LevelNode } from "./level";

export type Direction = "ltr" | "rtl";

export interface Box {
	/** Top-left corner. */
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Point {
	x: number;
	y: number;
}

export interface EdgeGeometry {
	/** SVG path (`M`, `L` and `C` commands) from the importing end to the imported one. */
	path: string;
	/** Centre of the count label. */
	label: Point;
	/** Arrowheads as SVG polygon point lists: at the imported end, and at the other end for a pair. */
	arrows: string[];
}

export interface MapLayout {
	boxes: Map<string, Box>;
	/** By edge id: inner edges, detail edges and context links. */
	edges: Map<string, EdgeGeometry>;
	/** Around the current group's own nodes when context nodes are drawn; else null. */
	frame: Box | null;
	bounds: Box;
}

/** Default sizes; the map widens file and context nodes to their measured names (`SizeOf`). */
export const NODE_SIZE = {
	group: { width: 184, height: 100 },
	file: { width: 192, height: 62 },
	context: { width: 156, height: 40 },
} as const;

export type SizeOf = (node: LevelNode) => { width: number; height: number };

export function nodeSize(node: LevelNode): { width: number; height: number } {
	if (node.context) return NODE_SIZE.context;
	return node.kind === "group" ? NODE_SIZE.group : NODE_SIZE.file;
}

/**
 * Room for an edge's count label: `12`, `12⇄3` for a pair (a pair is a cycle by itself), `↻ 12`
 * for a line on a longer cycle. dagre reserves it in a layer between the node layers, so the
 * label's width is added to the gap: keep it tight.
 */
export function labelSize(edge: Pick<DrawnEdge, "count" | "back" | "cycle" | "labelled">): {
	width: number;
	height: number;
} {
	if (!edge.labelled) return { width: 0, height: 0 };
	const chars = String(edge.count).length + (edge.back ? String(edge.back.count).length + 1 : 0);
	return { width: 10 + chars * 7 + (edge.cycle && !edge.back ? 11 : 0), height: 18 };
}

/** Between layers: with count labels dagre adds a label layer, so the gap is this plus the label. */
const RANKSEP_LABELLED = 22;
const RANKSEP_PLAIN = 48;
const NODESEP = 16;
const FRAME_PAD = 16;
/** Between the frame and a context column: room for the line, its arrowhead and its label. */
const LINK_GAP = 64;
const COLUMN_GAP = 20;
const CONTEXT_SPACING = 10;
const MAX_COLUMN = 12;
/** Between the drawing and the block of unconnected nodes below it. */
const BLOCK_GAP = 36;
const BLOCK_SPACING = 16;
/** A line leaves and enters a node at least this far from its corners. */
const SIDE_INSET = 10;

/** Stroke width of a line by the number of imports behind it. */
export function strokeWidth(count: number): number {
	return Math.min(6, 1.25 + 1.4 * Math.log2(Math.max(1, count)));
}

interface ArrowSize {
	length: number;
	half: number;
}

/** An arrowhead stays clearly wider than its line. */
export function arrowSize(count: number): ArrowSize {
	const w = strokeWidth(count);
	return { length: 7 + w * 1.4, half: 3.5 + w * 0.9 };
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * A path through every point, each segment a cubic with horizontal tangents at both ends: it
 * stays inside its two points' x range and y range, so a bend never leaves its gap.
 */
export function horizontalPath(points: readonly Point[]): string {
	const [first] = points;
	if (!first) return "";
	let d = `M${round(first.x)},${round(first.y)}`;
	for (let i = 1; i < points.length; i++) {
		const p = points[i - 1];
		const q = points[i];
		if (!p || !q) continue;
		if (Math.abs(p.y - q.y) < 0.05) {
			d += `L${round(q.x)},${round(q.y)}`;
			continue;
		}
		const mid = (p.x + q.x) / 2;
		d += `C${round(mid)},${round(p.y)} ${round(mid)},${round(q.y)} ${round(q.x)},${round(q.y)}`;
	}
	return d;
}

/** An arrowhead with its tip at `tip`, pointing away from `from`. */
function arrow(tip: Point, from: Point, size: ArrowSize): string {
	const dx = tip.x - from.x;
	const dy = tip.y - from.y;
	const length = Math.hypot(dx, dy) || 1;
	const ux = dx / length;
	const uy = dy / length;
	const bx = tip.x - ux * size.length;
	const by = tip.y - uy * size.length;
	return `${round(tip.x)},${round(tip.y)} ${round(bx - uy * size.half)},${round(by + ux * size.half)} ${round(bx + uy * size.half)},${round(by - ux * size.half)}`;
}

const clamp = (value: number, low: number, high: number) =>
	low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value));

/**
 * The polyline of an inner edge: from the importer's side, horizontally through the band of every
 * layer it crosses (at dagre's point there), to the imported node's side. `halfWidthAt(p)` is the
 * half width of the band the line must cross straight at point `p` (0: it may bend there).
 */
export function routeThroughBands(
	points: readonly Point[],
	from: Box,
	to: Box,
	halfWidthAt: (p: Point) => number,
): Point[] {
	const first = points[0];
	const last = points[points.length - 1];
	if (!first || !last) return [];
	const fromCentre = from.x + from.width / 2;
	const toCentre = to.x + to.width / 2;
	const s = toCentre >= fromCentre ? 1 : -1; // the direction of travel along x
	const inner = points.slice(1, -1);
	const out: Point[] = [];
	const push = (p: Point) => {
		const prev = out[out.length - 1];
		if (!prev || Math.abs(prev.x - p.x) > 0.05 || Math.abs(prev.y - p.y) > 0.05) out.push(p);
	};
	const startY = clamp(
		(inner[0] ?? last).y,
		from.y + SIDE_INSET,
		from.y + from.height - SIDE_INSET,
	);
	push({ x: fromCentre + (s * from.width) / 2, y: startY });
	const fromHalf = halfWidthAt({ x: fromCentre, y: startY });
	push({ x: fromCentre + s * Math.max(from.width / 2, fromHalf), y: startY });
	for (const p of inner) {
		const half = halfWidthAt(p);
		push({ x: p.x - s * half, y: p.y });
		push({ x: p.x + s * half, y: p.y });
	}
	const endY = clamp(
		(inner[inner.length - 1] ?? first).y,
		to.y + SIDE_INSET,
		to.y + to.height - SIDE_INSET,
	);
	const toHalf = halfWidthAt({ x: toCentre, y: endY });
	push({ x: toCentre - s * Math.max(to.width / 2, toHalf), y: endY });
	push({ x: toCentre - (s * to.width) / 2, y: endY });
	return out;
}

/**
 * A polyline that is horizontal at both ends as a path with arrowheads: one at the end, and one
 * at the start too when `both`; the line stops at each arrowhead's base.
 */
function polylineGeometry(
	points: readonly Point[],
	both: boolean,
	label: Point,
	size: ArrowSize,
): EdgeGeometry {
	const line = [...points];
	const n = line.length;
	const last = line[n - 1];
	const first = line[0];
	const arrows: string[] = [];
	if (!first || !last || n < 2) return { path: "", label, arrows };
	const s = last.x >= first.x ? 1 : -1;
	arrows.push(arrow(last, { x: last.x - s, y: last.y }, size));
	line[n - 1] = { x: last.x - s * (size.length - 1), y: last.y };
	if (both) {
		arrows.push(arrow(first, { x: first.x + s, y: first.y }, size));
		line[0] = { x: first.x + s * (size.length - 1), y: first.y };
	}
	return { path: horizontalPath(line), label, arrows };
}

/**
 * A horizontal S-curve from `from` to `to` (importer to imported) with arrowheads like
 * `polylineGeometry`; the label sits at its middle.
 */
function curveGeometry(from: Point, to: Point, both: boolean, size: ArrowSize): EdgeGeometry {
	const geometry = polylineGeometry([from, to], both, { x: 0, y: 0 }, size);
	return { ...geometry, label: { x: round((from.x + to.x) / 2), y: round((from.y + to.y) / 2) } };
}

/** How many unconnected nodes go into one row of the block they form. */
export function rowLength(isolated: number): number {
	return Math.max(2, Math.min(5, Math.ceil(Math.sqrt(isolated * 1.6))));
}

/** Stage 1: the group's own nodes and the edges among them. */
function layoutInside(
	nodes: readonly LevelNode[],
	edges: readonly DrawnEdge[],
	direction: Direction,
	sizeOf: SizeOf,
): { boxes: Map<string, Box>; edges: Map<string, EdgeGeometry> } {
	const connected = new Set<string>();
	for (const e of edges) {
		connected.add(e.source);
		connected.add(e.target);
	}
	const linked = nodes.filter((n) => connected.has(n.id));
	const isolated = nodes.filter((n) => !connected.has(n.id));
	const boxes = new Map<string, Box>();
	const geometry = new Map<string, EdgeGeometry>();

	if (linked.length > 0) {
		const g = new Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: true });
		g.setGraph({
			rankdir: direction === "ltr" ? "LR" : "RL",
			nodesep: NODESEP,
			ranksep: edges.some((e) => e.labelled) ? RANKSEP_LABELLED : RANKSEP_PLAIN,
			edgesep: 10,
			marginx: 0,
			marginy: 0,
		});
		g.setDefaultEdgeLabel(() => ({}));
		for (const node of linked) g.setNode(node.id, { ...sizeOf(node) });
		for (const edge of edges) {
			// Tail = the imported node, so it lands in the earlier (left) layer.
			g.setEdge(
				edge.target,
				edge.source,
				{ ...labelSize(edge), labelpos: "c", minlen: 1, weight: 1 + Math.log2(edge.count) },
				edge.id,
			);
		}
		layout(g);

		// Every layer shares one x (dagre places a layer on one line); a layer of nodes is a band as
		// wide as its widest node. Between two such bands lie only lines and count labels.
		const bands = new Map<number, number>();
		const key = (x: number) => Math.round(x * 10);
		for (const node of linked) {
			const label = g.node(node.id);
			const size = sizeOf(node);
			boxes.set(node.id, {
				x: (label.x ?? 0) - size.width / 2,
				y: (label.y ?? 0) - size.height / 2,
				...size,
			});
			const k = key(label.x ?? 0);
			bands.set(k, Math.max(bands.get(k) ?? 0, size.width / 2));
		}

		for (const edge of edges) {
			const label = g.edge(edge.target, edge.source, edge.id);
			const from = boxes.get(edge.source);
			const to = boxes.get(edge.target);
			// dagre's points run from the imported node to the importer: reverse them.
			const points = [...(label.points ?? [])].reverse();
			if (!from || !to || points.length < 2) continue;
			// Straight through a band of nodes, and through the edge's own label (it sits on the line).
			const own = edge.labelled && label.x !== undefined && label.y !== undefined;
			const halfWidthAt = (p: Point) => {
				const band = bands.get(key(p.x));
				if (band !== undefined) return band;
				const isLabel =
					own && Math.abs(p.x - (label.x ?? 0)) < 0.5 && Math.abs(p.y - (label.y ?? 0)) < 0.5;
				return isLabel ? labelSize(edge).width / 2 + 2 : 0;
			};
			const line = routeThroughBands(points, from, to, halfWidthAt);
			const mid = line[Math.floor(line.length / 2)] ?? { x: 0, y: 0 };
			geometry.set(
				edge.id,
				polylineGeometry(
					line,
					edge.back !== undefined,
					{ x: label.x ?? mid.x, y: label.y ?? mid.y },
					arrowSize(edge.count + (edge.back?.count ?? 0)),
				),
			);
		}
	}

	if (isolated.length > 0) {
		// A block of rows below the drawing, starting on the "Grundlagen" side.
		const drawn = linked.length > 0 ? union([...boxes.values()]) : null;
		const top = drawn ? drawn.y + drawn.height + BLOCK_GAP : 0;
		const perRow =
			linked.length > 0 ? Math.max(rowLength(isolated.length), 3) : rowLength(isolated.length);
		const rows: LevelNode[][] = [];
		for (let i = 0; i < isolated.length; i += perRow) rows.push(isolated.slice(i, i + perRow));
		let y = top;
		for (const row of rows) {
			const sizes = row.map(sizeOf);
			const width = sizes.reduce((w, s) => w + s.width, 0) + BLOCK_SPACING * (row.length - 1);
			const height = Math.max(...sizes.map((s) => s.height));
			let x = direction === "ltr" || !drawn ? (drawn?.x ?? 0) : drawn.x + drawn.width - width;
			row.forEach((node, i) => {
				const size = sizes[i] ?? sizeOf(node);
				boxes.set(node.id, { x, y, ...size });
				x += size.width + BLOCK_SPACING;
			});
			y += height + BLOCK_SPACING;
		}
	}
	return { boxes, edges: geometry };
}

/** Centres for a column of items near their wished centres, without overlap, keeping the mean. */
export function stack(wished: readonly number[], height: number, gap: number): number[] {
	const placed: number[] = [];
	for (const y of wished) {
		const prev = placed[placed.length - 1];
		placed.push(prev === undefined ? y : Math.max(y, prev + height + gap));
	}
	if (placed.length === 0) return placed;
	const mean = (list: readonly number[]) => list.reduce((a, b) => a + b, 0) / list.length;
	const shift = mean(wished) - mean(placed);
	return placed.map((y) => y + shift);
}

export function layoutLevel(
	nodes: readonly LevelNode[],
	drawing: Drawing,
	direction: Direction,
	sizeOf: SizeOf = nodeSize,
): MapLayout {
	const own = nodes.filter((n) => !n.context);
	const inside = layoutInside(own, drawing.inner, direction, sizeOf);
	const boxes = inside.boxes;
	const geometry = inside.edges;
	const context = nodes.filter((n) => n.context);
	if (context.length === 0) {
		const all = [...boxes.values()];
		for (const geo of geometry.values()) all.push({ ...geo.label, width: 0, height: 0 });
		return { boxes, edges: geometry, frame: null, bounds: union(all) };
	}

	const frame = inflate(union([...boxes.values()]), FRAME_PAD);
	const linkOf = new Map(drawing.links.map((l) => [l.node, l]));
	const leftSide: ContextLink["side"] = direction === "ltr" ? "dependency" : "dependent";
	const height = NODE_SIZE.context.height;

	// Wished height of a context node: the weighted mean of the nodes inside it is connected with.
	const wish = new Map<string, number>();
	for (const node of context) {
		let sum = 0;
		let weight = 0;
		for (const e of drawing.details) {
			const inner = e.source === node.id ? e.target : e.target === node.id ? e.source : null;
			const box = inner ? boxes.get(inner) : undefined;
			if (!box) continue;
			const w = e.count + (e.back?.count ?? 0);
			sum += (box.y + box.height / 2) * w;
			weight += w;
		}
		wish.set(node.id, weight > 0 ? sum / weight : frame.y + frame.height / 2);
	}

	for (const left of [true, false]) {
		const column = context
			.filter((n) => (linkOf.get(n.id)?.side === leftSide) === left)
			.sort((a, b) => (wish.get(a.id) ?? 0) - (wish.get(b.id) ?? 0) || a.id.localeCompare(b.id));
		let offset = LINK_GAP;
		for (let start = 0; start < column.length; start += MAX_COLUMN) {
			const chunk = column.slice(start, start + MAX_COLUMN);
			const width = Math.max(...chunk.map((n) => sizeOf(n).width));
			const centres = stack(
				chunk.map((n) => wish.get(n.id) ?? 0),
				height,
				CONTEXT_SPACING,
			);
			chunk.forEach((node, i) => {
				const size = sizeOf(node);
				// Each column hugs the frame: right-aligned on the left side, left-aligned on the right.
				const x = left ? frame.x - offset - size.width : frame.x + frame.width + offset;
				boxes.set(node.id, { x, y: (centres[i] ?? 0) - size.height / 2, ...size });
			});
			offset += width + COLUMN_GAP;
		}
	}

	// Context links: from the context node to the frame's facing side.
	for (const link of drawing.links) {
		const box = boxes.get(link.node);
		if (!box) continue;
		const isLeft = box.x + box.width <= frame.x;
		const cy = box.y + box.height / 2;
		const nodePoint = { x: isLeft ? box.x + box.width : box.x, y: cy };
		const framePoint = {
			x: isLeft ? frame.x : frame.x + frame.width,
			y: Math.min(frame.y + frame.height - 14, Math.max(frame.y + 14, cy)),
		};
		// Drawn from the importer to the imported end of the stronger direction.
		const groupImports = link.side === "dependency";
		const both = link.uses !== null && link.usedBy !== null;
		const size = arrowSize((link.uses?.count ?? 0) + (link.usedBy?.count ?? 0));
		geometry.set(
			link.id,
			groupImports
				? curveGeometry(framePoint, nodePoint, both, size)
				: curveGeometry(nodePoint, framePoint, both, size),
		);
	}

	// Detail edges: from a node inside to a context node, drawn on hover.
	for (const edge of drawing.details) {
		const a = boxes.get(edge.source);
		const b = boxes.get(edge.target);
		if (!a || !b) continue;
		const aLeft = a.x + a.width / 2 < b.x + b.width / 2;
		const from = { x: aLeft ? a.x + a.width : a.x, y: a.y + a.height / 2 };
		const to = { x: aLeft ? b.x : b.x + b.width, y: b.y + b.height / 2 };
		geometry.set(
			edge.id,
			curveGeometry(
				from,
				to,
				edge.back !== undefined,
				arrowSize(edge.count + (edge.back?.count ?? 0)),
			),
		);
	}

	const all = [...boxes.values(), frame];
	for (const link of drawing.links) {
		const geo = geometry.get(link.id);
		if (geo) all.push({ ...geo.label, width: 0, height: 0 });
	}
	return { boxes, edges: geometry, frame, bounds: union(all) };
}

/** A box on the screen (relative to the canvas), as the browser reports it. */
export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

const overlapArea = (a: Rect, b: Rect) =>
	Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
	Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

/**
 * Where the hover tooltip goes: below, above, right or left of the hovered node (kept on the
 * canvas), whichever covers the least of it and of the nodes that stay lit — dagre stacks a layer
 * vertically, so the nodes right below a node are often the very neighbours the hover shows.
 */
export function placeTip(
	anchor: Rect,
	lit: readonly Rect[],
	size: { width: number; height: number },
	canvas: { width: number; height: number },
): { left: number; top: number } {
	const gap = 8;
	const keep = (left: number, top: number) => ({
		left: Math.max(gap, Math.min(left, canvas.width - size.width - gap)),
		top: Math.max(gap, Math.min(top, canvas.height - size.height - gap)),
	});
	const candidates = [
		keep(anchor.left, anchor.top + anchor.height + gap),
		keep(anchor.left, anchor.top - size.height - gap),
		keep(anchor.left + anchor.width + gap, anchor.top),
		keep(anchor.left - size.width - gap, anchor.top),
	];
	let best = candidates[0] ?? { left: gap, top: gap };
	let least = Number.POSITIVE_INFINITY;
	for (const c of candidates) {
		const box = { ...c, ...size };
		const covered = [anchor, ...lit].reduce((sum, r) => sum + overlapArea(box, r), 0);
		if (covered < least) {
			least = covered;
			best = c;
		}
	}
	return best;
}

export function union(boxes: readonly Box[]): Box {
	if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
	let x0 = Number.POSITIVE_INFINITY;
	let y0 = Number.POSITIVE_INFINITY;
	let x1 = Number.NEGATIVE_INFINITY;
	let y1 = Number.NEGATIVE_INFINITY;
	for (const b of boxes) {
		x0 = Math.min(x0, b.x);
		y0 = Math.min(y0, b.y);
		x1 = Math.max(x1, b.x + b.width);
		y1 = Math.max(y1, b.y + b.height);
	}
	return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function inflate(box: Box, by: number): Box {
	return { x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by };
}
