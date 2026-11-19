/**
 * Syntax highlighting on the server. A `Highlighter` names a file's language and turns code into
 * token lines with a light and a dark colour per token; shiki is the one shipped.
 */
import type { BundledLanguage, BundledTheme } from "shiki";
import type { Token, TokenLine } from "./types";

export interface Highlighted {
	lines: TokenLine[];
	/** `[light, dark]`; index 0 is the plain text colour. */
	palette: [light: string, dark: string][];
}

export interface Highlighter {
	/** The language id for a path, or null for plain text. Synchronous and cheap. */
	languageFor(path: string): string | null;
	/** `language: null` gives plain text (one token per line in colour 0). */
	highlight(code: string, language: string | null): Promise<Highlighted>;
}

/** Splits like git counts lines: a final newline does not start another line. */
export function splitLines(code: string): string[] {
	if (code === "") return [];
	const normalized = code.replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	if (normalized.endsWith("\n")) lines.pop();
	return lines;
}

export function plainLines(code: string): TokenLine[] {
	return splitLines(code).map((line) => (line === "" ? [] : [[line, 0]]));
}

const BY_EXTENSION: Record<string, string> = {
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "tsx",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "jsx",
	json: "json",
	jsonc: "jsonc",
	json5: "json5",
	md: "markdown",
	mdx: "mdx",
	css: "css",
	scss: "scss",
	sass: "sass",
	less: "less",
	html: "html",
	vue: "vue",
	svelte: "svelte",
	astro: "astro",
	yml: "yaml",
	yaml: "yaml",
	toml: "toml",
	ini: "ini",
	sh: "shellscript",
	bash: "shellscript",
	zsh: "shellscript",
	sql: "sql",
	py: "python",
	rb: "ruby",
	go: "go",
	rs: "rust",
	java: "java",
	kt: "kotlin",
	swift: "swift",
	c: "c",
	h: "c",
	cc: "cpp",
	cpp: "cpp",
	hpp: "cpp",
	cs: "csharp",
	php: "php",
	graphql: "graphql",
	gql: "graphql",
	lua: "lua",
	nix: "nix",
	xml: "xml",
	svg: "xml",
	diff: "diff",
	patch: "diff",
	csv: "csv",
};

const BY_NAME: [RegExp, string][] = [
	[/^Dockerfile(?:\..*)?$/, "docker"],
	[/^Makefile$/, "make"],
	[/^\.env(?:\..*)?$/, "dotenv"],
	[/^bun\.lock$/, "jsonc"],
	[/^tsconfig.*\.json$/, "jsonc"],
];

/** The shiki language id of a path, from its name or extension. */
export function shikiLanguageFor(path: string): string | null {
	const name = path.slice(path.lastIndexOf("/") + 1);
	for (const [pattern, language] of BY_NAME) if (pattern.test(name)) return language;
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return null;
	return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

export interface ShikiOptions {
	/** Shiki theme names; default github-light / github-dark. */
	themes?: { light: BundledTheme; dark: BundledTheme };
	/** Lines longer than this are not tokenized (minified code). */
	maxLineLength?: number;
}

type ShikiModule = typeof import("shiki");
type ShikiInstance = Awaited<ReturnType<ShikiModule["createHighlighter"]>>;

function isBundledLanguage(shiki: ShikiModule, language: string): language is BundledLanguage {
	return Object.hasOwn(shiki.bundledLanguages, language);
}

/** Shiki, loaded on first use; languages are loaded when a file first needs them. */
export function createShikiHighlighter(options: ShikiOptions = {}): Highlighter {
	const themes = options.themes ?? { light: "github-light", dark: "github-dark" };
	const maxLineLength = options.maxLineLength ?? 5000;
	let instance: Promise<{ shiki: ShikiModule; highlighter: ShikiInstance }> | undefined;

	const load = () => {
		instance ??= import("shiki").then(async (shiki) => ({
			shiki,
			highlighter: await shiki.createHighlighter({
				themes: [themes.light, themes.dark],
				langs: [],
			}),
		}));
		return instance;
	};

	return {
		languageFor: shikiLanguageFor,
		async highlight(code, language) {
			const { shiki, highlighter } = await load();
			const fg: [string, string] = [
				highlighter.getTheme(themes.light).fg,
				highlighter.getTheme(themes.dark).fg,
			];
			if (language === null || !isBundledLanguage(shiki, language))
				return { lines: plainLines(code), palette: [fg] };
			if (!highlighter.getLoadedLanguages().includes(language))
				await highlighter.loadLanguage(language);
			const source = splitLines(code).join("\n");
			const tokenLines = highlighter.codeToTokensWithThemes(source, {
				lang: language,
				themes: { light: themes.light, dark: themes.dark },
				tokenizeMaxLineLength: maxLineLength,
			});
			const palette: [string, string][] = [fg];
			const indexOf = new Map<string, number>([[`${fg[0]}|${fg[1]}`, 0]]);
			const lines: TokenLine[] = tokenLines.map((tokens) => {
				const line: TokenLine = [];
				for (const token of tokens) {
					const light = token.variants.light?.color ?? fg[0];
					const dark = token.variants.dark?.color ?? fg[1];
					const key = `${light}|${dark}`;
					let colour = indexOf.get(key);
					if (colour === undefined) {
						colour = palette.length;
						palette.push([light, dark]);
						indexOf.set(key, colour);
					}
					// Shiki's FontStyle bits (1 italic, 2 bold, 4 underline, 8 strikethrough); -1 = not set.
					const style = Math.max(0, token.variants.light?.fontStyle ?? 0);
					const last = line[line.length - 1];
					if (last && last[1] === colour && (last[2] ?? 0) === style) {
						last[0] += token.content;
					} else {
						const next: Token = style ? [token.content, colour, style] : [token.content, colour];
						line.push(next);
					}
				}
				return line;
			});
			return { lines, palette };
		},
	};
}
