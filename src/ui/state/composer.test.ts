import { describe, expect, test } from "bun:test";
import { type Composer, createComposerStore } from "./composer";

/** A store and how often it told its listeners. */
function store() {
	const composers = createComposerStore();
	let told = 0;
	composers.subscribe(() => told++);
	return { composers, told: () => told };
}

/** Where a composer is, without what it remembers. */
const place = (composer: Composer | null) =>
	composer && { line: composer.line, endLine: composer.endLine, anchor: composer.anchor };

describe("createComposerStore", () => {
	test("a file has no composer until one is opened; a line, a range in either order, the whole file", () => {
		const { composers, told } = store();
		expect(composers.get("a.ts")).toBeNull();
		expect(composers.open("a.ts", 42)).toBe(true);
		expect(place(composers.get("a.ts"))).toEqual({ line: 42, endLine: undefined, anchor: 42 });
		expect(composers.get("a.ts")?.memory).toEqual({ text: "", problem: null });
		expect(composers.open("a.ts", 42, 45)).toBe(true);
		expect(place(composers.get("a.ts"))).toEqual({ line: 42, endLine: 45, anchor: 42 });
		// Dragged upwards: the same range, but the selection started at its end.
		expect(composers.open("b.ts", 45, 42)).toBe(true);
		expect(place(composers.get("b.ts"))).toEqual({ line: 42, endLine: 45, anchor: 45 });
		expect(composers.open("a.ts")).toBe(true);
		expect(place(composers.get("a.ts"))).toEqual({
			line: undefined,
			endLine: undefined,
			anchor: undefined,
		});
		expect(told()).toBe(4);
	});

	test("the same place again changes nothing: the same object, nobody is told", () => {
		const { composers, told } = store();
		composers.open("a.ts", 3, 5);
		const first = composers.get("a.ts");
		expect(composers.open("a.ts", 3, 5)).toBe(true);
		expect(composers.open("a.ts", 5, 3)).toBe(true);
		expect(composers.get("a.ts")).toBe(first);
		composers.open("a.ts");
		const whole = composers.get("a.ts");
		expect(composers.open("a.ts")).toBe(true);
		expect(composers.get("a.ts")).toBe(whole);
		expect(told()).toBe(2);
	});

	test("an empty composer moves; one that holds text stays where it is", () => {
		const { composers, told } = store();
		expect(composers.holdsText("a.ts")).toBe(false);
		composers.open("a.ts", 10);
		const first = composers.get("a.ts");
		if (!first) throw new Error("no composer");
		// Blanks are not text.
		first.memory.text = " \n\t";
		expect(composers.holdsText("a.ts")).toBe(false);
		expect(composers.open("a.ts", 20)).toBe(true);
		const second = composers.get("a.ts");
		if (!second) throw new Error("no composer");
		expect(second.line).toBe(20);
		// Typing tells nobody: the page is not drawn again for a keystroke.
		const before = told();
		second.memory.text = "Why?";
		expect(told()).toBe(before);
		expect(composers.holdsText("a.ts")).toBe(true);
		expect(composers.holdsText("b.ts")).toBe(false);
		expect(composers.open("a.ts", 30)).toBe(false);
		expect(composers.open("a.ts")).toBe(false);
		expect(composers.open("a.ts", 20)).toBe(false);
		expect(composers.get("a.ts")).toBe(second);
		expect(told()).toBe(before);
	});

	test("a moved composer starts empty, without the problem of the one before", () => {
		const { composers } = store();
		composers.open("a.ts", 10);
		const first = composers.get("a.ts");
		if (!first) throw new Error("no composer");
		first.memory.problem = "Nicht gespeichert";
		composers.open("a.ts", 11);
		expect(composers.get("a.ts")?.memory).toEqual({ text: "", problem: null });
		expect(first.memory.problem).toBe("Nicht gespeichert");
	});

	test("each file has its own composer", () => {
		const { composers } = store();
		composers.open("a.ts", 1);
		const a = composers.get("a.ts");
		if (!a) throw new Error("no composer");
		a.memory.text = "about a";
		expect(composers.open("b.ts", 7)).toBe(true);
		expect(composers.get("b.ts")?.line).toBe(7);
		expect(composers.get("a.ts")).toBe(a);
		composers.close("b.ts");
		expect(composers.get("b.ts")).toBeNull();
		expect(composers.get("a.ts")?.memory.text).toBe("about a");
	});

	test("extend: a shift-click stretches an empty composer from where its selection started", () => {
		const { composers, told } = store();
		expect(composers.extend("a.ts", 5)).toBe(false);
		composers.open("a.ts", 10);
		const memory = composers.get("a.ts")?.memory;
		expect(composers.extend("a.ts", 14)).toBe(true);
		expect(place(composers.get("a.ts"))).toEqual({ line: 10, endLine: 14, anchor: 10 });
		// Above the start, and back onto it: always counted from the first line pressed.
		expect(composers.extend("a.ts", 7)).toBe(true);
		expect(place(composers.get("a.ts"))).toEqual({ line: 7, endLine: 10, anchor: 10 });
		expect(composers.extend("a.ts", 10)).toBe(true);
		expect(place(composers.get("a.ts"))).toEqual({ line: 10, endLine: undefined, anchor: 10 });
		// The same composer all along: what it remembers is the same object.
		expect(composers.get("a.ts")?.memory).toBe(memory);
		expect(told()).toBe(4);
	});

	test("extend forgets the head the lines were first chosen at: they are chosen anew", () => {
		const { composers } = store();
		composers.open("a.ts", 10);
		const memory = composers.get("a.ts")?.memory;
		if (!memory) throw new Error("no composer");
		memory.head = "an earlier head";
		expect(composers.extend("a.ts", 12)).toBe(true);
		expect(composers.get("a.ts")?.memory.head).toBeUndefined();
	});

	test("extend leaves a composer with text and one for the whole file alone", () => {
		const { composers } = store();
		composers.open("a.ts", 10);
		const lines = composers.get("a.ts");
		if (!lines) throw new Error("no composer");
		lines.memory.text = "x";
		expect(composers.extend("a.ts", 14)).toBe(false);
		expect(composers.get("a.ts")).toBe(lines);
		composers.open("b.ts");
		expect(composers.extend("b.ts", 3)).toBe(false);
		expect(composers.get("b.ts")?.line).toBeUndefined();
	});

	test("toFile: a composer whose lines are gone is for the whole file and keeps what is typed", () => {
		const { composers, told } = store();
		composers.toFile("a.ts");
		composers.open("a.ts", 40, 44);
		const before = composers.get("a.ts");
		if (!before) throw new Error("no composer");
		before.memory.text = "typed before the file got shorter";
		before.memory.problem = "Nicht gespeichert";
		composers.toFile("a.ts");
		const after = composers.get("a.ts");
		expect(place(after)).toEqual({ line: undefined, endLine: undefined, anchor: undefined });
		expect(after?.memory).toBe(before.memory);
		// It says what happened to it.
		expect(after?.lost).toBe(true);
		// Already for the whole file: nothing to do.
		composers.toFile("a.ts");
		expect(composers.get("a.ts")).toBe(after);
		expect(told()).toBe(2);
	});

	test("leave: an empty composer closes, one with text waits for the reader to come back", () => {
		const { composers, told } = store();
		composers.leave("a.ts");
		composers.open("a.ts", 3);
		composers.leave("a.ts");
		expect(composers.get("a.ts")).toBeNull();
		composers.open("a.ts", 3);
		const kept = composers.get("a.ts");
		if (!kept) throw new Error("no composer");
		kept.memory.text = "not sent yet";
		composers.leave("a.ts");
		expect(composers.get("a.ts")).toBe(kept);
		expect(told()).toBe(3);
		composers.close("a.ts");
		composers.close("a.ts");
		expect(composers.get("a.ts")).toBeNull();
		expect(told()).toBe(4);
	});

	test("a listener that unsubscribed is not told", () => {
		const composers = createComposerStore();
		let told = 0;
		const unsubscribe = composers.subscribe(() => told++);
		composers.open("a.ts", 1);
		unsubscribe();
		composers.open("a.ts", 2);
		expect(told).toBe(1);
	});
});
