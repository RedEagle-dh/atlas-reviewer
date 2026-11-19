/**
 * `defineReview()` for review files, and turning a review file into a resolved `Review`
 * (defaults filled in, repository path absolute).
 */
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { BUILTIN_CATEGORIES } from "./classify";
import type { CategoryRule, ChapterConfig, RangeConfig, ReviewConfig } from "./types";

/** Files that match no chapter go here; it is always the last chapter. Its title is the UI's word. */
export const REST_CHAPTER_ID = "rest";

export const DEFAULT_VISIBLE_CATEGORIES: readonly string[] = ["logic"];

/** A review with every default filled in. */
export interface Review {
	id: string;
	title: string;
	description?: string;
	/** Absolute path of the repository. */
	repo: string;
	repoName: string;
	ranges: RangeConfig[];
	excludeCategories: string[];
	defaultCategories: string[];
	categories: CategoryRule[];
	exclude: string[];
	chapters: ChapterConfig[];
	restTitle?: string;
	expectedUnresolved: string[];
	/** The review file it came from, when loaded from one. */
	file?: string;
}

const SLUG = /^[a-z0-9][a-z0-9._-]*$/i;

/** Typed helper for review files; checks the config and returns it unchanged. */
export function defineReview(config: ReviewConfig): ReviewConfig {
	const problems = validateReview(config);
	if (problems.length > 0) throw new InvalidReviewError(config, problems);
	return config;
}

