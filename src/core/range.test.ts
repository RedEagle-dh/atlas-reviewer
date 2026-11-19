/**
 * The whole core on a real repository: a temporary git repository with an added, a modified, a
 * renamed and a deleted file (a deleted workspace package, even), a text file marked `-diff`
 * and generated and documentation files, run through `buildRange`, `buildFileView` and the
 * session. Git runs isolated from the user's configuration (no signing, no hooks).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildRange, type RangeBuild } from "./build";
import { type Review, resolveReview } from "./define";
import { buildFileView, type Content, LruCache } from "./file-view";
import { type Highlighter, plainLines } from "./highlight";
import { RangeMovedError, ReviewSession } from "./session";
import type { FileView } from "./types";

const ISOLATED_GIT = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
let root = "";
let repo = "";

async function git(...args: string[]): Promise<string> {
	const proc = Bun.spawn(
		[
			"git",
			"-c",
			"user.name=atlas",
			"-c",
			"user.email=atlas@example.invalid",
			"-c",
			"commit.gpgsign=false",
			...args,
		],
		{ cwd: repo, stdout: "pipe", stderr: "pipe", env: ISOLATED_GIT },
	);
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${err}`);
	return out.trim();
}

async function write(files: Record<string, string>): Promise<void> {
	for (const [path, text] of Object.entries(files)) {
		await mkdir(dirname(join(repo, path)), { recursive: true });
		await Bun.write(join(repo, path), text);
	}
}

const OLD_BODY = Array.from({ length: 12 }, (_, i) => `export const old${i} = ${i};`).join("\n");

const plain: Highlighter = {
	languageFor: () => null,
	highlight: async (code) => ({ lines: plainLines(code), palette: [["#000000", "#ffffff"]] }),
};

let review: Review;
let build: RangeBuild;
const views = new Map<string, FileView | null>();
const view = async (path: string) => {
	if (!views.has(path))
		views.set(
			path,
			await buildFileView(build, path, { highlighter: plain, cache: new LruCache<Content>() }),
		);
	return views.get(path) ?? null;
};

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "review-atlas-range-"));
	repo = join(root, "repo");
	await mkdir(repo);
	await git("init", "-q", "-b", "main");
	await write({
		"package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
		"packages/lib/package.json": JSON.stringify({
			name: "@t/lib",
			exports: { ".": "./src/index.ts" },
		}),
		"packages/lib/src/index.ts": 'export { util } from "./util";\nexport const lib = 1;\n',
		"packages/lib/src/util.ts":
			'import { shared } from "../../../src/shared";\nexport const util = shared;\n',
		"src/shared.ts": "export const shared = 1;\n",
		"src/a.ts": 'import { lib } from "@t/lib";\nexport const a = lib;\n',
		"src/old.ts": `${OLD_BODY}\n`,
		"src/keep.ts": 'import { old0 } from "./old";\nexport const keep = old0;\n',
		".gitattributes": "data.json -diff\n",
		"data.json": '{\n\t"a": 1,\n\t"b": 2\n}\n',
		"src/gen/x.generated.ts": "export const x = 1;\n",
	});
	await git("add", "-A");
	await git("commit", "-q", "-m", "base");
	await git("rm", "-q", "-r", "packages/lib");
	await git("mv", "src/old.ts", "src/new.ts");
	await write({
		"src/a.ts": "export const a = 2;\n",
		"src/new.ts": `${OLD_BODY}\nexport const added = 12;\n`,
		"src/keep.ts": 'import { old0 } from "./new";\nexport const keep = old0;\n',
		"data.json": '{\n\t"a": 1,\n\t"b": 3\n}\n',
		"src/added.ts": 'import { a } from "./a";\nexport const added = a;\n',
		"src/gen/x.generated.ts": "export const x = 2;\n",
		"docs/testing/GUIDE.md": "# How we test\n",
	});
	await git("add", "-A");
	await git("commit", "-q", "-m", "head");

	review = resolveReview({
		id: "range-test",
		title: "Range test",
		repo,
		ranges: [{ id: "r", label: "R", base: "HEAD~1" }],
		excludeCategories: ["generated", "test"],
	});
	build = await buildRange(review, "r", { cache: null, languageFor: () => null });
});

afterAll(() => rm(root, { recursive: true, force: true }));

const fileOf = (path: string) => build.model.files.find((f) => f.path === path);
const edge = (from: string, to: string) =>
	build.model.edges.find((e) => e.from === from && e.to === to);

describe("the file set", () => {
	test("every status, renames by their new path, generated files left out", () => {
		const statuses = Object.fromEntries(build.model.files.map((f) => [f.path, f.status]));
		expect(statuses).toEqual({
			"data.json": "modified",
			"docs/testing/GUIDE.md": "added",
			"packages/lib/package.json": "deleted",
			"packages/lib/src/index.ts": "deleted",
			"packages/lib/src/util.ts": "deleted",
			"src/a.ts": "modified",
			"src/added.ts": "added",
			"src/keep.ts": "modified",
			"src/new.ts": "renamed",
		});
		expect(fileOf("src/new.ts")?.oldPath).toBe("src/old.ts");
		expect(build.model.excluded).toEqual({ generated: 1 });
		expect(fileOf("docs/testing/GUIDE.md")?.category).toBe("docs");
	});

	test("a deleted file belongs to the package it was in, not to the top-level directory", () => {
		expect(fileOf("packages/lib/src/index.ts")?.unit).toBe("packages/lib");
		expect(fileOf("src/a.ts")?.unit).toBe("src");
	});

	test("a text file marked -diff is text: its changed lines, not binary, not an asset", () => {
		expect(fileOf("data.json")).toMatchObject({ binary: false, added: 1, deleted: 1 });
		expect(fileOf("data.json")?.category).not.toBe("asset");
		expect(build.diff.get("data.json")?.blocks).toEqual([
			{ start: 3, count: 1, baseStart: 3, baseCount: 1 },
		]);
	});
});

describe("relations", () => {
	test("a deleted file's imports resolve against the base commit, so nothing is unresolved", () => {
		expect(build.model.unresolved).toEqual([]);
		// deleted → deleted
		expect(edge("packages/lib/src/index.ts", "packages/lib/src/util.ts")?.kind).toBe("re-export");
	});

	test("the files that imported a deleted file then are connected to it", () => {
		expect(edge("src/a.ts", "packages/lib/src/index.ts")).toMatchObject({
			kind: "value",
			names: ["lib"],
			line: 1,
		});
		// a deleted file's import of an unchanged file counts outside the review
		expect(fileOf("packages/lib/src/util.ts")?.outside).toEqual({ imports: 1, importers: 0 });
	});

	test("head imports connect renamed and added files", () => {
		expect(edge("src/keep.ts", "src/new.ts")).toBeDefined();
		expect(edge("src/added.ts", "src/a.ts")).toBeDefined();
		expect(edge("src/keep.ts", "src/old.ts")).toBeUndefined();
	});

	test("the reading order holds every file once, what a file imports first", () => {
		const order = build.model.readingOrder;
		expect([...order].sort()).toEqual(build.model.files.map((f) => f.path));
		for (const e of build.model.edges)
			expect(order.indexOf(e.to)).toBeLessThan(order.indexOf(e.from));
	});
});

describe("file views", () => {
	test("a deleted file: base content as one block, imports and importers from the base commit", async () => {
		const v = await view("packages/lib/src/index.ts");
		expect(v?.status).toBe("deleted");
		expect(v?.changes).toEqual([{ start: 1, count: 2, removed: [] }]);
		expect(v?.imports).toEqual([
			{
				line: 1,
				specifier: "./util",
				kind: "re-export",
				names: ["util"],
				target: "packages/lib/src/util.ts",
				category: "logic",
				where: "review",
			},
		]);
		expect(v?.importers.map((i) => [i.path, i.where, i.line])).toEqual([["src/a.ts", "review", 1]]);
	});

	test("an unchanged file lists a deleted file that imported it", async () => {
		const v = await view("src/shared.ts");
		expect(v?.status).toBe("unchanged");
		expect(v?.importers.map((i) => i.path)).toEqual(["packages/lib/src/util.ts"]);
		expect((await view("packages/lib/src/util.ts"))?.imports[0]).toMatchObject({
			target: "src/shared.ts",
			where: "unchanged",
		});
	});

	test("a renamed file by its new path; the old path is no file of the range", async () => {
		const v = await view("src/new.ts");
		expect(v).toMatchObject({ status: "renamed", oldPath: "src/old.ts" });
		expect(v?.changes).toEqual([{ start: 13, count: 1, removed: [] }]);
		expect(await view("src/old.ts")).toBeNull();
	});

	test("an added file is one block; a -diff text file shows its lines and what it replaced", async () => {
		expect((await view("src/added.ts"))?.changes).toEqual([{ start: 1, count: 2, removed: [] }]);
		const data = await view("data.json");
		expect(data).toMatchObject({ binary: false, importsRead: false });
		expect(data?.lines).toHaveLength(4);
		expect(data?.changes).toEqual([{ start: 3, count: 1, removed: [[['\t"b": 2', 0]]] }]);
	});
});

describe("session", () => {
	test("a page that shows an older state gets RangeMovedError, not a mix of two states", async () => {
		const session = new ReviewSession(review, {
			dataDir: join(root, "data"),
			importCache: null,
			highlighter: plain,
		});
		const model = await session.model("r");
		const at = { base: model.range.base.sha, head: model.range.head.sha };
		expect((await session.file("r", "src/a.ts", at))?.status).toBe("modified");
		await expect(
			session.file("r", "src/a.ts", { ...at, head: "0".repeat(40) }),
		).rejects.toBeInstanceOf(RangeMovedError);
		const blob = model.files.find((f) => f.path === "src/a.ts")?.blob ?? "";
		expect((await session.setViewed({ path: "src/a.ts", viewed: true, blob }))?.viewed).toEqual({
			"src/a.ts": blob,
		});
		await expect(
			session.setViewed({ path: "src/a.ts", viewed: true, blob: "f".repeat(40) }),
		).rejects.toBeInstanceOf(RangeMovedError);
	});
});
