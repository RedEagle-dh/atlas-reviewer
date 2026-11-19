import { describe, expect, test } from "bun:test";
import { file } from "./fixtures";
import { buildGroupTree } from "./grouping";
import { fitText, labelNodes, MAX_NODE_WIDTH, type Measure } from "./labels";
import type { LevelNode } from "./level";

/** 7 px per character, whatever the style. */
const measure: Measure = (text) => text.length * 7;

describe("fitText", () => {
	test("a name that fits stays whole", () => {
		expect(fitText("service.ts", 100, (t) => t.length * 7)).toBe("service.ts");
	});

	test("a long name is cut in the middle: its start and its extension stay", () => {
		const cut = fitText("master-data-models-and-more.ts", 70, (t) => t.length * 7);
		expect(cut).toBe("maste…e.ts");
		expect(cut.length * 7).toBeLessThanOrEqual(70);
	});
});

describe("labelNodes", () => {
	const tree = buildGroupTree([file("a/x.ts", "c", "a"), file("a/y.ts", "c", "a")], "dirs", []);
	const group = tree.byId.get("a");
	if (!group) throw new Error("no a");
	const fileNode = (path: string, context: boolean): LevelNode => ({
		id: `f:${path}`,
		kind: "file",
		file: file(path, "c", "a"),
		context,
	});
	const contextGroup: LevelNode = { id: "g:a", kind: "group", group, context: true };

	test("a context node is as wide as its name, so the name is never cut when it fits", () => {
		const labels = labelNodes(
			[{ node: contextGroup, name: "4 Von der Anfrage zur Registry", count: "13" }],
			measure,
		);
		const label = labels.get("g:a");
		expect(label?.text).toBe("4 Von der Anfrage zur Registry");
		expect(label?.width).toBeGreaterThan(30 * 7);
	});

	test("a group node widens so its title fits in two lines, up to a cap", () => {
		const own: LevelNode = { id: "g:a", kind: "group", group, context: false };
		const short = labelNodes([{ node: own, name: "Datenmodell", index: "5" }], measure);
		expect(short.get("g:a")?.width).toBe(184);
		// a bold title of 9 px per character (DejaVu Sans Bold at 14.5 px is about that wide)
		const bold: Measure = (text, style) => text.length * (style === "group" ? 9 : 7);
		const long = labelNodes(
			[{ node: own, name: "SDK: was ein Paket enthalten darf", index: "2" }],
			bold,
		);
		expect(long.get("g:a")?.width).toBeGreaterThan(184);
		expect(long.get("g:a")?.width).toBeLessThanOrEqual(260);
	});

	test("a file node grows with a long name up to the cap; beyond it the middle is cut", () => {
		const long = "installed-module-registry-with-a-very-long-name.ts";
		const labels = labelNodes(
			[
				{ node: fileNode("a/x.ts", false), name: "x.ts" },
				{ node: fileNode(`a/${long}`, false), name: long },
			],
			measure,
		);
		expect(labels.get("f:a/x.ts")?.width).toBe(192);
		const cut = labels.get(`f:a/${long}`);
		expect(cut?.width).toBeLessThanOrEqual(MAX_NODE_WIDTH);
		expect(cut?.width).toBeGreaterThan(280);
		expect(cut?.text).toMatch(/^installed-mod.*….*name\.ts$/);
	});
});
