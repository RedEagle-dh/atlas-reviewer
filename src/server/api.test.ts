/**
 * Review comments end to end on a real repository: a temporary git repository with a modified, a
 * deleted, a renamed and an unchanged file, asked through the session, through the handlers (with
 * plain `Request` objects) and through the running server (routes, methods, body size, what a
 * page of another site may send). Git runs isolated from the user's configuration (no signing,
 * no hooks).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { UnknownRangeError } from "../core/build";
import { MAX_COMMENT_SNIPPET, MAX_COMMENT_TEXT } from "../core/comments";
import { type Review, resolveReview } from "../core/define";
import { type Highlighter, plainLines } from "../core/highlight";
import { RangeMovedError, ReviewSession } from "../core/session";
import type { CommentsState, ReviewComment } from "../core/types";
import { type CommentRequest, createApi, MAX_BODY } from "./api";
import { type RunningServer, startServer } from "./main";

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

const plain: Highlighter = {
	languageFor: () => null,
	highlight: async (code) => ({ lines: plainLines(code), palette: [["#000000", "#ffffff"]] }),
};

let review: Review;
/** The head of range `r` (and of `tagged`) before the last test of "session" moves `r` on. */
let firstHead = "";

/** A session with a data directory of its own, so every group of tests starts without comments. */
const open = (name: string): ReviewSession =>
	new ReviewSession(review, { dataDir: join(root, name), importCache: null, highlighter: plain });
