import { describe, expect, test } from "bun:test";
import {
	buildEdges,
	findCycles,
	importedOnlyByTests,
	mergeStatements,
	readingOrder,
	strongerKind,
	unitOf,
} from "./graph";
import type { Edge, ImportKind } from "./types";

const edge = (from: string, to: string, kind: ImportKind = "value"): Edge => ({
	from,
	to,
	kind,
	names: [],
	line: 1,
});

describe("strongerKind / mergeStatements", () => {
	test("value beats re-export beats dynamic beats side-effect beats type", () => {
		expect(strongerKind("type", "value")).toBe("value");
		expect(strongerKind("re-export", "dynamic")).toBe("re-export");
		expect(strongerKind("side-effect", "type")).toBe("side-effect");
	});

	test("merging keeps the strongest kind, every name once, the first line", () => {
		expect(
			mergeStatements([
				{ kind: "type", names: ["A", "B"], line: 7 },
				{ kind: "value", names: ["b", "A"], line: 3 },
			]),
		).toEqual({ kind: "value", names: ["A", "B", "b"], line: 3 });
	});
});

describe("buildEdges", () => {
	test("one edge per (from, to) between files of the set, sorted", () => {
		const statements: Record<
			string,
			{ kind: ImportKind; names: string[]; line: number; target: string | null }[]
		> = {
			"b.ts": [
				{ kind: "type", names: ["T"], line: 1, target: "a.ts" },
				{ kind: "value", names: ["f"], line: 2, target: "a.ts" },
				{ kind: "value", names: ["x"], line: 3, target: "outside.ts" },
				{ kind: "value", names: [], line: 4, target: null },
			],
			"a.ts": [{ kind: "re-export", names: ["*"], line: 5, target: "c.ts" }],
		};
		const edges = buildEdges(new Set(["a.ts", "b.ts", "c.ts"]), (path) => statements[path] ?? []);
		expect(edges).toEqual([
			{ from: "a.ts", to: "c.ts", kind: "re-export", names: ["*"], line: 5 },
			{ from: "b.ts", to: "a.ts", kind: "value", names: ["T", "f"], line: 1 },
		]);
	});
});

describe("unitOf", () => {
	const dirs = ["apps/api", "packages/shared", "packages/shared/sub"];

	test("the nearest package directory that contains the file", () => {
		expect(unitOf("apps/api/src/index.ts", dirs)).toBe("apps/api");
		expect(unitOf("packages/shared/sub/x.ts", dirs)).toBe("packages/shared/sub");
		expect(unitOf("apps/apiary/x.ts", dirs)).toBe("apps");
	});

	test("else the top-level directory, else `.`", () => {
		expect(unitOf("examples/plugins/a/manifest.ts", dirs)).toBe("examples");
		expect(unitOf("README.md", dirs)).toBe(".");
	});
});

describe("findCycles", () => {
	test("each strongly connected component once, sorted; a self-import counts", () => {
		const paths = ["a", "b", "c", "d", "e", "f"];
		const edges = [
			edge("a", "b"),
			edge("b", "c"),
			edge("c", "a"),
			edge("c", "d"),
			edge("e", "e"),
			edge("f", "e"),
		];
		expect(findCycles(paths, edges)).toEqual([["a", "b", "c"], ["e"]]);
	});

	test("type-only edges count", () => {
		expect(findCycles(["x", "y"], [edge("x", "y", "type"), edge("y", "x", "type")])).toEqual([
			["x", "y"],
		]);
	});

	test("no cycle in a DAG", () => {
		expect(findCycles(["a", "b", "c"], [edge("a", "b"), edge("b", "c"), edge("a", "c")])).toEqual(
			[],
		);
	});

	test("deep chains do not overflow the stack", () => {
		const paths = Array.from({ length: 20_000 }, (_, i) => `f${String(i).padStart(5, "0")}`);
		const edges = paths.slice(1).map((p, i) => edge(paths[i] ?? "", p));
		edges.push(edge(paths.at(-1) ?? "", paths[0] ?? ""));
		expect(findCycles(paths, edges)[0]).toHaveLength(20_000);
	});
});

