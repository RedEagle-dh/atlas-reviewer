/**
 * One review, served: builds models on demand and keeps them while the refs stay put, keeps the
 * repository analysis per head commit, and answers the questions of the contract (the review, a
 * model, a file, the viewed marks, the comments).
 */
import { resolve } from "node:path";
import {
	buildRange,
	findRange,
	type RangeBuild,
	resolveRange,
	sourceOf,
	UnknownRangeError,
} from "./build";
import { createClassifier } from "./classify";
import { type CommentStore, createCommentStore } from "./comments";
import { REST_CHAPTER_ID, type Review } from "./define";
import { buildFileView, type Content, LruCache } from "./file-view";
import { createShikiHighlighter, type Highlighter } from "./highlight";
import { analyzeRepo, ImportCache, type RepoImports } from "./imports/analyze";
import type { Extractor } from "./imports/extract";
import type { ResolverFactory } from "./imports/resolve";
import type { RepoSource } from "./source";
import { createStateStore, type StateStore } from "./state";
import type {
	CommentDraft,
	CommentEdit,
	CommentsState,
	FileView,
	ReviewMeta,
	ReviewModel,
	ViewedState,
	ViewedUpdate,
} from "./types";

/** `<tool>/.review-atlas`: state files and the extraction cache. */
export const DEFAULT_DATA_DIR = resolve(import.meta.dir, "../../.review-atlas");

export interface SessionOptions {
	/** Where state and cache live; default `DEFAULT_DATA_DIR`. */
	dataDir?: string;
	highlighter?: Highlighter;
	extractors?: readonly Extractor[];
	resolvers?: readonly ResolverFactory[];
	/** The extraction cache; `null` = none. Default: `<dataDir>/cache/imports.json`. */
	importCache?: ImportCache | null;
}

export class ReviewSession {
	readonly highlighter: Highlighter;
	private readonly dataDir: string;
	private readonly builds = new Map<string, { key: string; build: Promise<RangeBuild> }>();
	private readonly analyses = new Map<string, Promise<RepoImports>>();
	private readonly contents = new LruCache<Content>(300);
	private readonly state: StateStore;
	private readonly commentStore: CommentStore;
	private importCache: Promise<ImportCache | null> | undefined;

	constructor(
		readonly review: Review,
		private readonly options: SessionOptions = {},
	) {
		this.dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
		this.highlighter = options.highlighter ?? createShikiHighlighter();
		this.state = createStateStore(resolve(this.dataDir, "state", `${review.id}.json`));
		this.commentStore = createCommentStore(resolve(this.dataDir, "comments", `${review.id}.json`));
		if (options.importCache !== undefined) this.importCache = Promise.resolve(options.importCache);
	}

	meta(): ReviewMeta {
		const { review } = this;
		const excluded = new Set(review.excludeCategories);
		const meta: ReviewMeta = {
			id: review.id,
			title: review.title,
			repoName: review.repoName,
			repoPath: review.repo,
			ranges: review.ranges.map((r) =>
				r.note === undefined
					? { id: r.id, label: r.label }
					: { id: r.id, label: r.label, note: r.note },
			),
			categories: createClassifier(review.categories)
				.categories()
				.filter((c) => !excluded.has(c.id))
				.map((c) => ({ ...c, defaultVisible: review.defaultCategories.includes(c.id) })),
			chapters: [
				...review.chapters.map((c) =>
					c.summary === undefined
						? { id: c.id, title: c.title }
						: { id: c.id, title: c.title, summary: c.summary },
				),
				review.restTitle === undefined
					? { id: REST_CHAPTER_ID }
					: { id: REST_CHAPTER_ID, title: review.restTitle },
			],
		};
		if (review.description !== undefined) meta.description = review.description;
		return meta;
	}

	/** The current build of a range; rebuilt when one of its refs moved. */
	async build(rangeId?: string): Promise<RangeBuild> {
		const range = findRange(this.review, rangeId);
		if (!range) throw new UnknownRangeError(this.review, rangeId ?? "");
		const resolved = await resolveRange(this.review, range);
		const cached = this.builds.get(range.id);
		if (cached && cached.key === resolved.key) return cached.build;
		const build = buildRange(this.review, range.id, {
			resolved,
			analyze: (head) => this.analyze(head),
			languageFor: (path) => this.highlighter.languageFor(path),
		});
		this.builds.set(range.id, { key: resolved.key, build });
		build.catch(() => {
			if (this.builds.get(range.id)?.build === build) this.builds.delete(range.id);
		});
		return build;
	}

	async model(rangeId?: string): Promise<ReviewModel> {
		return (await this.build(rangeId)).model;
	}

