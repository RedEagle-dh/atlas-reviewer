import { describe, expect, test } from "bun:test";
import { combineDiff, parseNameStatus, parseNumstat, parsePatch, unquote } from "./diff";

/**
 * Real `git diff -M -U0 --src-prefix=a/ --dst-prefix=b/` output (captured with git 2.x and
 * `--no-index` on two directories, the directory prefix removed): hunk headers carry function
 * context, a path with a space ends in a tab, a path with a tab is C-quoted, an empty file and
 * a pure rename have no `---`/`+++` lines.
 */
const PATCH = [
	"diff --git a/add.ts b/add.ts",
	"new file mode 100644",
	"index 00000000..9d8f9d4a",
	"--- /dev/null",
	"+++ b/add.ts",
	"@@ -0,0 +1,2 @@",
	"+fresh",
	"+file",
	"diff --git a/bin.dat b/bin.dat",
	"index d5d0b8b4..4a270318 100644",
	"Binary files a/bin.dat and b/bin.dat differ",
	"diff --git a/del.ts b/del.ts",
	"deleted file mode 100644",
	"index 6eeb8d89..00000000",
	"--- a/del.ts",
	"+++ /dev/null",
	"@@ -1,2 +0,0 @@",
	"-gone",
	"-forever",
	"diff --git a/empty.ts b/empty.ts",
	"new file mode 100644",
	"index 00000000..e69de29b",
	"diff --git a/mod.ts b/mod.ts",
	"index b2f931a6..96420083 100644",
	"--- a/mod.ts",
	"+++ b/mod.ts",
	"@@ -2 +2 @@ one",
	"-two",
	"+TWO",
	"@@ -5,0 +6 @@ five",
	"+six",
	"diff --git a/same.ts b/moved.ts",
	"similarity index 100%",
	"rename from same.ts",
	"rename to moved.ts",
	"diff --git a/old-name.ts b/new-name.ts",
	"similarity index 90%",
	"rename from old-name.ts",
	"rename to new-name.ts",
	"index 691dd366..a59e144f 100644",
	"--- a/old-name.ts",
	"+++ b/new-name.ts",
	"@@ -9 +9 @@ r8",
	"-r9",
	"+R9",
	"diff --git a/nonl.ts b/nonl.ts",
	"index 0a207c06..817f660e 100644",
	"--- a/nonl.ts",
	"+++ b/nonl.ts",
	"@@ -2 +2 @@ a",
	"-b",
	"\\ No newline at end of file",
	"+c",
	"\\ No newline at end of file",
	'diff --git "a/tab\\tname.ts" "b/tab\\tname.ts"',
	"index 587be6b4..975fbec8 100644",
	'--- "a/tab\\tname.ts"',
	'+++ "b/tab\\tname.ts"',
	"@@ -1 +1 @@",
	"-x",
	"+y",
	"diff --git a/with space.ts b/with space.ts",
	"index 2fa992c0..fe5841d9 100644",
	"--- a/with space.ts\t",
	"+++ b/with space.ts\t",
	"@@ -1,0 +2 @@ keep",
	"+more",
	"diff --git a/ümlaut.ts b/ümlaut.ts",
	"index 8be8316c..d3b4b915 100644",
	"--- a/ümlaut.ts",
	"+++ b/ümlaut.ts",
	"@@ -1 +1 @@",
	"-ä",
	"+ö",
	"",
].join("\n");

const NAME_STATUS = [
	"A",
	"add.ts",
	"M",
	"bin.dat",
	"D",
	"del.ts",
	"A",
	"empty.ts",
	"M",
	"mod.ts",
	"R100",
	"same.ts",
	"moved.ts",
	"R090",
	"old-name.ts",
	"new-name.ts",
	"M",
	"nonl.ts",
	"M",
	"tab\tname.ts",
	"M",
	"with space.ts",
	"M",
	"ümlaut.ts",
	"",
].join("\0");

const NUMSTAT = [
	"2\t0\tadd.ts",
	"-\t-\tbin.dat",
	"0\t2\tdel.ts",
	"0\t0\tempty.ts",
	"2\t1\tmod.ts",
	"0\t0\t",
	"same.ts",
	"moved.ts",
	"1\t1\t",
	"old-name.ts",
	"new-name.ts",
	"1\t1\tnonl.ts",
	"1\t1\ttab\tname.ts",
	"1\t0\twith space.ts",
	"1\t1\tümlaut.ts",
	"",
].join("\0");

