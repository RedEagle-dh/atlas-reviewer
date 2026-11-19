/**
 * One level of the map: what is drawn when the map shows a group.
 *
 * - Main nodes: the group's children (sub-groups and files), all of them.
 * - Context nodes: for each ancestor level, the siblings on the way down (sibling groups and
 *   files), muted, but only those connected to a main node: they show what the current group
 *   depends on and what depends on it. The others are counted (`hiddenContext`).
 * - Edges: every file-to-file import, lifted to the nodes that contain its two files and counted.
 *   Imports inside one node vanish, imports between two context nodes are not drawn.
 * - Cycles, marked only where they are true:
 *   - an edge between two of the group's own nodes that lie in one strongly connected component of
 *     the own nodes (for groups: the directories depend on each other);
 *   - any edge with an import behind it whose two files lie on one file cycle (`model.cycles`);
 *   - a pair of opposite edges, or a context link used both ways (they are mutual by themselves).
 *   Context nodes never take part in the component search: one of them lumps unrelated
 *   directories together, so a loop through it is usually no loop between files at all.
 *
 * An edge `source → target` means "source imports target", as everywhere in the tool.
 */
import type { ChangedFile, Edge } from "../../../core/types";
import { type Group, type GroupTree, trail } from "./grouping";

export type LevelNode =
	| { id: string; kind: "group"; group: Group; context: boolean }
	| { id: string; kind: "file"; file: ChangedFile; context: boolean };

export interface LevelEdge {
	id: string;
	/** The importing node. */
	source: string;
	/** The imported node. */
	target: string;
	/** How many file-to-file imports it stands for. */
	count: number;
	/** Every import behind it is type-only. */
	typeOnly: boolean;
	/** Source and target depend on each other (see the rules at the top of this file). */
	cycle: boolean;
	/** The file-to-file imports behind it. */
	imports: Edge[];
}

export interface Level {
	group: Group;
	/** Root … group. */
	trail: Group[];
	/** Main nodes first (groups, then files), then context nodes from the nearest level outwards. */
	nodes: LevelNode[];
	edges: LevelEdge[];
	/** Sibling groups and files of the ancestor levels that are not drawn: no import to a main node. */
	hiddenContext: number;
}

export const groupNodeId = (group: Group) => `g:${group.id}`;
export const fileNodeId = (path: string) => `f:${path}`;

/**
 * Strongly connected components: node id → component number. Recursive Tarjan (levels are
 * small). Core has its own (iterative, `src/core/graph.ts`); the UI imports only types from core,
 * so it keeps this copy.
 */
export function components(
	nodes: readonly string[],
	edges: readonly { source: string; target: string }[],
) {
	const out = new Map<string, string[]>();
	for (const e of edges) {
		const list = out.get(e.source);
		if (list) list.push(e.target);
		else out.set(e.source, [e.target]);
	}
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const component = new Map<string, number>();
	let counter = 0;
	let next = 0;
	const visit = (v: string) => {
		index.set(v, counter);
		low.set(v, counter);
		counter++;
		stack.push(v);
		onStack.add(v);
		for (const w of out.get(v) ?? []) {
			if (!index.has(w)) {
				visit(w);
				low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
			} else if (onStack.has(w)) {
				low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0));
			}
		}
		if (low.get(v) === index.get(v)) {
			for (;;) {
				const w = stack.pop();
				if (w === undefined) break;
				onStack.delete(w);
				component.set(w, next);
				if (w === v) break;
			}
			next++;
		}
	};
	for (const v of nodes) if (!index.has(v)) visit(v);
	return component;
}

