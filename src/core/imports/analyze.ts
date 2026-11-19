/**
 * The whole repository at one commit, parsed once: every file an extractor accepts, its imports
 * resolved. Extraction results are cached on disk by blob sha, so a second start skips parsing.
 */
import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { type RepoSource, readBlobs } from "../source";
import type { ImportKind } from "../types";
import { DEFAULT_EXTRACTORS, type Extractor, extractorFor, type RawImport } from "./extract";
import {
	createResolve,
	DEFAULT_RESOLVERS,
	loadRepoFiles,
	type RepoFiles,
	type Resolution,
	type Resolve,
	type ResolverFactory,
} from "./resolve";

export interface ResolvedImport extends RawImport {
	resolution: Resolution;
}

export interface Importer {
	from: string;
	import: ResolvedImport;
}

export interface RepoImports {
	sha: string;
	files: RepoFiles;
	resolve: Resolve;
	/** Path → its import statements, resolved, in source order. */
	imports: Map<string, ResolvedImport[]>;
	/** Repo path → every statement of another file that resolves to it. */
	importers: Map<string, Importer[]>;
	stats: AnalyzeStats;
}

export interface AnalyzeStats {
	/** Files an extractor accepted. */
	files: number;
	/** Of those, parsed now / taken from the disk cache / skipped for size. */
	parsed: number;
	cached: number;
	skipped: number;
	imports: number;
	ms: { configs: number; extract: number; resolve: number };
}

export interface AnalyzeOptions {
	extractors?: readonly Extractor[];
	resolvers?: readonly ResolverFactory[];
	/** `null` disables the disk cache (reads and writes). */
	cache?: ImportCache | null;
}

/** Larger files (bundles, generated data) are not parsed. */
export const MAX_PARSE_BYTES = 1_500_000;
const SYMLINK_MODE = "120000";

export async function analyzeRepo(
	source: RepoSource,
	options: AnalyzeOptions = {},
): Promise<RepoImports> {
	const extractors = options.extractors ?? DEFAULT_EXTRACTORS;
	const cache = options.cache ?? null;
	const t0 = performance.now();
	const files = await loadRepoFiles(source);
	const resolve = createResolve(files, options.resolvers ?? DEFAULT_RESOLVERS);
	const t1 = performance.now();

	const raw = new Map<string, RawImport[]>();
	const todo = new Map<string, { path: string; extractor: Extractor }[]>();
	const stats: AnalyzeStats = {
		files: 0,
		parsed: 0,
		cached: 0,
		skipped: 0,
		imports: 0,
		ms: { configs: Math.round(t1 - t0), extract: 0, resolve: 0 },
	};
	for (const path of source.paths()) {
		const entry = source.entry(path);
		const extractor = extractorFor(extractors, path);
		if (!entry || !extractor || entry.mode === SYMLINK_MODE) continue;
		stats.files++;
		if (entry.size > MAX_PARSE_BYTES) {
			stats.skipped++;
			raw.set(path, []);
			continue;
		}
		const hit = cache?.get(cacheKey(extractor, entry.blob, path));
		if (hit) {
			stats.cached++;
			raw.set(path, hit);
			continue;
		}
		const list = todo.get(entry.blob);
		if (list) list.push({ path, extractor });
		else todo.set(entry.blob, [{ path, extractor }]);
	}

	const decoder = new TextDecoder();
	await readBlobs(source.repo, [...todo.keys()], (blob, bytes) => {
		const code = decoder.decode(bytes);
		for (const { path, extractor } of todo.get(blob) ?? []) {
			let found: RawImport[];
			try {
				found = extractor.extract(path, code);
			} catch {
				found = [];
			}
			raw.set(path, found);
			cache?.set(cacheKey(extractor, blob, path), found);
			stats.parsed++;
		}
	});
	if (cache && stats.parsed > 0) await cache.save();
	const t2 = performance.now();

	const imports = new Map<string, ResolvedImport[]>();
	const importers = new Map<string, Importer[]>();
	for (const [path, list] of raw) {
		const resolved = list.map((item) => ({ ...item, resolution: resolve(item.specifier, path) }));
		imports.set(path, resolved);
		stats.imports += resolved.length;
		for (const item of resolved) {
			if (item.resolution.kind !== "file") continue;
			const target = item.resolution.path;
			const entry = { from: path, import: item };
			const existing = importers.get(target);
			if (existing) existing.push(entry);
			else importers.set(target, [entry]);
		}
	}
	stats.ms.extract = Math.round(t2 - t1);
	stats.ms.resolve = Math.round(performance.now() - t2);
	return { sha: source.sha, files, resolve, imports, importers, stats };
}

/** The extension is part of the key: the same blob parses differently as `.ts` and `.tsx`. */
function cacheKey(extractor: Extractor, blob: string, path: string): string {
	const dot = path.lastIndexOf(".");
	return `${extractor.id}:${dot < 0 ? "" : path.slice(dot + 1)}:${blob}`;
}

const KINDS: ReadonlySet<string> = new Set<ImportKind>([
	"value",
	"re-export",
	"dynamic",
	"side-effect",
	"type",
]);

function isImportKind(value: unknown): value is ImportKind {
	return typeof value === "string" && KINDS.has(value);
}

function toRawImports(value: unknown): RawImport[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: RawImport[] = [];
	for (const item of value) {
		if (!Array.isArray(item)) return undefined;
		const [specifier, line, kind, names] = item;
		if (typeof specifier !== "string" || typeof line !== "number" || !isImportKind(kind))
			return undefined;
		if (!Array.isArray(names) || !names.every((n) => typeof n === "string")) return undefined;
		out.push({ specifier, line, kind, names });
	}
	return out;
}

/**
 * Extraction results by `<extractor id>:<extension>:<blob sha>` in one JSON file. Content
 * addressed, so it is shared by every review and every commit; written atomically.
 */
export class ImportCache {
	private entries = new Map<string, RawImport[]>();
	private dirty = false;
	/** Saves run one after the other (two head commits may be analysed at once). */
	private queue: Promise<void> = Promise.resolve();

	private constructor(private readonly file: string) {}

	static async open(file: string): Promise<ImportCache> {
		const cache = new ImportCache(file);
		try {
			const data: unknown = JSON.parse(await Bun.file(file).text());
			if (typeof data === "object" && data !== null) {
				for (const [key, value] of Object.entries(data)) {
					const list = toRawImports(value);
					if (list) cache.entries.set(key, list);
				}
			}
		} catch {
			// Missing or unreadable: start empty.
		}
		return cache;
	}

	get(key: string): RawImport[] | undefined {
		return this.entries.get(key);
	}

	set(key: string, value: RawImport[]): void {
		this.entries.set(key, value);
		this.dirty = true;
	}

	save(): Promise<void> {
		const run = this.queue.then(() => this.write());
		this.queue = run.catch(() => undefined);
		return run;
	}

	private async write(): Promise<void> {
		if (!this.dirty) return;
		this.dirty = false;
		const data: Record<string, [string, number, ImportKind, string[]][]> = {};
		for (const [key, list] of this.entries)
			data[key] = list.map((i) => [i.specifier, i.line, i.kind, i.names]);
		try {
			await mkdir(dirname(this.file), { recursive: true });
			// A name of its own per write: another process may save the same cache at the same time.
			const tmp = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
			await Bun.write(tmp, JSON.stringify(data));
			await rename(tmp, this.file);
		} catch (error) {
			this.dirty = true;
			throw error;
		}
	}
}
