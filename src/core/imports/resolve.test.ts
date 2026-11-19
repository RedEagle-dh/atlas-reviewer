import { describe, expect, test } from "bun:test";
import {
	createResolve,
	externalPackage,
	probe,
	type Resolution,
	repoFilesOf,
	resolveExports,
	splitPackageSpecifier,
} from "./resolve";

const json = (value: unknown) => JSON.stringify(value);

/** A small monorepo shaped like the first review's repository. */
function monorepo() {
	const texts = new Map<string, string>([
		["package.json", json({ name: "root", private: true })],
		[
			"tsconfig.base.json",
			'{\n // comments and trailing commas are fine in a tsconfig\n "compilerOptions": { "strict": true, },\n}',
		],
		[
			"tsconfig.react.json",
			json({ extends: "./tsconfig.base.json", compilerOptions: { jsx: "react-jsx" } }),
		],
		[
			"apps/web/tsconfig.json",
			json({
				extends: "../../tsconfig.react.json",
				compilerOptions: { paths: { "#/*": ["./src/*"] } },
			}),
		],
		["apps/web/package.json", json({ name: "@acme/web" })],
		["apps/api/tsconfig.json", json({ extends: "../../tsconfig.base.json" })],
		["apps/api/package.json", json({ name: "@acme/api", exports: { ".": "./src/index.ts" } })],
		[
			"packages/shared/package.json",
			json({
				name: "@acme/shared",
				exports: {
					".": "./src/index.ts",
					"./mobility": "./src/mobility/index.ts",
					"./testing": "./src/testing.ts",
				},
			}),
		],
		[
			"packages/ui/package.json",
			json({
				name: "@acme/ui",
				exports: {
					".": "./src/index.ts",
					"./components/*": "./src/components/*.tsx",
					"./lib/*": "./src/lib/*.ts",
					"./lib/utils": "./src/lib/utils-special.ts",
					"./styles.css": "./src/styles.css",
				},
			}),
		],
		[
			"packages/cond/package.json",
			json({
				name: "@acme/cond",
				exports: {
					".": { types: "./dist/index.d.ts", bun: "./src/bun.ts", default: "./dist/index.js" },
					"./node": { require: "./src/node.cjs", node: { import: "./src/node.mts" } },
					"./fallback": { types: "./dist/fallback.d.ts", default: "./src/fallback.ts" },
					"./hidden": null,
				},
			}),
		],
		["packages/legacy/package.json", json({ name: "legacy-lib", main: "lib/main.js" })],
		["packages/bare/package.json", json({ name: "bare-lib" })],
		["packages/sugar/package.json", json({ name: "sugar", exports: "./src/sugar.ts" })],
		["fixtures/shared-copy/package.json", json({ name: "@acme/shared-copy" })],
		["deep/nested/copy/package.json", json({ name: "@acme/api" })],
	]);
	const paths = [
		...texts.keys(),
		"apps/web/src/main.tsx",
		"apps/web/src/lib/api.ts",
		"apps/web/src/lib/index.ts",
		"apps/web/src/components/Button.tsx",
		"apps/web/src/routes/index.tsx",
		"apps/api/src/index.ts",
		"apps/api/src/env.ts",
		"apps/api/src/http/policies.ts",
		"apps/api/src/modules/plugins/service.ts",
		"apps/api/src/modules/plugins/index.ts",
		"apps/api/src/data.json",
		"apps/api/src/legacy.js",
		"packages/shared/src/index.ts",
		"packages/shared/src/mobility/index.ts",
		"packages/shared/src/testing.ts",
		"packages/ui/src/index.ts",
		"packages/ui/src/components/button.tsx",
		"packages/ui/src/lib/format.ts",
		"packages/ui/src/lib/utils-special.ts",
		"packages/ui/src/styles.css",
		"packages/cond/src/bun.ts",
		"packages/cond/src/node.mts",
		"packages/cond/src/fallback.ts",
		"packages/legacy/lib/main.js",
		"packages/bare/src/index.ts",
		"packages/sugar/src/sugar.ts",
		"deep/nested/copy/src/index.ts",
	];
	return repoFilesOf(paths, texts);
}

const resolve = createResolve(monorepo());
const file = (path: string): Resolution => ({ kind: "file", path });

