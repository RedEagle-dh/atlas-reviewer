import { describe, expect, test } from "bun:test";
import type { Edge } from "../../../core/types";
import { CHAPTERS, EDGES, edge, FILES, file } from "./fixtures";
import { buildGroupTree } from "./grouping";
import {
	type Box,
	horizontalPath,
	layoutLevel,
	type Point,
	placeTip,
	routeThroughBands,
	rowLength,
	stack,
} from "./layout";
import { buildLevel, drawLevel } from "./level";

const tree = buildGroupTree(FILES, "chapters", CHAPTERS);
const host = buildLevel(tree, tree.byId.get("host") ?? tree.root, EDGES);
const SERVICE = "f:apps/api/src/modules/plugins/service.ts";
const STORE = "f:apps/api/src/modules/plugins/store.ts";

const box = (layout: ReturnType<typeof layoutLevel>, id: string) => {
	const b = layout.boxes.get(id);
	if (!b) throw new Error(`no box ${id}`);
	return b;
};

const overlaps = (a: Box, b: Box) =>
	a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Points along an SVG path of `M`, `L` and `C` commands (what the layout writes). */
function samplePath(d: string): Point[] {
	const points: Point[] = [];
	let at: Point = { x: 0, y: 0 };
	for (const [, command, args] of d.matchAll(/([MLC])([^MLC]*)/g)) {
		const n = (args ?? "").split(/[ ,]+/).filter(Boolean).map(Number);
		if (command === "M") {
			at = { x: n[0] ?? 0, y: n[1] ?? 0 };
			points.push(at);
		} else if (command === "L") {
			const to = { x: n[0] ?? 0, y: n[1] ?? 0 };
			for (let t = 0.1; t <= 1.0001; t += 0.1)
				points.push({ x: at.x + (to.x - at.x) * t, y: at.y + (to.y - at.y) * t });
			at = to;
		} else {
			const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x = 0, y = 0] = n;
			for (let t = 0.05; t <= 1.0001; t += 0.05) {
				const u = 1 - t;
				points.push({
					x: u * u * u * at.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
					y: u * u * u * at.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
				});
			}
			at = { x, y };
		}
	}
	return points;
}

/** Inner lines that pass through the box of a node that is neither of their ends. */
function linesUnderNodes(level: ReturnType<typeof buildLevel>, direction: "ltr" | "rtl") {
	const drawing = drawLevel(level);
	const layout = layoutLevel(level.nodes, drawing, direction);
	const found: string[] = [];
	for (const e of drawing.inner) {
		const geo = layout.edges.get(e.id);
		if (!geo) continue;
		for (const [id, b] of layout.boxes) {
			if (id === e.source || id === e.target) continue;
			const inside = samplePath(geo.path).some(
				(p) =>
					p.x > b.x + 1 && p.x < b.x + b.width - 1 && p.y > b.y + 1 && p.y < b.y + b.height - 1,
			);
			if (inside) found.push(`${e.id} under ${id}`);
		}
	}
	return found;
}

/** A small deterministic random generator (tests must not flake). */
function random(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
}

