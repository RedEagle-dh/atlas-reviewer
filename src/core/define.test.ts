import { describe, expect, test } from "bun:test";
import { defineReview, describeLoadError, resolveReview, validateReview } from "./define";
import type { ReviewConfig } from "./types";

const minimal: ReviewConfig = {
	id: "demo",
	title: "Demo",
	repo: "../repo",
	ranges: [{ id: "main", label: "Main", base: "main" }],
};

describe("defineReview", () => {
	test("returns a valid config unchanged", () => {
		expect(defineReview(minimal)).toBe(minimal);
	});

	test("names every problem of an invalid config", () => {
		const problems = validateReview({
			...minimal,
			id: "not a slug",
			ranges: [
				{ id: "a", label: "A", base: "main" },
				{ id: "a", label: "A2", base: "" },
			],
			chapters: [{ id: "rest", title: "Rest", match: [] }],
		});
		expect(problems.join("\n")).toMatch(/slug/);
		expect(problems.join("\n")).toMatch(/range id "a" is used twice/);
		expect(problems.join("\n")).toMatch(/has no base/);
		expect(problems.join("\n")).toMatch(/reserved/);
		expect(() => defineReview({ ...minimal, ranges: [] })).toThrow(/ranges is empty/);
	});

	test("checks the shape before reading a field: a review file outside the tool is not type-checked", () => {
		const { ranges: _, ...noRanges } = minimal;
		expect(validateReview(noRanges)).toEqual(["ranges must be a list: give at least one range"]);
		expect(validateReview(null)).toEqual([
			"the default export must be an object: defineReview({ … })",
		]);
		expect(
			validateReview({ ...minimal, chapters: [{ id: "api", title: "API", match: "apps/**" }] }),
		).toEqual(['chapter "api".match must be a list of strings, e.g. ["apps/**"]']);
		expect(
			validateReview({ ...minimal, categories: [{ category: "test", match: "**/x.ts" }] }),
		).toEqual(['categories[0] (test).match must be a list of strings, e.g. ["apps/**"]']);
		expect(validateReview({ ...minimal, exclude: "vendor/**" })).toEqual([
			'exclude must be a list of strings, e.g. ["apps/**"]',
		]);
		expect(validateReview({ ...minimal, ranges: [{ id: "a", base: "main" }] })).toEqual([
			'range "a" has no label',
		]);
		expect(
			validateReview({ ...minimal, chapters: [{ id: "Web Kern", title: "W", match: [] }] }),
		).toEqual(['chapter "Web Kern": id must be a slug']);
	});

	test("default and excluded categories must name categories the review knows", () => {
		expect(
			validateReview({
				...minimal,
				excludeCategories: ["test"],
				defaultCategories: ["logic", "test", "schema"],
			}),
		).toEqual([
			'defaultCategories: "test" is excluded by excludeCategories',
			expect.stringMatching(/^defaultCategories: "schema" is no category/),
		]);
		expect(
			validateReview({
				...minimal,
				categories: [{ category: "schema", match: ["**/*.sql"] }],
				defaultCategories: ["logic", "schema"],
			}),
		).toEqual([]);
	});
});

describe("describeLoadError", () => {
	test("lists every build message of an AggregateError with its position", () => {
		const error = new AggregateError(
			[
				{ message: 'Expected "]" but found ")"', position: { line: 2, column: 164 } },
				{ message: "Unexpected end of file", position: { line: 9, column: 1 } },
			],
			"2 errors building x.review.ts",
		);
		expect(describeLoadError(error)).toBe(
			'  2:164 Expected "]" but found ")"\n  9:1 Unexpected end of file',
		);
		expect(describeLoadError(new Error("a\nb"))).toBe("  a\n  b");
	});
});

describe("resolveReview", () => {
	test("fills the defaults and resolves `repo` against the review file", () => {
		const review = resolveReview(minimal, "/work/reviews/demo.review.ts");
		expect(review.repo).toBe("/work/repo");
		expect(review.repoName).toBe("repo");
		expect(review.defaultCategories).toEqual(["logic"]);
		expect(review.excludeCategories).toEqual([]);
		expect(review.chapters).toEqual([]);
		expect(review.file).toBe("/work/reviews/demo.review.ts");
	});

	test("keeps an absolute `repo`", () => {
		expect(resolveReview({ ...minimal, repo: "/abs/repo" }, "/x/y.review.ts").repo).toBe(
			"/abs/repo",
		);
	});
});
