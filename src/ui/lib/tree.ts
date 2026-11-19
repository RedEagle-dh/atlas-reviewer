/** The directory tree of the sidebar's "Ordner" tab: chains of single directories collapse. */
import type { ChangedFile } from "../../core/types";

export interface DirNode {
	/** Name below the parent, collapsed chains joined (`src/modules/plugins`). */
	name: string;
	/** Full directory path; `""` for the root. */
	dir: string;
	dirs: DirNode[];
	files: ChangedFile[];
	/** Every file below. */
	count: number;
}

export function buildDirTree(files: readonly ChangedFile[]): DirNode {
	const root: DirNode = { name: "", dir: "", dirs: [], files: [], count: 0 };
	const index = new Map<string, DirNode>([["", root]]);
	for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
		const segments = file.path.split("/");
		segments.pop();
		let node = root;
		let dir = "";
		for (const segment of segments) {
			dir = dir === "" ? segment : `${dir}/${segment}`;
			let next = index.get(dir);
			if (!next) {
				next = { name: segment, dir, dirs: [], files: [], count: 0 };
				index.set(dir, next);
				node.dirs.push(next);
			}
			node = next;
		}
		node.files.push(file);
	}
	const collapse = (node: DirNode): DirNode => {
		node.dirs = node.dirs.map(collapse).sort((a, b) => (a.name < b.name ? -1 : 1));
		node.count = node.files.length + node.dirs.reduce((n, d) => n + d.count, 0);
		const [only] = node.dirs;
		if (node.dir !== "" && node.files.length === 0 && node.dirs.length === 1 && only)
			return { ...only, name: `${node.name}/${only.name}` };
		return node;
	};
	return collapse(root);
}