describe("layoutLevel", () => {
	test("Grundlagen links: an imported node stands left of its importer", () => {
		const layout = layoutLevel(host.nodes, drawLevel(host), "ltr");
		const service = box(layout, SERVICE);
		expect(box(layout, STORE).x + box(layout, STORE).width).toBeLessThanOrEqual(service.x);
		// a context node the group imports stands left of the frame
		expect(box(layout, "g:sdk").x + box(layout, "g:sdk").width).toBeLessThanOrEqual(
			layout.frame?.x ?? 0,
		);
	});

	test("mirrored: the imported node stands right of its importer, the context too", () => {
		const layout = layoutLevel(host.nodes, drawLevel(host), "rtl");
		const service = box(layout, SERVICE);
		expect(service.x + service.width).toBeLessThanOrEqual(box(layout, STORE).x);
		const frame = layout.frame;
		if (!frame) throw new Error("no frame");
		expect(box(layout, "g:sdk").x).toBeGreaterThanOrEqual(frame.x + frame.width);
	});

	test("no two nodes overlap", () => {
		const layout = layoutLevel(host.nodes, drawLevel(host), "ltr");
		const list = [...layout.boxes.values()];
		for (let i = 0; i < list.length; i++)
			for (let j = i + 1; j < list.length; j++) {
				const a = list[i];
				const b = list[j];
				if (a && b) expect(overlaps(a, b)).toBe(false);
			}
	});

	test("the frame holds the group's own nodes and none of the context nodes", () => {
		const layout = layoutLevel(host.nodes, drawLevel(host), "ltr");
		const frame = layout.frame;
		if (!frame) throw new Error("no frame");
		for (const node of host.nodes) {
			const b = box(layout, node.id);
			if (node.context) expect(overlaps(frame, b)).toBe(false);
			else {
				expect(b.x).toBeGreaterThanOrEqual(frame.x);
				expect(b.y).toBeGreaterThanOrEqual(frame.y);
				expect(b.x + b.width).toBeLessThanOrEqual(frame.x + frame.width);
				expect(b.y + b.height).toBeLessThanOrEqual(frame.y + frame.height);
			}
		}
	});

	test("without context nodes there is no frame", () => {
		const top = buildLevel(tree, tree.root, EDGES);
		expect(layoutLevel(top.nodes, drawLevel(top), "ltr").frame).toBeNull();
	});

	test("every line gets a path and arrowheads, a pair one at each end", () => {
		const drawing = drawLevel(host);
		const { edges } = layoutLevel(host.nodes, drawing, "ltr");
		for (const e of [...drawing.inner, ...drawing.details]) {
			const geo = edges.get(e.id);
			expect(geo?.path.startsWith("M")).toBe(true);
			expect(geo?.arrows).toHaveLength(e.back ? 2 : 1);
		}
		for (const link of drawing.links) expect(edges.get(link.id)?.arrows).toHaveLength(1);
	});

	test("nodes take the size the map measured for them", () => {
		const wide = (n: { id: string }) => ({ width: n.id === STORE ? 290 : 192, height: 62 });
		const layout = layoutLevel(host.nodes, drawLevel(host), "ltr", (n) =>
			n.context ? { width: 230, height: 40 } : wide(n),
		);
		expect(box(layout, STORE).width).toBe(290);
		expect(box(layout, "g:sdk").width).toBe(230);
	});

	test("many context nodes on one side wrap into a second column", () => {
		const files = [
			file("core/a.ts", "c", "core"),
			file("core/b.ts", "c", "core"),
			...Array.from({ length: 15 }, (_, i) => file(`lib${i}/x.ts`, "l", `lib${i}`)),
		];
		const t = buildGroupTree(files, "dirs", []);
		const core = t.byId.get("core");
		if (!core) throw new Error("no core");
		const level = buildLevel(
			t,
			core,
			Array.from({ length: 15 }, (_, i) => edge("core/a.ts", `lib${i}/x.ts`)),
		);
		const layout = layoutLevel(level.nodes, drawLevel(level), "ltr");
		const xs = new Set(level.nodes.filter((n) => n.context).map((n) => box(layout, n.id).x));
		expect(xs.size).toBe(2);
	});

	test("unconnected nodes form a block of rows, not one tall column", () => {
		const docs = Array.from({ length: 9 }, (_, i) => file(`docs/d${i}.md`, "rest", "docs"));
		const docsTree = buildGroupTree(docs, "dirs", []);
		const group = docsTree.byId.get("docs");
		if (!group) throw new Error("no docs");
		const level = buildLevel(docsTree, group, []);
		const { boxes } = layoutLevel(level.nodes, drawLevel(level), "ltr");
		const xs = new Set([...boxes.values()].map((b) => Math.round(b.x)));
		const ys = new Set([...boxes.values()].map((b) => Math.round(b.y)));
		expect(xs.size).toBe(rowLength(9));
		expect(ys.size).toBe(Math.ceil(9 / rowLength(9)));
	});

	test("an unconnected node stands below the drawing, in the level's order, not in its first layer", () => {
		// A "Pakete & Ordner" top level in which one unit (`scripts`) has no edge at all.
		const files = [
			...["a", "b"].map((n) => file(`apps/web/${n}.ts`, "w", "apps/web")),
			...["a", "b"].map((n) => file(`packages/shared/${n}.ts`, "s", "packages/shared")),
			...["a", "b"].map((n) => file(`scripts/${n}.sh`, "x", "scripts")),
			...["a", "b"].map((n) => file(`examples/${n}.ts`, "e", "examples")),
		];
		const t = buildGroupTree(files, "dirs", []);
		const level = buildLevel(t, t.root, [edge("apps/web/a.ts", "packages/shared/a.ts")]);
		const layout = layoutLevel(level.nodes, drawLevel(level), "ltr");
		const web = box(layout, "g:apps/web");
		const shared = box(layout, "g:packages/shared");
		const drawingBottom = Math.max(web.y + web.height, shared.y + shared.height);
		const examples = box(layout, "g:examples");
		const scripts = box(layout, "g:scripts");
		expect(examples.y).toBeGreaterThan(drawingBottom);
		expect(scripts.y).toBeGreaterThan(drawingBottom);
		expect(examples.x).toBeLessThan(scripts.x); // examples < scripts by path
	});

	test("no line runs under a node that is neither of its ends", () => {
		// Shaped like a real top level on which 9 of 17 lines once ran under a foreign node: many
		// groups, long edges over several layers, groups and files mixed.
		for (const seed of [1, 7, 42, 99, 2024]) {
			const next = random(seed);
			const dirs = Array.from({ length: 9 }, (_, i) => `pkg${i}`);
			const files = dirs.flatMap((d, i) =>
				Array.from({ length: 2 + (i % 3) }, (_, j) => file(`${d}/f${j}.ts`, "c", d)),
			);
			files.push(file("lone.ts", "c", "."), file("other.ts", "c", "."));
			const edges: Edge[] = [];
			for (let k = 0; k < 40; k++) {
				const a = files[Math.floor(next() * files.length)];
				const b = files[Math.floor(next() * files.length)];
				// only "downhill" imports, so the drawing has layers and long edges
				if (a && b && a.path > b.path)
					edges.push(edge(a.path, b.path, next() < 0.3 ? "type" : "value"));
			}
			const t = buildGroupTree(files, "dirs", []);
			for (const direction of ["ltr", "rtl"] as const) {
				expect([seed, direction, linesUnderNodes(buildLevel(t, t.root, edges), direction)]).toEqual(
					[seed, direction, []],
				);
				const inner = t.byId.get("pkg8");
				if (inner) expect(linesUnderNodes(buildLevel(t, inner, edges), direction)).toEqual([]);
			}
		}
	});
});

