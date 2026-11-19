/**
 * The shape of the review: edges between its files, units, reading order and cycles.
 */
import type { Edge, ImportKind } from "./types";

/** Strongest first (see `ImportKind`). */
export const KIND_ORDER: readonly ImportKind[] = [
	"value",
	"re-export",
	"dynamic",
	"side-effect",
	"type",
];

export function strongerKind(a: ImportKind, b: ImportKind): ImportKind {
	return KIND_ORDER.indexOf(a) <= KIND_ORDER.indexOf(b) ? a : b;
}

export interface ImportStatement {
	kind: ImportKind;
	names: readonly string[];
	line: number;
}

/** Several statements of one file for one target, merged: strongest kind, all names, first line. */
export function mergeStatements(statements: readonly ImportStatement[]): {
	kind: ImportKind;
	names: string[];
	line: number;
} {
	let kind: ImportKind = "type";
	const names: string[] = [];
	let line = Number.POSITIVE_INFINITY;
	for (const s of statements) {
		kind = strongerKind(kind, s.kind);
		for (const name of s.names) if (!names.includes(name)) names.push(name);
		line = Math.min(line, s.line);
	}
	return { kind, names, line: Number.isFinite(line) ? line : 0 };
}

/** One edge per (from, to) from per-file resolved statements; only targets inside `files`. */
export function buildEdges(
	files: ReadonlySet<string>,
	statementsOf: (path: string) => Iterable<ImportStatement & { target: string | null }>,
): Edge[] {
	const edges: Edge[] = [];
	for (const from of [...files].sort()) {
		const byTarget = new Map<string, ImportStatement[]>();
		for (const statement of statementsOf(from)) {
			const target = statement.target;
			if (target === null || !files.has(target)) continue;
			const list = byTarget.get(target);
			if (list) list.push(statement);
			else byTarget.set(target, [statement]);
		}
		for (const to of [...byTarget.keys()].sort()) {
			const merged = mergeStatements(byTarget.get(to) ?? []);
			edges.push({ from, to, kind: merged.kind, names: merged.names, line: merged.line });
		}
	}
	return edges;
}

/** Dir of the nearest package dir that contains the path, else its top-level dir, else ".". */
export function unitOf(path: string, packageDirs: readonly string[]): string {
	let best = "";
	for (const dir of packageDirs) {
		if (dir && path.startsWith(`${dir}/`) && dir.length > best.length) best = dir;
	}
	if (best) return best;
	const slash = path.indexOf("/");
	return slash < 0 ? "." : path.slice(0, slash);
}

/**
 * Strongly connected components with more than one file (or a file that imports itself), each
 * sorted, the list sorted by its first path.
 */
export function findCycles(paths: readonly string[], edges: readonly Edge[]): string[][] {
	const selfLoops = new Set(edges.filter((e) => e.from === e.to).map((e) => e.from));
	return stronglyConnected(paths, edges).filter(
		(component) => component.length > 1 || selfLoops.has(component[0] ?? ""),
	);
}

/**
 * Every strongly connected component of the graph (a file outside any cycle is one by itself),
 * each sorted, the list sorted by its first path. Tarjan's algorithm, iterative. Edges whose ends
 * are not in `paths` are ignored.
 */
export function stronglyConnected(paths: readonly string[], edges: readonly Edge[]): string[][] {
	const adjacency = new Map<string, string[]>();
	for (const p of paths) adjacency.set(p, []);
	for (const e of edges) if (adjacency.has(e.to)) adjacency.get(e.from)?.push(e.to);
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const components: string[][] = [];
	let counter = 0;

	for (const root of [...paths].sort()) {
		if (index.has(root)) continue;
		const work: { node: string; next: number }[] = [{ node: root, next: 0 }];
		index.set(root, counter);
		low.set(root, counter);
		counter++;
		stack.push(root);
		onStack.add(root);
		while (work.length > 0) {
			const frame = work[work.length - 1];
			if (!frame) break;
			const targets = adjacency.get(frame.node) ?? [];
			if (frame.next < targets.length) {
				const target = targets[frame.next++] ?? "";
				if (!index.has(target)) {
					index.set(target, counter);
					low.set(target, counter);
					counter++;
					stack.push(target);
					onStack.add(target);
					work.push({ node: target, next: 0 });
				} else if (onStack.has(target)) {
					low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(target) ?? 0));
				}
				continue;
			}
			work.pop();
			const parent = work[work.length - 1];
			if (parent)
				low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0));
			if (low.get(frame.node) === index.get(frame.node)) {
				const component: string[] = [];
				let member: string | undefined;
				do {
					member = stack.pop();
					if (member === undefined) break;
					onStack.delete(member);
					component.push(member);
				} while (member !== frame.node);
				components.push(component.sort(compare));
			}
		}
	}
	return components.sort((a, b) => compare(a[0] ?? "", b[0] ?? ""));
}

