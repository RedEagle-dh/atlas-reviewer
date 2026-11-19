/**
 * The group tree of the map: the levels one drills through.
 *
 * - Grouping "chapters": root → chapters (reading order) → directories below the chapter's
 *   common prefix → files.
 * - Grouping "dirs" ("Pakete & Ordner"): root → units (package directories) → directories → files.
 *
 * Two simplifications keep the levels meaningful: a chain of directories that each hold only one
 * directory collapses into one node (`src/modules/plugins`), and a directory that holds a single
 * file is not a group of its own: the file stands at the parent's level. A chapter or unit whose
 * only content is one directory absorbs it, which gives the chapter's common prefix.
 *
 * Group ids are what the URL carries (`#/map/<id>`): a chapter is its chapter id and a directory
 * inside it `<chapter id>/<repo dir>`; a unit is its directory and a directory inside it the repo
 * directory. `locateGroup` maps any id (also one of a collapsed directory) to the group that shows
 * it.
 */
import type { ChangedFile, FileStatus } from "../../../core/types";
import type { Grouping } from "../../router";

export interface ChapterInfo {
	id: string;
	title: string;
	summary?: string;
	/** 1-based place in the reading order. */
	index: number;
}

export interface Group {
	id: string;
	kind: "root" | "chapter" | "unit" | "dir";
	/** A chapter's title, a unit's directory, or the (collapsed) directory name below the parent. */
	label: string;
	/** The deepest repository directory the group stands for; `""` = the repository root. */
	dir: string;
	parent: Group | null;
	/** 0 for the root. */
	depth: number;
	/** Sub-groups, by directory. */
	groups: Group[];
	/** Files that stand directly at this level, by path. */
	files: ChangedFile[];
	/** Every file below, by path. */
	all: ChangedFile[];
	chapter?: ChapterInfo;
}

export interface GroupTree {
	grouping: Grouping;
	root: Group;
	byId: ReadonlyMap<string, Group>;
	/** The group a file stands in directly (its parent on the map). */
	parentOf: ReadonlyMap<string, Group>;
}

/** The unit id of files at the repository root. */
export const ROOT_UNIT = ".";

// ---------------------------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------------------------

interface Trie {
	name: string;
	dir: string;
	subdirs: Map<string, Trie>;
	files: ChangedFile[];
}

function trieOf(files: readonly ChangedFile[], base: string): Trie {
	const root: Trie = { name: "", dir: base, subdirs: new Map(), files: [] };
	for (const file of files) {
		const rel = base === "" ? file.path : file.path.slice(base.length + 1);
		const segments = rel.split("/");
		segments.pop();
		let node = root;
		for (const segment of segments) {
			let next = node.subdirs.get(segment);
			if (!next) {
				const dir = node.dir === "" ? segment : `${node.dir}/${segment}`;
				next = { name: segment, dir, subdirs: new Map(), files: [] };
				node.subdirs.set(segment, next);
			}
			node = next;
		}
		node.files.push(file);
	}
	return root;
}

const byPath = (a: ChangedFile, b: ChangedFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const byDir = (a: Group, b: Group) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0);

function newGroup(
	kind: Group["kind"],
	id: string,
	label: string,
	dir: string,
	groups: Group[],
	files: ChangedFile[],
): Group {
	return {
		id,
		kind,
		label,
		dir,
		parent: null,
		depth: 0,
		groups: groups.sort(byDir),
		files: files.sort(byPath),
		all: [],
	};
}

type Converted = { group: Group } | { file: ChangedFile };

/** A directory of the trie as a group, a collapsed group, or the single file it holds. */
function convert(node: Trie, idOf: (dir: string) => string): Converted {
	const groups: Group[] = [];
	const files = [...node.files];
	for (const sub of node.subdirs.values()) {
		const child = convert(sub, idOf);
		if ("file" in child) files.push(child.file);
		else groups.push(child.group);
	}
	const [onlyGroup] = groups;
	if (files.length === 0 && groups.length === 1 && onlyGroup) {
		onlyGroup.label = `${node.name}/${onlyGroup.label}`;
		return { group: onlyGroup };
	}
	const [onlyFile] = files;
	if (files.length === 1 && groups.length === 0 && onlyFile) return { file: onlyFile };
	return { group: newGroup("dir", idOf(node.dir), node.name, node.dir, groups, files) };
}

/** A chapter or unit: the trie's content, absorbing a single directory. */
function topGroup(
	kind: "chapter" | "unit",
	id: string,
	label: string,
	trie: Trie,
	idOf: (dir: string) => string,
): Group {
	let groups: Group[] = [];
	let files = [...trie.files];
	let dir = trie.dir;
	for (const sub of trie.subdirs.values()) {
		const child = convert(sub, idOf);
		if ("file" in child) files.push(child.file);
		else groups.push(child.group);
	}
	for (let only = groups[0]; files.length === 0 && groups.length === 1 && only; only = groups[0]) {
		dir = only.dir;
		files = only.files;
		groups = only.groups;
	}
	return newGroup(kind, id, label, dir, groups, files);
}