describe("readingOrder", () => {
	const chapterOf = (path: string) => path.split("/")[0] ?? "";

	test("chapters in the given order; unknown chapters after them", () => {
		const order = readingOrder(["z/a", "x/a", "y/a", "other/a"], [], chapterOf, ["x", "y", "z"]);
		expect(order).toEqual(["x/a", "y/a", "z/a", "other/a"]);
	});

	test("inside a chapter, what a file imports comes first; ties by path", () => {
		// app imports service imports model; util is independent
		const edges = [
			edge("c/app", "c/service"),
			edge("c/service", "c/model"),
			edge("c/app", "c/util"),
		];
		expect(
			readingOrder(["c/app", "c/model", "c/service", "c/util"], edges, chapterOf, ["c"]),
		).toEqual(["c/model", "c/service", "c/util", "c/app"]);
	});

	test("edges across chapters do not reorder a chapter", () => {
		const edges = [edge("a/z", "b/y"), edge("b/x", "a/z")];
		expect(readingOrder(["a/z", "b/x", "b/y"], edges, chapterOf, ["a", "b"])).toEqual([
			"a/z",
			"b/x",
			"b/y",
		]);
	});

	test("a cycle is broken deterministically: fewest unplaced dependencies first, then path", () => {
		// a → b → c → a, and d → a; e stands alone
		const edges = [edge("k/a", "k/b"), edge("k/b", "k/c"), edge("k/c", "k/a"), edge("k/d", "k/a")];
		const paths = ["k/d", "k/c", "k/e", "k/b", "k/a"];
		const order = readingOrder(paths, edges, chapterOf, ["k"]);
		// the cycle as a whole takes the place of its smallest path, k/a
		expect(order).toEqual(["k/a", "k/c", "k/b", "k/d", "k/e"]);
		// the same input in another order gives the same answer
		expect(readingOrder([...paths].reverse(), [...edges].reverse(), chapterOf, ["k"])).toEqual(
			order,
		);
	});

	test("a cycle does not pull a file before what it imports", () => {
		// m ⇄ n is a cycle; a imports m and sorts before it; x → y is an unrelated chain. Before
		// the fix, once y and x were placed no file had zero open dependencies and a (first by path,
		// one open dependency) was taken before m.
		const edges = [edge("k/m", "k/n"), edge("k/n", "k/m"), edge("k/a", "k/m"), edge("k/x", "k/y")];
		const order = readingOrder(["k/a", "k/m", "k/n", "k/x", "k/y"], edges, chapterOf, ["k"]);
		expect(order).toEqual(["k/m", "k/n", "k/a", "k/y", "k/x"]);
		const cycles = findCycles(order, edges);
		const sameCycle = (a: string, b: string) => cycles.some((c) => c.includes(a) && c.includes(b));
		for (const e of edges)
			if (!sameCycle(e.from, e.to))
				expect([e, order.indexOf(e.to) < order.indexOf(e.from)]).toEqual([e, true]);
	});

	test("every file appears exactly once", () => {
		const paths = ["m/1", "m/2", "m/3"];
		const edges = [edge("m/1", "m/2"), edge("m/2", "m/1"), edge("m/3", "m/3")];
		const order = readingOrder(paths, edges, chapterOf, ["m"]);
		expect([...order].sort()).toEqual(paths);
	});
});

describe("importedOnlyByTests", () => {
	test("files whose every importer is a test; unimported files are not listed", () => {
		const importers: Record<string, string[]> = {
			"sim/fixture.ts": ["sim/a.test.ts", "cluster.test.ts"],
			"sim/model.ts": ["sim/a.test.ts", "sim/run.ts"],
			"sim/lonely.ts": [],
		};
		expect(
			importedOnlyByTests(
				Object.keys(importers),
				(p) => importers[p] ?? [],
				(p) => p.endsWith(".test.ts"),
			),
		).toEqual(["sim/fixture.ts"]);
	});
});