export class InvalidReviewError extends Error {
	constructor(config: unknown, problems: readonly string[]) {
		const id = isRecord(config) && typeof config.id === "string" ? ` "${config.id}"` : "";
		super(`invalid review${id}:\n- ${problems.join("\n- ")}`);
		this.name = "InvalidReviewError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isStringList = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Every problem of a review config, checked by hand before any field is read: a review file kept
 * outside this directory is not type-checked, so the shape may be anything.
 */
export function validateReview(config: unknown): string[] {
	if (!isRecord(config)) return ["the default export must be an object: defineReview({ … })"];
	const problems: string[] = [];
	const text = (field: string, required: boolean) => {
		const value = config[field];
		if (value === undefined) {
			if (required) problems.push(`${field} is missing`);
		} else if (typeof value !== "string") problems.push(`${field} must be a string`);
		else if (required && value === "") problems.push(`${field} is empty`);
	};
	const list = (field: string, value: unknown) => {
		if (value !== undefined && !isStringList(value))
			problems.push(`${field} must be a list of strings, e.g. ["apps/**"]`);
	};
	text("id", true);
	if (typeof config.id === "string" && config.id !== "" && !SLUG.test(config.id))
		problems.push(`id "${config.id}" must be a slug (letters, digits, . _ -)`);
	text("title", true);
	text("repo", true);
	text("description", false);
	text("restTitle", false);
	list("excludeCategories", config.excludeCategories);
	list("defaultCategories", config.defaultCategories);
	list("exclude", config.exclude);
	list("expectedUnresolved", config.expectedUnresolved);
	const duplicates = (ids: string[]) => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];

	const ranges: unknown = config.ranges;
	if (!Array.isArray(ranges)) problems.push("ranges must be a list: give at least one range");
	else if (ranges.length === 0) problems.push("ranges is empty: give at least one range");
	else {
		const ids: string[] = [];
		for (const [i, range] of ranges.entries()) {
			if (!isRecord(range)) {
				problems.push(`ranges[${i}] must be an object`);
				continue;
			}
			const name =
				typeof range.id === "string" && range.id ? `range "${range.id}"` : `ranges[${i}]`;
			if (typeof range.id !== "string" || range.id === "") problems.push(`${name} has no id`);
			else if (!SLUG.test(range.id)) problems.push(`${name}: id must be a slug`);
			else ids.push(range.id);
			if (typeof range.label !== "string") problems.push(`${name} has no label`);
			if (typeof range.base !== "string" || range.base === "") problems.push(`${name} has no base`);
			if (range.head !== undefined && typeof range.head !== "string")
				problems.push(`${name}: head must be a string`);
			if (range.mergeBase !== undefined && typeof range.mergeBase !== "boolean")
				problems.push(`${name}: mergeBase must be true or false`);
			if (range.note !== undefined && typeof range.note !== "string")
				problems.push(`${name}: note must be a string`);
		}
		for (const id of duplicates(ids)) problems.push(`range id "${id}" is used twice`);
	}

	const categories: unknown = config.categories ?? [];
	const known = new Set(BUILTIN_CATEGORIES.map((c) => c.id));
	if (!Array.isArray(categories)) problems.push("categories must be a list of { category, match }");
	else
		for (const [i, rule] of categories.entries()) {
			if (!isRecord(rule) || typeof rule.category !== "string" || rule.category === "") {
				problems.push(`categories[${i}] needs a category id`);
				continue;
			}
			known.add(rule.category);
			list(`categories[${i}] (${rule.category}).match`, rule.match ?? null);
			if (rule.label !== undefined && typeof rule.label !== "string")
				problems.push(`categories[${i}] (${rule.category}).label must be a string`);
		}

	const chapters: unknown = config.chapters ?? [];
	if (!Array.isArray(chapters)) problems.push("chapters must be a list of { id, title, match }");
	else {
		const ids: string[] = [];
		for (const [i, chapter] of chapters.entries()) {
			if (!isRecord(chapter) || typeof chapter.id !== "string" || chapter.id === "") {
				problems.push(`chapters[${i}] needs an id`);
				continue;
			}
			const name = `chapter "${chapter.id}"`;
			if (!SLUG.test(chapter.id)) problems.push(`${name}: id must be a slug`);
			ids.push(chapter.id);
			if (typeof chapter.title !== "string" || chapter.title === "")
				problems.push(`${name} has no title`);
			if (chapter.summary !== undefined && typeof chapter.summary !== "string")
				problems.push(`${name}: summary must be a string`);
			list(`${name}.match`, chapter.match ?? null);
		}
		for (const id of duplicates(ids)) problems.push(`chapter id "${id}" is used twice`);
		if (ids.includes(REST_CHAPTER_ID))
			problems.push(`chapter id "${REST_CHAPTER_ID}" is reserved for files that match no chapter`);
	}

	if (isStringList(config.defaultCategories)) {
		const excluded = new Set(
			isStringList(config.excludeCategories) ? config.excludeCategories : [],
		);
		for (const id of config.defaultCategories) {
			if (!known.has(id))
				problems.push(`defaultCategories: "${id}" is no category (${[...known].join(", ")})`);
			else if (excluded.has(id))
				problems.push(`defaultCategories: "${id}" is excluded by excludeCategories`);
		}
	}
	if (isStringList(config.excludeCategories))
		for (const id of config.excludeCategories)
			if (!known.has(id)) problems.push(`excludeCategories: "${id}" is no category`);
	return problems;
}

/** Fills in the defaults; `repo` is resolved against the review file's directory (or the cwd). */
export function resolveReview(config: ReviewConfig, reviewFile?: string): Review {
	const problems = validateReview(config);
	if (problems.length > 0) throw new InvalidReviewError(config, problems);
	const baseDir = reviewFile ? dirname(resolve(reviewFile)) : process.cwd();
	const repo = isAbsolute(config.repo) ? config.repo : resolve(baseDir, config.repo);
	const review: Review = {
		id: config.id,
		title: config.title,
		repo,
		repoName: basename(repo),
		ranges: config.ranges,
		excludeCategories: config.excludeCategories ?? [],
		defaultCategories: config.defaultCategories ?? [...DEFAULT_VISIBLE_CATEGORIES],
		categories: config.categories ?? [],
		exclude: config.exclude ?? [],
		chapters: config.chapters ?? [],
		expectedUnresolved: config.expectedUnresolved ?? [],
	};
	if (config.description !== undefined) review.description = config.description;
	if (config.restTitle !== undefined) review.restTitle = config.restTitle;
	if (reviewFile !== undefined) review.file = resolve(reviewFile);
	return review;
}

/** Imports a `*.review.ts` file and resolves its default export; errors name the file. */
export async function loadReview(file: string): Promise<Review> {
	const path = resolve(file);
	if (!(await Bun.file(path).exists())) throw new Error(`review file ${path} does not exist`);
	let mod: unknown;
	try {
		mod = await import(path);
	} catch (error) {
		throw new ReviewLoadError(path, error);
	}
	const config: unknown =
		typeof mod === "object" && mod !== null && "default" in mod ? mod.default : undefined;
	if (config === undefined)
		throw new Error(`${path} must \`export default defineReview({ id, title, repo, ranges, … })\``);
	const problems = validateReview(config);
	if (problems.length > 0)
		throw new ReviewLoadError(path, new InvalidReviewError(config, problems));
	if (!isReviewConfig(config)) throw new Error(`${path}: not a review config`);
	return resolveReview(config, path);
}

/** After `validateReview` found no problem, the value has the shape of a `ReviewConfig`. */
function isReviewConfig(value: unknown): value is ReviewConfig {
	return validateReview(value).length === 0;
}

/** A review file that does not load: a syntax error, a throwing `defineReview`, a bad import. */
export class ReviewLoadError extends Error {
	constructor(
		readonly file: string,
		readonly reason: unknown,
	) {
		super(`${file}:\n${describeLoadError(reason)}`);
		this.name = "ReviewLoadError";
	}
}

/**
 * Bun reports a file that does not build as an `AggregateError` whose `errors` are build
 * messages with a position; its own message only says how many there are.
 */
export function describeLoadError(error: unknown): string {
	const parts: string[] = [];
	if (error instanceof AggregateError && error.errors.length > 0) {
		for (const item of error.errors) parts.push(`${positionOf(item)}${messageOf(item)}`);
	} else parts.push(messageOf(error));
	return parts.map((part) => `  ${part.replaceAll("\n", "\n  ")}`).join("\n");
}

function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (isRecord(error) && typeof error.message === "string") return error.message;
	return String(error);
}

function positionOf(error: unknown): string {
	if (!isRecord(error) || !isRecord(error.position)) return "";
	const { line, column } = error.position;
	return typeof line === "number" && typeof column === "number" ? `${line}:${column} ` : "";
}
