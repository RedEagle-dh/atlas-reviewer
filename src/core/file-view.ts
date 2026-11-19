/**
 * The file page's data: any file of the head commit (or a deleted file of the base commit),
 * highlighted, with its change blocks, its imports and who imports it.
 */
import { type RangeBuild, sourceOf, targetOf } from "./build";
import { mergeStatements } from "./graph";
import type { Highlighted, Highlighter } from "./highlight";
import type { ResolvedImport } from "./imports/analyze";
import { DEFAULT_EXTRACTORS, type Extractor, extractorFor } from "./imports/extract";
import type { ChangeBlock, FileView, ImporterRef, ImportRef, TokenLine } from "./types";

/** Above either limit a file is returned as plain text, cut to the limits, `truncated: true`. */
export const MAX_HIGHLIGHT_BYTES = 1_500_000;
export const MAX_HIGHLIGHT_LINES = 20_000;

/** Promises by key, kept in memory; the least recently used goes first. */
export class LruCache<T> {
	private readonly entries = new Map<string, Promise<T>>();

	constructor(private readonly limit = 200) {}

	get(key: string, make: () => Promise<T>): Promise<T> {
		const hit = this.entries.get(key);
		if (hit) {
			this.entries.delete(key);
			this.entries.set(key, hit);
			return hit;
		}
		const value = make();
		this.entries.set(key, value);
		value.catch(() => this.entries.delete(key));
		while (this.entries.size > this.limit) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
		return value;
	}
}

/** A blob read and highlighted; cached by blob sha. */
export interface Content {
	highlighted: Highlighted;
	truncated: boolean;
	binary: boolean;
	size: number;
}

export interface FileViewContext {
	highlighter: Highlighter;
	cache: LruCache<Content>;
	extractors?: readonly Extractor[];
}

/** Git's heuristic: a NUL byte in the first 8000 bytes means binary. */
export function looksBinary(bytes: Uint8Array): boolean {
	const end = Math.min(bytes.length, 8000);
	for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
	return false;
}

/**
 * Binary is decided by the content, the same heuristic the diff uses (git's, with attributes
 * ignored), so a text file that `.gitattributes` marks `-diff` still shows its lines.
 */
async function readContent(
	source: RangeBuild["head"],
	path: string,
	context: FileViewContext,
): Promise<Content> {
	const entry = source.entry(path);
	const language = context.highlighter.languageFor(path);
	const key = `${entry?.blob ?? path}:${language}`;
	return context.cache.get(key, async () => {
		const size = entry?.size ?? 0;
		const bytes = await source.read(path);
		const binary = looksBinary(bytes);
		if (binary) {
			const empty = await context.highlighter.highlight("", null);
			return { highlighted: { lines: [], palette: empty.palette }, truncated: false, binary, size };
		}
		let text = new TextDecoder().decode(bytes);
		let truncated = false;
		if (bytes.length > MAX_HIGHLIGHT_BYTES) {
			text = text.slice(0, MAX_HIGHLIGHT_BYTES);
			truncated = true;
		}
		const lines = text.split("\n");
		if (lines.length > MAX_HIGHLIGHT_LINES + 1) {
			text = lines.slice(0, MAX_HIGHLIGHT_LINES).join("\n");
			truncated = true;
		}
		const highlighted = await context.highlighter.highlight(text, truncated ? null : language);
		return { highlighted, truncated, binary, size };
	});
}

/** Joins the base palette into the head palette and re-indexes the base lines' tokens. */
function mergePalettes(
	head: Highlighted["palette"],
	base: Highlighted["palette"],
): { palette: Highlighted["palette"]; map: number[] } {
	const palette = [...head];
	const index = new Map(head.map(([l, d], i) => [`${l}|${d}`, i]));
	const map = base.map(([l, d]) => {
		const key = `${l}|${d}`;
		let i = index.get(key);
		if (i === undefined) {
			i = palette.length;
			palette.push([l, d]);
			index.set(key, i);
		}
		return i;
	});
	return { palette, map };
}

