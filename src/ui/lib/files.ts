/**
 * Small, pure facts about changed files that several views need: names, the viewed mark, the
 * size of a change, the visible subset.
 */
import type { ChangedFile, ReviewModel } from "../../core/types";

export function baseName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

/** Directory of a path, `""` for a root file. */
export function dirName(path: string): string {
	const i = path.lastIndexOf("/");
	return i === -1 ? "" : path.slice(0, i);
}

/** The blob a file is viewed at: head, or base for a deleted file. */
export function viewedKey(file: ChangedFile): string | null {
	return file.blob ?? file.baseBlob;
}

export type ViewedMark = "viewed" | "stale" | "none";

/** `stale`: viewed once, but the file changed since (another blob is recorded). */
export function viewedMark(
	file: ChangedFile,
	viewed: Readonly<Record<string, string>>,
): ViewedMark {
	const recorded = viewed[file.path];
	if (recorded === undefined) return "none";
	return recorded === viewedKey(file) ? "viewed" : "stale";
}

export function countViewed(
	files: readonly ChangedFile[],
	viewed: Readonly<Record<string, string>>,
): number {
	let n = 0;
	for (const file of files) if (viewedMark(file, viewed) === "viewed") n++;
	return n;
}

/**
 * Width of a "size of change" bar, 0..1, on a log scale so a 3-line fix stays visible next to a
 * 1 600-line new file.
 */
export function changeScale(lines: number): number {
	if (lines <= 0) return 0;
	return Math.min(1, Math.log10(lines + 1) / Math.log10(2001));
}

/** Files of the visible categories, in the model's order (by path). */
export function visibleFiles(model: ReviewModel, categories: ReadonlySet<string>): ChangedFile[] {
	return model.files.filter((f) => categories.has(f.category));
}

/** The visible files in reading order. */
export function readingList(model: ReviewModel, visible: readonly ChangedFile[]): ChangedFile[] {
	const byPath = new Map(visible.map((f) => [f.path, f]));
	const list: ChangedFile[] = [];
	for (const path of model.readingOrder) {
		const file = byPath.get(path);
		if (file) list.push(file);
	}
	return list;
}

/** How many files per category (all files of the model, visible or not). */
export function categoryCounts(model: ReviewModel): Map<string, number> {
	const counts = new Map<string, number>();
	for (const f of model.files) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
	return counts;
}

/**
 * A path for a box that cuts from the left (`direction: rtl` + ellipsis): left-to-right marks
 * around it keep a trailing `/` where it belongs.
 */
export function ltr(text: string): string {
	return text === "" ? "" : `\u200e${text}\u200e`;
}

export function shortSha(sha: string): string {
	return sha.slice(0, 10);
}