	/**
	 * `null` when the path is no file of the range's head (or a deleted file of its base). With
	 * `at` (the shas of the model the caller shows) a range that has moved on throws
	 * `RangeMovedError`, so the caller never mixes two states of the branch.
	 */
	async file(
		rangeId: string | undefined,
		path: string,
		at?: { base: string; head: string },
	): Promise<FileView | null> {
		const build = await this.build(rangeId);
		const { baseSha, headSha } = build.resolved;
		if (at && (at.base !== baseSha || at.head !== headSha))
			throw new RangeMovedError(build.resolved.range.id, at.head, headSha);
		return buildFileView(build, path, {
			highlighter: this.highlighter,
			cache: this.contents,
			...(this.options.extractors ? { extractors: this.options.extractors } : {}),
		});
	}

	viewed(): Promise<ViewedState> {
		return this.state.read();
	}

	/**
	 * Marks a file as viewed at its current blob (head; base for a deleted file) or removes the
	 * mark. `null` when marking a path the range does not know. With `blob` (what the page shows)
	 * a file that has changed since throws `RangeMovedError` and nothing is written: the mark
	 * always names the content the reader saw.
	 */
	async setViewed(update: ViewedUpdate): Promise<ViewedState | null> {
		if (!update.viewed) return this.state.set(update.path, null);
		const build = await this.build(update.range);
		const blob = sourceOf(build, update.path)?.blob(update.path);
		if (!blob) return null;
		if (update.blob !== undefined && update.blob !== blob)
			throw new RangeMovedError(build.resolved.range.id, null, build.resolved.headSha);
		return this.state.set(update.path, blob);
	}

	comments(): Promise<CommentsState> {
		return this.commentStore.list();
	}

	/**
	 * Records a comment in a range, at the range's head of this moment: the commit its line
	 * numbers belong to. With `draft.head` (the head the writer's page shows) a range that has
	 * moved on throws `RangeMovedError` and nothing is written: the line numbers were read off
	 * another commit. `null` when the path is no file of the range (see `sourceOf`); a draft that
	 * breaks a rule rejects with `InvalidCommentError`. The new comment is the last entry.
	 */
	async addComment(draft: CommentDraft): Promise<CommentsState | null> {
		const build = await this.build(draft.range);
		const { range: _asked, head: shown, ...content } = draft;
		const { headSha } = build.resolved;
		// Before the path: in the new state the file may be gone, and "not found" would hide why.
		if (shown !== undefined && shown !== headSha)
			throw new RangeMovedError(build.resolved.range.id, shown, headSha);
		if (!sourceOf(build, draft.path)) return null;
		return this.commentStore.add({ ...content, range: build.resolved.range.id, head: headSha });
	}

	/** `null` for an unknown id. */
	editComment(id: string, edit: CommentEdit): Promise<CommentsState | null> {
		return this.commentStore.edit(id, edit.text);
	}

	/** An unknown id is not an error: the comment is gone either way. */
	removeComment(id: string): Promise<CommentsState> {
		return this.commentStore.remove(id);
	}

	/** The reader starts over, after handing the comments to the agent. */
	clearComments(): Promise<CommentsState> {
		return this.commentStore.clear();
	}

	private analyze(commit: RepoSource): Promise<RepoImports> {
		const cached = this.analyses.get(commit.sha);
		if (cached) return cached;
		const analysis = (async () => {
			const cache = await this.openImportCache();
			return analyzeRepo(commit, {
				cache,
				...(this.options.extractors ? { extractors: this.options.extractors } : {}),
				...(this.options.resolvers ? { resolvers: this.options.resolvers } : {}),
			});
		})();
		this.analyses.set(commit.sha, analysis);
		analysis.catch(() => this.analyses.delete(commit.sha));
		// Two ranges with a head and (when they delete files) a base each.
		while (this.analyses.size > 4) {
			const oldest = this.analyses.keys().next().value;
			if (oldest === undefined) break;
			this.analyses.delete(oldest);
		}
		return analysis;
	}

	private openImportCache(): Promise<ImportCache | null> {
		this.importCache ??= ImportCache.open(resolve(this.dataDir, "cache", "imports.json"));
		return this.importCache;
	}
}

/** The range has new commits since the page loaded its model (HTTP 409 `range-moved`). */
export class RangeMovedError extends Error {
	constructor(rangeId: string, shownHead: string | null, currentHead: string) {
		super(
			shownHead
				? `range "${rangeId}" has moved on: the page shows ${shownHead.slice(0, 10)}, the range is at ${currentHead.slice(0, 10)}`
				: `the file has changed in range "${rangeId}" (now at ${currentHead.slice(0, 10)}) since the page loaded it`,
		);
		this.name = "RangeMovedError";
	}
}
