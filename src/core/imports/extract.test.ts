import { describe, expect, test } from "bun:test";
import { cssExtractor, DEFAULT_EXTRACTORS, extractorFor, typescriptExtractor } from "./extract";

const extract = (code: string, path = "src/a.ts") => typescriptExtractor.extract(path, code);
const one = (code: string, path?: string) => {
	const [only, ...rest] = extract(code, path);
	expect(rest).toEqual([]);
	if (!only) throw new Error(`no import found in: ${code}`);
	return only;
};

describe("typescriptExtractor: static imports", () => {
	test("default, named, aliased, namespace and side-effect imports", () => {
		expect(one('import React from "react";')).toEqual({
			specifier: "react",
			line: 1,
			kind: "value",
			names: ["default"],
		});
		expect(one('import { a, b as c } from "./x";')).toMatchObject({
			kind: "value",
			names: ["a", "b"],
		});
		expect(one('import * as ns from "./x";')).toMatchObject({ kind: "value", names: ["*"] });
		expect(one('import D, { e } from "./x";')).toMatchObject({
			kind: "value",
			names: ["default", "e"],
		});
		expect(one('import D, * as ns from "./x";')).toMatchObject({
			kind: "value",
			names: ["default", "*"],
		});
		expect(one('import "./polyfill";')).toMatchObject({ kind: "side-effect", names: [] });
		expect(one('import {} from "./x";')).toMatchObject({ kind: "side-effect", names: [] });
	});

	test("`default as` names the export it takes", () => {
		expect(one('import { default as X } from "./x";').names).toEqual(["default"]);
	});

	test("`import type` and per-name `type` modifiers", () => {
		expect(one('import type { A, B } from "./t";')).toMatchObject({
			kind: "type",
			names: ["A", "B"],
		});
		expect(one('import type D from "./t";')).toMatchObject({ kind: "type", names: ["default"] });
		expect(one('import type * as T from "./t";')).toMatchObject({ kind: "type", names: ["*"] });
		// every name type-only: the statement only needs types
		expect(one('import { type A, type B } from "./t";')).toMatchObject({
			kind: "type",
			names: ["A", "B"],
		});
		// one value name makes it a value import
		expect(one('import { type A, b } from "./t";')).toMatchObject({
			kind: "value",
			names: ["A", "b"],
		});
		expect(one('import D, { type A } from "./t";')).toMatchObject({
			kind: "value",
			names: ["default", "A"],
		});
	});

	test("`import x = require()`", () => {
		expect(one('import fs = require("fs");')).toMatchObject({
			specifier: "fs",
			kind: "value",
			names: ["*"],
		});
		expect(one('import type T = require("./t");')).toMatchObject({ kind: "type" });
	});
});

describe("typescriptExtractor: re-exports", () => {
	test("`export … from`, `export * from`, `export * as`", () => {
		expect(one('export { a, b as c } from "./x";')).toMatchObject({
			kind: "re-export",
			names: ["a", "b"],
		});
		expect(one('export { default } from "./x";')).toMatchObject({
			kind: "re-export",
			names: ["default"],
		});
		expect(one('export * from "./x";')).toMatchObject({ kind: "re-export", names: ["*"] });
		expect(one('export * as ns from "./x";')).toMatchObject({ kind: "re-export", names: ["*"] });
	});

	test("type-only re-exports", () => {
		expect(one('export type { A } from "./t";')).toMatchObject({ kind: "type", names: ["A"] });
		expect(one('export type * from "./t";')).toMatchObject({ kind: "type", names: ["*"] });
		expect(one('export { type A, type B } from "./t";')).toMatchObject({
			kind: "type",
			names: ["A", "B"],
		});
		expect(one('export { type A, b } from "./t";')).toMatchObject({
			kind: "re-export",
			names: ["A", "b"],
		});
	});

	test("a local export is no import", () => {
		expect(extract("const a = 1;\nexport { a };\nexport default a;")).toEqual([]);
	});
});

