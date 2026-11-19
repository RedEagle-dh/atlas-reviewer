/**
 * Categories: what kind of file a changed path is. The review's own rules are checked first,
 * then the built-in rules below, in this order; the first match wins. Core knows only ids: the
 * words the UI shows for them live in `src/ui/strings.ts` (a review rule may bring a `label`).
 */
import { createMatcher } from "./glob";
import type { CategoryRule } from "./types";

export interface BuiltinCategory {
	id: string;
	match: string[];
}

/** Extensions of files that hold program text (the `logic` category). */
export const SOURCE_EXTENSIONS = [
	"ts",
	"tsx",
	"mts",
	"cts",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"vue",
	"svelte",
	"astro",
	"css",
	"scss",
	"sass",
	"less",
	"html",
	"sh",
	"bash",
	"zsh",
	"py",
	"rb",
	"go",
	"rs",
	"java",
	"kt",
	"swift",
	"c",
	"h",
	"cc",
	"cpp",
	"hpp",
	"cs",
	"php",
	"sql",
	"graphql",
	"gql",
	"lua",
	"nix",
];

const ASSET_EXTENSIONS = [
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"avif",
	"ico",
	"bmp",
	"tif",
	"tiff",
	"svg",
	"psd",
	"woff",
	"woff2",
	"ttf",
	"otf",
	"eot",
	"mp3",
	"mp4",
	"m4a",
	"wav",
	"ogg",
	"webm",
	"mov",
	"avi",
	"pdf",
	"zip",
	"gz",
	"tgz",
	"bz2",
	"xz",
	"7z",
	"tar",
	"rar",
	"wasm",
	"glb",
	"gltf",
	"pbf",
	"mbtiles",
];

const ext = (list: string[]) => `**/*.{${list.join(",")}}`;

export const BUILTIN_CATEGORIES: readonly BuiltinCategory[] = [
	{
		id: "generated",
		match: [
			"**/{bun.lock,bun.lockb,package-lock.json,npm-shrinkwrap.json,yarn.lock,pnpm-lock.yaml,Cargo.lock,poetry.lock,composer.lock,Gemfile.lock,go.sum,flake.lock}",
			"**/*.snap",
			"**/*.gen.*",
			"**/*.generated.*",
			"**/routeTree.gen.ts",
			"**/*.min.{js,css}",
			"**/*.{js,css}.map",
		],
	},
	{ id: "migration", match: ["**/drizzle/**", "**/migrations/**"] },
	// Before `test`: a Markdown file in a test directory (`docs/testing/CONVENTIONS.md`,
	// `test/README.md`) is documentation, and so is everything below `docs/`.
	{ id: "docs", match: ["**/*.md", "**/*.mdx", "docs/**"] },
	{
		id: "test",
		match: [
			"**/*.test.*",
			"**/*.spec.*",
			"**/__tests__/**",
			"**/*.testing.*",
			"**/test/**",
			"**/tests/**",
			"**/testing/**",
			"**/fixtures/**",
			"**/e2e/**",
		],
	},
	{ id: "locale", match: ["**/locales/**", "**/i18n/**/*.json"] },
	{ id: "asset", match: [ext(ASSET_EXTENSIONS)] },
	{
		id: "config",
		match: [
			"**/package.json",
			"**/tsconfig*.json",
			"**/jsconfig*.json",
			"**/*.config.*",
			"**/.*",
			"**/.*/**", // files inside a dot directory (`.husky/pre-commit`, `.vscode/…`)
			"**/*.{yml,yaml,toml,ini,jsonc}",
			"**/{biome.json,turbo.json,deno.json,components.json}",
			"**/Dockerfile*",
			"**/Makefile",
			"helm/**",
			".github/**",
			"**/.env*",
		],
	},
	{ id: "logic", match: [ext(SOURCE_EXTENSIONS)] },
	{ id: "other", match: ["**"] },
];

export interface ClassifyInput {
	path: string;
	/** Any binary file is an asset unless an earlier rule claims it. */
	binary: boolean;
}

export interface Classifier {
	classify(file: ClassifyInput): string;
	/**
	 * Every category id: built-ins in rule order, then the review's own ones. `label` only where a
	 * review rule gives one (the last such rule wins).
	 */
	categories(): { id: string; label?: string }[];
}

export function createClassifier(rules: readonly CategoryRule[] = []): Classifier {
	const custom = rules.map((rule) => ({ id: rule.category, test: createMatcher(rule.match) }));
	const builtin = BUILTIN_CATEGORIES.map((c) => ({ id: c.id, test: createMatcher(c.match) }));
	const assetIndex = builtin.findIndex((c) => c.id === "asset");
	const labels = new Map<string, string | undefined>(
		BUILTIN_CATEGORIES.map((c) => [c.id, undefined]),
	);
	for (const rule of rules) {
		if (rule.label !== undefined) labels.set(rule.category, rule.label);
		else if (!labels.has(rule.category)) labels.set(rule.category, undefined);
	}
	return {
		classify({ path, binary }) {
			for (const rule of custom) if (rule.test(path)) return rule.id;
			for (let i = 0; i < builtin.length; i++) {
				const rule = builtin[i];
				if (!rule) continue;
				if (i === assetIndex && binary) return rule.id;
				if (rule.test(path)) return rule.id;
			}
			return "other";
		},
		categories() {
			return [...labels].map(([id, label]) => (label === undefined ? { id } : { id, label }));
		},
	};
}
