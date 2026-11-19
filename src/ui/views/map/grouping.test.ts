import { describe, expect, test } from "bun:test";
import { CHAPTERS, FILES, file } from "./fixtures";
import {
	buildGroupTree,
	type Group,
	groupOfFile,
	groupStats,
	locateGroup,
	trail,
} from "./grouping";

const names = (group: Group) => group.files.map((f) => f.path.slice(f.path.lastIndexOf("/") + 1));

describe("buildGroupTree — chapters", () => {
	const tree = buildGroupTree(FILES, "chapters", CHAPTERS);

	test("the top level holds the chapters with files, in reading order, numbered", () => {
		expect(tree.root.groups.map((g) => g.id)).toEqual(["sdk", "host", "web"]);
		expect(tree.root.groups.map((g) => g.chapter?.index)).toEqual([1, 2, 3]);
		expect(tree.root.groups[1]?.chapter?.summary).toBe("Der Plugin-Host");
	});

	test("a chapter starts below its files' common prefix", () => {
		const host = tree.byId.get("host");
		expect(host?.dir).toBe("apps/api/src/modules/plugins");
		expect(host && names(host)).toEqual(["routes.ts", "service.ts", "store.ts"]);
		expect(host?.groups.map((g) => [g.id, g.label])).toEqual([
			["host/apps/api/src/modules/plugins/ops", "ops"],
		]);
	});

	test("a chapter across top-level directories keeps the root as prefix and collapses chains", () => {
		const web = tree.byId.get("web");
		expect(web?.dir).toBe("");
		expect(web && names(web)).toEqual(["README.md"]);
		expect(web?.groups.map((g) => [g.id, g.label])).toEqual([["web/apps/web/src", "apps/web/src"]]);
	});

	test("a directory with a single file is no group: the file stands one level up", () => {
		const src = tree.byId.get("web/apps/web/src");
		expect(src && names(src)).toEqual(["registry.ts"]);
		const routes = tree.byId.get("web/apps/web/src/routes");
		// deep/x/only.tsx bubbles up through two single-file directories
		expect(routes && names(routes)).toEqual(["a.tsx", "b.tsx", "only.tsx"]);
		expect(tree.byId.has("web/apps/web/src/lib")).toBe(false);
		expect(tree.byId.has("web/apps/web/src/routes/deep")).toBe(false);
	});

	test("every file stands in exactly one group and `all` counts every file below", () => {
		expect(tree.root.all).toHaveLength(FILES.length);
		expect(tree.parentOf.size).toBe(FILES.length);
		expect(tree.byId.get("host")?.all).toHaveLength(5);
		expect(groupOfFile(tree, "apps/api/src/modules/plugins/ops/install.ts").id).toBe(
			"host/apps/api/src/modules/plugins/ops",
		);
		expect(groupOfFile(tree, "nope.ts")).toBe(tree.root);
	});

	test("parents and depths form the trail", () => {
		const routes = tree.byId.get("web/apps/web/src/routes");
		expect(routes && trail(routes).map((g) => g.id)).toEqual([
			"",
			"web",
			"web/apps/web/src",
			"web/apps/web/src/routes",
		]);
		expect(routes?.depth).toBe(3);
	});
});

describe("buildGroupTree — packages and folders", () => {
	const tree = buildGroupTree(FILES, "dirs", CHAPTERS);

	test("the top level holds the units by path, the repository root last", () => {
		expect(tree.root.groups.map((g) => g.id)).toEqual([
			"apps/api",
			"apps/web",
			"packages/sdk",
			".",
		]);
	});

	test("a unit absorbs a chain of single directories but keeps its id and label", () => {
		const api = tree.byId.get("apps/api");
		expect(api?.label).toBe("apps/api");
		expect(api?.dir).toBe("apps/api/src/modules/plugins");
		expect(api?.groups.map((g) => g.id)).toEqual(["apps/api/src/modules/plugins/ops"]);
		const web = tree.byId.get("apps/web");
		expect(web?.dir).toBe("apps/web/src");
		expect(web && names(web)).toEqual(["registry.ts"]);
		expect(web?.groups.map((g) => g.id)).toEqual(["apps/web/src/routes"]);
	});

	test("files at the repository root form the unit `.`", () => {
		const root = tree.byId.get(".");
		expect(root && names(root)).toEqual(["README.md"]);
		expect(root?.dir).toBe("");
	});

	test("a unit's single file still makes a group of one", () => {
		const one = buildGroupTree([file("tools/x.ts", "rest", "tools")], "dirs", []);
		expect(one.root.groups.map((g) => [g.id, g.files.length])).toEqual([["tools", 1]]);
	});
});

describe("locateGroup", () => {
	const chapters = buildGroupTree(FILES, "chapters", CHAPTERS);
	const dirs = buildGroupTree(FILES, "dirs", CHAPTERS);

	test("an exact id, the root for an empty or unknown id", () => {
		expect(locateGroup(chapters, "host").id).toBe("host");
		expect(locateGroup(chapters, "").id).toBe("");
		expect(locateGroup(chapters, "nope").id).toBe("");
		expect(locateGroup(chapters, "nope/apps").id).toBe("");
		expect(locateGroup(dirs, "lib/nope").id).toBe("");
	});

	test("a directory inside a collapsed chain shows as the collapsed group", () => {
		expect(locateGroup(chapters, "web/apps").id).toBe("web/apps/web/src");
		expect(locateGroup(chapters, "web/apps/web").id).toBe("web/apps/web/src");
		expect(locateGroup(dirs, "apps/api/src").id).toBe("apps/api");
	});

	test("a directory above a chapter's prefix is the chapter; a deeper one the deepest group", () => {
		expect(locateGroup(chapters, "host/apps/api").id).toBe("host");
		expect(locateGroup(chapters, "web/apps/web/src/routes/deep/x").id).toBe(
			"web/apps/web/src/routes",
		);
		expect(locateGroup(dirs, "apps/web/src/lib").id).toBe("apps/web");
	});
});

describe("groupStats", () => {
	test("sums files, lines and statuses below a group", () => {
		const tree = buildGroupTree(FILES, "chapters", CHAPTERS);
		const host = tree.byId.get("host");
		expect(host && groupStats(host)).toEqual({
			files: 5,
			added: 5,
			deleted: 5,
			status: { added: 1, modified: 4, deleted: 0, renamed: 0 },
		});
	});
});