function finish(
	group: Group,
	parent: Group | null,
	byId: Map<string, Group>,
	parentOf: Map<string, Group>,
): ChangedFile[] {
	group.parent = parent;
	group.depth = parent ? parent.depth + 1 : 0;
	byId.set(group.id, group);
	const all = [...group.files];
	for (const file of group.files) parentOf.set(file.path, group);
	for (const child of group.groups) all.push(...finish(child, group, byId, parentOf));
	group.all = all.sort(byPath);
	return group.all;
}

export function buildGroupTree(
	files: readonly ChangedFile[],
	grouping: Grouping,
	chapters: readonly { id: string; title: string; summary?: string }[],
): GroupTree {
	const tops: Group[] = [];
	if (grouping === "chapters") {
		chapters.forEach((chapter, i) => {
			const members = files.filter((f) => f.chapter === chapter.id);
			if (members.length === 0) return;
			const group = topGroup(
				"chapter",
				chapter.id,
				chapter.title,
				trieOf(members, ""),
				(dir) => `${chapter.id}/${dir}`,
			);
			group.chapter = { id: chapter.id, title: chapter.title, index: i + 1 };
			if (chapter.summary !== undefined) group.chapter.summary = chapter.summary;
			tops.push(group);
		});
	} else {
		const units = [...new Set(files.map((f) => f.unit))].sort((a, b) =>
			a === ROOT_UNIT ? 1 : b === ROOT_UNIT ? -1 : a < b ? -1 : a > b ? 1 : 0,
		);
		for (const unit of units) {
			const members = files.filter((f) => f.unit === unit);
			const base = unit === ROOT_UNIT ? "" : unit;
			tops.push(topGroup("unit", unit, unit, trieOf(members, base), (dir) => dir));
		}
	}
	const root: Group = {
		id: "",
		kind: "root",
		label: "",
		dir: "",
		parent: null,
		depth: 0,
		groups: tops,
		files: [],
		all: [],
	};
	const byId = new Map<string, Group>();
	const parentOf = new Map<string, Group>();
	finish(root, null, byId, parentOf);
	return { grouping, root, byId, parentOf };
}

// ---------------------------------------------------------------------------------------------
// Finding groups
// ---------------------------------------------------------------------------------------------

/** Root first, the group last. */
export function trail(group: Group): Group[] {
	const list: Group[] = [];
	for (let g: Group | null = group; g; g = g.parent) list.push(g);
	return list.reverse();
}

function isWithin(path: string, dir: string): boolean {
	return dir === "" || path === dir || path.startsWith(`${dir}/`);
}

/** Follows `dir` down from `group` as far as groups show it (a collapsed chain shows each of its directories). */
function descend(group: Group, dir: string): Group {
	let current = group;
	for (;;) {
		const below = dir !== current.dir && isWithin(dir, current.dir);
		const next = current.groups.find(
			(g) => isWithin(dir, g.dir) || (below && isWithin(g.dir, dir)),
		);
		if (!next) return current;
		current = next;
	}
}

/** The group a URL id stands for: exact, else the deepest group that shows it, else the root. */
export function locateGroup(tree: GroupTree, id: string): Group {
	if (id === "") return tree.root;
	const exact = tree.byId.get(id);
	if (exact) return exact;
	if (tree.grouping === "chapters") {
		const slash = id.indexOf("/");
		const top = tree.root.groups.find((g) => g.id === (slash === -1 ? id : id.slice(0, slash)));
		if (!top) return tree.root;
		return slash === -1 ? top : descend(top, id.slice(slash + 1));
	}
	const top = tree.root.groups
		.filter((g) => g.id !== ROOT_UNIT && isWithin(id, g.id))
		.sort((a, b) => b.id.length - a.id.length)[0];
	return top ? descend(top, id) : tree.root;
}

/** The group a file stands in, or the root when the file is not in the tree. */
export function groupOfFile(tree: GroupTree, path: string): Group {
	return tree.parentOf.get(path) ?? tree.root;
}

// ---------------------------------------------------------------------------------------------
// Numbers a group node shows
// ---------------------------------------------------------------------------------------------

export interface GroupStats {
	files: number;
	added: number;
	deleted: number;
	status: Record<FileStatus, number>;
}

export function groupStats(group: Group): GroupStats {
	const stats: GroupStats = {
		files: group.all.length,
		added: 0,
		deleted: 0,
		status: { added: 0, modified: 0, deleted: 0, renamed: 0 },
	};
	for (const file of group.all) {
		stats.added += file.added;
		stats.deleted += file.deleted;
		stats.status[file.status]++;
	}
	return stats;
}
