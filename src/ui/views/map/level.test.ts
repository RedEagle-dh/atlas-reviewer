import { describe, expect, test } from "bun:test";
import { CHAPTERS, EDGES, edge, FILES, file } from "./fixtures";
import { buildGroupTree } from "./grouping";
import { buildLevel, components, drawLevel, neighbourhood, relationsOf } from "./level";

const chapters = buildGroupTree(FILES, "chapters", CHAPTERS);
const at = (id: string) => {
	const group = chapters.byId.get(id);
	if (!group) throw new Error(`no group ${id}`);
	return buildLevel(chapters, group, EDGES);
};
const summary = (level: ReturnType<typeof at>) =>
	level.edges.map(
		(e) =>
			`${e.source} > ${e.target} ${e.count}${e.typeOnly ? " type" : ""}${e.cycle ? " cycle" : ""}`,
	);

describe("buildLevel", () => {
	test("the top level: one node per chapter, imports counted between them, nothing inside", () => {
		const level = at("");
		expect(level.nodes.map((n) => [n.id, n.context])).toEqual([
			["g:sdk", false],
			["g:host", false],
			["g:web", false],
		]);
		expect(summary(level)).toEqual(["g:host > g:sdk 2", "g:web > g:sdk 1 type"]);
		expect(level.hiddenContext).toBe(0);
	});

	test("inside a chapter: its children, plus the connected sibling chapters as context", () => {
		const level = at("host");
		expect(level.nodes.map((n) => [n.id, n.context])).toEqual([
			["g:host/apps/api/src/modules/plugins/ops", false],
			["f:apps/api/src/modules/plugins/routes.ts", false],
			["f:apps/api/src/modules/plugins/service.ts", false],
			["f:apps/api/src/modules/plugins/store.ts", false],
			["g:sdk", true],
		]);
		// web is a sibling too, but it has no import to or from host: hidden, and counted
		expect(level.hiddenContext).toBe(1);
	});

	test("lifts every import to the drawn nodes, drops edges between two context nodes", () => {
		const level = at("host");
		expect(summary(level).sort()).toEqual([
			"f:apps/api/src/modules/plugins/routes.ts > f:apps/api/src/modules/plugins/service.ts 1",
			"f:apps/api/src/modules/plugins/service.ts > f:apps/api/src/modules/plugins/store.ts 1",
			"f:apps/api/src/modules/plugins/service.ts > g:sdk 1",
			"f:apps/api/src/modules/plugins/store.ts > g:host/apps/api/src/modules/plugins/ops 1 type cycle",
			"g:host/apps/api/src/modules/plugins/ops > f:apps/api/src/modules/plugins/store.ts 2 cycle",
			"g:host/apps/api/src/modules/plugins/ops > g:sdk 1 type",
		]);
		const lifted = level.edges.find((e) =>
			e.id.startsWith("g:host/apps/api/src/modules/plugins/ops→f:"),
		);
		expect(lifted?.imports.map((i) => i.from)).toEqual([
			"apps/api/src/modules/plugins/ops/install.ts",
			"apps/api/src/modules/plugins/ops/remove.ts",
		]);
	});

	test("deep down: files of ancestor levels are context too, nearest level first", () => {
		const level = at("web/apps/web/src/routes");
		expect(level.nodes.map((n) => [n.id, n.context])).toEqual([
			["f:apps/web/src/routes/a.tsx", false],
			["f:apps/web/src/routes/b.tsx", false],
			["f:apps/web/src/routes/deep/x/only.tsx", false],
			["f:apps/web/src/lib/registry.ts", true],
		]);
		// registry → sdk is between two context nodes: not drawn, so sdk is not drawn either
		expect(summary(level)).toEqual([
			"f:apps/web/src/routes/a.tsx > f:apps/web/src/lib/registry.ts 1",
			"f:apps/web/src/routes/b.tsx > f:apps/web/src/lib/registry.ts 1",
		]);
		// sdk, host (level 1), README.md (level 2) stay hidden
		expect(level.hiddenContext).toBe(3);
	});

	test("orders context by level: the parent's siblings before the grandparent's", () => {
		const files = [
			file("a/x/one.ts", "c", "a"),
			file("a/x/two.ts", "c", "a"),
			file("a/y/three.ts", "c", "a"),
			file("a/y/four.ts", "c", "a"),
			file("b/five.ts", "d", "b"),
			file("b/six.ts", "d", "b"),
		];
		const tree = buildGroupTree(files, "dirs", []);
		const x = tree.byId.get("a/x");
		if (!x) throw new Error("no a/x");
		const level = buildLevel(tree, x, [
			edge("a/x/one.ts", "b/five.ts"),
			edge("a/x/two.ts", "a/y/three.ts"),
		]);
		expect(level.nodes.filter((n) => n.context).map((n) => n.id)).toEqual(["g:a/y", "g:b"]);
	});

	test("a loop through a context node is no cycle between the group's files", () => {
		// The SDK case: the context group r lumps r/ui.ts (imports the group) and r/shared.ts (which
		// the group imports). a → b was drawn as a cycle, though no file cycle exists.
		const files = [
			file("s/a.ts", "s", "s"),
			file("s/b.ts", "s", "s"),
			file("r/shared.ts", "r", "r"),
			file("r/ui.ts", "r", "r"),
		];
		const tree = buildGroupTree(files, "dirs", []);
		const s = tree.byId.get("s");
		if (!s) throw new Error("no s");
		const edges = [
			edge("s/a.ts", "s/b.ts"),
			edge("s/b.ts", "r/shared.ts"),
			edge("r/ui.ts", "s/a.ts"),
		];
		const level = buildLevel(tree, s, edges, []);
		expect(summary(level).sort()).toEqual([
			"f:s/a.ts > f:s/b.ts 1",
			"f:s/b.ts > g:r 1",
			"g:r > f:s/a.ts 1",
		]);
		// the link to r is used both ways: that much is mutual, and marked
		expect(drawLevel(level).links[0]?.cycle).toBe(true);
	});

	test("an edge with an import on a real file cycle is marked, also when the cycle leaves the group", () => {
		const files = [
			file("s/a.ts", "s", "s"),
			file("s/b.ts", "s", "s"),
			file("r/x.ts", "r", "r"),
			file("r/y.ts", "r", "r"),
		];
		const tree = buildGroupTree(files, "dirs", []);
		const s = tree.byId.get("s");
		if (!s) throw new Error("no s");
		const edges = [edge("s/a.ts", "s/b.ts"), edge("s/b.ts", "r/x.ts"), edge("r/x.ts", "s/a.ts")];
		const level = buildLevel(tree, s, edges, [["r/x.ts", "s/a.ts", "s/b.ts"]]);
		expect(summary(level).sort()).toEqual([
			"f:s/a.ts > f:s/b.ts 1 cycle",
			"f:s/b.ts > g:r 1 cycle",
			"g:r > f:s/a.ts 1 cycle",
		]);
	});

	test("a file outside the tree (a hidden category) is ignored", () => {
		const level = buildLevel(chapters, chapters.root, [
			edge("hidden/x.ts", "packages/sdk/src/index.ts"),
		]);
		expect(level.edges).toEqual([]);
	});
});

