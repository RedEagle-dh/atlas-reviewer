import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createCommentStore,
	InvalidCommentError,
	MAX_COMMENT_SNIPPET,
	MAX_COMMENT_TEXT,
	type NewComment,
	readCommentDraft,
	readCommentEdit,
} from "./comments";

const dir = await mkdtemp(join(tmpdir(), "review-atlas-comments-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

const HEAD = "a".repeat(40);
const on = (path: string, text: string, place: Partial<NewComment> = {}): NewComment => ({
	path,
	text,
	range: "r",
	head: HEAD,
	...place,
});
const onDisk = async (file: string): Promise<unknown> => JSON.parse(await Bun.file(file).text());

describe("readCommentDraft", () => {
	test("keeps what a draft says, trims the text and drops unknown fields", () => {
		expect(
			readCommentDraft({
				path: "src/a.ts",
				line: 4,
				endLine: 6,
				snippet: "\tconst a = 1;\n",
				text: "  why?\n",
				range: "r",
				head: HEAD,
				id: "mine",
				createdAt: "then",
			}),
		).toEqual({
			path: "src/a.ts",
			line: 4,
			endLine: 6,
			snippet: "\tconst a = 1;\n",
			text: "why?",
			range: "r",
			head: HEAD,
		});
		expect(readCommentDraft({ path: "a.ts", text: "x" })).toEqual({ path: "a.ts", text: "x" });
	});

	test("one stored form: no `endLine` on `line`, no snippet of a whole file", () => {
		expect(readCommentDraft({ path: "a.ts", line: 3, endLine: 3, text: "x" })).toEqual({
			path: "a.ts",
			line: 3,
			text: "x",
		});
		expect(readCommentDraft({ path: "a.ts", snippet: "const a = 1;", text: "x" })).toEqual({
			path: "a.ts",
			text: "x",
		});
	});

	test("says which field breaks a rule", () => {
		const problem = (draft: unknown): string => {
			try {
				readCommentDraft(draft);
			} catch (error) {
				if (error instanceof InvalidCommentError) return error.message;
				throw error;
			}
			return "accepted";
		};
		const ok = { path: "a.ts", text: "x" };
		for (const body of [null, "text", 3, [ok]])
			expect(problem(body)).toBe("a comment must be a JSON object");
		for (const path of [undefined, "", 3, null])
			expect(problem({ ...ok, path })).toBe("`path` must be a non-empty string");
		for (const line of [0, -1, 1.5, "3", null, Number.NaN, 2 ** 60])
			expect(problem({ ...ok, line })).toBe("`line` must be a positive integer");
		for (const endLine of [0, 2.5, "9", null])
			expect(problem({ ...ok, line: 2, endLine })).toBe("`endLine` must be a positive integer");
		expect(problem({ ...ok, endLine: 4 })).toBe("`endLine` needs `line`");
		expect(problem({ ...ok, line: 5, endLine: 4 })).toBe("`endLine` must not be before `line`");
		for (const text of [undefined, 3, null, ["x"]])
			expect(problem({ ...ok, text })).toBe("`text` must be a string");
		for (const text of ["", " \n\t "])
			expect(problem({ ...ok, text })).toBe("`text` must not be empty");
		expect(problem({ ...ok, text: "x".repeat(MAX_COMMENT_TEXT + 1) })).toBe(
			"`text` must be at most 10000 characters",
		);
		expect(problem({ ...ok, line: 1, snippet: 3 })).toBe("`snippet` must be a string");
		expect(problem({ ...ok, line: 1, snippet: "x".repeat(MAX_COMMENT_SNIPPET + 1) })).toBe(
			"`snippet` must be at most 8000 characters",
		);
		expect(problem({ ...ok, range: 3 })).toBe("`range` must be a string");
		// An empty `head` (or `base`) is no commit: "none" is said by leaving the field out.
		for (const commit of [3, null, ["f00"], ""]) {
			expect(problem({ ...ok, head: commit })).toBe("`head` must be a non-empty string");
			expect(problem({ ...ok, base: commit })).toBe("`base` must be a non-empty string");
		}
	});

	test("the limits are inclusive, and the text is measured after trimming", () => {
		const draft = readCommentDraft({
			path: "a.ts",
			line: 1,
			snippet: "s".repeat(MAX_COMMENT_SNIPPET),
			text: `  ${"x".repeat(MAX_COMMENT_TEXT)}  `,
		});
		expect(draft.text).toHaveLength(MAX_COMMENT_TEXT);
		expect(draft.snippet).toHaveLength(MAX_COMMENT_SNIPPET);
	});
});

describe("readCommentEdit", () => {
	test("the new text, under the rules of a draft's text", () => {
		expect(readCommentEdit({ text: " better ", path: "ignored" })).toEqual({ text: "better" });
		expect(() => readCommentEdit({ text: "  " })).toThrow("`text` must not be empty");
		expect(() => readCommentEdit({})).toThrow("`text` must be a string");
		expect(() => readCommentEdit("text")).toThrow(InvalidCommentError);
	});
});

describe("createCommentStore", () => {
	test("starts empty when there is no file, and writes none for a change that changes nothing", async () => {
		const file = join(dir, "none", "x.comments.json");
		const store = createCommentStore(file);
		expect(await store.list()).toEqual({ comments: [] });
		expect(await store.remove("nope")).toEqual({ comments: [] });
		expect(await store.clear()).toEqual({ comments: [] });
		expect(await store.edit("nope", "text")).toBeNull();
		expect(await Bun.file(file).exists()).toBe(false);
	});

	test("keeps comments in the order they were written, with an id and timestamps of its own", async () => {
		const file = join(dir, "order", "review.comments.json");
		const store = createCommentStore(file);
		const before = Date.now();
		await store.add(on("src/b.ts", "second file first", { line: 9, endLine: 12, snippet: "b" }));
		await store.add(on("src/a.ts", "whole file"));
		const { comments } = await store.add(on("src/a.ts", "a line", { line: 2 }));
		expect(comments.map((c) => c.text)).toEqual(["second file first", "whole file", "a line"]);
		expect(new Set(comments.map((c) => c.id)).size).toBe(3);
		for (const comment of comments) {
			expect(comment.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
			expect(comment.updatedAt).toBe(comment.createdAt);
			expect(new Date(comment.createdAt).toISOString()).toBe(comment.createdAt);
			expect(Date.parse(comment.createdAt)).toBeGreaterThanOrEqual(before);
		}
		expect(comments[0]).toEqual({
			id: comments[0]?.id ?? "",
			path: "src/b.ts",
			line: 9,
			endLine: 12,
			snippet: "b",
			text: "second file first",
			range: "r",
			head: HEAD,
			createdAt: comments[0]?.createdAt ?? "",
			updatedAt: comments[0]?.createdAt ?? "",
		});
		expect(await onDisk(file)).toEqual({ comments });
	});

	test("another store on the same file reads them back", async () => {
		const file = join(dir, "reopen.comments.json");
		const store = createCommentStore(file);
		await store.add(on("a.ts", "one", { line: 1, snippet: "const a = 1;" }));
		const written = await store.add(on("b.ts", "two"));
		expect(await createCommentStore(file).list()).toEqual(written);
	});

	test("edit changes the text and `updatedAt`, nothing else; the same text again changes nothing", async () => {
		const file = join(dir, "edit.comments.json");
		const store = createCommentStore(file);
		const first = (await store.add(on("a.ts", "frist", { line: 3 }))).comments[0];
		await store.add(on("b.ts", "other"));
		if (!first) throw new Error("no comment");
		await Bun.sleep(5);
		const edited = await store.edit(first.id, "  first\n");
		if (!edited) throw new Error("not edited");
		expect(edited.comments[0]).toEqual({
			...first,
			text: "first",
			updatedAt: edited.comments[0]?.updatedAt ?? "",
		});
		expect(Date.parse(edited.comments[0]?.updatedAt ?? "")).toBeGreaterThan(
			Date.parse(first.createdAt),
		);
		expect(edited.comments.map((c) => c.text)).toEqual(["first", "other"]);
		await Bun.sleep(5);
		expect(await store.edit(first.id, "first")).toEqual(edited);
		expect(await onDisk(file)).toEqual(edited);
		expect(await store.edit("unknown", "x")).toBeNull();
		await expect(store.edit(first.id, "   ")).rejects.toBeInstanceOf(InvalidCommentError);
		expect(await createCommentStore(file).list()).toEqual(edited);
	});

	test("remove takes one out, clear all of them", async () => {
		const file = join(dir, "remove.comments.json");
		const store = createCommentStore(file);
		await store.add(on("a.ts", "one"));
		await store.add(on("a.ts", "two"));
		const { comments } = await store.add(on("a.ts", "three"));
		const removed = await store.remove(comments[1]?.id ?? "");
		expect(removed.comments.map((c) => c.text)).toEqual(["one", "three"]);
		expect(await store.remove(comments[1]?.id ?? "")).toEqual(removed);
		expect(await onDisk(file)).toEqual(removed);
		expect(await store.clear()).toEqual({ comments: [] });
		expect(await onDisk(file)).toEqual({ comments: [] });
		expect(await createCommentStore(file).list()).toEqual({ comments: [] });
	});

	test("writes at the same time all land, in the order they were asked for", async () => {
		const file = join(dir, "burst.comments.json");
		const store = createCommentStore(file);
		// The first list() is still reading the file when the writes come in.
		const [early, ...answers] = await Promise.all([
			store.list(),
			...Array.from({ length: 25 }, (_, i) => store.add(on(`f${i}.ts`, `c${i}`))),
		]);
		expect(early).toEqual({ comments: [] });
		expect(answers.map((a) => a.comments.length)).toEqual(
			Array.from({ length: 25 }, (_, i) => i + 1),
		);
		// Each answer ends with the comment its own request wrote.
		expect(answers.map((a) => a.comments.at(-1)?.text)).toEqual(
			Array.from({ length: 25 }, (_, i) => `c${i}`),
		);
		const reopened = await createCommentStore(file).list();
		expect(reopened.comments.map((c) => c.text)).toEqual(
			Array.from({ length: 25 }, (_, i) => `c${i}`),
		);
		expect(await store.list()).toEqual(reopened);
		// Atomic writes leave no temporary file behind.
		expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
	});

	test("an answer is a copy: changing it does not change the store", async () => {
		const store = createCommentStore(join(dir, "copy.comments.json"));
		const answer = await store.add(on("a.ts", "kept"));
		const first = answer.comments[0];
		if (first) first.text = "changed";
		answer.comments.length = 0;
		expect((await store.list()).comments.map((c) => c.text)).toEqual(["kept"]);
	});

	test("an unreadable file counts as empty and is kept aside: the next write does not destroy it", async () => {
		const said = console.error;
		const lines: string[] = [];
		console.error = (line: string) => lines.push(line);
		try {
			for (const [name, content] of [
				["broken", "{ not json"],
				["null", "null"],
				["list", "[]"],
				["shape", '{ "comments": { "a": 1 } }'],
				["empty", ""],
			] as const) {
				const own = join(dir, `unreadable-${name}`);
				const file = join(own, "x.comments.json");
				await Bun.write(file, content);
				const store = createCommentStore(file);
				expect(await store.list()).toEqual({ comments: [] });
				const written = await store.add(on("a.ts", "fresh"));
				expect(await onDisk(file)).toEqual(written);
				// What was there is still there, under another name, and it was said once.
				const aside = (await readdir(own)).filter((entry) => entry.includes(".unreadable-"));
				expect(aside).toHaveLength(1);
				expect(await Bun.file(join(own, aside[0] ?? "")).text()).toBe(content);
			}
			expect(lines).toHaveLength(5);
		} finally {
			console.error = said;
		}
	});

	test("a hand-edited file: the entries that break a rule are left out, the others stay", async () => {
		const file = join(dir, "edited.comments.json");
		const good = {
			id: "one",
			path: "src/a.ts",
			line: 3,
			text: "kept",
			range: "r",
			head: HEAD,
			createdAt: "2026-01-01T10:00:00.000Z",
			updatedAt: "2026-01-01T10:00:00.000Z",
		};
		await Bun.write(
			file,
			JSON.stringify({
				comments: [
					good,
					null,
					"text",
					{ ...good, id: "no-path", path: "" },
					{ ...good, id: "bad-line", line: 0 },
					{ ...good, id: "bad-end", endLine: 2 },
					{ ...good, id: "empty", text: "   " },
					{ ...good, id: "long", text: "x".repeat(MAX_COMMENT_TEXT + 1) },
					{ ...good, id: "snippet", snippet: "s".repeat(MAX_COMMENT_SNIPPET + 1) },
					{ ...good, id: 7 },
					{ ...good, id: "no-head", head: undefined },
					{ ...good, id: "no-date", createdAt: 5 },
					{ ...good, id: "bad-date", createdAt: "yesterday" },
					{ ...good, id: "bad-update", updatedAt: "2026-13-45T10:00:00.000Z" },
					// The same id again: an id names one comment.
					{ ...good, text: "a second one" },
					// Brought into the stored form rather than refused.
					{ ...good, id: "two", endLine: 3, text: "  tidy  ", extra: true },
					// A date written another way: the same instant, as the store writes it.
					{ ...good, id: "three", createdAt: "2026-01-01T12:30:00+02:00", updatedAt: "2026-01-02" },
				],
			}),
		);
		const store = createCommentStore(file);
		expect(await store.list()).toEqual({
			comments: [
				good,
				{ ...good, id: "two", text: "tidy" },
				{
					...good,
					id: "three",
					createdAt: "2026-01-01T10:30:00.000Z",
					updatedAt: "2026-01-02T00:00:00.000Z",
				},
			],
		});
		// Still usable after such a file.
		expect((await store.edit("two", "edited"))?.comments.map((c) => c.text)).toEqual([
			"kept",
			"edited",
			"kept",
		]);
	});

	test("refuses what it would not read back", async () => {
		const file = join(dir, "limits.comments.json");
		const store = createCommentStore(file);
		const refused = [
			on("a.ts", "x".repeat(MAX_COMMENT_TEXT + 1)),
			on("a.ts", "  "),
			on("", "x"),
			on("a.ts", "x", { line: 0 }),
			on("a.ts", "x", { line: 4, endLine: 2 }),
			on("a.ts", "x", { line: 1, snippet: "s".repeat(MAX_COMMENT_SNIPPET + 1) }),
			on("a.ts", "x", { head: "" }),
		];
		for (const comment of refused)
			await expect(store.add(comment)).rejects.toBeInstanceOf(InvalidCommentError);
		expect(await Bun.file(file).exists()).toBe(false);
		// A refused write does not stop the ones after it.
		const { comments } = await store.add(
			on("a.ts", "x".repeat(MAX_COMMENT_TEXT), {
				line: 1,
				snippet: "s".repeat(MAX_COMMENT_SNIPPET),
			}),
		);
		expect(comments).toHaveLength(1);
		expect(await onDisk(file)).toEqual({ comments });
	});

	test("a write that fails changes nothing, and the writes after it go on", async () => {
		const file = join(dir, "blocked", "x.comments.json");
		const store = createCommentStore(file);
		const first = await store.add(on("a.ts", "written"));
		// A directory where the store puts its temporary file: nothing can be written there.
		const tmp = `${file}.${process.pid}.tmp`;
		await mkdir(tmp);
		await expect(store.add(on("a.ts", "lost"))).rejects.toThrow();
		await expect(store.edit(first.comments[0]?.id ?? "", "lost too")).rejects.toThrow();
		await expect(store.clear()).rejects.toThrow();
		// The file is the list: it still holds what the last write that worked put there.
		expect(await store.list()).toEqual(first);
		expect(await onDisk(file)).toEqual(first);
		await rm(tmp, { recursive: true });
		const second = await store.add(on("a.ts", "written again"));
		expect(second.comments.map((c) => c.text)).toEqual(["written", "written again"]);
		expect(await onDisk(file)).toEqual(second);
	});

	test("two stores on one file (two servers of one review) do not write over each other", async () => {
		const file = join(dir, "two", "x.comments.json");
		const one = createCommentStore(file);
		const two = createCommentStore(file);
		// Both have looked at the (empty) file before either writes.
		expect((await one.list()).comments).toEqual([]);
		expect((await two.list()).comments).toEqual([]);
		await one.add(on("a.ts", "from one"));
		const after = await two.add(on("b.ts", "from two"));
		expect(after.comments.map((c) => c.text)).toEqual(["from one", "from two"]);
		expect((await one.list()).comments.map((c) => c.text)).toEqual(["from one", "from two"]);
		const id = after.comments[0]?.id ?? "";
		expect((await two.remove(id)).comments.map((c) => c.text)).toEqual(["from two"]);
		expect((await one.list()).comments.map((c) => c.text)).toEqual(["from two"]);
	});
});