describe("probe", () => {
	const repo = repoFilesOf([
		"a/b.ts",
		"a/c.tsx",
		"a/d/index.ts",
		"a/e.js",
		"a/f.ts",
		"a/g.d.ts",
		"index.ts",
	]);

	test("the path itself, then with an extension, then its index file", () => {
		expect(probe(repo, "a/e.js")).toBe("a/e.js");
		expect(probe(repo, "a/b")).toBe("a/b.ts");
		expect(probe(repo, "a/c")).toBe("a/c.tsx");
		expect(probe(repo, "a/g")).toBe("a/g.d.ts");
		expect(probe(repo, "a/d")).toBe("a/d/index.ts");
		expect(probe(repo, "a/d/")).toBe("a/d/index.ts");
		expect(probe(repo, ".")).toBe("index.ts");
	});

	test("a `.js` specifier finds the `.ts` source", () => {
		expect(probe(repo, "a/f.js")).toBe("a/f.ts");
		expect(probe(repo, "a/c.jsx")).toBe("a/c.tsx");
	});

	test("nothing outside the repository or missing", () => {
		expect(probe(repo, "../a/b")).toBeUndefined();
		expect(probe(repo, "/a/b")).toBeUndefined();
		expect(probe(repo, "a/zzz")).toBeUndefined();
	});
});

describe("relative specifiers", () => {
	test("with and without extension, with index probing, upwards", () => {
		expect(resolve("./env", "apps/api/src/index.ts")).toEqual(file("apps/api/src/env.ts"));
		expect(resolve("./env.ts", "apps/api/src/index.ts")).toEqual(file("apps/api/src/env.ts"));
		expect(resolve("./env.js", "apps/api/src/index.ts")).toEqual(file("apps/api/src/env.ts"));
		expect(resolve("./modules/plugins", "apps/api/src/index.ts")).toEqual(
			file("apps/api/src/modules/plugins/index.ts"),
		);
		expect(resolve("../../http/policies", "apps/api/src/modules/plugins/service.ts")).toEqual(
			file("apps/api/src/http/policies.ts"),
		);
		expect(resolve(".", "apps/api/src/modules/plugins/service.ts")).toEqual(
			file("apps/api/src/modules/plugins/index.ts"),
		);
		expect(resolve("./data.json", "apps/api/src/index.ts")).toEqual(file("apps/api/src/data.json"));
		expect(resolve("./legacy", "apps/api/src/index.ts")).toEqual(file("apps/api/src/legacy.js"));
	});

	test("a missing target or one outside the repository is unresolved", () => {
		expect(resolve("./nope", "apps/api/src/index.ts")).toEqual({
			kind: "unresolved",
			resolver: "relative",
		});
		expect(resolve("../../../../x", "apps/api/src/index.ts").kind).toBe("unresolved");
	});

	test("a bundler query or fragment is dropped", () => {
		expect(resolve("./env?raw", "apps/api/src/index.ts")).toEqual(file("apps/api/src/env.ts"));
	});
});

