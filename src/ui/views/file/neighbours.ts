/**
 * The file page's "Zusammenhang": what the file imports (one entry per target file, its import
 * statements merged) and what imports it, each split into changed files of the review, changed
 * files left out of it, and unchanged files; npm packages and unresolved specifiers apart.
 */
import type { ChangedFile, FileView, ImportKind } from "../../../core/types";

/**
 * Strongest first, as in core's `KIND_ORDER` (src/core/graph.ts): a target with a value import is
 * a value neighbour. A copy on purpose: the UI imports only types from core, so nothing of core's
 * code reaches the browser bundle; keep the two in step.
 */
const STRENGTH = {
	value: 0,
	"re-export": 1,
	dynamic: 2,
	"side-effect": 3,
	type: 4,
} satisfies Record<ImportKind, number>;

export function strongest(a: ImportKind, b: ImportKind): ImportKind {
	return STRENGTH[a] <= STRENGTH[b] ? a : b;
}

export interface Neighbour {
	path: string;
	where: "review" | "excluded" | "unchanged";
	category: string;
	kind: ImportKind;
	names: string[];
	/** Imports: the line of the first statement in THIS file. Importers: the line in the importer. */
	line: number;
	/** The changed file, when it is part of the review. */
	file?: ChangedFile;
}

export interface Side {
	changed: Neighbour[];
	excluded: Neighbour[];
	unchanged: Neighbour[];
}

export interface PackageUse {
	name: string;
	kind: ImportKind;
	names: string[];
	line: number;
}

export interface Neighbours {
	imports: Side;
	importers: Side;
	packages: PackageUse[];
	unresolved: { specifier: string; line: number }[];
}

function union(a: readonly string[], b: readonly string[]): string[] {
	return [...new Set([...a, ...b])];
}

function split(list: Neighbour[]): Side {
	const byPath = (a: Neighbour, b: Neighbour) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
	return {
		changed: list.filter((n) => n.where === "review").sort(byPath),
		excluded: list.filter((n) => n.where === "excluded").sort(byPath),
		unchanged: list.filter((n) => n.where === "unchanged").sort(byPath),
	};
}

export function neighboursOf(view: FileView, files: ReadonlyMap<string, ChangedFile>): Neighbours {
	const targets = new Map<string, Neighbour>();
	const packages = new Map<string, PackageUse>();
	const unresolved: Neighbours["unresolved"] = [];
	for (const ref of view.imports) {
		if (
			ref.target !== null &&
			(ref.where === "review" || ref.where === "excluded" || ref.where === "unchanged")
		) {
			if (ref.target === view.path) continue;
			const known = targets.get(ref.target);
			if (known) {
				known.kind = strongest(known.kind, ref.kind);
				known.names = union(known.names, ref.names);
				continue;
			}
			const file = files.get(ref.target);
			targets.set(ref.target, {
				path: ref.target,
				where: ref.where,
				category: ref.category ?? file?.category ?? "",
				kind: ref.kind,
				names: [...ref.names],
				line: ref.line,
				...(file && ref.where === "review" ? { file } : {}),
			});
		} else if (ref.where === "external" && ref.package) {
			const known = packages.get(ref.package);
			if (known) {
				known.kind = strongest(known.kind, ref.kind);
				known.names = union(known.names, ref.names);
			} else
				packages.set(ref.package, {
					name: ref.package,
					kind: ref.kind,
					names: [...ref.names],
					line: ref.line,
				});
		} else if (ref.where === "unresolved") {
			unresolved.push({ specifier: ref.specifier, line: ref.line });
		}
	}
	const importers: Neighbour[] = view.importers
		.filter((ref) => ref.path !== view.path)
		.map((ref) => {
			const file = files.get(ref.path);
			return {
				path: ref.path,
				where: ref.where,
				category: ref.category,
				kind: ref.kind,
				names: ref.names,
				line: ref.line,
				...(file && ref.where === "review" ? { file } : {}),
			};
		});
	return {
		imports: split([...targets.values()]),
		importers: split(importers),
		packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)),
		unresolved,
	};
}

/** Every import statement line that resolves into the repository, with its target (for the code view's links). */
export function importLinks(view: FileView): Map<number, string[]> {
	const links = new Map<number, string[]>();
	for (const ref of view.imports) {
		if (ref.target === null || ref.target === view.path) continue;
		const list = links.get(ref.line);
		if (list) {
			if (!list.includes(ref.target)) list.push(ref.target);
		} else links.set(ref.line, [ref.target]);
	}
	return links;
}