describe("parseNameStatus", () => {
	test("reads every status; a rename carries its old path", () => {
		const entries = parseNameStatus(NAME_STATUS);
		expect(entries).toHaveLength(11);
		expect(entries[0]).toEqual({ status: "added", path: "add.ts" });
		expect(entries[2]).toEqual({ status: "deleted", path: "del.ts" });
		expect(entries[4]).toEqual({ status: "modified", path: "mod.ts" });
		expect(entries[5]).toEqual({ status: "renamed", path: "moved.ts", oldPath: "same.ts" });
		expect(entries[6]).toEqual({ status: "renamed", path: "new-name.ts", oldPath: "old-name.ts" });
	});

	test("paths with a tab, a space or non-ASCII come through unchanged (-z)", () => {
		const paths = parseNameStatus(NAME_STATUS).map((e) => e.path);
		expect(paths).toContain("tab\tname.ts");
		expect(paths).toContain("with space.ts");
		expect(paths).toContain("ümlaut.ts");
	});

	test("a type change counts as modified, a copy as added", () => {
		expect(parseNameStatus("T\0link\0C075\0a.ts\0b.ts\0")).toEqual([
			{ status: "modified", path: "link" },
			{ status: "added", path: "b.ts" },
		]);
	});

	test("empty output is no change", () => {
		expect(parseNameStatus("")).toEqual([]);
	});
});

describe("parseNumstat", () => {
	test("counts lines; a binary file has no counts", () => {
		const byPath = new Map(parseNumstat(NUMSTAT).map((e) => [e.path, e]));
		expect(byPath.get("mod.ts")).toEqual({ path: "mod.ts", added: 2, deleted: 1, binary: false });
		expect(byPath.get("bin.dat")).toEqual({ path: "bin.dat", added: 0, deleted: 0, binary: true });
		expect(byPath.get("tab\tname.ts")?.added).toBe(1);
	});

	test("a rename is keyed by its new path", () => {
		const byPath = new Map(parseNumstat(NUMSTAT).map((e) => [e.path, e]));
		expect(byPath.get("moved.ts")).toEqual({
			path: "moved.ts",
			oldPath: "same.ts",
			added: 0,
			deleted: 0,
			binary: false,
		});
		expect(byPath.get("new-name.ts")?.oldPath).toBe("old-name.ts");
	});
});

describe("parsePatch", () => {
	const sections = parsePatch(PATCH);

	test("an added file is one block of head lines, nothing removed", () => {
		expect(sections.get("add.ts")?.blocks).toEqual([
			{ start: 1, count: 2, baseStart: 1, baseCount: 0 },
		]);
	});

	test("a deleted file is one block of removed base lines, keyed by its base path", () => {
		expect(sections.get("del.ts")?.blocks).toEqual([
			{ start: 1, count: 0, baseStart: 1, baseCount: 2 },
		]);
	});

	test("a modification gives one block per hunk; an insertion has no base lines", () => {
		expect(sections.get("mod.ts")?.blocks).toEqual([
			{ start: 2, count: 1, baseStart: 2, baseCount: 1 },
			{ start: 6, count: 1, baseStart: 6, baseCount: 0 },
		]);
	});

	test("a rename without content change has a section without blocks", () => {
		expect(sections.get("moved.ts")).toEqual({ path: "moved.ts", binary: false, blocks: [] });
		expect(sections.has("same.ts")).toBe(false);
	});

	test("a rename with a change is keyed by the new path", () => {
		expect(sections.get("new-name.ts")?.blocks).toEqual([
			{ start: 9, count: 1, baseStart: 9, baseCount: 1 },
		]);
	});

	test("a binary file is marked and has no blocks", () => {
		expect(sections.get("bin.dat")).toEqual({ path: "bin.dat", binary: true, blocks: [] });
	});

	test("an empty added file has a section (path from the `diff --git` line)", () => {
		expect(sections.get("empty.ts")).toEqual({ path: "empty.ts", binary: false, blocks: [] });
	});

	test("`\\ No newline at end of file` neither counts nor ends the hunk early", () => {
		expect(sections.get("nonl.ts")?.blocks).toEqual([
			{ start: 2, count: 1, baseStart: 2, baseCount: 1 },
		]);
	});

	test("a path with a space loses git's trailing tab; a quoted path is unquoted", () => {
		expect(sections.get("with space.ts")?.blocks).toEqual([
			{ start: 2, count: 1, baseStart: 2, baseCount: 0 },
		]);
		expect(sections.get("tab\tname.ts")?.blocks).toHaveLength(1);
		expect(sections.get("ümlaut.ts")?.blocks).toHaveLength(1);
	});

	test("a pure deletion inside a file lies before the head line after it", () => {
		const patch = [
			"diff --git a/x b/x",
			"--- a/x",
			"+++ b/x",
			"@@ -3,2 +2,0 @@",
			"-c",
			"-d",
			"",
		].join("\n");
		expect(parsePatch(patch).get("x")?.blocks).toEqual([
			{ start: 3, count: 0, baseStart: 3, baseCount: 2 },
		]);
	});

	test("removed lines that look like headers are content, not headers", () => {
		const patch = [
			"diff --git a/x b/x",
			"--- a/x",
			"+++ b/x",
			"@@ -1,2 +1 @@",
			"--- not a header",
			"-diff --git a/y b/y",
			"+kept",
			"",
		].join("\n");
		const parsed = parsePatch(patch);
		expect([...parsed.keys()]).toEqual(["x"]);
		expect(parsed.get("x")?.blocks).toEqual([{ start: 1, count: 1, baseStart: 1, baseCount: 2 }]);
	});

	test("a hunk with mixed runs splits into removal-then-addition blocks", () => {
		const patch = [
			"diff --git a/x b/x",
			"--- a/x",
			"+++ b/x",
			"@@ -1,3 +1,3 @@",
			"-a",
			"+A",
			"-b",
			"+B",
			"",
		].join("\n");
		expect(parsePatch(patch).get("x")?.blocks).toEqual([
			{ start: 1, count: 1, baseStart: 1, baseCount: 1 },
			{ start: 2, count: 1, baseStart: 2, baseCount: 1 },
		]);
	});
});

