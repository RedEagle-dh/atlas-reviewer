/**
 * Builds the model of one range: resolve the commits, diff them, classify and group the changed
 * files, and connect them through the repository's imports.
 */
import { type Classifier, createClassifier } from "./classify";
import { REST_CHAPTER_ID, type Review } from "./define";
import { type DiffEntry, diffCommits } from "./diff";
import { createMatcher } from "./glob";
import { buildEdges, findCycles, type ImportStatement, readingOrder, unitOf } from "./graph";
import { shikiLanguageFor } from "./highlight";
import {
	type AnalyzeOptions,
	analyzeRepo,
	type Importer,
	type RepoImports,
	type ResolvedImport,
} from "./imports/analyze";
import { workspacePackages } from "./imports/resolve";
import { assertRepository, mergeBase, RepoSource, resolveCommit } from "./source";
import type { ChangedFile, RangeConfig, ReviewModel } from "./types";

export interface ResolvedRange {
	range: RangeConfig;
	headRef: string;
	baseSha: string;
	headSha: string;
	/** Identifies a model: a moved ref gives a new key. */
	key: string;
}

/** Turns a range's refs into commit shas (the merge base when `mergeBase`). */
export async function resolveRange(review: Review, range: RangeConfig): Promise<ResolvedRange> {
	const headRef = range.head ?? "HEAD";
	const [headSha, baseTip] = await Promise.all([
		resolveCommit(review.repo, headRef),
		resolveCommit(review.repo, range.base),
	]);
	const baseSha = range.mergeBase ? await mergeBase(review.repo, baseTip, headSha) : baseTip;
	return { range, headRef, baseSha, headSha, key: `${range.id}:${baseSha}:${headSha}` };
}

export function findRange(review: Review, rangeId?: string): RangeConfig | undefined {
	return rangeId === undefined ? review.ranges[0] : review.ranges.find((r) => r.id === rangeId);
}

/** Everything a built range knows; the file view and the CLI read from it. */
export interface RangeBuild {
	resolved: ResolvedRange;
	model: ReviewModel;
	head: RepoSource;
	base: RepoSource;
	/** By path (base path for a deleted file); every changed file, excluded ones too. */
	diff: Map<string, DiffEntry>;
	/** The head commit, parsed. */
	repo: RepoImports;
	/**
	 * The base commit, parsed, when the range deletes files: a deleted file's imports and the files
	 * that imported it are known only there. `null` when nothing was deleted.
	 */
	before: RepoImports | null;
	/**
	 * The head path of a base path: the same path (still there, or deleted: a deleted file keeps
	 * its base path in the model), the new path of a renamed file, `null` when it is gone otherwise.
	 */
	toHead: (basePath: string) => string | null;
	/** Imports and importers of any file, deleted ones included (see `relationsOf`). */
	relations: Relations;
	classifier: Classifier;
	/** Paths of `model.files`. */
	reviewPaths: Set<string>;
	/** Changed files that are left out. */
	excludedPaths: Set<string>;
	timings: BuildTimings;
}

/**
 * The commit a path of the range is read from: head, or base for a deleted file. `null` when the
 * path is no file of the head commit and no deleted file of the base. Decided from the commits'
 * file lists alone, so no path, however it is spelled, reaches the disk.
 */
export function sourceOf(build: RangeBuild, path: string): RepoSource | null {
	const source = build.diff.get(path)?.status === "deleted" ? build.base : build.head;
	return source.has(path) ? source : null;
}

export interface BuildTimings {
	refs: number;
	list: number;
	diff: number;
	analyze: number;
	model: number;
	total: number;
}

export interface BuildContext extends AnalyzeOptions {
	/** Reuse the repository analysis of a commit (the session caches it by sha). */
	analyze?: (commit: RepoSource) => Promise<RepoImports>;
	/** `resolveRange` result, when the caller already has it. */
	resolved?: ResolvedRange;
	/** The highlighter's language of a path (`ChangedFile.language`); default: shiki's ids. */
	languageFor?: (path: string) => string | null;
}

