import { describe, expect, test } from "bun:test";
import type { CommentDraft, CommentsState, ReviewComment } from "../../core/types";
import { ApiError } from "../api";
import { type CommentsApi, createCommentsStore } from "./comments";

const OLD_HEAD = "a".repeat(40);
const NEW_HEAD = "b".repeat(40);

/**
 * A stand-in for the server: keeps the list like the real one, counts its requests, and can be
 * told to fail the next request (before or after doing what it asks) or to hold its answers.
 */
function fakeServer(initial: ReviewComment[] = []) {
	let comments = initial;
	let made = 0;
	const log: string[] = [];
	const failures: { when: "before" | "after"; error: unknown }[] = [];
	let gate: Promise<void> | null = null;
	let open = () => {};

	const answer = async (name: string, change?: () => void): Promise<CommentsState> => {
		log.push(name);
		if (gate) await gate;
		const failure = failures.shift();
		if (failure?.when === "before") throw failure.error;
		change?.();
		if (failure?.when === "after") throw failure.error;
		// New objects in every answer, as a body that is parsed anew gives them.
		return { comments: comments.map((comment) => ({ ...comment })) };
	};
	const record = (draft: CommentDraft): ReviewComment => {
		const at = new Date(Date.UTC(2026, 0, 1, 12, 0, made++)).toISOString();
		const { range, head, ...content } = draft;
		return {
			id: `c${made}`,
			...content,
			range: range ?? "first",
			head: head ?? OLD_HEAD,
			createdAt: at,
			updatedAt: at,
		};
	};
	const api: CommentsApi = {
		get: () => answer("get"),
		add: (draft) =>
			answer(`add ${draft.text}`, () => {
				comments = [...comments, record(draft)];
			}),
		edit: (id, edit) =>
			answer(`edit ${id}`, () => {
				if (!comments.some((c) => c.id === id))
					throw new ApiError(404, { error: "not-found", message: `there is no comment ${id}` });
				comments = comments.map((c) => (c.id === id ? { ...c, text: edit.text } : c));
			}),
		remove: (id) =>
			answer(`remove ${id}`, () => {
				comments = comments.filter((c) => c.id !== id);
			}),
		clear: () =>
			answer("clear", () => {
				comments = [];
			}),
	};
	return {
		api,
		log,
		texts: () => comments.map((c) => c.text),
		failNext: (when: "before" | "after", error: unknown = new Error("the server is gone")) =>
			failures.push({ when, error }),
		/** Answers wait until `release()`. */
		hold: () => {
			gate = new Promise((resolve) => {
				open = resolve;
			});
		},
		release: () => {
			gate = null;
			open();
		},
	};
}

const texts = (store: ReturnType<typeof createCommentsStore>): string[] =>
	store.getSnapshot().comments.map((c) => c.text);

