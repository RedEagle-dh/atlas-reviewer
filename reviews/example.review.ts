/**
 * A template. Copy it, point `repo` at a checkout, and adjust ranges and chapters:
 *
 *   cp reviews/example.review.ts reviews/local/my-branch.review.ts
 *   bun run atlas:check reviews/local/my-branch.review.ts
 *   bun run atlas reviews/local/my-branch.review.ts
 *
 * `reviews/local/` is git-ignored: a review file names a local path and describes a project's
 * layout, which does not belong in this repository when the project is private. Mind the import
 * path below when you move the file one directory down (`../../src/core/define`).
 */
import { defineReview } from "../src/core/define";

export default defineReview({
	id: "example",
	title: "Example — a feature branch against main",
	// Absolute, or relative to this file.
	repo: "../../path/to/repository",
	// The first range is the default. `mergeBase` compares with the point the branch left `main`.
	ranges: [
		{ id: "branch", label: "Branch", base: "main", mergeBase: true },
		{ id: "last", label: "Last commit", base: "HEAD~1" },
	],
	// Never part of the review …
	excludeCategories: ["test", "migration", "generated", "asset"],
	// … and of the rest, what is visible when the page opens (docs, config, locale stay a click away).
	defaultCategories: ["logic"],
	// Checked before the built-in rules; the first match wins.
	categories: [{ category: "test", match: ["**/testing.ts"] }],
	// Ordered = reading order; the first match wins; what matches none lands in a last chapter.
	chapters: [
		{
			id: "packages",
			title: "Shared packages",
			summary: "What the applications build on.",
			match: ["packages/**"],
		},
		{ id: "server", title: "Server", match: ["apps/api/**"] },
		{ id: "web", title: "Web", match: ["apps/web/**"] },
	],
});