/** `cycles`: the file cycles of the model (`ReviewModel.cycles`). */
export function buildLevel(
	tree: GroupTree,
	group: Group,
	edges: readonly Edge[],
	cycles: readonly (readonly string[])[] = [],
): Level {
	const here = trail(group);
	const nodes = new Map<string, LevelNode>();
	for (const child of group.groups)
		nodes.set(groupNodeId(child), {
			id: groupNodeId(child),
			kind: "group",
			group: child,
			context: false,
		});
	for (const file of group.files)
		nodes.set(fileNodeId(file.path), {
			id: fileNodeId(file.path),
			kind: "file",
			file,
			context: false,
		});

	const contextCandidates = new Map<string, LevelNode>();
	/** Context node id → the level it belongs to (1 = top level); nearer levels come first. */
	const contextLevel = new Map<string, number>();
	const representative = new Map<string, LevelNode | null>();
	const representativeOf = (path: string): LevelNode | null => {
		const known = representative.get(path);
		if (known !== undefined) return known;
		let node: LevelNode | null = null;
		const parent = tree.parentOf.get(path);
		if (parent) {
			const chain = trail(parent);
			let i = 0;
			while (i < chain.length && i < here.length && chain[i] === here[i]) i++;
			if (i === here.length) {
				// Inside the current group: the file itself or the child group that holds it.
				const child = chain[i];
				node = nodes.get(child ? groupNodeId(child) : fileNodeId(path)) ?? null;
			} else if (i > 0) {
				// Outside: a sibling of the trail at level i, or a file that stands at level i - 1.
				const sibling = chain[i];
				const id = sibling ? groupNodeId(sibling) : fileNodeId(path);
				node = contextCandidates.get(id) ?? null;
				if (!node) {
					const file = sibling ? undefined : parent.files.find((f) => f.path === path);
					if (sibling) node = { id, kind: "group", group: sibling, context: true };
					else if (file) node = { id, kind: "file", file, context: true };
					if (node) {
						contextCandidates.set(id, node);
						contextLevel.set(id, i);
					}
				}
			}
		}
		representative.set(path, node);
		return node;
	};

	const lifted = new Map<string, LevelEdge>();
	for (const edge of edges) {
		const a = representativeOf(edge.from);
		const b = representativeOf(edge.to);
		if (!a || !b || a.id === b.id || (a.context && b.context)) continue;
		const id = `${a.id}→${b.id}`;
		const known = lifted.get(id);
		if (known) {
			known.count++;
			known.typeOnly &&= edge.kind === "type";
			known.imports.push(edge);
		} else {
			lifted.set(id, {
				id,
				source: a.id,
				target: b.id,
				count: 1,
				typeOnly: edge.kind === "type",
				cycle: false,
				imports: [edge],
			});
		}
	}

	// Context nodes that carry an edge, nearest level first, then by label.
	const used = new Set<string>();
	for (const e of lifted.values()) {
		used.add(e.source);
		used.add(e.target);
	}
	const context = [...contextCandidates.values()]
		.filter((n) => used.has(n.id))
		.sort(
			(a, b) =>
				(contextLevel.get(b.id) ?? 0) - (contextLevel.get(a.id) ?? 0) ||
				labelOf(a).localeCompare(labelOf(b)),
		);
	const all = [...nodes.values(), ...context];

	const levelEdges = [...lifted.values()];
	const own = new Set(nodes.keys());
	const isInner = (e: LevelEdge) => own.has(e.source) && own.has(e.target);
	const component = components([...own], levelEdges.filter(isInner));
	const cycleOf = new Map<string, number>();
	cycles.forEach((files, i) => {
		for (const path of files) cycleOf.set(path, i);
	});
	const onFileCycle = (e: Edge) => {
		const a = cycleOf.get(e.from);
		return a !== undefined && a === cycleOf.get(e.to);
	};
	for (const e of levelEdges)
		e.cycle =
			(isInner(e) && component.get(e.source) === component.get(e.target)) ||
			e.imports.some(onFileCycle);

	let siblings = 0;
	for (let i = 1; i < here.length; i++) {
		const parent = here[i - 1];
		if (parent) siblings += parent.groups.length - 1 + parent.files.length;
	}
	return {
		group,
		trail: here,
		nodes: all,
		edges: levelEdges,
		hiddenContext: siblings - context.length,
	};
}

function labelOf(node: LevelNode): string {
	return node.kind === "group" ? node.group.label : node.file.path;
}

// ---------------------------------------------------------------------------------------------
// For drawing
// ---------------------------------------------------------------------------------------------

/** An edge as drawn: two opposite level edges become one line with an arrowhead at each end. */
export interface DrawnEdge {
	id: string;
	source: string;
	target: string;
	count: number;
	typeOnly: boolean;
	cycle: boolean;
	/** The opposite direction (target imports source), when it exists. */
	back?: { count: number; typeOnly: boolean };
	/** Show the count on the line: at least one end is a group (a file-to-file line is always 1). */
	labelled: boolean;
	imports: Edge[];
}

/** Everything between one context node and the current group, drawn as one line to the frame. */
export interface ContextLink {
	id: string;
	/** The context node. */
	node: string;
	/** The group imports the context node. */
	uses: { count: number; typeOnly: boolean } | null;
	/** The context node imports the group. */
	usedBy: { count: number; typeOnly: boolean } | null;
	cycle: boolean;
	/** `dependency`: mainly imported by the group (the "Grundlagen" side); else `dependent`. */
	side: "dependency" | "dependent";
}

