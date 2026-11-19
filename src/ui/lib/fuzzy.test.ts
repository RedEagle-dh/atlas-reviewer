import { describe, expect, test } from "bun:test";
import { fuzzyFilter, fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
	test("matches the query's characters in order, case-insensitively", () => {
		expect(fuzzyMatch("SVC", "apps/api/service.ts")?.indices).toEqual([9, 12, 14]);
		expect(fuzzyMatch("xyz", "apps/api/service.ts")).toBeNull();
		expect(fuzzyMatch("ts.", "a.ts")).toBeNull();
	});

	test("prefers word starts over the first occurrence", () => {
		expect(fuzzyMatch("ps", "apps/plugin-sdk/x.ts")?.indices).toEqual([5, 12]);
		expect(
			fuzzyMatch("ms", "apps/api/src/modules/plugins/marketplace-service.ts")?.indices,
		).toEqual([29, 41]);
	});

	test("an empty query matches everything with score 0", () => {
		expect(fuzzyMatch("  ", "a/b.ts")).toEqual({ score: 0, indices: [] });
	});

	test("ignores spaces in the query", () => {
		expect(fuzzyMatch("plug serv", "apps/api/src/modules/plugins/service.ts")).not.toBeNull();
	});
});

describe("fuzzyFilter", () => {
	const paths = [
		"apps/api/src/modules/registry/service.ts",
		"apps/api/src/modules/plugins/service.ts",
		"apps/api/src/modules/plugins/store.ts",
		"packages/plugin-sdk/src/manifest.ts",
	];

	test("a hit in the file name beats a hit spread over directories", () => {
		const [first] = fuzzyFilter("store", paths, (p) => p);
		expect(first?.item).toBe("apps/api/src/modules/plugins/store.ts");
	});

	test("segment starts and runs rank the intended file first", () => {
		const [first] = fuzzyFilter("plugservice", paths, (p) => p);
		expect(first?.item).toBe("apps/api/src/modules/plugins/service.ts");
		expect(fuzzyFilter("manifest", paths, (p) => p)[0]?.item).toBe(
			"packages/plugin-sdk/src/manifest.ts",
		);
	});

	test("keeps only matches and respects the limit", () => {
		expect(fuzzyFilter("zzz", paths, (p) => p)).toEqual([]);
		expect(fuzzyFilter("s", paths, (p) => p, 2)).toHaveLength(2);
	});

	test("an empty query keeps the input order", () => {
		expect(fuzzyFilter("", paths, (p) => p).map((r) => r.item)).toEqual(paths);
	});
});
