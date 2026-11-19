import { describe, expect, test } from "bun:test";
import { BUILTIN_CATEGORIES, createClassifier } from "./classify";

const classify = (path: string, rules = createClassifier()) =>
	rules.classify({ path, binary: false });

describe("built-in rules", () => {
	test("each category recognises its typical files", () => {
		const cases: [string, string][] = [
			["bun.lock", "generated"],
			["apps/web/src/routeTree.gen.ts", "generated"],
			["apps/api/src/modules/traffic/network/sites.generated.ts", "generated"],
			["packages/shared/src/mobility/network/fulda.shapes.generated.ts", "generated"],
			["dist/app.min.js", "generated"],
			["src/__snapshots__/a.test.ts.snap", "generated"],
			["packages/db/drizzle/0007_plugins.sql", "migration"],
			["db/migrations/001.ts", "migration"],
			["apps/api/src/a.test.ts", "test"],
			["apps/web/src/b.spec.tsx", "test"],
			["apps/web/src/lib/__tests__/x.ts", "test"],
			["packages/sdk/src/fixtures.testing.ts", "test"],
			["packages/db/src/testing/postgres.ts", "test"],
			["apps/api/test/helpers.ts", "test"],
			["e2e/login.ts", "test"],
			["README.md", "docs"],
			["docs/adr/0001.txt", "docs"],
			["apps/web/src/locales/de.json", "locale"],
			["apps/web/src/i18n/en/common.json", "locale"],
			["apps/web/public/logo.png", "asset"],
			["fonts/inter.woff2", "asset"],
			["apps/api/package.json", "config"],
			["tsconfig.base.json", "config"],
			["apps/web/vite.config.ts", "config"],
			[".gitignore", "config"],
			["apps/api/.env.example", "config"],
			[".husky/pre-commit", "config"],
			["helm/values.yaml", "config"],
			[".github/workflows/ci.yml", "config"],
			["apps/api/Dockerfile", "config"],
			["Dockerfile.dev", "config"],
			["apps/api/src/index.ts", "logic"],
			["apps/web/src/app.tsx", "logic"],
			["packages/ui/src/styles.css", "logic"],
			["scripts/plugin-example.sh", "logic"],
			["LICENSE", "other"],
			["data/regions.json", "other"],
		];
		for (const [path, category] of cases) expect([path, classify(path)]).toEqual([path, category]);
	});

	test("the first matching rule wins, in the documented order", () => {
		// generated before test: a snapshot of a test is generated
		expect(classify("src/a.test.ts.snap")).toBe("generated");
		// migration before config: a drizzle config inside drizzle/ is a migration
		expect(classify("packages/db/drizzle/meta/_journal.json")).toBe("migration");
		// docs before test: Markdown in a test directory, and anything below docs/, is documentation
		expect(classify("docs/testing/CONVENTIONS.md")).toBe("docs");
		expect(classify("apps/api/test/README.md")).toBe("docs");
		expect(classify("apps/api/src/__tests__/notes.mdx")).toBe("docs");
		// …but other files in a test directory stay tests
		expect(classify("packages/db/src/testing/postgres.ts")).toBe("test");
		// docs before config: helm's README is documentation
		expect(classify("helm/README.md")).toBe("docs");
		// locale before config: a YAML translation is a locale file
		expect(classify("apps/web/locales/de.yaml")).toBe("locale");
		// asset before logic: an SVG is media even though it is text
		expect(classify("apps/web/src/icon.svg")).toBe("asset");
		// config before logic: a config file in TypeScript is config
		expect(classify("apps/web/vite.config.ts")).toBe("config");
	});

	test("the built-in order is the documented one", () => {
		expect(BUILTIN_CATEGORIES.map((c) => c.id)).toEqual([
			"generated",
			"migration",
			"docs",
			"test",
			"locale",
			"asset",
			"config",
			"logic",
			"other",
		]);
	});

	test("a binary file is an asset unless an earlier rule claims it", () => {
		const c = createClassifier();
		expect(c.classify({ path: "apps/api/src/blob.ts", binary: true })).toBe("asset");
		expect(c.classify({ path: "data/archive", binary: true })).toBe("asset");
		expect(c.classify({ path: "apps/api/test/blob.bin", binary: true })).toBe("test");
		expect(c.classify({ path: "bun.lockb", binary: true })).toBe("generated");
	});
});

describe("review rules", () => {
	test("are checked before the built-in rules; the first of them wins", () => {
		const c = createClassifier([
			{ category: "test", match: ["**/testing.ts", "test/**"] },
			{ category: "logic", match: ["**/*.md"] },
		]);
		expect(classify("apps/mcp/src/testing.ts", c)).toBe("test");
		expect(classify("test/preload.ts", c)).toBe("test");
		expect(classify("apps/mcp/src/testing-utils.ts", c)).toBe("logic");
		expect(classify("README.md", c)).toBe("logic");
	});

	test("may add a category with a label; a built-in gets a label only from the review", () => {
		const c = createClassifier([
			{ category: "proto", label: "Protokolle", match: ["**/*.proto"] },
			{ category: "docs", label: "Doku", match: ["notes/**"] },
		]);
		expect(classify("api/a.proto", c)).toBe("proto");
		const labels = new Map(c.categories().map((x) => [x.id, x.label]));
		expect(labels.get("proto")).toBe("Protokolle");
		expect(labels.get("docs")).toBe("Doku");
		// core has no words of its own: the UI names the built-in ids
		expect(labels.has("logic")).toBe(true);
		expect(labels.get("logic")).toBeUndefined();
		// built-ins keep their order; a new category comes after them
		expect(
			c
				.categories()
				.map((x) => x.id)
				.at(-1),
		).toBe("proto");
	});
});