describe("tsconfig paths", () => {
	test("the nearest tsconfig's alias, through `extends`", () => {
		expect(resolve("#/lib/api", "apps/web/src/main.tsx")).toEqual(file("apps/web/src/lib/api.ts"));
		expect(resolve("#/lib", "apps/web/src/routes/index.tsx")).toEqual(
			file("apps/web/src/lib/index.ts"),
		);
		expect(resolve("#/components/Button", "apps/web/src/main.tsx")).toEqual(
			file("apps/web/src/components/Button.tsx"),
		);
	});

	test("an alias that matches but names no file is unresolved", () => {
		expect(resolve("#/missing", "apps/web/src/main.tsx")).toEqual({
			kind: "unresolved",
			resolver: "tsconfig-paths",
		});
	});

	test("the alias belongs to its tsconfig only", () => {
		// apps/api has no `#/*`: an unclaimed `#` specifier is unresolved, not an npm package
		expect(resolve("#/lib/api", "apps/api/src/index.ts").kind).toBe("unresolved");
	});

	test("`paths` and `baseUrl` are inherited through `extends`; `baseUrl` resolves bare paths", () => {
		const texts = new Map([
			[
				"tsconfig.json",
				json({ compilerOptions: { baseUrl: "./src", paths: { "@app/*": ["app/*"] } } }),
			],
			["pkg/tsconfig.json", json({ extends: "../tsconfig" })],
		]);
		const r = createResolve(
			repoFilesOf([...texts.keys(), "src/app/main.ts", "src/util/x.ts", "pkg/a.ts"], texts),
		);
		expect(r("@app/main", "pkg/a.ts")).toEqual(file("src/app/main.ts"));
		expect(r("util/x", "pkg/a.ts")).toEqual(file("src/util/x.ts"));
		expect(r("react", "pkg/a.ts")).toEqual({ kind: "external", package: "react" });
	});

	test("the longest `*` prefix wins; a catch-all `*` does not swallow npm packages", () => {
		const texts = new Map([
			[
				"tsconfig.json",
				json({
					compilerOptions: {
						paths: { "*": ["./types/*"], "@x/*": ["./a/*"], "@x/deep/*": ["./b/*"] },
					},
				}),
			],
		]);
		const r = createResolve(
			repoFilesOf([...texts.keys(), "a/one.ts", "b/two.ts", "types/zod.d.ts"], texts),
		);
		expect(r("@x/deep/two", "m.ts")).toEqual(file("b/two.ts"));
		expect(r("@x/one", "m.ts")).toEqual(file("a/one.ts"));
		expect(r("zod", "m.ts")).toEqual(file("types/zod.d.ts"));
		expect(r("react", "m.ts")).toEqual({ kind: "external", package: "react" });
	});

	test("a JavaScript project's jsconfig.json counts like a tsconfig.json", () => {
		const texts = new Map([
			["jsconfig.json", json({ compilerOptions: { paths: { "@/*": ["./src/*"] } } })],
		]);
		const r = createResolve(
			repoFilesOf([...texts.keys(), "src/lib/utils.js", "src/app.jsx"], texts),
		);
		expect(r("@/lib/utils", "src/app.jsx")).toEqual(file("src/lib/utils.js"));
	});

	test("a solution-style tsconfig: the referenced project that includes the file brings the paths", () => {
		// Vite's react-ts layout: tsconfig.json only references; tsconfig.app.json holds the alias.
		const texts = new Map([
			[
				"web/tsconfig.json",
				json({
					files: [],
					references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.node.json" }],
				}),
			],
			[
				"web/tsconfig.app.json",
				json({ include: ["src"], compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
			],
			["web/tsconfig.node.json", json({ include: ["vite.config.ts"] })],
		]);
		const r = createResolve(
			repoFilesOf(
				[...texts.keys(), "web/src/lib/utils.ts", "web/src/app.tsx", "web/vite.config.ts"],
				texts,
			),
		);
		expect(r("@/lib/utils", "web/src/app.tsx")).toEqual(file("web/src/lib/utils.ts"));
		// vite.config.ts is not in the app project: the alias is not its
		expect(r("@/lib/utils", "web/vite.config.ts").kind).toBe("unresolved");
	});
});

describe("workspace packages", () => {
	test("the package's `.` export", () => {
		expect(resolve("@acme/shared", "apps/api/src/index.ts")).toEqual(
			file("packages/shared/src/index.ts"),
		);
		expect(resolve("sugar", "apps/api/src/index.ts")).toEqual(file("packages/sugar/src/sugar.ts"));
	});

	test("subpath exports", () => {
		expect(resolve("@acme/shared/mobility", "apps/api/src/index.ts")).toEqual(
			file("packages/shared/src/mobility/index.ts"),
		);
		expect(resolve("@acme/shared/testing", "apps/api/src/index.ts")).toEqual(
			file("packages/shared/src/testing.ts"),
		);
		expect(resolve("@acme/ui/styles.css", "apps/web/src/main.tsx")).toEqual(
			file("packages/ui/src/styles.css"),
		);
	});

	test("wildcard exports; an exact key beats a pattern", () => {
		expect(resolve("@acme/ui/components/button", "apps/web/src/main.tsx")).toEqual(
			file("packages/ui/src/components/button.tsx"),
		);
		expect(resolve("@acme/ui/lib/format", "apps/web/src/main.tsx")).toEqual(
			file("packages/ui/src/lib/format.ts"),
		);
		expect(resolve("@acme/ui/lib/utils", "apps/web/src/main.tsx")).toEqual(
			file("packages/ui/src/lib/utils-special.ts"),
		);
	});

	test("condition objects: bun, import, types, default first; a target that is not a file is skipped", () => {
		expect(resolve("@acme/cond", "apps/api/src/index.ts")).toEqual(
			file("packages/cond/src/bun.ts"),
		);
		expect(resolve("@acme/cond/node", "apps/api/src/index.ts")).toEqual(
			file("packages/cond/src/node.mts"),
		);
		expect(resolve("@acme/cond/fallback", "apps/api/src/index.ts")).toEqual(
			file("packages/cond/src/fallback.ts"),
		);
	});

	test("a subpath that `exports` does not list, or maps to null, is unresolved", () => {
		expect(resolve("@acme/shared/internal", "apps/api/src/index.ts")).toEqual({
			kind: "unresolved",
			resolver: "workspace",
		});
		expect(resolve("@acme/cond/hidden", "apps/api/src/index.ts").kind).toBe("unresolved");
		expect(resolve("@acme/ui/components/missing", "apps/web/src/main.tsx").kind).toBe("unresolved");
	});

	test("without `exports`: `module` / `main`, then `src/index`, then `index`; subpaths by path", () => {
		expect(resolve("legacy-lib", "apps/api/src/index.ts")).toEqual(
			file("packages/legacy/lib/main.js"),
		);
		expect(resolve("bare-lib", "apps/api/src/index.ts")).toEqual(
			file("packages/bare/src/index.ts"),
		);
		expect(resolve("bare-lib/src/index", "apps/api/src/index.ts")).toEqual(
			file("packages/bare/src/index.ts"),
		);
	});

	test("two manifests with one name: the shallower package wins", () => {
		expect(resolve("@acme/api", "apps/web/src/main.tsx")).toEqual(file("apps/api/src/index.ts"));
	});
});

describe("what no resolver claims", () => {
	test("npm packages and builtins are external", () => {
		expect(resolve("react", "apps/web/src/main.tsx")).toEqual({
			kind: "external",
			package: "react",
		});
		expect(resolve("react-dom/client", "apps/web/src/main.tsx")).toEqual({
			kind: "external",
			package: "react-dom",
		});
		expect(resolve("@tanstack/react-router", "apps/web/src/main.tsx")).toEqual({
			kind: "external",
			package: "@tanstack/react-router",
		});
		expect(resolve("node:fs/promises", "apps/api/src/index.ts")).toEqual({
			kind: "external",
			package: "node:fs",
		});
		expect(resolve("bun:test", "apps/api/src/index.ts")).toEqual({
			kind: "external",
			package: "bun:test",
		});
		expect(resolve("bun", "apps/api/src/index.ts")).toEqual({ kind: "external", package: "bun" });
		expect(resolve("path", "apps/api/src/index.ts")).toEqual({
			kind: "external",
			package: "node:path",
		});
	});

	test("an absolute or empty specifier is unresolved", () => {
		expect(resolve("/etc/x", "apps/api/src/index.ts").kind).toBe("unresolved");
		expect(resolve("", "apps/api/src/index.ts").kind).toBe("unresolved");
	});

	test("an alias nobody understood is unresolved, not an npm package (so atlas:check fails)", () => {
		const r = createResolve(repoFilesOf(["src/lib/utils.ts", "src/app.ts"]));
		expect(r("@/lib/utils", "src/app.ts")).toEqual({ kind: "unresolved", resolver: "none" });
		expect(r("~/lib/utils", "src/app.ts")).toEqual({ kind: "unresolved", resolver: "none" });
		expect(r("@x", "src/app.ts")).toEqual({ kind: "unresolved", resolver: "none" });
		expect(r("lodash.debounce", "src/app.ts")).toEqual({
			kind: "external",
			package: "lodash.debounce",
		});
		expect(r("JSONStream", "src/app.ts")).toEqual({ kind: "external", package: "JSONStream" });
	});
});

describe("helpers", () => {
	test("splitPackageSpecifier", () => {
		expect(splitPackageSpecifier("@a/b/c/d")).toEqual(["@a/b", "./c/d"]);
		expect(splitPackageSpecifier("lodash/fp")).toEqual(["lodash", "./fp"]);
		expect(splitPackageSpecifier("react")).toEqual(["react", "."]);
	});

	test("externalPackage", () => {
		expect(externalPackage("fs/promises")).toBe("node:fs");
		expect(externalPackage("node:fs/promises")).toBe("node:fs");
		expect(externalPackage("@scope/pkg/deep")).toBe("@scope/pkg");
	});

	test("resolveExports: a string, a condition object, a subpath map", () => {
		expect(resolveExports("./a.ts", ".")).toEqual(["./a.ts"]);
		expect(resolveExports("./a.ts", "./x")).toBeUndefined();
		expect(resolveExports({ import: "./a.mjs", require: "./a.cjs" }, ".")).toEqual([
			"./a.mjs",
			"./a.cjs",
		]);
		expect(resolveExports({ "./*": ["./src/*.ts", "./src/*.tsx"] }, "./x")).toEqual([
			"./src/x.ts",
			"./src/x.tsx",
		]);
		expect(resolveExports({ "./x": null }, "./x")).toEqual([]);
	});
});
