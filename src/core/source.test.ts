import { describe, expect, test } from "bun:test";
import { BatchParser } from "./source";

const encoder = new TextEncoder();

function batchOutput(objects: [sha: string, content: Uint8Array][]): Uint8Array {
	const parts: Uint8Array[] = [];
	for (const [sha, content] of objects) {
		parts.push(encoder.encode(`${sha} blob ${content.length}\n`), content, encoder.encode("\n"));
	}
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

const objects: [string, Uint8Array][] = [
	["a".repeat(40), encoder.encode("first\nfile\n")],
	["b".repeat(40), new Uint8Array(0)],
	["c".repeat(40), new Uint8Array([0, 10, 255, 10, 0])],
	["d".repeat(40), encoder.encode("ümlaut ✓")],
];

describe("BatchParser", () => {
	test("hands over every object, whatever the chunk boundaries", () => {
		const data = batchOutput(objects);
		for (const size of [1, 2, 3, 7, 41, 64, data.length]) {
			const seen: [string, number[]][] = [];
			const parser = new BatchParser((sha, bytes) => seen.push([sha, [...bytes]]));
			for (let i = 0; i < data.length; i += size) parser.push(data.subarray(i, i + size));
			parser.finish();
			expect(seen).toEqual(objects.map(([sha, bytes]) => [sha, [...bytes]]));
		}
	});

	test("a missing object is an error", () => {
		const parser = new BatchParser(() => undefined);
		expect(() => parser.push(encoder.encode(`${"e".repeat(40)} missing\n`))).toThrow(/missing/);
	});

	test("output that ends inside an object is an error", () => {
		const data = batchOutput(objects);
		const parser = new BatchParser(() => undefined);
		parser.push(data.subarray(0, 50));
		expect(() => parser.finish()).toThrow(/middle of an object/);
	});
});
