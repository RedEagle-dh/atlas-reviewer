/**
 * What changed between two commits: one `--name-status`, one `--numstat` and ONE full patch,
 * parsed into change blocks per file.
 */
import { runGit } from "./source";
import type { FileStatus } from "./types";

/** A run of removed base lines followed by a run of added head lines (either may be empty). */
export interface DiffBlock {
	/** 1-based head line where the block begins; for `count: 0` the deletion lies BEFORE it. */
	start: number;
	count: number;
	/** 1-based base line of the first removed line. */
	baseStart: number;
	baseCount: number;
}

export interface DiffEntry {
	/** Head path (base path for a deleted file). */
	path: string;
	oldPath?: string;
	status: FileStatus;
	added: number;
	deleted: number;
	binary: boolean;
	blocks: DiffBlock[];
}

const DIFF_FLAGS = ["-M", "--no-color", "--no-ext-diff", "--no-textconv", "--no-relative"];

const emptyTrees = new Map<string, Promise<string>>();

/** The id of the empty tree in this repository's hash (SHA-1 or SHA-256); nothing is written. */
function emptyTree(repo: string): Promise<string> {
	let id = emptyTrees.get(repo);
	if (!id) {
		id = runGit(repo, ["hash-object", "-t", "tree", "--stdin"], new Uint8Array(0)).then((out) =>
			new TextDecoder().decode(out).trim(),
		);
		emptyTrees.set(repo, id);
		id.catch(() => emptyTrees.delete(repo));
	}
	return id;
}

/**
 * Git options that make "binary" a property of the content, as in the file view: no attributes
 * from the working tree's `.gitattributes` (git reads them from there even when it diffs two
 * commits) and none from the user's attributes file. Otherwise a text file marked `-diff` (e.g.
 * drizzle's snapshots) comes out as binary with no lines, and would even be classified as an asset.
 * `--attr-source` needs git 2.40 or newer.
 */
async function contentOnly(repo: string): Promise<string[]> {
	return [`--attr-source=${await emptyTree(repo)}`, "-c", "core.attributesFile=/dev/null"];
}

/** Every changed file between `base` and `head` (commit shas), in git's order. */
export async function diffCommits(repo: string, base: string, head: string): Promise<DiffEntry[]> {
	const decoder = new TextDecoder();
	const git = [...(await contentOnly(repo)), "diff", ...DIFF_FLAGS];
	const [nameStatus, numstat, patch] = await Promise.all([
		runGit(repo, [...git, "-z", "--name-status", base, head]),
		runGit(repo, [...git, "-z", "--numstat", base, head]),
		runGit(repo, [...git, "-U0", "--src-prefix=a/", "--dst-prefix=b/", base, head]),
	]);
	return combineDiff(
		parseNameStatus(decoder.decode(nameStatus)),
		parseNumstat(decoder.decode(numstat)),
		parsePatch(decoder.decode(patch)),
	);
}

export interface NameStatusEntry {
	status: FileStatus;
	path: string;
	oldPath?: string;
}

/** Parses `git diff --name-status -z`. */
export function parseNameStatus(raw: string): NameStatusEntry[] {
	const tokens = raw.split("\0");
	const out: NameStatusEntry[] = [];
	let i = 0;
	while (i < tokens.length) {
		const code = tokens[i++];
		if (!code) continue;
		const letter = code[0];
		if (letter === "R" || letter === "C") {
			const oldPath = tokens[i++] ?? "";
			const path = tokens[i++] ?? "";
			// A copy (only with -C) is a new file as far as the review is concerned.
			if (letter === "R") out.push({ status: "renamed", path, oldPath });
			else out.push({ status: "added", path });
			continue;
		}
		const path = tokens[i++] ?? "";
		const status: FileStatus = letter === "A" ? "added" : letter === "D" ? "deleted" : "modified"; // M, T (type change)
		out.push({ status, path });
	}
	return out;
}

export interface NumstatEntry {
	path: string;
	oldPath?: string;
	added: number;
	deleted: number;
	binary: boolean;
}