export async function buildRange(
	review: Review,
	rangeId: string | undefined,
	context: BuildContext = {},
): Promise<RangeBuild> {
	const range = findRange(review, rangeId);
	if (!range) throw new UnknownRangeError(review, rangeId ?? "");
	const t0 = performance.now();
	await assertRepository(review.repo);
	const resolved = context.resolved ?? (await resolveRange(review, range));
	const t1 = performance.now();
	const [head, base] = await Promise.all([
		RepoSource.open(review.repo, resolved.headSha),
		RepoSource.open(review.repo, resolved.baseSha),
	]);
	const t2 = performance.now();
	const entries = await diffCommits(review.repo, resolved.baseSha, resolved.headSha);
	const t3 = performance.now();
	const analyze = (commit: RepoSource) =>
		context.analyze ? context.analyze(commit) : analyzeRepo(commit, context);
	const deletedPaths = new Set(entries.filter((e) => e.status === "deleted").map((e) => e.path));
	const [repo, before] = await Promise.all([
		analyze(head),
		deletedPaths.size > 0 ? analyze(base) : null,
	]);
	const t4 = performance.now();

	const renamedTo = new Map<string, string>();
	for (const e of entries) if (e.oldPath !== undefined) renamedTo.set(e.oldPath, e.path);
	const toHead = (basePath: string): string | null =>
		renamedTo.get(basePath) ?? (deletedPaths.has(basePath) || head.has(basePath) ? basePath : null);

	const languageFor = context.languageFor ?? shikiLanguageFor;
	const classifier = createClassifier(review.categories);
	const excludeCategories = new Set(review.excludeCategories);
	const excludeGlob = createMatcher(review.exclude);
	const chapters = review.chapters.map((c) => ({ id: c.id, test: createMatcher(c.match) }));
	const chapterOf = (path: string) => chapters.find((c) => c.test(path))?.id ?? REST_CHAPTER_ID;
	const packageDirsOf = (analysis: RepoImports) =>
		workspacePackages(analysis.files)
			.map((p) => p.dir)
			.filter((dir) => dir !== "");
	const packageDirs = packageDirsOf(repo);
	// A deleted file belongs to the package it was in, which may be gone at head.
	const basePackageDirs = before ? packageDirsOf(before) : packageDirs;

	const diff = new Map<string, DiffEntry>();
	const files: ChangedFile[] = [];
	const excluded: Record<string, number> = {};
	const excludedPaths = new Set<string>();
	for (const entry of entries) {
		diff.set(entry.path, entry);
		const category = classifier.classify(entry);
		if (excludeCategories.has(category) || excludeGlob(entry.path)) {
			excluded[category] = (excluded[category] ?? 0) + 1;
			excludedPaths.add(entry.path);
			continue;
		}
		const file: ChangedFile = {
			path: entry.path,
			status: entry.status,
			added: entry.added,
			deleted: entry.deleted,
			binary: entry.binary,
			category,
			chapter: chapterOf(entry.path),
			unit: unitOf(entry.path, entry.status === "deleted" ? basePackageDirs : packageDirs),
			language: languageFor(entry.path),
			blob: entry.status === "deleted" ? null : (head.blob(entry.path) ?? null),
			baseBlob: entry.status === "added" ? null : (base.blob(entry.oldPath ?? entry.path) ?? null),
			outside: { imports: 0, importers: 0 },
		};
		if (entry.oldPath !== undefined) file.oldPath = entry.oldPath;
		files.push(file);
	}
	files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

	const reviewPaths = new Set(files.map((f) => f.path));
	const changed = new Set(entries.map((e) => e.path));
	const relations = relationsOf({ repo, before, toHead, deleted: deletedPaths });
	type Statement = ImportStatement & { target: string | null };
	const statement = (i: ResolvedImport, target: string | null): Statement => ({
		kind: i.kind,
		names: i.names,
		line: i.line,
		target,
	});
	// The files that imported a deleted file at base: their statements for it, as they were then.
	const formerImports = new Map<string, Statement[]>();
	for (const path of deletedPaths)
		for (const importer of relations.importers(path)) {
			if (deletedPaths.has(importer.from)) continue; // its own imports say so already
			const list = formerImports.get(importer.from) ?? [];
			list.push(statement(importer.import, path));
			formerImports.set(importer.from, list);
		}
	const edges = buildEdges(reviewPaths, (path) => [
		...relations.imports(path).map((i) => statement(i, targetOf(i))),
		...(formerImports.get(path) ?? []),
	]);

	const unresolved: ReviewModel["unresolved"] = [];
	for (const file of files) {
		const outsideTargets = new Set<string>();
		for (const i of relations.imports(file.path)) {
			if (i.resolution.kind === "unresolved")
				unresolved.push({ from: file.path, specifier: i.specifier, line: i.line });
			const target = targetOf(i);
			if (target !== null && !changed.has(target)) outsideTargets.add(target);
		}
		const outsideImporters = new Set<string>();
		for (const importer of relations.importers(file.path))
			if (!changed.has(importer.from)) outsideImporters.add(importer.from);
		file.outside = { imports: outsideTargets.size, importers: outsideImporters.size };
	}

	const paths = files.map((f) => f.path);
	const chapterOrder = [...review.chapters.map((c) => c.id), REST_CHAPTER_ID];
	const chapterById = new Map(files.map((f) => [f.path, f.chapter]));
	const model: ReviewModel = {
		range: {
			id: range.id,
			label: range.label,
			base: { ref: range.base, sha: resolved.baseSha },
			head: { ref: resolved.headRef, sha: resolved.headSha },
			mergeBase: range.mergeBase ?? false,
		},
		files,
		edges,
		readingOrder: readingOrder(
			paths,
			edges,
			(p) => chapterById.get(p) ?? REST_CHAPTER_ID,
			chapterOrder,
		),
		cycles: findCycles(paths, edges),
		excluded,
		unresolved,
		generatedAt: new Date().toISOString(),
	};
	if (range.note !== undefined) model.range.note = range.note;
	const t5 = performance.now();
	const ms = (a: number, b: number) => Math.round(b - a);
	return {
		resolved,
		model,
		head,
		base,
		diff,
		repo,
		before,
		toHead,
		relations,
		classifier,
		reviewPaths,
		excludedPaths,
		timings: {
			refs: ms(t0, t1),
			list: ms(t1, t2),
			diff: ms(t2, t3),
			analyze: ms(t3, t4),
			model: ms(t4, t5),
			total: ms(t0, t5),
		},
	};
}