describe("typescriptExtractor: dynamic import and require", () => {
	test("`import()` with a string literal or a plain template", () => {
		expect(one('const m = await import("./lazy");')).toMatchObject({
			specifier: "./lazy",
			kind: "dynamic",
			names: [],
		});
		expect(one("const m = import(`./lazy`);").specifier).toBe("./lazy");
	});

	test("an `import()` with a computed specifier is skipped", () => {
		const computed = ["const m = import(`./x/$", "{name}`);\nconst n = import(name);"].join("");
		expect(extract(computed)).toEqual([]);
	});

	test("`require()` with one string argument, nested anywhere", () => {
		expect(one('function f() { return require("./cjs"); }', "src/a.js")).toMatchObject({
			specifier: "./cjs",
			kind: "value",
		});
		expect(extract('require(name); require("a", "b");')).toEqual([]);
	});

	test('`import("x")` in a type position is a type import', () => {
		expect(one('type M = typeof import("./m");')).toMatchObject({ kind: "type", names: ["*"] });
		expect(one('let x: import("./m").Config.Inner;')).toMatchObject({
			kind: "type",
			names: ["Config"],
		});
	});
});

describe("typescriptExtractor: lines and order", () => {
	test("the 1-based line where the statement starts, in source order", () => {
		const code = [
			"// a comment",
			"import {",
			"  a,",
			"  b,",
			'} from "./multi";',
			"",
			"export async function load() {",
			'  return import("./late");',
			"}",
			'export * from "./again";',
		].join("\n");
		expect(extract(code).map((i) => [i.specifier, i.line])).toEqual([
			["./multi", 2],
			["./late", 8],
			["./again", 10],
		]);
	});

	test("an import in a comment or a string is not an import", () => {
		expect(extract('// import x from "./no";\nconst s = "import y from \'./no\'";')).toEqual([]);
	});
});

describe("typescriptExtractor: languages", () => {
	test("parses JSX in .tsx, .jsx and .js files", () => {
		const code =
			'import { Button } from "./button";\nexport const App = () => <Button label="x" />;';
		for (const path of ["a.tsx", "a.jsx", "a.js"])
			expect(extract(code, path).map((i) => i.specifier)).toEqual(["./button"]);
	});

	test("accepts every TypeScript and JavaScript extension, nothing else", () => {
		for (const ext of ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "d.ts"])
			expect(typescriptExtractor.test(`src/a.${ext}`)).toBe(true);
		for (const ext of ["json", "css", "md", "tsx.snap"])
			expect(typescriptExtractor.test(`src/a.${ext}`)).toBe(false);
	});

	test("broken code still yields what can be read", () => {
		expect(extract('import { a } from "./ok";\nfunction (').map((i) => i.specifier)).toEqual([
			"./ok",
		]);
	});
});

describe("cssExtractor", () => {
	test("`@import` with quotes or url(), with lines; comments are ignored", () => {
		const code = [
			'@import "./tokens.css";',
			"/* @import './commented.css'; */",
			"@import url(base.css);",
			"@import url('./quoted.css') layer(x);",
			".a { color: red; }",
		].join("\n");
		expect(cssExtractor.extract("a.css", code)).toEqual([
			{ specifier: "./tokens.css", line: 1, kind: "side-effect", names: [] },
			{ specifier: "base.css", line: 3, kind: "side-effect", names: [] },
			{ specifier: "./quoted.css", line: 4, kind: "side-effect", names: [] },
		]);
	});
});

describe("extractorFor", () => {
	test("the first extractor that accepts the path", () => {
		expect(extractorFor(DEFAULT_EXTRACTORS, "a.tsx")).toBe(typescriptExtractor);
		expect(extractorFor(DEFAULT_EXTRACTORS, "a.css")).toBe(cssExtractor);
		expect(extractorFor(DEFAULT_EXTRACTORS, "a.md")).toBeUndefined();
	});
});