const fileOf = (name: string): string => join(root, name, "comments", "comments-test.json");
const onDisk = async (name: string): Promise<unknown> =>
	JSON.parse(await Bun.file(fileOf(name)).text());

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "review-atlas-comments-api-"));
	repo = join(root, "repo");
	await mkdir(repo);
	await git("init", "-q", "-b", "main");
	await write({
		"src/a.ts": "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n",
		"src/gone.ts": "export const gone = 1;\nexport const too = 2;\n",
		"src/old.ts": Array.from({ length: 12 }, (_, i) => `export const old${i} = ${i};`).join("\n"),
		"src/same.ts": "export const same = 1;\n",
	});
	await git("add", "-A");
	await git("commit", "-q", "-m", "base");
	await git("tag", "base");
	await git("rm", "-q", "src/gone.ts");
	await git("mv", "src/old.ts", "src/new.ts");
	await write({ "src/a.ts": "export const a = 1;\nexport const b = 20;\nexport const c = 3;\n" });
	await git("add", "-A");
	await git("commit", "-q", "-m", "head");
	await git("tag", "v1");
	firstHead = await git("rev-parse", "HEAD");

	review = resolveReview({
		id: "comments-test",
		title: "Comments test",
		repo,
		ranges: [
			{ id: "r", label: "R", base: "base" },
			{ id: "tagged", label: "Tagged", base: "base", head: "v1" },
			{ id: "later", label: "Later", base: "v1" },
		],
	});
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe("session", () => {
	test("a comment on lines of a head file: recorded in the range, at its head commit", async () => {
		const session = open("lines");
		expect(await session.comments()).toEqual({ comments: [] });
		const state = await session.addComment({
			path: "src/a.ts",
			line: 2,
			endLine: 3,
			snippet: "export const b = 20;\nexport const c = 3;",
			text: "  Why 20?\n",
			range: "r",
		});
		const comment = state?.comments[0];
		expect(state?.comments).toEqual([
			{
				id: comment?.id ?? "",
				path: "src/a.ts",
				line: 2,
				endLine: 3,
				snippet: "export const b = 20;\nexport const c = 3;",
				text: "Why 20?",
				range: "r",
				head: firstHead,
				createdAt: comment?.createdAt ?? "",
				updatedAt: comment?.createdAt ?? "",
			},
		]);
		expect(comment?.head).toBe((await session.model("r")).range.head.sha);
		expect(await session.comments()).toEqual({ comments: state?.comments ?? [] });
		expect(await onDisk("lines")).toEqual({ comments: state?.comments ?? [] });
	});

	test("on a whole file, a deleted file, a renamed file, an unchanged file", async () => {
		const session = open("kinds");
		await session.addComment({ path: "src/a.ts", text: "whole file" });
		await session.addComment({ path: "src/gone.ts", line: 2, text: "deleted: a base line" });
		await session.addComment({ path: "src/new.ts", line: 12, text: "renamed: its new path" });
		const state = await session.addComment({ path: "src/same.ts", line: 1, text: "unchanged" });
		expect(state?.comments.map((c) => [c.path, c.line, c.range, c.head])).toEqual([
			// No range named: the review's first.
			["src/a.ts", undefined, "r", firstHead],
			["src/gone.ts", 2, "r", firstHead],
			["src/new.ts", 12, "r", firstHead],
			["src/same.ts", 1, "r", firstHead],
		]);
	});

	test("a path that is no file of the range: null, and nothing is written", async () => {
		const session = open("unknown-path");
		for (const path of [
			"src/nope.ts",
			// A renamed file's old path is gone; a directory is no file.
			"src/old.ts",
			"src",
			// Whatever a path looks like, it is only looked up in the commit's file list.
			"../../etc/passwd",
			"/etc/passwd",
			"src/../src/a.ts",
			join(repo, "src/a.ts"),
			"__proto__",
		])
			expect(await session.addComment({ path, text: "x" })).toBeNull();
		// A deleted file is a file only of a range that deletes it.
		expect(await session.addComment({ path: "src/gone.ts", text: "x", range: "later" })).toBeNull();
		expect(await session.comments()).toEqual({ comments: [] });
		expect(await Bun.file(fileOf("unknown-path")).exists()).toBe(false);
	});

	test("an unknown range is an error, not a comment in another range", async () => {
		const session = open("unknown-range");
		await expect(
			session.addComment({ path: "src/a.ts", text: "x", range: "nope" }),
		).rejects.toBeInstanceOf(UnknownRangeError);
		expect(await session.comments()).toEqual({ comments: [] });
	});

	test("edit, remove and clear", async () => {
		const session = open("edit");
		await session.addComment({ path: "src/a.ts", line: 1, text: "one" });
		const added = await session.addComment({ path: "src/a.ts", line: 2, text: "two" });
		const [one, two] = added?.comments ?? [];
		if (!one || !two) throw new Error("no comments");
		await Bun.sleep(5);
		const edited = await session.editComment(two.id, { text: " two, better " });
		expect(edited?.comments[0]).toEqual(one);
		expect(edited?.comments[1]).toMatchObject({ id: two.id, text: "two, better", line: 2 });
		expect(edited?.comments[1]?.createdAt).toBe(two.createdAt);
		expect(edited?.comments[1]?.updatedAt).not.toBe(two.updatedAt);
		expect(await session.editComment("unknown", { text: "x" })).toBeNull();
		expect((await session.removeComment(one.id)).comments.map((c) => c.id)).toEqual([two.id]);
		expect((await session.removeComment(one.id)).comments.map((c) => c.id)).toEqual([two.id]);
		expect(await onDisk("edit")).toEqual(await session.comments());
		expect(await session.clearComments()).toEqual({ comments: [] });
		expect(await onDisk("edit")).toEqual({ comments: [] });
	});

	test("another session on the same data (a restart) has the comments again", async () => {
		const first = open("restart");
		await first.addComment({
			path: "src/a.ts",
			line: 1,
			snippet: "export const a = 1;",
			text: "a",
		});
		const written = await first.addComment({ path: "src/gone.ts", text: "b" });
		expect(await open("restart").comments()).toEqual({ comments: written?.comments ?? [] });
	});

	test("a range that has moved on records its new head; the comments before keep theirs", async () => {
		const session = open("moved");
		await session.addComment({ path: "src/a.ts", line: 2, text: "before", range: "r" });
		await write({ "src/a.ts": "export const a = 1;\nexport const b = 21;\nexport const c = 3;\n" });
		await git("commit", "-q", "-am", "moved");
		const moved = await git("rev-parse", "HEAD");
		expect(moved).not.toBe(firstHead);
		await session.addComment({ path: "src/a.ts", line: 2, text: "after", range: "r" });
		// The other range ends at a tag, which stayed where it was.
		const state = await session.addComment({
			path: "src/a.ts",
			line: 2,
			text: "tag",
			range: "tagged",
		});
		expect(state?.comments.map((c) => [c.text, c.range, c.head])).toEqual([
			["before", "r", firstHead],
			["after", "r", moved],
			["tag", "tagged", firstHead],
		]);
	});

	test("a draft that names the head its page shows is refused once the range has moved on", async () => {
		// After the test above: range `r` is at a newer commit than `firstHead`, `tagged` is not.
		const session = open("moved-head");
		const now = (await session.model("r")).range.head.sha;
		expect(now).not.toBe(firstHead);
		const stale = { path: "src/a.ts", line: 2, text: "written on the old page", range: "r" };
		const refusal = session.addComment({ ...stale, head: firstHead });
		await expect(refusal).rejects.toBeInstanceOf(RangeMovedError);
		await expect(refusal).rejects.toThrow(
			`range "r" has moved on: the page shows ${firstHead.slice(0, 10)}, the range is at ${now.slice(0, 10)}`,
		);
		// The move is said before anything else: in the new state the path might be gone.
		await expect(
			session.addComment({ path: "src/nope.ts", text: "x", range: "r", head: firstHead }),
		).rejects.toBeInstanceOf(RangeMovedError);
		// Nothing was written, not even the file.
		expect(await session.comments()).toEqual({ comments: [] });
		expect(await Bun.file(fileOf("moved-head")).exists()).toBe(false);

		// The head the range is at now, and a range that did not move: both are recorded.
		await session.addComment({ ...stale, head: now });
		const state = await session.addComment({ ...stale, range: "tagged", head: firstHead });
		expect(state?.comments.map((c) => [c.range, c.head])).toEqual([
			["r", now],
			["tagged", firstHead],
		]);
		// What is stored is the comment, not the draft: `head` once, as the commit it was recorded at.
		expect(await onDisk("moved-head")).toEqual({ comments: state?.comments ?? [] });
	});
});

