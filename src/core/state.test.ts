import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateStore } from "./state";

const dir = await mkdtemp(join(tmpdir(), "review-atlas-state-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("createStateStore", () => {
	test("starts empty when there is no file", async () => {
		expect(await createStateStore(join(dir, "none", "x.json")).read()).toEqual({ viewed: {} });
	});

	test("records and removes marks, and keeps them on disk", async () => {
		const file = join(dir, "state", "review.json");
		const store = createStateStore(file);
		await store.set("a.ts", "sha-a");
		expect(await store.set("b.ts", "sha-b")).toEqual({
			viewed: { "a.ts": "sha-a", "b.ts": "sha-b" },
		});
		expect(await store.set("a.ts", null)).toEqual({ viewed: { "b.ts": "sha-b" } });
		expect(await createStateStore(file).read()).toEqual({ viewed: { "b.ts": "sha-b" } });
	});

	test("quick writes one after the other all land", async () => {
		const file = join(dir, "burst.json");
		const store = createStateStore(file);
		await Promise.all(Array.from({ length: 20 }, (_, i) => store.set(`f${i}.ts`, `s${i}`)));
		expect(Object.keys((await createStateStore(file).read()).viewed)).toHaveLength(20);
	});

	test("a read that started before a write does not bring the old marks back", async () => {
		const file = join(dir, "race.json");
		await createStateStore(file).set("old.ts", "sha-old");
		// A fresh start: the first read and the first write arrive together.
		const store = createStateStore(file);
		const [, written] = await Promise.all([store.read(), store.set("new.ts", "sha-new")]);
		expect(written.viewed).toEqual({ "old.ts": "sha-old", "new.ts": "sha-new" });
		expect((await store.read()).viewed).toEqual({ "old.ts": "sha-old", "new.ts": "sha-new" });
	});

	test("two stores on one file (two servers of one review) do not write over each other", async () => {
		const file = join(dir, "two.json");
		const one = createStateStore(file);
		const two = createStateStore(file);
		expect((await one.read()).viewed).toEqual({});
		expect((await two.read()).viewed).toEqual({});
		await one.set("a.ts", "sha-a");
		expect((await two.set("b.ts", "sha-b")).viewed).toEqual({ "a.ts": "sha-a", "b.ts": "sha-b" });
		expect((await one.read()).viewed).toEqual({ "a.ts": "sha-a", "b.ts": "sha-b" });
	});

	test("a path named `__proto__` is an ordinary key", async () => {
		const file = join(dir, "proto.json");
		const store = createStateStore(file);
		await store.set("__proto__", "sha");
		const state = await createStateStore(file).read();
		expect(Object.keys(state.viewed)).toEqual(["__proto__"]);
		expect(Object.getPrototypeOf({})).toBe(Object.prototype);
	});

	test("a file that is not JSON counts as empty", async () => {
		const file = join(dir, "broken.json");
		await Bun.write(file, "{ not json");
		expect(await createStateStore(file).read()).toEqual({ viewed: {} });
	});

	test("a file that cannot be read is no empty state: read and set reject, and it stays as it is", async () => {
		const own = join(dir, "cannot-read");
		const file = join(own, "x.json");
		// A directory in the file's place cannot be read as a file, whoever runs the test.
		await mkdir(file, { recursive: true });
		const store = createStateStore(file);
		await expect(store.read()).rejects.toMatchObject({ code: "EISDIR" });
		await expect(store.set("a.ts", "sha-a")).rejects.toMatchObject({ code: "EISDIR" });
		// Nothing written next to it or into it.
		expect(await readdir(own)).toEqual(["x.json"]);
		expect(await readdir(file)).toEqual([]);
	});
});
