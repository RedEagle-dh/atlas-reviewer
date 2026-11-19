import { afterEach, describe, expect, test } from "bun:test";
import { copyText } from "./clipboard";

/**
 * A stand-in for the browser, as far as `copyText` looks: a clipboard (or none), a document that
 * copies what is selected (or refuses), a button that has the focus, and optionally a dialog
 * around it.
 */
function browser(options: {
	clipboard?: "works" | "refuses";
	execCommand: "works" | "refuses" | "throws";
	inDialog?: boolean;
}) {
	const events: string[] = [];
	let copied: string | null = null;
	let selected: string | null = null;

	class FakeElement {
		value = "";
		readOnly = false;
		tabIndex = 0;
		style = { cssText: "" };
		constructor(readonly name: string) {}
		setAttribute(): void {}
		select(): void {
			selected = this.value;
			events.push("select");
		}
		remove(): void {
			selected = null;
			events.push("remove");
		}
		focus(): void {
			events.push(`focus ${this.name}`);
		}
		append(): void {
			events.push(`append to ${this.name}`);
		}
		closest(): FakeElement | null {
			return options.inDialog ? dialog : null;
		}
	}
	const dialog = new FakeElement("dialog");
	const button = new FakeElement("button");

	const document = {
		activeElement: button,
		body: new FakeElement("body"),
		createElement: () => new FakeElement("field"),
		execCommand: (command: string) => {
			events.push(command);
			if (options.execCommand === "throws") throw new Error("not allowed");
			if (options.execCommand === "refuses") return false;
			copied = selected;
			return true;
		},
	};
	const clipboard =
		options.clipboard === undefined
			? undefined
			: {
					writeText: async (text: string) => {
						events.push("writeText");
						if (options.clipboard === "refuses") throw new Error("NotAllowedError");
						copied = text;
					},
				};
	Object.assign(globalThis, { document, HTMLElement: FakeElement });
	Object.defineProperty(globalThis, "navigator", { value: { clipboard }, configurable: true });
	return { events, copied: () => copied };
}

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => {
	Object.assign(globalThis, { document: undefined, HTMLElement: undefined });
	if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
});

describe("copyText", () => {
	test("a secure context: the Clipboard API, and nothing else is touched", async () => {
		const page = browser({ clipboard: "works", execCommand: "works" });
		expect(await copyText("the prompt\n")).toBe(true);
		expect(page.copied()).toBe("the prompt\n");
		expect(page.events).toEqual(["writeText"]);
	});

	test("no Clipboard API (plain http): a field off screen is selected and copied, the focus stays", async () => {
		const page = browser({ execCommand: "works" });
		expect(await copyText("line 1\nline 2\n")).toBe(true);
		expect(page.copied()).toBe("line 1\nline 2\n");
		expect(page.events).toEqual(["append to body", "select", "copy", "remove", "focus button"]);
	});

	test("the Clipboard API refuses: the old way is tried", async () => {
		const page = browser({ clipboard: "refuses", execCommand: "works" });
		expect(await copyText("x")).toBe(true);
		expect(page.copied()).toBe("x");
		expect(page.events.slice(0, 3)).toEqual(["writeText", "append to body", "select"]);
	});

	test("inside an open dialog the field goes into the dialog, which holds the focus", async () => {
		const page = browser({ execCommand: "works", inDialog: true });
		expect(await copyText("x")).toBe(true);
		expect(page.events[0]).toBe("append to dialog");
	});

	test("neither way: false, and the field is gone again", async () => {
		for (const execCommand of ["refuses", "throws"] as const) {
			const page = browser({ clipboard: "refuses", execCommand });
			expect(await copyText("x")).toBe(false);
			expect(page.copied()).toBeNull();
			expect(page.events.slice(-2)).toEqual(["remove", "focus button"]);
		}
	});
});