describe("routeThroughBands", () => {
	test("leaves and enters at the facing sides and crosses each band horizontally", () => {
		const from: Box = { x: 400, y: 0, width: 100, height: 40 };
		const to: Box = { x: 0, y: 200, width: 100, height: 40 };
		// dagre: an intersection at each box and one dummy in the middle layer (centre x 250)
		const line = routeThroughBands(
			[
				{ x: 420, y: 40 },
				{ x: 250, y: 120 },
				{ x: 80, y: 200 },
			],
			from,
			to,
			(p) => (p.x === 250 ? 50 : p.x === 450 || p.x === 50 ? 50 : 0),
		);
		expect(line).toEqual([
			{ x: 400, y: 30 },
			{ x: 300, y: 120 },
			{ x: 200, y: 120 },
			{ x: 100, y: 210 },
		]);
	});
});

describe("placeTip", () => {
	const canvas = { width: 1000, height: 700 };
	const size = { width: 320, height: 100 };

	test("below the node when nothing lit is there", () => {
		const anchor = { left: 100, top: 100, width: 190, height: 60 };
		expect(placeTip(anchor, [], size, canvas)).toEqual({ left: 100, top: 168 });
	});

	test("not over the lit neighbours right below the node (one dagre layer is a column)", () => {
		const anchor = { left: 100, top: 100, width: 190, height: 60 };
		const lit = [
			{ left: 100, top: 176, width: 190, height: 60 },
			{ left: 100, top: 252, width: 190, height: 60 },
		];
		// above has no room (clamped onto the node), right is free
		expect(placeTip(anchor, lit, size, canvas)).toEqual({ left: 298, top: 100 });
	});
});

describe("stack", () => {
	test("keeps wished positions that do not collide", () => {
		expect(stack([0, 100, 200], 40, 10)).toEqual([0, 100, 200]);
	});

	test("pushes colliding items apart and keeps their mean", () => {
		const placed = stack([50, 50, 50], 40, 10);
		expect(placed).toEqual([0, 50, 100]);
	});
});

describe("horizontalPath", () => {
	test("a level step is a line; a bend is a cubic with horizontal tangents at both ends", () => {
		expect(
			horizontalPath([
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 30, y: 20 },
			]),
		).toBe("M0,0L10,0C20,0 20,20 30,20");
	});
});
