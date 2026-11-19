/**
 * The three layers: `core` imports neither `server` nor `ui`; `ui` takes only TYPES from `core`
 * and nothing from `server`, and of the packages only the four the browser needs, so nothing of
 * git, the filesystem, shiki or the TypeScript compiler reaches the browser bundle. Checked with
 * the tool's own extractor.
 */
import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { typescriptExtractor } from "./core/imports/extract";
import { splitPackageSpecifier } from "./core/imports/resolve";

const SRC = import.meta.dir;

/** The packages the UI may import (its runtime dependencies in the browser). */
const UI_PACKAGES = new Set(["react", "react-dom", "@xyflow/react", "@dagrejs/dagre"]);

async function sources(dir: string): Promise<string[]> {
	const entries = await readdir(join(SRC, dir), { recursive: true });
	return entries
		.filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))
		.map((p) => join(dir, p));
}

interface Found {
	/** `core`, `ui`, … for a relative import; null for a package or builtin. */
	layer: string | null;
	/** The package (`react`, `node:fs`, `bun`) for a bare specifier. */
	package: string | null;
	kind: string;
	line: number;
	specifier: string;
}

async function importsOf(file: string): Promise<Found[]> {
	const code = await Bun.file(join(SRC, file)).text();
	return typescriptExtractor.extract(file, code).map((i) => {
		const common = { kind: i.kind, line: i.line, specifier: i.specifier };
		if (i.specifier.startsWith(".")) {
			const target = relative(SRC, resolve(SRC, dirname(file), i.specifier));
			return { ...common, layer: target.split("/")[0] ?? "", package: null };
		}
		const builtin = /^[a-z]+:/i.test(i.specifier);
		const name = builtin ? i.specifier : splitPackageSpecifier(i.specifier)[0];
		return { ...common, layer: null, package: name };
	});
}

describe("layers", () => {
	test("core imports nothing from server or ui", async () => {
		const offending: string[] = [];
		for (const file of await sources("core"))
			for (const i of await importsOf(file))
				if (i.layer === "server" || i.layer === "ui")
					offending.push(`${file}:${i.line} ${i.specifier}`);
		expect(offending).toEqual([]);
	});

	test("ui imports only types from core, nothing from server", async () => {
		const offending: string[] = [];
		for (const file of await sources("ui"))
			for (const i of await importsOf(file))
				if (i.layer === "server" || (i.layer === "core" && i.kind !== "type"))
					offending.push(`${file}:${i.line} ${i.kind} ${i.specifier}`);
		expect(offending).toEqual([]);
	});

	test("ui imports no builtin and no package but the browser's four (types excepted)", async () => {
		const offending: string[] = [];
		for (const file of await sources("ui"))
			for (const i of await importsOf(file))
				if (i.package !== null && i.kind !== "type" && !UI_PACKAGES.has(i.package))
					offending.push(`${file}:${i.line} ${i.specifier}`);
		expect(offending).toEqual([]);
	});
});
