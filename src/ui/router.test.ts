import { describe, expect, test } from "bun:test";
import {
	fileRoute,
	formatHash,
	mapRoute,
	parseHash,
	readFileParams,
	readMapParams,
	withRange,
} from "./router";

describe("parseHash", () => {
	test("an empty hash is the map at the top level", () => {
		expect(parseHash("")).toEqual({ view: "map", path: "", query: {} });
		expect(parseHash("#/")).toEqual({ view: "map", path: "", query: {} });
	});

	test("splits view, path and query", () => {
		expect(parseHash("#/file/apps/api/src/app.ts?line=42&range=all")).toEqual({
			view: "file",
			path: "apps/api/src/app.ts",
			query: { line: "42", range: "all" },
		});
	});

	test("decodes segments and query values", () => {
		const route = parseHash("#/file/docs/Gr%C3%BC%C3%9Fe%20und%20%3F.md?focus=a%2Fb");
		expect(route.path).toBe("docs/Grüße und ?.md");
		expect(route.query.focus).toBe("a/b");
	});

	test("keeps a malformed escape as it is", () => {
		expect(parseHash("#/file/a%zz.ts").path).toBe("a%zz.ts");
	});
});

describe("formatHash", () => {
	test("round-trips paths with spaces, umlauts, `?`, `#` and `$`", () => {
		for (const path of [
			"apps/web/src/routes/m/$module/index.tsx",
			"docs/Größe und ?.md",
			"a#b/c d.ts",
		]) {
			const route = fileRoute({ path, line: 7 }, "all");
			expect(parseHash(formatHash(route))).toEqual(route);
		}
	});

	test("keeps slashes readable and leaves out empty query values", () => {
		expect(
			formatHash({ view: "map", path: "host/apps/api", query: { by: "", range: "all" } }),
		).toBe("#/map/host/apps/api?range=all");
	});
});

describe("map and file params", () => {
	test("the grouping defaults to chapters", () => {
		expect(readMapParams(parseHash("#/map/host"))).toEqual({ group: "host", grouping: "chapters" });
		expect(readMapParams(parseHash("#/map/apps/web?by=dirs&focus=apps/web/x.ts"))).toEqual({
			group: "apps/web",
			grouping: "dirs",
			focus: "apps/web/x.ts",
		});
	});

	test("mapRoute writes only what differs from the defaults", () => {
		expect(formatHash(mapRoute({ group: "", grouping: "chapters" }))).toBe("#/map");
		expect(formatHash(mapRoute({ group: "apps/web", grouping: "dirs" }, "all"))).toBe(
			"#/map/apps/web?by=dirs&range=all",
		);
	});

	test("a line must be a positive integer", () => {
		expect(readFileParams(parseHash("#/file/a.ts?line=12"))).toEqual({ path: "a.ts", line: 12 });
		expect(readFileParams(parseHash("#/file/a.ts?line=0"))).toEqual({ path: "a.ts" });
		expect(readFileParams(parseHash("#/file/a.ts?line=x"))).toEqual({ path: "a.ts" });
	});

	test("withRange replaces or removes the range and keeps the rest", () => {
		const route = parseHash("#/map/host?by=dirs&range=logic");
		expect(withRange(route, "all").query).toEqual({ by: "dirs", range: "all" });
		expect(withRange(route, undefined).query).toEqual({ by: "dirs" });
	});
});