interface Answer {
	status: number;
	type: string | null;
	cache: string | null;
	body: unknown;
}

async function answerOf(response: Response | Promise<Response>): Promise<Answer> {
	const r = await response;
	const text = await r.text();
	return {
		status: r.status,
		type: r.headers.get("content-type"),
		cache: r.headers.get("cache-control"),
		body: text === "" ? null : JSON.parse(text),
	};
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isCommentsState = (value: unknown): value is CommentsState =>
	isRecord(value) && Array.isArray(value.comments);

/** The comments of a 200 answer; any other answer fails the test here. */
const commentsOf = (answer: Answer): ReviewComment[] => {
	if (answer.status === 200 && isCommentsState(answer.body)) return answer.body.comments;
	throw new Error(`not a list of comments: ${answer.status} ${JSON.stringify(answer.body)}`);
};

/** Status, `error` and `message` of an answer with the contract's error body. */
const errorOf = (answer: Answer): [number, unknown, unknown] => {
	const body = isRecord(answer.body) ? answer.body : {};
	return [answer.status, body.error, body.message];
};

describe("handlers", () => {
	const ENDPOINT = "http://atlas.test/api/comments";
	const JSON_BODY = { "content-type": "application/json" };
	const post = (body: unknown, headers: Record<string, string> = JSON_BODY): Request =>
		new Request(ENDPOINT, {
			method: "POST",
			headers,
			body: typeof body === "string" ? body : JSON.stringify(body),
		});
	const withId = (
		id: string,
		method: "PUT" | "DELETE",
		body?: unknown,
		headers: Record<string, string> = JSON_BODY,
	): CommentRequest =>
		Object.assign(
			new Request(`${ENDPOINT}/${encodeURIComponent(id)}`, {
				method,
				...(body === undefined
					? {}
					: { headers, body: typeof body === "string" ? body : JSON.stringify(body) }),
			}),
			{ params: { id } },
		);

	test("GET, POST, PUT, DELETE one, DELETE all: each answers with the whole list, uncached", async () => {
		const session = open("handlers");
		const api = createApi(session);
		const head = (await session.model()).range.head.sha;

		const empty = await answerOf(api.getComments());
		expect(empty).toEqual({
			status: 200,
			type: "application/json;charset=utf-8",
			cache: "no-store",
			body: { comments: [] },
		});

		const first = await answerOf(
			api.addComment(
				post({
					path: "src/a.ts",
					line: 2,
					endLine: 2,
					snippet: "export const b = 21;",
					text: "\n Why?  ",
					head,
					id: "mine",
					updatedAt: "never",
					createdAt: "then",
				}),
			),
		);
		expect(first.cache).toBe("no-store");
		const [one] = commentsOf(first);
		expect(one).toEqual({
			id: one?.id ?? "",
			path: "src/a.ts",
			line: 2,
			snippet: "export const b = 21;",
			text: "Why?",
			range: "r",
			head,
			createdAt: one?.createdAt ?? "",
			updatedAt: one?.createdAt ?? "",
		});
		expect(one?.id).toMatch(/^[0-9a-f-]{36}$/);

		const second = commentsOf(
			await answerOf(
				api.addComment(post({ path: "src/gone.ts", text: "Why gone?", range: "tagged" })),
			),
		);
		expect(second.map((c) => [c.path, c.range, c.head])).toEqual([
			["src/a.ts", "r", head],
			["src/gone.ts", "tagged", firstHead],
		]);
		expect(commentsOf(await answerOf(api.getComments()))).toEqual(second);
		expect(await onDisk("handlers")).toEqual({ comments: second });

		const edited = commentsOf(
			await answerOf(api.editComment(withId(one?.id ?? "", "PUT", { text: " Why 21? " }))),
		);
		expect(edited.map((c) => c.text)).toEqual(["Why 21?", "Why gone?"]);
		expect(await onDisk("handlers")).toEqual({ comments: edited });

		const removed = commentsOf(await answerOf(api.removeComment(withId(one?.id ?? "", "DELETE"))));
		expect(removed.map((c) => c.text)).toEqual(["Why gone?"]);
		// Gone either way: the same request again is no error.
		expect(commentsOf(await answerOf(api.removeComment(withId(one?.id ?? "", "DELETE"))))).toEqual(
			removed,
		);
		expect(commentsOf(await answerOf(api.removeComment(withId("no-such-id", "DELETE"))))).toEqual(
			removed,
		);

		expect(await answerOf(api.clearComments())).toMatchObject({
			status: 200,
			body: { comments: [] },
		});
		expect(await onDisk("handlers")).toEqual({ comments: [] });
	});

	test("a malformed body is a 400 that names the field; nothing is written", async () => {
		const session = open("handlers-400");
		const api = createApi(session);
		const ok = { path: "src/a.ts", text: "x" };
		const refused = async (body: unknown) => errorOf(await answerOf(api.addComment(post(body))));
		expect(await refused("{ not json")).toEqual([400, "bad-request", "body must be JSON"]);
		expect(await refused("")).toEqual([400, "bad-request", "body must be JSON"]);
		expect(await refused("null")).toEqual([400, "bad-request", "a comment must be a JSON object"]);
		expect(await refused([ok])).toEqual([400, "bad-request", "a comment must be a JSON object"]);
		expect(await refused({ text: "x" })).toEqual([
			400,
			"bad-request",
			"`path` must be a non-empty string",
		]);
		expect(await refused({ ...ok, line: 0 })).toEqual([
			400,
			"bad-request",
			"`line` must be a positive integer",
		]);
		expect(await refused({ ...ok, line: "2" })).toEqual([
			400,
			"bad-request",
			"`line` must be a positive integer",
		]);
		expect(await refused({ ...ok, line: 2, endLine: 1.5 })).toEqual([
			400,
			"bad-request",
			"`endLine` must be a positive integer",
		]);
		expect(await refused({ ...ok, endLine: 3 })).toEqual([
			400,
			"bad-request",
			"`endLine` needs `line`",
		]);
		expect(await refused({ ...ok, line: 3, endLine: 2 })).toEqual([
			400,
			"bad-request",
			"`endLine` must not be before `line`",
		]);
		expect(await refused({ path: "src/a.ts" })).toEqual([
			400,
			"bad-request",
			"`text` must be a string",
		]);
		expect(await refused({ ...ok, text: " \n " })).toEqual([
			400,
			"bad-request",
			"`text` must not be empty",
		]);
		expect(await refused({ ...ok, text: "x".repeat(MAX_COMMENT_TEXT + 1) })).toEqual([
			400,
			"bad-request",
			"`text` must be at most 10000 characters",
		]);
		expect(await refused({ ...ok, line: 1, snippet: ["x"] })).toEqual([
			400,
			"bad-request",
			"`snippet` must be a string",
		]);
		expect(await refused({ ...ok, line: 1, snippet: "x".repeat(MAX_COMMENT_SNIPPET + 1) })).toEqual(
			[400, "bad-request", "`snippet` must be at most 8000 characters"],
		);
		expect(await refused({ ...ok, range: 1 })).toEqual([
			400,
			"bad-request",
			"`range` must be a string",
		]);
		// A malformed body is refused before the range or the path is looked at.
		expect(await refused({ path: "nope.ts", text: "", range: "nope" })).toEqual([
			400,
			"bad-request",
			"`text` must not be empty",
		]);
		expect(await refused("x".repeat(MAX_BODY + 1))).toEqual([400, "bad-request", "body too large"]);
		expect(await session.comments()).toEqual({ comments: [] });
		expect(await Bun.file(fileOf("handlers-400")).exists()).toBe(false);
	});

	test("a body that does not say it is JSON is refused, so no other site's page can write a comment", async () => {
		const session = open("handlers-type");
		const api = createApi(session);
		const ok = { path: "src/a.ts", text: "x" };
		const refusal: [number, string, string] = [
			400,
			"bad-request",
			"the body must be sent as application/json",
		];
		// What a browser lets any page send without asking: a form, plain text, no type at all.
		for (const type of [
			"text/plain",
			"text/plain;charset=UTF-8",
			"application/x-www-form-urlencoded",
			"multipart/form-data; boundary=x",
			"application/jsonp",
			"text/json",
			"",
		])
			expect([
				type,
				...errorOf(await answerOf(api.addComment(post(ok, { "content-type": type })))),
			]).toEqual([type, ...refusal]);
		// A `Request` gives a text body the type `text/plain` when none is named.
		expect(errorOf(await answerOf(api.addComment(post(ok, {}))))).toEqual(refusal);
		expect(await session.comments()).toEqual({ comments: [] });
		expect(await Bun.file(fileOf("handlers-type")).exists()).toBe(false);

		for (const type of ["application/json", "application/json; charset=utf-8", "Application/JSON"])
			commentsOf(await answerOf(api.addComment(post(ok, { "content-type": type }))));
		const [one] = (await session.comments()).comments;
		expect((await session.comments()).comments).toHaveLength(3);
		// An edit is held to the same rule.
		expect(
			errorOf(
				await answerOf(
					api.editComment(
						withId(one?.id ?? "", "PUT", { text: "y" }, { "content-type": "text/plain" }),
					),
				),
			),
		).toEqual(refusal);
		expect((await session.comments()).comments[0]?.text).toBe("x");
	});

	test("a draft for a head the range has left is a 409 `range-moved`; nothing is written", async () => {
		const session = open("handlers-409");
		const api = createApi(session);
		const head = (await session.model("r")).range.head.sha;
		const draft = { path: "src/a.ts", line: 2, snippet: "export const b = 21;", text: "Why 21?" };
		const refused = await answerOf(api.addComment(post({ ...draft, head: firstHead })));
		expect(errorOf(refused)).toEqual([
			409,
			"range-moved",
			`range "r" has moved on: the page shows ${firstHead.slice(0, 10)}, the range is at ${head.slice(0, 10)}`,
		]);
		expect(refused.cache).toBe("no-store");
		// Whatever is not the range's head is a state the range is not in: a short sha, another word.
		for (const shown of [head.slice(0, 10), "HEAD", head.toUpperCase()])
			expect(
				errorOf(await answerOf(api.addComment(post({ ...draft, head: shown })))).slice(0, 2),
			).toEqual([409, "range-moved"]);
		// A malformed draft is a bad request first (an empty `head` names no state at all); an
		// unknown range is unknown, moved or not.
		for (const shown of [7, ""])
			expect(errorOf(await answerOf(api.addComment(post({ ...draft, head: shown }))))).toEqual([
				400,
				"bad-request",
				"`head` must be a non-empty string",
			]);
		expect(
			errorOf(await answerOf(api.addComment(post({ ...draft, text: "", head: firstHead })))),
		).toEqual([400, "bad-request", "`text` must not be empty"]);
		expect(
			errorOf(
				await answerOf(api.addComment(post({ ...draft, range: "nope", head: firstHead }))),
			).slice(0, 2),
		).toEqual([404, "unknown-range"]);
		expect(await session.comments()).toEqual({ comments: [] });
		expect(await Bun.file(fileOf("handlers-409")).exists()).toBe(false);

		// The same draft with the head the range is at now is written, at that head.
		const [one] = commentsOf(await answerOf(api.addComment(post({ ...draft, head }))));
		expect(one).toMatchObject({ path: "src/a.ts", line: 2, text: "Why 21?", range: "r", head });
		// A range that ends at a tag has not moved: the page that shows it still writes.
		const tagged = commentsOf(
			await answerOf(api.addComment(post({ ...draft, range: "tagged", head: firstHead }))),
		);
		expect(tagged.map((c) => [c.range, c.head])).toEqual([
			["r", head],
			["tagged", firstHead],
		]);
	});

	test("an unknown path or id is a 404 `not-found`, an unknown range a 404 `unknown-range`", async () => {
		const session = open("handlers-404");
		const api = createApi(session);
		for (const path of ["src/nope.ts", "src/old.ts", "../../etc/passwd", "/etc/passwd"])
			expect(errorOf(await answerOf(api.addComment(post({ path, text: "x" }))))).toEqual([
				404,
				"not-found",
				`${path} is not a file of this range`,
			]);
		const unknownRange = await answerOf(
			api.addComment(post({ path: "src/a.ts", text: "x", range: "nope" })),
		);
		expect(errorOf(unknownRange).slice(0, 2)).toEqual([404, "unknown-range"]);
		expect(unknownRange.cache).toBe("no-store");

		const edit = (id: string, body: unknown) =>
			answerOf(api.editComment(withId(id, "PUT", body))).then(errorOf);
		expect(await edit("no-such-id", { text: "x" })).toEqual([
			404,
			"not-found",
			'there is no comment with the id "no-such-id"',
		]);
		expect((await edit("../../etc/passwd", { text: "x" })).slice(0, 2)).toEqual([404, "not-found"]);
		// The body is checked first: a bad edit of an unknown comment is a bad request.
		expect(await edit("no-such-id", { text: "  " })).toEqual([
			400,
			"bad-request",
			"`text` must not be empty",
		]);
		expect(await edit("no-such-id", "{")).toEqual([400, "bad-request", "body must be JSON"]);
		expect(await edit("no-such-id", { text: "x".repeat(MAX_COMMENT_TEXT + 1) })).toEqual([
			400,
			"bad-request",
			"`text` must be at most 10000 characters",
		]);
		expect(await session.comments()).toEqual({ comments: [] });
	});
});

describe("the running server", () => {
	let running: RunningServer;
	const at = (path: string): string => `${running.url.replace(/\/$/, "")}${path}`;
	const send = (method: string, path: string, body?: unknown): Promise<Answer> =>
		answerOf(
			fetch(at(path), {
				method,
				...(body === undefined
					? {}
					: {
							headers: { "content-type": "application/json" },
							body: typeof body === "string" ? body : JSON.stringify(body),
						}),
			}),
		);

	beforeAll(() => {
		running = startServer(review, { session: open("server"), port: 0 });
	});
	afterAll(() => running.stop());

	test("a port has one server: a second one on it is refused, not let in beside the first", () => {
		// Two servers on one port would answer in turns, each from its own copy of the comments.
		expect(() =>
			startServer(review, { session: open("second-server"), port: running.server.port ?? 0 }),
		).toThrow(/in use/);
	});

	test("the routes reach their handlers, the id comes out of the path", async () => {
		expect(commentsOf(await send("GET", "/api/comments"))).toEqual([]);
		const [one] = commentsOf(
			await send("POST", "/api/comments", { path: "src/a.ts", line: 1, text: "first" }),
		);
		const id = one?.id ?? "";
		commentsOf(await send("POST", "/api/comments", { path: "src/gone.ts", text: "second" }));
		expect(
			commentsOf(await send("PUT", `/api/comments/${id}`, { text: "first, edited" })).map(
				(c) => c.text,
			),
		).toEqual(["first, edited", "second"]);
		expect(errorOf(await send("PUT", "/api/comments/no-such-id", { text: "x" }))).toEqual([
			404,
			"not-found",
			'there is no comment with the id "no-such-id"',
		]);
		// An id is a name in a list, never a path: an encoded `../` finds nothing and touches nothing.
		expect(
			errorOf(await send("PUT", "/api/comments/..%2F..%2Fetc%2Fpasswd", { text: "x" })),
		).toEqual([404, "not-found", 'there is no comment with the id "../../etc/passwd"']);
		expect(commentsOf(await send("DELETE", "/api/comments/..%2F..%2Fetc%2Fpasswd"))).toHaveLength(
			2,
		);
		expect(commentsOf(await send("DELETE", `/api/comments/${id}`)).map((c) => c.text)).toEqual([
			"second",
		]);
		expect(commentsOf(await send("DELETE", "/api/comments"))).toEqual([]);
		expect(commentsOf(await send("GET", "/api/comments"))).toEqual([]);
	});

	test("a known path with another method is a 404 `not-found` as JSON, like any unknown endpoint", async () => {
		for (const [method, path] of [
			["PUT", "/api/comments"],
			["PATCH", "/api/comments"],
			["GET", "/api/comments/some-id"],
			["POST", "/api/comments/some-id"],
			["PATCH", "/api/comments/some-id"],
			["DELETE", "/api/comments/"],
			["PUT", "/api/comments/a/b"],
			["GET", "/api/comment"],
		] as const) {
			const answer = await send(method, path, method === "GET" ? undefined : { text: "x" });
			expect([method, path, ...errorOf(answer)]).toEqual([
				method,
				path,
				404,
				"not-found",
				`no such endpoint: ${method} ${path}`,
			]);
			expect(answer.type).toBe("application/json;charset=utf-8");
		}
		expect(commentsOf(await send("GET", "/api/comments"))).toEqual([]);
	});

	test("what a page of another site can send does not write; what could is asked for first and never allowed", async () => {
		const draft = JSON.stringify({ path: "src/a.ts", text: "from another site" });
		// A form or a `no-cors` fetch: sent without asking, with one of the three types a form has.
		for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
			const answer = await answerOf(
				fetch(at("/api/comments"), {
					method: "POST",
					headers: { "content-type": type, origin: "http://other.example" },
					body: draft,
				}),
			);
			expect(errorOf(answer)).toEqual([
				400,
				"bad-request",
				"the body must be sent as application/json",
			]);
		}
		// Any other request (a JSON body, PUT, DELETE) the browser asks about first. The answer is no:
		// a 404 that allows no origin.
		for (const [path, method] of [
			["/api/comments", "POST"],
			["/api/comments", "DELETE"],
			["/api/comments/some-id", "PUT"],
			["/api/comments/some-id", "DELETE"],
		] as const) {
			const preflight = await fetch(at(path), {
				method: "OPTIONS",
				headers: {
					origin: "http://other.example",
					"access-control-request-method": method,
					"access-control-request-headers": "content-type",
				},
			});
			expect([path, method, preflight.status]).toEqual([path, method, 404]);
			expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
			await preflight.text();
		}
		// Nor may another site read: no answer names an origin that is allowed to.
		const read = await fetch(at("/api/comments"), { headers: { origin: "http://other.example" } });
		expect(read.headers.get("access-control-allow-origin")).toBeNull();
		expect(commentsOf(await answerOf(read))).toEqual([]);
	});

	test("the errors arrive as the contract's error body", async () => {
		expect(errorOf(await send("POST", "/api/comments", "{ not json"))).toEqual([
			400,
			"bad-request",
			"body must be JSON",
		]);
		expect(errorOf(await send("POST", "/api/comments", { path: "src/a.ts", text: "" }))).toEqual([
			400,
			"bad-request",
			"`text` must not be empty",
		]);
		expect(
			errorOf(await send("POST", "/api/comments", { path: "../../etc/passwd", text: "x" })),
		).toEqual([404, "not-found", "../../etc/passwd is not a file of this range"]);
		expect(
			errorOf(
				await send("POST", "/api/comments", { path: "src/a.ts", text: "x", range: "nope" }),
			).slice(0, 2),
		).toEqual([404, "unknown-range"]);
		expect(
			errorOf(
				await send("POST", "/api/comments", { path: "src/a.ts", text: "x", head: firstHead }),
			).slice(0, 2),
		).toEqual([409, "range-moved"]);
		expect(commentsOf(await send("GET", "/api/comments"))).toEqual([]);
	});

	test("the body limit holds a comment at its limits, whatever its characters", async () => {
		// JSON writes a control character as six bytes (`\u0001`): the largest a draft can get.
		const draft = {
			path: "src/a.ts",
			line: 1,
			endLine: 3,
			snippet: "\u0001".repeat(MAX_COMMENT_SNIPPET),
			text: "\u0001".repeat(MAX_COMMENT_TEXT),
			range: "tagged",
		};
		const body = JSON.stringify(draft);
		expect(body.length).toBeGreaterThan(6 * (MAX_COMMENT_SNIPPET + MAX_COMMENT_TEXT));
		expect(body.length).toBeLessThan(MAX_BODY);
		const [comment] = commentsOf(await send("POST", "/api/comments", body));
		expect(comment?.text).toHaveLength(MAX_COMMENT_TEXT);
		expect(comment?.snippet).toHaveLength(MAX_COMMENT_SNIPPET);
		// Three bytes a character in UTF-8, the most a character takes when it is not escaped.
		commentsOf(
			await send("POST", "/api/comments", { ...draft, text: "言".repeat(MAX_COMMENT_TEXT) }),
		);
		expect(commentsOf(await send("DELETE", "/api/comments"))).toEqual([]);
	});

	test("a larger body is turned away by the server itself", async () => {
		const answer = await send("POST", "/api/comments", "x".repeat(MAX_BODY + 1));
		expect(answer.status).toBe(413);
		expect(commentsOf(await send("GET", "/api/comments"))).toEqual([]);
	});
});