describe("components", () => {
	test("finds strongly connected components, singletons included", () => {
		const c = components(
			["a", "b", "c", "d"],
			[
				{ source: "a", target: "b" },
				{ source: "b", target: "c" },
				{ source: "c", target: "a" },
				{ source: "c", target: "d" },
			],
		);
		expect(c.get("a")).toBe(c.get("b"));
		expect(c.get("b")).toBe(c.get("c"));
		expect(c.get("d")).not.toBe(c.get("a"));
	});
});

describe("drawLevel", () => {
	test("two opposite inner edges become one line with a back count; the stronger direction leads", () => {
		const { inner } = drawLevel(at("host"));
		const pair = inner.find((e) => e.back);
		expect(pair).toMatchObject({
			source: "g:host/apps/api/src/modules/plugins/ops",
			target: "f:apps/api/src/modules/plugins/store.ts",
			count: 2,
			typeOnly: false,
			cycle: true,
			back: { count: 1, typeOnly: true },
			labelled: true,
		});
		expect(pair?.imports).toHaveLength(3);
		expect(inner).toHaveLength(3);
	});

	test("a file-to-file line carries no count label", () => {
		const { inner } = drawLevel(at("host"));
		expect(inner.find((e) => e.source.endsWith("routes.ts"))?.labelled).toBe(false);
	});

	test("edges to context nodes become details, summed into one link per context node", () => {
		const { details, links } = drawLevel(at("host"));
		expect(details.map((e) => `${e.source} > ${e.target}`).sort()).toEqual([
			"f:apps/api/src/modules/plugins/service.ts > g:sdk",
			"g:host/apps/api/src/modules/plugins/ops > g:sdk",
		]);
		expect(links).toEqual([
			{
				id: "link:g:sdk",
				node: "g:sdk",
				uses: { count: 2, typeOnly: false },
				usedBy: null,
				cycle: false,
				side: "dependency",
			},
		]);
	});

	test("a context node that mainly imports the group stands on the dependent side", () => {
		const files = [
			file("a/x.ts", "a", "a"),
			file("a/y.ts", "a", "a"),
			file("b/z.ts", "b", "b"),
			file("b/w.ts", "b", "b"),
		];
		const tree = buildGroupTree(files, "dirs", []);
		const a = tree.byId.get("a");
		if (!a) throw new Error("no a");
		const level = buildLevel(tree, a, [
			edge("b/z.ts", "a/x.ts"),
			edge("b/w.ts", "a/y.ts", "type"),
			edge("a/x.ts", "b/z.ts", "type"),
		]);
		const [link] = drawLevel(level).links;
		expect(link).toMatchObject({
			uses: { count: 1, typeOnly: true },
			usedBy: { count: 2, typeOnly: false },
			cycle: true,
			side: "dependent",
		});
	});
});