describe("combineDiff", () => {
	const entries = combineDiff(
		parseNameStatus(NAME_STATUS),
		parseNumstat(NUMSTAT),
		parsePatch(PATCH),
	);
	const byPath = new Map(entries.map((e) => [e.path, e]));

	test("one entry per name-status entry, in its order", () => {
		expect(entries.map((e) => e.path)).toEqual(parseNameStatus(NAME_STATUS).map((e) => e.path));
	});

	test("joins counts and blocks by path", () => {
		expect(byPath.get("mod.ts")).toMatchObject({
			status: "modified",
			added: 2,
			deleted: 1,
			binary: false,
		});
		expect(byPath.get("mod.ts")?.blocks).toHaveLength(2);
		expect(byPath.get("new-name.ts")).toMatchObject({
			status: "renamed",
			oldPath: "old-name.ts",
			added: 1,
			deleted: 1,
		});
		expect(byPath.get("moved.ts")).toMatchObject({
			status: "renamed",
			oldPath: "same.ts",
			added: 0,
			blocks: [],
		});
	});

	test("a binary file has no blocks; an empty file has no counts", () => {
		expect(byPath.get("bin.dat")).toMatchObject({ binary: true, blocks: [] });
		expect(byPath.get("empty.ts")).toMatchObject({
			status: "added",
			added: 0,
			deleted: 0,
			blocks: [],
		});
	});

	test("a text file's counts are the sums of its blocks, even where --numstat aligns differently", () => {
		// Seen with git 2.43: numstat said +415 −37 for a file whose -U0 patch marks +414 −36.
		const [entry] = combineDiff(
			[{ status: "modified", path: "router.ts" }],
			[{ path: "router.ts", added: 3, deleted: 2, binary: false }],
			parsePatch(
				[
					"diff --git a/router.ts b/router.ts",
					"--- a/router.ts",
					"+++ b/router.ts",
					"@@ -4 +4,2 @@",
					"-a",
					"+b",
					"+c",
				].join("\n"),
			),
		);
		expect(entry).toMatchObject({ added: 2, deleted: 1 });
	});
});

describe("unquote", () => {
	test("leaves an unquoted path alone", () => {
		expect(unquote("a b.ts")).toBe("a b.ts");
	});

	test("undoes C escapes and octal UTF-8 bytes", () => {
		expect(unquote('"a\\tb\\"c\\\\d"')).toBe('a\tb"c\\d');
		expect(unquote('"\\303\\274.ts"')).toBe("ü.ts");
	});
});