describe("createCommentsStore", () => {
	test("starts empty and not loaded; load() takes the server's list", async () => {
		const server = fakeServer();
		await server.api.add({ path: "a.ts", text: "already there" });
		const store = createCommentsStore(server.api);
		const first = store.getSnapshot();
		expect(first).toEqual({
			comments: [],
			loaded: false,
			error: null,
			moved: false,
			answered: true,
			refreshing: false,
			stale: false,
		});
		expect(store.failure()).toBeNull();
		// The same object until something changes: React compares snapshots by identity.
		expect(store.getSnapshot()).toBe(first);
		let told = 0;
		const unsubscribe = store.subscribe(() => told++);
		expect(await store.load()).toBe(true);
		// Once when it is asked for, once with the answer.
		expect(told).toBe(2);
		expect(store.getSnapshot()).not.toBe(first);
		expect(store.getSnapshot()).toMatchObject({ loaded: true, error: null, refreshing: false });
		expect(texts(store)).toEqual(["already there"]);
		unsubscribe();
		await store.load();
		expect(told).toBe(2);
	});

	test("add sends the draft and resolves to the comment the server recorded", async () => {
		const server = fakeServer();
		const store = createCommentsStore(server.api);
		await store.load();
		await store.add({ path: "a.ts", text: "one", range: "r" });
		const created = await store.add({
			path: "b.ts",
			line: 4,
			endLine: 6,
			snippet: "const b = 1;",
			text: "two",
			range: "second",
		});
		expect(created).toMatchObject({
			id: "c2",
			path: "b.ts",
			line: 4,
			endLine: 6,
			snippet: "const b = 1;",
			text: "two",
			range: "second",
		});
		expect(store.getSnapshot().comments.at(-1) ?? null).toEqual(created);
		expect(texts(store)).toEqual(["one", "two"]);
	});

	test("edit, remove and clear answer true, and the server's answer is the list", async () => {
		const server = fakeServer();
		const store = createCommentsStore(server.api);
		await store.add({ path: "a.ts", text: "one" });
		await store.add({ path: "a.ts", text: "two" });
		// A change before any load() brings the whole list just the same.
		expect(store.getSnapshot().loaded).toBe(true);
		expect(await store.edit("c1", "one, edited")).toBe(true);
		expect(texts(store)).toEqual(["one, edited", "two"]);
		expect(await store.remove("c1")).toBe(true);
		expect(texts(store)).toEqual(["two"]);
		expect(await store.clear()).toBe(true);
		expect(texts(store)).toEqual([]);
		expect(server.log).toEqual(["add one", "add two", "edit c1", "remove c1", "clear"]);
	});

	test("an answer keeps the objects of the comments that did not change", async () => {
		const server = fakeServer();
		const store = createCommentsStore(server.api);
		await store.add({ path: "a.ts", text: "one" });
		await store.add({ path: "a.ts", text: "two" });
		const [one, two] = store.getSnapshot().comments;
		// What shows one comment compares by identity: another comment must not look like a change.
		await store.add({ path: "b.ts", text: "three" });
		expect(store.getSnapshot().comments[0]).toBe(one);
		expect(store.getSnapshot().comments[1]).toBe(two);
		await store.edit("c1", "one, edited");
		const edited = store.getSnapshot().comments;
		expect(edited[0]).not.toBe(one);
		expect(edited[0]?.text).toBe("one, edited");
		expect(edited[1]).toBe(two);
		// The list that is asked for after a failure is settled the same way.
		server.failNext("after", new Error("connection lost"));
		expect(await store.remove("c3")).toBe(false);
		expect(texts(store)).toEqual(["one, edited", "two"]);
		expect(store.getSnapshot().comments[0]).toBe(edited[0]);
		expect(store.getSnapshot().comments[1]).toBe(two);
	});

	test("a request the server refuses: the message as `error`, the list as the server has it", async () => {
		const server = fakeServer();
		const store = createCommentsStore(server.api);
		await store.add({ path: "a.ts", text: "one" });
		// Meanwhile another tab has written a comment this store has not seen.
		await server.api.add({ path: "a.ts", text: "from another tab" });
		expect(await store.edit("nope", "x")).toBe(false);
		expect(store.getSnapshot()).toMatchObject({ loaded: true, error: "there is no comment nope" });
		expect(texts(store)).toEqual(["one", "from another tab"]);
		expect(server.log.slice(-2)).toEqual(["edit nope", "get"]);
	});

	test("a failure after the server did its part does not leave the page behind", async () => {
		const server = fakeServer();
		const store = createCommentsStore(server.api);
		await store.add({ path: "a.ts", text: "one" });
		// The comment is written, but the answer never arrives.
		server.failNext("after", new Error("connection lost"));
		expect(await store.add({ path: "a.ts", text: "two" })).toBeNull();
		expect(store.getSnapshot().error).toBe("connection lost");
		expect(texts(store)).toEqual(["one", "two"]);
		server.failNext("after");
		expect(await store.clear()).toBe(false);
		expect(texts(store)).toEqual([]);
	});

	test("when the server cannot be asked either, the list stays as it was", async () => {
		const server = fakeServer();
		const store = createCommentsStore(server.api);
		await store.add({ path: "a.ts", text: "one" });
		server.failNext("before", new Error("first"));
		server.failNext("before", new Error("second"));
		expect(await store.remove("c1")).toBe(false);
		expect(store.getSnapshot()).toMatchObject({ loaded: true, error: "first" });
		expect(texts(store)).toEqual(["one"]);
		// What is thrown need not be an Error.
		server.failNext("before", "just text");
		server.failNext("before");
		await store.remove("c1");
		expect(store.getSnapshot().error).toBe("just text");
	});

	test("the next request that succeeds takes the error away", async () => {
		const server = fakeServer();
		const store = createCommentsStore(server.api);
		server.failNext("before");
		expect(await store.load()).toBe(false);
		// Nothing loaded, and a failed load() does not ask a second time.
		expect(store.getSnapshot()).toEqual({
			comments: [],
			loaded: false,
			error: "the server is gone",
			moved: false,
			answered: false,
			refreshing: false,
			stale: false,
		});
		expect(store.failure()).toEqual({
			message: "the server is gone",
			moved: false,
			answered: false,
		});
		expect(server.log).toEqual(["get"]);
		expect(await store.add({ path: "a.ts", text: "one" })).not.toBeNull();
		expect(store.getSnapshot()).toMatchObject({ loaded: true, error: null });
		expect(store.failure()).toBeNull();
	});

	test("a failed first load followed by a failed change counts as loaded once the list is known", async () => {
		const server = fakeServer();
		await server.api.add({ path: "a.ts", text: "there" });
		const store = createCommentsStore(server.api);
		server.failNext("before");
		await store.load();
		server.failNext("before", new Error("refused"));
		expect(await store.edit("c1", "x")).toBe(false);
		expect(store.getSnapshot()).toMatchObject({ loaded: true, error: "refused" });
		expect(texts(store)).toEqual(["there"]);
	});

	test("one request at a time, in the order they were made", async () => {
		const server = fakeServer();
		const store = createCommentsStore(server.api);
		server.hold();
		const loading = store.load();
		const one = store.add({ path: "a.ts", text: "one" });
		const two = store.add({ path: "a.ts", text: "two" });
		const gone = store.remove("c1");
		await Bun.sleep(5);
		// Only the first is on its way; the others wait for its answer.
		expect(server.log).toEqual(["get"]);
		expect(store.getSnapshot().loaded).toBe(false);
		server.release();
		expect([await loading, (await one)?.text, (await two)?.text, await gone]).toEqual([
			true,
			"one",
			"two",
			true,
		]);
		expect(server.log).toEqual(["get", "add one", "add two", "remove c1"]);
		expect(texts(store)).toEqual(["two"]);
	});

	test("a comment refused because the range moved on: `onMoved` is told, nothing else is asked", async () => {
		const server = fakeServer();
		let told = 0;
		const store = createCommentsStore(server.api, () => told++);
		await store.add({ path: "a.ts", text: "one", head: OLD_HEAD });
		expect(told).toBe(0);
		const refusal = new ApiError(409, {
			error: "range-moved",
			message: 'range "r" has moved on',
		});
		server.failNext("before", refusal);
		const draft = { path: "a.ts", line: 3, text: "written on the old page", head: OLD_HEAD };
		expect(await store.add(draft)).toBeNull();
		expect(told).toBe(1);
		// The server said what it did (nothing): the list is not asked for again.
		expect(server.log).toEqual(["add one", "add written on the old page"]);
		expect(texts(store)).toEqual(["one"]);
		expect(store.getSnapshot()).toMatchObject({
			loaded: true,
			error: 'range "r" has moved on',
			moved: true,
		});
		// Known the moment the request has answered, without a render in between.
		expect(store.failure()).toEqual({
			message: 'range "r" has moved on',
			moved: true,
			answered: true,
		});

		// The page has the new state: the same comment for the new head is written.
		expect(await store.add({ ...draft, head: NEW_HEAD })).toMatchObject({ line: 3 });
		expect(told).toBe(1);
		expect(store.getSnapshot()).toMatchObject({ error: null, moved: false });
		expect(texts(store)).toEqual(["one", "written on the old page"]);
	});

	test("any other failure is not a moved range, and a later one takes `moved` away", async () => {
		const server = fakeServer();
		let told = 0;
		const store = createCommentsStore(server.api, () => told++);
		// A 409 of another kind, a 404 and no answer at all.
		for (const error of [
			new ApiError(409, { error: "internal", message: "busy" }),
			new ApiError(404, { error: "not-found", message: "a.ts is not a file of this range" }),
			new Error("connection lost"),
		]) {
			server.failNext("before", error);
			expect(await store.add({ path: "a.ts", text: "x", head: OLD_HEAD })).toBeNull();
			// Only what the server answered is a message for the reader; the last one is the browser's.
			expect(store.failure()).toEqual({
				message: error.message,
				moved: false,
				answered: error instanceof ApiError,
			});
		}
		expect(told).toBe(0);
		expect(server.log).toEqual(["add x", "get", "add x", "get", "add x", "get"]);

		server.failNext("before", new ApiError(409, { error: "range-moved", message: "moved" }));
		await store.add({ path: "a.ts", text: "x", head: OLD_HEAD });
		expect(store.failure()).toEqual({ message: "moved", moved: true, answered: true });
		server.failNext("before", new Error("refused"));
		expect(await store.remove("c1")).toBe(false);
		expect(store.failure()).toEqual({ message: "refused", moved: false, answered: false });
		expect(told).toBe(1);
	});

	test("the draft goes to the server as it is given, `head` included", async () => {
		const sent: CommentDraft[] = [];
		const server = fakeServer();
		const store = createCommentsStore({
			...server.api,
			add: (draft) => {
				sent.push(draft);
				return server.api.add(draft);
			},
		});
		await store.add({ path: "a.ts", line: 2, text: "one", range: "r", head: NEW_HEAD });
		await store.add({ path: "a.ts", text: "two" });
		expect(sent).toEqual([
			{ path: "a.ts", line: 2, text: "one", range: "r", head: NEW_HEAD },
			{ path: "a.ts", text: "two" },
		]);
	});

	test("a failure in the middle does not stop the requests after it", async () => {
		const server = fakeServer();
		const store = createCommentsStore(server.api);
		server.failNext("before");
		const results = await Promise.all([
			store.add({ path: "a.ts", text: "lost" }),
			store.add({ path: "a.ts", text: "kept" }),
		]);
		expect(results.map((c) => c?.text ?? null)).toEqual([null, "kept"]);
		expect(server.log).toEqual(["add lost", "get", "add kept"]);
		expect(store.getSnapshot().error).toBeNull();
		expect(texts(store)).toEqual(["kept"]);
	});

	test("`refreshing` from the call of load() until its answer is published", async () => {
		const server = fakeServer();
		await server.api.add({ path: "a.ts", text: "one" });
		const store = createCommentsStore(server.api);
		const seen: { refreshing: boolean; texts: string[] }[] = [];
		store.subscribe(() =>
			seen.push({ refreshing: store.getSnapshot().refreshing, texts: texts(store) }),
		);
		server.hold();
		const loading = store.load();
		// At once, before the request has even left.
		expect(store.getSnapshot().refreshing).toBe(true);
		await Bun.sleep(5);
		expect(store.getSnapshot().refreshing).toBe(true);
		server.release();
		expect(await loading).toBe(true);
		expect(store.getSnapshot().refreshing).toBe(false);
		// The answer and the end of the wait come in one snapshot: never "done" with the old list.
		expect(seen).toEqual([
			{ refreshing: true, texts: [] },
			{ refreshing: false, texts: ["one"] },
		]);

		// A load that fails ends the wait just the same.
		server.failNext("before");
		const failing = store.load();
		expect(store.getSnapshot().refreshing).toBe(true);
		expect(await failing).toBe(false);
		expect(store.getSnapshot()).toMatchObject({ refreshing: false, error: "the server is gone" });
	});

	test("two loads: `refreshing` until the last of them has its answer", async () => {
		const server = fakeServer();
		const store = createCommentsStore(server.api);
		const seen: boolean[] = [];
		store.subscribe(() => seen.push(store.getSnapshot().refreshing));
		// One after the other: each has its own wait.
		await store.load();
		await store.load();
		expect(seen).toEqual([true, false, true, false]);

		// Overlapping, with a change between them: the first answer does not end the second wait.
		seen.length = 0;
		server.hold();
		const first = store.load();
		const added = store.add({ path: "a.ts", text: "one" });
		const second = store.load();
		server.release();
		expect([await first, (await added)?.text, await second]).toEqual([true, "one", true]);
		expect(seen).toEqual([true, true, true, false]);
		expect(server.log.slice(-3)).toEqual(["get", "add one", "get"]);
		expect(store.getSnapshot()).toMatchObject({ refreshing: false, stale: false });
	});

	test("`stale` when asking again fails on a loaded list, gone with the next answer", async () => {
		const server = fakeServer();
		const store = createCommentsStore(server.api);
		await store.add({ path: "a.ts", text: "one" });
		await server.api.add({ path: "a.ts", text: "from another tab" });
		server.failNext("before");
		expect(await store.load()).toBe(false);
		// What this tab knew stays, and it is marked as possibly behind.
		expect(store.getSnapshot()).toMatchObject({
			loaded: true,
			stale: true,
			refreshing: false,
			error: "the server is gone",
		});
		expect(texts(store)).toEqual(["one"]);
		expect(await store.load()).toBe(true);
		expect(store.getSnapshot()).toMatchObject({ stale: false, error: null });
		expect(texts(store)).toEqual(["one", "from another tab"]);

		// A change that fails, and the list cannot be asked for after it either.
		server.failNext("before");
		server.failNext("before");
		expect(await store.remove("c1")).toBe(false);
		expect(store.getSnapshot()).toMatchObject({ stale: true });
		// A change that the server answers brings the whole list: no longer stale.
		expect(await store.add({ path: "a.ts", text: "two" })).not.toBeNull();
		expect(store.getSnapshot()).toMatchObject({ stale: false });

		// A change that fails, but the list asked for after it arrives: the list is current.
		server.failNext("before", new ApiError(404, { error: "not-found", message: "no such file" }));
		expect(await store.add({ path: "gone.ts", text: "x" })).toBeNull();
		expect(store.getSnapshot()).toMatchObject({ stale: false, error: "no such file" });
	});

	test("a refusal because the range moved on leaves `stale` as it was", async () => {
		const server = fakeServer();
		const store = createCommentsStore(server.api);
		await store.load();
		const moved = () =>
			new ApiError(409, { error: "range-moved", message: 'range "r" has moved on' });
		server.failNext("before", moved());
		await store.add({ path: "a.ts", text: "x", head: OLD_HEAD });
		expect(store.getSnapshot()).toMatchObject({ moved: true, stale: false });
		server.failNext("before");
		await store.load();
		server.failNext("before", moved());
		await store.add({ path: "a.ts", text: "x", head: OLD_HEAD });
		expect(store.getSnapshot()).toMatchObject({ moved: true, stale: true });
	});

	test("a failed FIRST load is not stale: nothing is shown that could be behind", async () => {
		const server = fakeServer();
		const store = createCommentsStore(server.api);
		server.failNext("before");
		expect(await store.load()).toBe(false);
		expect(store.getSnapshot()).toMatchObject({ loaded: false, stale: false, refreshing: false });
		// Nor is a change that fails before any list was had, with the asking after it failing too.
		server.failNext("before");
		server.failNext("before");
		expect(await store.add({ path: "a.ts", text: "x" })).toBeNull();
		expect(store.getSnapshot()).toMatchObject({ loaded: false, stale: false });
		expect(store.getSnapshot().error).not.toBeNull();
	});
});