describe("relationsOf and neighbourhood", () => {
	test("names what a node imports and what imports it, strongest first", () => {
		const level = at("host");
		const store = "f:apps/api/src/modules/plugins/store.ts";
		const { imports, importedBy } = relationsOf(level, store);
		expect(imports.map((r) => [r.node.id, r.count])).toEqual([
			["g:host/apps/api/src/modules/plugins/ops", 1],
		]);
		expect(importedBy.map((r) => [r.node.id, r.count])).toEqual([
			["g:host/apps/api/src/modules/plugins/ops", 2],
			["f:apps/api/src/modules/plugins/service.ts", 1],
		]);
	});

	test("a hovered context node keeps its link, its details and their nodes lit", () => {
		const lit = neighbourhood(drawLevel(at("host")), "g:sdk");
		expect([...lit.nodes].sort()).toEqual([
			"f:apps/api/src/modules/plugins/service.ts",
			"g:host/apps/api/src/modules/plugins/ops",
			"g:sdk",
		]);
		expect([...lit.edges].sort()).toEqual([
			"f:apps/api/src/modules/plugins/service.ts\u2192g:sdk",
			"g:host/apps/api/src/modules/plugins/ops\u2192g:sdk",
			"link:g:sdk",
		]);
	});

	test("a hovered inner node lights its inner edges and details, not the frame links", () => {
		const lit = neighbourhood(drawLevel(at("host")), "f:apps/api/src/modules/plugins/service.ts");
		expect(lit.edges.has("link:g:sdk")).toBe(false);
		expect(lit.nodes.has("g:sdk")).toBe(true);
		expect(lit.nodes.has("f:apps/api/src/modules/plugins/routes.ts")).toBe(true);
	});
});