/** Code-unit order, like `Array.prototype.sort()` without a comparator (not locale-dependent). */
function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Chapters in the given order; inside a chapter, what a file imports comes before it, ties by
 * path. Cycles are ordered as wholes: the chapter's strongly connected components are sorted
 * topologically (a component's place in a tie is its smallest path), so a file never comes before
 * something it imports unless both lie on one cycle. Inside a cycle, the file with the fewest
 * unplaced dependencies goes first, ties by path, so the order is deterministic.
 */
export function readingOrder(
	paths: readonly string[],
	edges: readonly Edge[],
	chapterOf: (path: string) => string,
	chapterOrder: readonly string[],
): string[] {
	const byChapter = new Map<string, string[]>();
	for (const p of paths) {
		const chapter = chapterOf(p);
		const list = byChapter.get(chapter);
		if (list) list.push(p);
		else byChapter.set(chapter, [p]);
	}
	const order: string[] = [];
	const chapters = [
		...chapterOrder,
		...[...byChapter.keys()].filter((c) => !chapterOrder.includes(c)).sort(),
	];
	for (const chapter of chapters) {
		const members = byChapter.get(chapter);
		if (!members) continue;
		order.push(...dependencyOrder(members, edges));
	}
	return order;
}

function dependencyOrder(members: readonly string[], edges: readonly Edge[]): string[] {
	const inChapter = new Set(members);
	const internal = edges.filter(
		(e) => e.from !== e.to && inChapter.has(e.from) && inChapter.has(e.to),
	);
	const deps = new Map<string, Set<string>>();
	for (const m of members) deps.set(m, new Set());
	for (const e of internal) deps.get(e.from)?.add(e.to);

	// The condensation: components in path order of their smallest file (stronglyConnected sorts so).
	const components = stronglyConnected(members, internal);
	const componentOf = new Map<string, number>();
	components.forEach((files, i) => {
		for (const f of files) componentOf.set(f, i);
	});
	const componentDeps = components.map((files, i) => {
		const set = new Set<number>();
		for (const f of files)
			for (const d of deps.get(f) ?? []) {
				const j = componentOf.get(d);
				if (j !== undefined && j !== i) set.add(j);
			}
		return set;
	});

	const placed = new Set<string>();
	const done = new Set<number>();
	const order: string[] = [];
	while (done.size < components.length) {
		// The first component (smallest path) whose dependencies are all placed; one always exists
		// because the condensation has no cycle.
		const next = components.findIndex(
			(_, i) => !done.has(i) && [...(componentDeps[i] ?? [])].every((j) => done.has(j)),
		);
		if (next < 0) break;
		done.add(next);
		const remaining = [...(components[next] ?? [])];
		while (remaining.length > 0) {
			let best = 0;
			let fewest = Number.POSITIVE_INFINITY;
			remaining.forEach((candidate, i) => {
				let open = 0;
				for (const d of deps.get(candidate) ?? []) if (!placed.has(d)) open++;
				if (open < fewest) {
					fewest = open;
					best = i;
				}
			});
			const [file] = remaining.splice(best, 1);
			if (file === undefined) break;
			placed.add(file);
			order.push(file);
		}
	}
	return order;
}

/**
 * Paths that are imported, but only by test files: helpers of the tests (a fixture, a fake) that
 * a category rule took for logic. `atlas:check` lists them, so a review file can catch them.
 */
export function importedOnlyByTests(
	paths: Iterable<string>,
	importersOf: (path: string) => Iterable<string>,
	isTest: (path: string) => boolean,
): string[] {
	const out: string[] = [];
	for (const path of paths) {
		const importers = [...new Set(importersOf(path))].filter((p) => p !== path);
		if (importers.length > 0 && importers.every(isTest)) out.push(path);
	}
	return out.sort(compare);
}
