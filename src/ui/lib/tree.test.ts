import { describe, expect, test } from "bun:test";
import { file } from "../views/map/fixtures";
import { buildDirTree, type DirNode } from "./tree";

const shape = (node: DirNode): unknown => ({
	name: node.name,
	count: node.count,
	files: node.files.map((f) => f.path),
	dirs: node.dirs.map(shape),
});

describe("buildDirTree", () => {
	test("collapses chains of single directories and counts the files below", () => {
		const tree = buildDirTree([
			file("apps/api/src/modules/plugins/service.ts", "c", "apps/api"),
			file("apps/api/src/modules/plugins/store.ts", "c", "apps/api"),
			file("apps/api/src/app.ts", "c", "apps/api"),
			file("README.md", "c", "."),
		]);
		expect(shape(tree)).toEqual({
			name: "",
			count: 4,
			files: ["README.md"],
			dirs: [
				{
					name: "apps/api/src",
					count: 3,
					files: ["apps/api/src/app.ts"],
					dirs: [
						{
							name: "modules/plugins",
							count: 2,
							files: [
								"apps/api/src/modules/plugins/service.ts",
								"apps/api/src/modules/plugins/store.ts",
							],
							dirs: [],
						},
					],
				},
			],
		});
	});

	test("the collapsed node keeps the deepest directory path", () => {
		const tree = buildDirTree([file("a/b/c/x.ts", "c", "a"), file("a/b/c/y.ts", "c", "a")]);
		expect(tree.dirs[0]?.dir).toBe("a/b/c");
	});
});
