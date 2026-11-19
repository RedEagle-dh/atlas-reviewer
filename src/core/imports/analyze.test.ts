import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImportCache } from "./analyze";

const dir = await mkdtemp(join(tmpdir(), "review-atlas-cache-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("ImportCache", () => {
	test("concurrent saves in one process all succeed and leave valid JSON, no temp files", async () => {
		const file = join(dir, "cache", "imports.json");
		const cache = await ImportCache.open(file);
		const saves: Promise<void>[] = [];
		for (let i = 0; i < 20; i++) {
			cache.set(`typescript@1:ts:${i}`, [
				{ specifier: `./m${i}`, line: 1, kind: "value", names: [] },
			]);
			saves.push(cache.save());
		}
		await Promise.all(saves);
		const reopened = await ImportCache.open(file);
		expect(reopened.get("typescript@1:ts:19")).toEqual([
			{ specifier: "./m19", line: 1, kind: "value", names: [] },
		]);
		expect(await readdir(join(dir, "cache"))).toEqual(["imports.json"]);
	});

	test("a broken cache file is read as empty", async () => {
		const file = join(dir, "broken.json");
		await Bun.write(file, "{not json");
		expect((await ImportCache.open(file)).get("x")).toBeUndefined();
	});
});