function remap(lines: TokenLine[], map: number[]): TokenLine[] {
	return lines.map((line) =>
		line.map(([text, colour, style]) =>
			style === undefined ? [text, map[colour] ?? 0] : [text, map[colour] ?? 0, style],
		),
	);
}

/** `null` when `path` is no file of the head commit and no deleted file of the base commit. */
export async function buildFileView(
	build: RangeBuild,
	path: string,
	context: FileViewContext,
): Promise<FileView | null> {
	const source = sourceOf(build, path);
	if (!source) return null;
	const entry = build.diff.get(path);

	const content = await readContent(source, path, context);
	let { palette } = content.highlighted;
	const { lines } = content.highlighted;
	const changes: ChangeBlock[] = [];
	if (entry && !content.binary) {
		if (entry.status === "added" || entry.status === "deleted") {
			if (lines.length > 0) changes.push({ start: 1, count: lines.length, removed: [] });
		} else if (entry.blocks.length > 0) {
			const basePath = entry.oldPath ?? path;
			const base = build.base.has(basePath)
				? await readContent(build.base, basePath, context)
				: undefined;
			const merged = base ? mergePalettes(palette, base.highlighted.palette) : { palette, map: [] };
			palette = merged.palette;
			for (const block of entry.blocks) {
				if (block.start > lines.length + 1) continue; // beyond a truncated file
				const removed = base
					? remap(
							base.highlighted.lines.slice(
								block.baseStart - 1,
								block.baseStart - 1 + block.baseCount,
							),
							merged.map,
						)
					: [];
				// A truncated file ends early: a block never reaches past its last line.
				const count = Math.min(block.count, lines.length - block.start + 1);
				changes.push({ start: block.start, count: Math.max(0, count), removed });
			}
			changes.sort((a, b) => a.start - b.start);
		}
	}

	const view: FileView = {
		path,
		status: entry?.status ?? "unchanged",
		category: build.classifier.classify({ path, binary: content.binary }),
		language: context.highlighter.languageFor(path),
		size: content.size,
		binary: content.binary,
		truncated: content.truncated,
		lines,
		palette,
		changes,
		importsRead: extractorFor(context.extractors ?? DEFAULT_EXTRACTORS, path) !== undefined,
		// A deleted file's relations come from the base commit (`RangeBuild.relations`).
		imports: build.relations.imports(path).map((i) => importRef(build, i)),
		importers: importersOf(build, path),
	};
	if (entry?.oldPath !== undefined) view.oldPath = entry.oldPath;
	return view;
}

function whereOf(build: RangeBuild, path: string): "review" | "excluded" | "unchanged" {
	if (build.reviewPaths.has(path)) return "review";
	if (build.excludedPaths.has(path)) return "excluded";
	return "unchanged";
}

/** The category of a repo path: a deleted one is classified as the diff saw it. */
function categoryOf(build: RangeBuild, path: string): string {
	return build.classifier.classify({ path, binary: build.diff.get(path)?.binary ?? false });
}

function importRef(build: RangeBuild, item: ResolvedImport): ImportRef {
	const base = { line: item.line, specifier: item.specifier, kind: item.kind, names: item.names };
	const r = item.resolution;
	const target = targetOf(item);
	if (target !== null)
		return {
			...base,
			target,
			category: categoryOf(build, target),
			where: whereOf(build, target),
		};
	if (r.kind === "external")
		return { ...base, target: null, where: "external", package: r.package };
	return { ...base, target: null, where: "unresolved" };
}

function importersOf(build: RangeBuild, path: string): ImporterRef[] {
	const byFile = new Map<string, ResolvedImport[]>();
	for (const importer of build.relations.importers(path)) {
		const list = byFile.get(importer.from);
		if (list) list.push(importer.import);
		else byFile.set(importer.from, [importer.import]);
	}
	return [...byFile.keys()].sort().map((from) => {
		const merged = mergeStatements(byFile.get(from) ?? []);
		return {
			path: from,
			where: whereOf(build, from),
			category: categoryOf(build, from),
			kind: merged.kind,
			names: merged.names,
			line: merged.line,
		};
	});
}