/** Parses `git diff --numstat -z` (a rename is `a\td\t\0old\0new\0`). */
export function parseNumstat(raw: string): NumstatEntry[] {
	const tokens = raw.split("\0");
	const out: NumstatEntry[] = [];
	let i = 0;
	while (i < tokens.length) {
		const record = tokens[i++];
		if (!record) continue;
		// Only the first two tabs separate fields: with -z the path is raw and may hold a tab.
		const first = record.indexOf("\t");
		const second = record.indexOf("\t", first + 1);
		if (first < 0 || second < 0) continue;
		const added = record.slice(0, first);
		const deleted = record.slice(first + 1, second);
		const path = record.slice(second + 1);
		const binary = added === "-" && deleted === "-";
		const counts = {
			added: binary ? 0 : Number(added),
			deleted: binary ? 0 : Number(deleted),
			binary,
		};
		if (path === "") {
			const oldPath = tokens[i++] ?? "";
			const newPath = tokens[i++] ?? "";
			out.push({ path: newPath, oldPath, ...counts });
		} else {
			out.push({ path, ...counts });
		}
	}
	return out;
}

export interface PatchSection {
	/** Head path, or base path for a deletion. */
	path: string;
	binary: boolean;
	blocks: DiffBlock[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parses a `git diff -U0` patch into sections keyed by path, merging repeated sections. */
export function parsePatch(raw: string): Map<string, PatchSection> {
	const sections = new Map<string, PatchSection>();
	const lines = raw.split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		if (!line.startsWith("diff --git ")) {
			i++;
			continue;
		}
		const header = line;
		i++;
		let minus: string | null | undefined;
		let plus: string | null | undefined;
		let renameTo: string | undefined;
		let renameFrom: string | undefined;
		let binary = false;
		const blocks: DiffBlock[] = [];
		while (i < lines.length) {
			const current = lines[i] ?? "";
			if (current.startsWith("diff --git ")) break;
			if (current.startsWith("@@ ")) {
				i = parseHunk(lines, i, blocks);
				continue;
			}
			if (current.startsWith("--- ")) minus = headerPath(current.slice(4), "a/");
			else if (current.startsWith("+++ ")) plus = headerPath(current.slice(4), "b/");
			else if (current.startsWith("rename from ")) renameFrom = unquote(current.slice(12));
			else if (current.startsWith("rename to ")) renameTo = unquote(current.slice(10));
			else if (current.startsWith("Binary files ") || current === "GIT binary patch") binary = true;
			i++;
		}
		const path = renameTo ?? plus ?? minus ?? renameFrom ?? pathFromDiffHeader(header);
		if (path === null) continue;
		const existing = sections.get(path);
		if (existing) {
			existing.binary ||= binary;
			existing.blocks.push(...blocks);
		} else {
			sections.set(path, { path, binary, blocks });
		}
	}
	return sections;
}

/** Reads one hunk starting at `lines[start]`; returns the index after it. */
function parseHunk(lines: string[], start: number, blocks: DiffBlock[]): number {
	const match = HUNK_HEADER.exec(lines[start] ?? "");
	if (!match) return start + 1;
	const oldStart = Number(match[1]);
	const oldCount = match[2] === undefined ? 1 : Number(match[2]);
	const newStart = Number(match[3]);
	const newCount = match[4] === undefined ? 1 : Number(match[4]);
	// With a count of 0 the number names the line BEFORE the change.
	let oldLine = oldCount === 0 ? oldStart + 1 : oldStart;
	let newLine = newCount === 0 ? newStart + 1 : newStart;
	let oldLeft = oldCount;
	let newLeft = newCount;
	let block: DiffBlock | null = null;
	let i = start + 1;
	while (i < lines.length && (oldLeft > 0 || newLeft > 0 || lines[i]?.startsWith("\\"))) {
		const line = lines[i] ?? "";
		const sign = line[0];
		if (sign === "\\") {
			// "\ No newline at end of file" belongs to the line before it.
		} else if (sign === "-") {
			if (block && block.count > 0) block = null;
			if (!block) {
				block = { start: newLine, count: 0, baseStart: oldLine, baseCount: 0 };
				blocks.push(block);
			}
			block.baseCount++;
			oldLine++;
			oldLeft--;
		} else if (sign === "+") {
			if (!block) {
				block = { start: newLine, count: 0, baseStart: oldLine, baseCount: 0 };
				blocks.push(block);
			}
			block.count++;
			newLine++;
			newLeft--;
		} else if (sign === " ") {
			block = null;
			oldLine++;
			newLine++;
			oldLeft--;
			newLeft--;
		} else {
			break;
		}
		i++;
	}
	return i;
}

/** `a/path`, `"a/quoted\tpath"` or `/dev/null` (→ null), with git's trailing tab removed. */
function headerPath(raw: string, prefix: string): string | null {
	const text = raw.endsWith("\t") ? raw.slice(0, -1) : raw;
	if (text === "/dev/null") return null;
	const path = unquote(text);
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * The path of a section without `---`/`+++` lines (empty or binary file, mode change). Without a
 * rename both sides are the same path: `diff --git a/P b/P`.
 */
function pathFromDiffHeader(header: string): string | null {
	const rest = header.slice("diff --git ".length);
	if (rest.startsWith('"')) {
		const [first] = readQuoted(rest);
		return first.startsWith("a/") ? first.slice(2) : null;
	}
	const half = (rest.length - 5) / 2;
	if (!Number.isInteger(half) || half <= 0) return null;
	const path = rest.slice(2, 2 + half);
	return rest === `a/${path} b/${path}` ? path : null;
}

/** Undoes git's C-style quoting of a path (`"tab\there"`, octal escapes for raw bytes). */
export function unquote(text: string): string {
	if (!text.startsWith('"')) return text;
	return readQuoted(text)[0];
}

const ESCAPES: Record<string, number> = {
	a: 7,
	b: 8,
	t: 9,
	n: 10,
	v: 11,
	f: 12,
	r: 13,
	'"': 34,
	"\\": 92,
};

/** Reads one quoted string at the start of `text`; returns it and the rest after it. */
function readQuoted(text: string): [string, string] {
	const bytes: number[] = [];
	const encoder = new TextEncoder();
	let i = 1;
	while (i < text.length) {
		const c = text[i] ?? "";
		if (c === '"') {
			i++;
			break;
		}
		if (c === "\\") {
			const next = text[i + 1] ?? "";
			if (/[0-7]/.test(next)) {
				bytes.push(Number.parseInt(text.slice(i + 1, i + 4), 8));
				i += 4;
				continue;
			}
			bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
			i += 2;
			continue;
		}
		bytes.push(...encoder.encode(c));
		i++;
	}
	return [new TextDecoder().decode(new Uint8Array(bytes)), text.slice(i)];
}

/**
 * Joins the three outputs; name-status is the authority on which files changed. The counts of a
 * text file are the sums of its blocks, so the header and the marked lines always agree: git's
 * `--numstat` aligns some files one line differently from its `-U0` patch.
 */
export function combineDiff(
	nameStatus: NameStatusEntry[],
	numstat: NumstatEntry[],
	patch: Map<string, PatchSection>,
): DiffEntry[] {
	const counts = new Map(numstat.map((n) => [n.path, n]));
	return nameStatus.map((entry) => {
		const count = counts.get(entry.path);
		const section = patch.get(entry.path);
		const binary = (count?.binary ?? false) || (section?.binary ?? false);
		const blocks = binary ? [] : (section?.blocks ?? []);
		const fromBlocks = !binary && section !== undefined;
		const out: DiffEntry = {
			path: entry.path,
			status: entry.status,
			added: fromBlocks ? blocks.reduce((n, b) => n + b.count, 0) : (count?.added ?? 0),
			deleted: fromBlocks ? blocks.reduce((n, b) => n + b.baseCount, 0) : (count?.deleted ?? 0),
			binary,
			blocks,
		};
		if (entry.oldPath !== undefined) out.oldPath = entry.oldPath;
		return out;
	});
}
