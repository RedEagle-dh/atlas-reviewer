/**
 * What `check` gives only as counts: every changed file of a review's range with its chapter and
 * category, in reading order, the left-out ones last; then the imports that run against the
 * reading order (a file of an earlier chapter importing one of a later chapter).
 *
 *   bun <this file> <atlas dir> <review-file> [<range id>]
 *
 * The review-atlas checkout is an argument, not a path relative to this file: an installed skill
 * is a copy somewhere else (`skills add` puts it into `~/.agents/skills/`).
 *
 * Reaches into review-atlas's core (`buildRange`), outside its type check and tests: when it
 * breaks after a change to the tool, `check` still works.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const [atlasArg, file, range] = process.argv.slice(2);
if (!atlasArg || !file) {
	console.error("usage: bun files.ts <atlas dir> <review-file> [<range id>]");
	process.exit(2);
}
const atlas = resolve(atlasArg);
if (!existsSync(join(atlas, "bin/review-atlas.ts"))) {
	console.error(`${atlas} is no review-atlas checkout (no bin/review-atlas.ts)`);
	process.exit(2);
}
const fail = (error: unknown): never => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
};
const { buildRange } = await import(join(atlas, "src/core/build.ts"));
const { loadReview, REST_CHAPTER_ID } = await import(join(atlas, "src/core/define.ts"));

interface File {
	path: string;
	chapter: string;
	category: string;
}
interface Edge {
	from: string;
	to: string;
	kind: string;
}

const review = await loadReview(file).catch(fail);
const build = await buildRange(review, range).catch(fail);
const files: File[] = build.model.files;
const edges: Edge[] = build.model.edges;
const readingOrder: string[] = build.model.readingOrder;
const excluded: string[] = [...build.excludedPaths].sort();

const byPath = new Map(files.map((f) => [f.path, f]));
console.log("files in reading order: chapter, category, path");
for (const path of readingOrder) {
	const f = byPath.get(path);
	if (f) console.log(`${f.chapter}\t${f.category}\t${f.path}`);
}
for (const path of excluded) {
	const entry = build.diff.get(path);
	console.log(`(left out)\t${entry ? build.classifier.classify(entry) : "?"}\t${path}`);
}

const order: string[] = [...review.chapters.map((c: { id: string }) => c.id), REST_CHAPTER_ID];
const chapterOf = (path: string) => byPath.get(path)?.chapter ?? REST_CHAPTER_ID;
const against = new Map<string, { count: number; types: number; example: string }>();
for (const edge of edges) {
	const from = chapterOf(edge.from);
	const to = chapterOf(edge.to);
	if (order.indexOf(from) >= order.indexOf(to)) continue;
	const key = `${from} imports ${to}`;
	const entry = against.get(key) ?? { count: 0, types: 0, example: `${edge.from} → ${edge.to}` };
	entry.count++;
	if (edge.kind === "type") entry.types++;
	against.set(key, entry);
}
console.log("");
console.log(`imports against the reading order: ${against.size === 0 ? "none" : ""}`);
for (const [key, { count, types, example }] of against)
	console.log(`  ${key}: ${count} file pair(s)${types ? `, ${types} type-only` : ""} (e.g. ${example})`);
