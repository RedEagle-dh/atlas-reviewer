import { describe, expect, test } from "bun:test";
import { createShikiHighlighter, plainLines, shikiLanguageFor, splitLines } from "./highlight";

describe("splitLines", () => {
	test("counts lines like git: a final newline starts no line", () => {
		expect(splitLines("")).toEqual([]);
		expect(splitLines("a")).toEqual(["a"]);
		expect(splitLines("a\n")).toEqual(["a"]);
		expect(splitLines("a\n\nb")).toEqual(["a", "", "b"]);
		expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
	});

	test("plain lines are one token in colour 0, an empty line no token", () => {
		expect(plainLines("x\n\ny\n")).toEqual([[["x", 0]], [], [["y", 0]]]);
	});
});

describe("shikiLanguageFor", () => {
	test("by name, then by extension", () => {
		expect(shikiLanguageFor("apps/api/Dockerfile")).toBe("docker");
		expect(shikiLanguageFor("tsconfig.base.json")).toBe("jsonc");
		expect(shikiLanguageFor("a/b.tsx")).toBe("tsx");
		expect(shikiLanguageFor("a/b.MTS")).toBe("typescript");
		expect(shikiLanguageFor("LICENSE")).toBeNull();
		expect(shikiLanguageFor(".gitignore")).toBeNull();
	});
});

describe("createShikiHighlighter", () => {
	const highlighter = createShikiHighlighter();

	test("one token line per source line, colours deduplicated into the palette", async () => {
		const code = 'import { a } from "./a";\n\nconst b = "x";\n';
		const { lines, palette } = await highlighter.highlight(code, "typescript");
		expect(lines).toHaveLength(3);
		expect(lines[1]).toEqual([]);
		expect(lines.map((l) => l.map((t) => t[0]).join(""))).toEqual([
			'import { a } from "./a";',
			"",
			'const b = "x";',
		]);
		const keys = palette.map(([light, dark]) => `${light}|${dark}`);
		expect(new Set(keys).size).toBe(keys.length);
		for (const line of lines) for (const [, colour] of line) expect(palette[colour]).toBeDefined();
		for (const [light, dark] of palette) {
			expect(light).toMatch(/^#/);
			expect(dark).toMatch(/^#/);
		}
	});

	test("an unknown language or none gives plain text", async () => {
		expect((await highlighter.highlight("a\nb", null)).lines).toEqual([[["a", 0]], [["b", 0]]]);
		expect((await highlighter.highlight("a", "no-such-language")).palette).toHaveLength(1);
	});
});
