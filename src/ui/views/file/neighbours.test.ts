import { describe, expect, test } from "bun:test";
import type { FileView, ImportRef } from "../../../core/types";
import { file } from "../map/fixtures";
import { importLinks, neighboursOf, strongest } from "./neighbours";

const ref = (patch: Partial<ImportRef> & Pick<ImportRef, "line" | "where">): ImportRef => ({
	specifier: "./x",
	kind: "value",
	names: [],
	target: null,
	...patch,
});

const VIEW: FileView = {
	path: "src/a.ts",
	status: "modified",
	category: "logic",
	language: "typescript",
	size: 10,
	binary: false,
	truncated: false,
	lines: [],
	palette: [["#000", "#fff"]],
	changes: [],
	importsRead: true,
	imports: [
		ref({
			line: 1,
			where: "review",
			target: "src/b.ts",
			kind: "type",
			names: ["B"],
			category: "logic",
		}),
		ref({
			line: 2,
			where: "review",
			target: "src/b.ts",
			kind: "value",
			names: ["makeB", "B"],
			category: "logic",
		}),
		ref({ line: 3, where: "unchanged", target: "src/c.ts", names: ["c"], category: "logic" }),
		ref({ line: 4, where: "external", specifier: "react", package: "react", names: ["useState"] }),
		ref({
			line: 5,
			where: "external",
			specifier: "react",
			package: "react",
			kind: "type",
			names: ["FC"],
		}),
		ref({ line: 6, where: "unresolved", specifier: "#/gone" }),
		ref({ line: 7, where: "excluded", target: "src/a.test.ts", category: "test" }),
		ref({ line: 9, where: "review", target: "src/a.ts" }),
	],
	importers: [
		{
			path: "src/z.ts",
			where: "unchanged",
			category: "logic",
			kind: "type",
			names: ["A"],
			line: 3,
		},
		{ path: "src/d.ts", where: "review", category: "logic", kind: "value", names: ["a"], line: 12 },
		{
			path: "src/a.test.ts",
			where: "excluded",
			category: "test",
			kind: "value",
			names: ["a"],
			line: 1,
		},
	],
};
const FILES = new Map([
	["src/b.ts", file("src/b.ts", "c", "src")],
	["src/d.ts", file("src/d.ts", "c", "src")],
]);

describe("neighboursOf", () => {
	const n = neighboursOf(VIEW, FILES);

	test("one entry per target: strongest kind, names merged, first line", () => {
		expect(n.imports.changed).toEqual([
			{
				path: "src/b.ts",
				where: "review",
				category: "logic",
				kind: "value",
				names: ["B", "makeB"],
				line: 1,
				file: FILES.get("src/b.ts"),
			},
		]);
	});

	test("splits into changed, left out and unchanged; ignores a self-import", () => {
		expect(n.imports.unchanged.map((x) => x.path)).toEqual(["src/c.ts"]);
		expect(n.imports.excluded.map((x) => [x.path, x.category])).toEqual([
			["src/a.test.ts", "test"],
		]);
		expect(n.importers.changed.map((x) => [x.path, x.line])).toEqual([["src/d.ts", 12]]);
		expect(n.importers.unchanged.map((x) => x.path)).toEqual(["src/z.ts"]);
		expect(n.importers.excluded.map((x) => x.path)).toEqual(["src/a.test.ts"]);
	});

	test("packages are listed once, unresolved specifiers apart", () => {
		expect(n.packages).toEqual([
			{ name: "react", kind: "value", names: ["useState", "FC"], line: 4 },
		]);
		expect(n.unresolved).toEqual([{ specifier: "#/gone", line: 6 }]);
	});
});

describe("importLinks", () => {
	test("maps statement lines to their repository targets", () => {
		expect([...importLinks(VIEW).entries()]).toEqual([
			[1, ["src/b.ts"]],
			[2, ["src/b.ts"]],
			[3, ["src/c.ts"]],
			[7, ["src/a.test.ts"]],
		]);
	});
});

describe("strongest", () => {
	test("value beats re-export beats dynamic beats side-effect beats type", () => {
		expect(strongest("type", "side-effect")).toBe("side-effect");
		expect(strongest("dynamic", "re-export")).toBe("re-export");
		expect(strongest("value", "type")).toBe("value");
	});
});