/** The repo path an import resolved to (already a head path, see `relationsOf`), or null. */
export function targetOf(item: ResolvedImport): string | null {
	return item.resolution.kind === "file" ? item.resolution.path : null;
}

export interface Relations {
	/** A file's import statements; for a deleted file those at base, targets as head paths. */
	imports(path: string): ResolvedImport[];
	/**
	 * Every statement that imports the file, importers as head paths: at head, plus deleted files
	 * that imported it at base; for a deleted file, the files that imported it at base.
	 */
	importers(path: string): Importer[];
}

/**
 * Who imports whom, at head for files that exist there and at base for deleted ones, with every
 * base path turned into a head path (a renamed file answers by its new path).
 */
export function relationsOf(input: {
	repo: RepoImports;
	before: RepoImports | null;
	toHead: (basePath: string) => string | null;
	deleted: ReadonlySet<string>;
}): Relations {
	const { repo, before, toHead, deleted } = input;
	const atHead = (item: ResolvedImport): ResolvedImport => {
		const r = item.resolution;
		if (r.kind !== "file") return item;
		const path = toHead(r.path);
		return path === null ? item : { ...item, resolution: { kind: "file", path } };
	};
	// Deleted files that imported a file at base, by the head path of that file.
	const formerImporters = new Map<string, Importer[]>();
	if (before)
		for (const from of deleted)
			for (const item of before.imports.get(from) ?? []) {
				const mapped = atHead(item);
				if (mapped.resolution.kind !== "file") continue;
				const target = mapped.resolution.path;
				const list = formerImporters.get(target) ?? [];
				list.push({ from, import: item });
				formerImporters.set(target, list);
			}
	return {
		imports(path) {
			if (!deleted.has(path)) return repo.imports.get(path) ?? [];
			return (before?.imports.get(path) ?? []).map(atHead);
		},
		importers(path) {
			if (!deleted.has(path))
				return [...(repo.importers.get(path) ?? []), ...(formerImporters.get(path) ?? [])];
			const out: Importer[] = [];
			for (const importer of before?.importers.get(path) ?? []) {
				const from = toHead(importer.from);
				if (from !== null) out.push({ from, import: importer.import });
			}
			return out;
		},
	};
}

/** The model of one range (`rangeId` undefined = the first range). */
export async function buildReviewModel(
	review: Review,
	rangeId?: string,
	context: BuildContext = {},
): Promise<ReviewModel> {
	return (await buildRange(review, rangeId, context)).model;
}

export class UnknownRangeError extends Error {
	constructor(review: Review, rangeId: string) {
		super(
			`unknown range "${rangeId}"; the review "${review.id}" has: ${review.ranges.map((r) => r.id).join(", ")}`,
		);
		this.name = "UnknownRangeError";
	}
}