export interface Drawing {
	/** Between two of the group's own nodes. */
	inner: DrawnEdge[];
	/** Between a context node and one of the group's own nodes: drawn while one of them is hovered. */
	details: DrawnEdge[];
	/** One per context node, to the frame around the group. */
	links: ContextLink[];
}

function mergePairs(
	edges: readonly LevelEdge[],
	kinds: ReadonlyMap<string, LevelNode["kind"]>,
): DrawnEdge[] {
	const byId = new Map(edges.map((e) => [e.id, e]));
	const done = new Set<string>();
	const drawn: DrawnEdge[] = [];
	for (const edge of edges) {
		if (done.has(edge.id)) continue;
		const reverse = byId.get(`${edge.target}\u2192${edge.source}`);
		const labelled = kinds.get(edge.source) === "group" || kinds.get(edge.target) === "group";
		done.add(edge.id);
		if (!reverse) {
			drawn.push({ ...edge, labelled });
			continue;
		}
		done.add(reverse.id);
		const [main, back] =
			reverse.count > edge.count || (reverse.count === edge.count && reverse.id < edge.id)
				? [reverse, edge]
				: [edge, reverse];
		drawn.push({
			id: `${main.id}\u21c4`,
			source: main.source,
			target: main.target,
			count: main.count,
			typeOnly: main.typeOnly,
			cycle: true,
			back: { count: back.count, typeOnly: back.typeOnly },
			labelled,
			imports: [...main.imports, ...back.imports],
		});
	}
	return drawn;
}

export function drawLevel(level: Level): Drawing {
	const kinds = new Map(level.nodes.map((n) => [n.id, n.kind]));
	const context = new Set(level.nodes.filter((n) => n.context).map((n) => n.id));
	const inner = level.edges.filter((e) => !context.has(e.source) && !context.has(e.target));
	const outer = level.edges.filter((e) => context.has(e.source) || context.has(e.target));
	const links = new Map<string, ContextLink>();
	for (const e of outer) {
		const node = context.has(e.source) ? e.source : e.target;
		let link = links.get(node);
		if (!link) {
			link = {
				id: `link:${node}`,
				node,
				uses: null,
				usedBy: null,
				cycle: false,
				side: "dependency",
			};
			links.set(node, link);
		}
		const key = node === e.target ? "uses" : "usedBy";
		const known = link[key];
		link[key] = known
			? { count: known.count + e.count, typeOnly: known.typeOnly && e.typeOnly }
			: { count: e.count, typeOnly: e.typeOnly };
		link.cycle ||= e.cycle;
	}
	for (const link of links.values()) link.cycle ||= link.uses !== null && link.usedBy !== null;
	for (const link of links.values())
		link.side =
			link.uses && (!link.usedBy || link.uses.count >= link.usedBy.count)
				? "dependency"
				: "dependent";
	return {
		inner: mergePairs(inner, kinds),
		details: mergePairs(outer, kinds),
		links: level.nodes.flatMap((n) => {
			const link = links.get(n.id);
			return link ? [link] : [];
		}),
	};
}

export interface Relation {
	node: LevelNode;
	count: number;
}

/** What a node imports and what imports it on this level, strongest first. */
export function relationsOf(
	level: Level,
	nodeId: string,
): { imports: Relation[]; importedBy: Relation[] } {
	const byId = new Map(level.nodes.map((n) => [n.id, n]));
	const imports: Relation[] = [];
	const importedBy: Relation[] = [];
	for (const e of level.edges) {
		const other = byId.get(e.source === nodeId ? e.target : e.source);
		if (!other) continue;
		if (e.source === nodeId) imports.push({ node: other, count: e.count });
		else if (e.target === nodeId) importedBy.push({ node: other, count: e.count });
	}
	const strongest = (a: Relation, b: Relation) =>
		b.count - a.count || a.node.id.localeCompare(b.node.id);
	return { imports: imports.sort(strongest), importedBy: importedBy.sort(strongest) };
}

/**
 * What stays lit while `nodeId` is hovered: the node, its lines (inner edges, its detail edges,
 * and for a context node its link to the frame) and the nodes at their other ends.
 */
export function neighbourhood(
	drawing: Drawing,
	nodeId: string,
): { nodes: Set<string>; edges: Set<string> } {
	const nodes = new Set([nodeId]);
	const lit = new Set<string>();
	for (const e of [...drawing.inner, ...drawing.details]) {
		if (e.source !== nodeId && e.target !== nodeId) continue;
		lit.add(e.id);
		nodes.add(e.source);
		nodes.add(e.target);
	}
	for (const link of drawing.links) if (link.node === nodeId) lit.add(link.id);
	return { nodes, edges: lit };
}
