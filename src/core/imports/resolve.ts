/**
 * Resolution turns an import specifier into a repo path. It is a chain of `Resolver`s; each
 * answers "this repo path", "external package X", "mine, but no such file" or "not mine"
 * (`undefined`), and the first answer wins. Probing for extensions and `index` files runs
 * against the commit's file list, never against the disk.
 */
import { posix } from "node:path";
import ts from "typescript";
import { createMatcher } from "../glob";
import type { RepoSource } from "../source";

export type Resolution =
	| { kind: "file"; path: string }
	| { kind: "external"; package: string }
	/** A relative, alias or workspace specifier that names no file of the commit. */
	| { kind: "unresolved"; resolver: string };

/** What resolvers may know about the commit: its file list and its config files' text. */
export interface RepoFiles {
	has(path: string): boolean;
	paths(): Iterable<string>;
	/** Text of a config file loaded up front (`package.json`, `tsconfig*.json`, their `extends`). */
	text(path: string): string | undefined;
}

export interface Resolver {
	name: string;
	resolve(specifier: string, from: string): Resolution | undefined;
}

/** A resolver is built once per commit from what it may know about it. */
export type ResolverFactory = (repo: RepoFiles) => Resolver;

export type Resolve = (specifier: string, from: string) => Resolution;

// ---------------------------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------------------------

const EXTENSIONS = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".json"];
const JS_TO_TS: Record<string, string[]> = {
	".js": [".ts", ".tsx"],
	".jsx": [".tsx"],
	".mjs": [".mts"],
	".cjs": [".cts"],
};

/**
 * The repo file a module path names: the path itself, a `.js` written for a `.ts` source, the
 * path with an extension, or its `index` file.
 */
export function probe(repo: RepoFiles, path: string): string | undefined {
	if (path.startsWith("..") || path.startsWith("/")) return undefined;
	const base = path === "." ? "" : path.replace(/\/$/, "");
	if (base && repo.has(base)) return base;
	const ext = posix.extname(base);
	for (const replacement of JS_TO_TS[ext] ?? []) {
		const candidate = base.slice(0, -ext.length) + replacement;
		if (repo.has(candidate)) return candidate;
	}
	if (base) for (const e of EXTENSIONS) if (repo.has(base + e)) return base + e;
	const dir = base ? `${base}/` : "";
	for (const e of EXTENSIONS) if (repo.has(`${dir}index${e}`)) return `${dir}index${e}`;
	return undefined;
}

/** Drops a bundler query (`./icon.svg?react`) or fragment. */
function stripQuery(specifier: string): string {
	const cut = specifier.slice(1).search(/[?#]/);
	return cut < 0 ? specifier : specifier.slice(0, cut + 1);
}

function isRelative(specifier: string): boolean {
	return (
		specifier === "." ||
		specifier === ".." ||
		specifier.startsWith("./") ||
		specifier.startsWith("../")
	);
}

/** `@scope/name/sub/path` → [`@scope/name`, `./sub/path`]; `name` → [`name`, `.`]. */
export function splitPackageSpecifier(specifier: string): [name: string, subpath: string] {
	const parts = specifier.split("/");
	const length = specifier.startsWith("@") ? 2 : 1;
	const name = parts.slice(0, length).join("/");
	const rest = parts.slice(length).join("/");
	return [name, rest ? `./${rest}` : "."];
}

const BUILTIN_MODULES = new Set([
	"assert",
	"async_hooks",
	"buffer",
	"child_process",
	"cluster",
	"console",
	"constants",
	"crypto",
	"dgram",
	"diagnostics_channel",
	"dns",
	"events",
	"fs",
	"http",
	"http2",
	"https",
	"inspector",
	"module",
	"net",
	"os",
	"path",
	"perf_hooks",
	"process",
	"punycode",
	"querystring",
	"readline",
	"repl",
	"stream",
	"string_decoder",
	"timers",
	"tls",
	"tty",
	"url",
	"util",
	"v8",
	"vm",
	"worker_threads",
	"zlib",
]);

/**
 * The package an external specifier belongs to: `node:fs` (also for `fs/promises` and
 * `node:fs/promises`), `bun:test`, `bun`, `react`, `@scope/x`.
 */
export function externalPackage(specifier: string): string {
	if (/^[a-z]+:/i.test(specifier)) return specifier.split("/")[0] ?? specifier;
	const [name] = splitPackageSpecifier(specifier);
	if (BUILTIN_MODULES.has(name)) return `node:${name}`;
	return name;
}

// ---------------------------------------------------------------------------------------------
// Relative
// ---------------------------------------------------------------------------------------------

export const relativeResolver: ResolverFactory = (repo) => ({
	name: "relative",
	resolve(specifier, from) {
		if (!isRelative(specifier)) return undefined;
		const target = posix.normalize(posix.join(posix.dirname(from), specifier));
		const path = probe(repo, target);
		return path ? { kind: "file", path } : { kind: "unresolved", resolver: "relative" };
	},
});

// ---------------------------------------------------------------------------------------------
// tsconfig `paths` (and `baseUrl`) of the nearest tsconfig.json
// ---------------------------------------------------------------------------------------------

interface CompilerPaths {
	/** Repo dir the `paths` targets are relative to. */
	pathsBase?: string;
	paths?: [pattern: string, targets: string[]][];
	/** Repo dir of `baseUrl`. */
	baseUrl?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonc(path: string, text: string): unknown {
	const result: { config?: unknown } = ts.parseConfigFileTextToJson(path, text);
	return result.config;
}

/** The repo paths a tsconfig's `extends` names (only files inside the repository). */
function extendsTargets(configPath: string, config: unknown): string[] {
	if (!isRecord(config)) return [];
	const raw = config.extends;
	const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
	const dir = posix.dirname(configPath);
	const out: string[] = [];
	for (const entry of list) {
		if (typeof entry !== "string" || !(entry.startsWith("./") || entry.startsWith("../"))) continue;
		const target = posix.normalize(posix.join(dir, entry));
		out.push(target.endsWith(".json") ? target : `${target}.json`);
	}
	return out;
}

function readCompilerPaths(repo: RepoFiles, configPath: string, seen: Set<string>): CompilerPaths {
	const text = repo.text(configPath);
	if (text === undefined || seen.has(configPath)) return {};
	seen.add(configPath);
	const config = parseJsonc(configPath, text);
	let merged: CompilerPaths = {};
	for (const parent of extendsTargets(configPath, config)) {
		merged = { ...merged, ...readCompilerPaths(repo, parent, seen) };
	}
	const options =
		isRecord(config) && isRecord(config.compilerOptions) ? config.compilerOptions : {};
	const dir = posix.dirname(configPath);
	const own: CompilerPaths = {};
	if (typeof options.baseUrl === "string")
		own.baseUrl = posix.normalize(posix.join(dir, options.baseUrl));
	if (isRecord(options.paths)) {
		own.pathsBase = dir;
		own.paths = Object.entries(options.paths).map(([pattern, targets]) => [
			pattern,
			Array.isArray(targets) ? targets.filter((t): t is string => typeof t === "string") : [],
		]);
	}
	return { ...merged, ...own };
}

/** Matches `specifier` against one `*` pattern; returns what the `*` stands for. */
function matchStar(pattern: string, specifier: string): string | undefined {
	const star = pattern.indexOf("*");
	if (star < 0) return pattern === specifier ? "" : undefined;
	const prefix = pattern.slice(0, star);
	const suffix = pattern.slice(star + 1);
	if (specifier.length < prefix.length + suffix.length) return undefined;
	if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return undefined;
	return specifier.slice(prefix.length, specifier.length - suffix.length);
}

/** The pattern that wins: an exact key, else the `*` pattern with the longest prefix. */
function bestPattern<T>(
	entries: [pattern: string, value: T][],
	specifier: string,
): { value: T; star: string; pattern: string } | undefined {
	let best: { value: T; star: string; pattern: string; prefix: number } | undefined;
	for (const [pattern, value] of entries) {
		const star = matchStar(pattern, specifier);
		if (star === undefined) continue;
		if (!pattern.includes("*")) return { value, star, pattern };
		const prefix = pattern.indexOf("*");
		if (
			!best ||
			prefix > best.prefix ||
			(prefix === best.prefix && pattern.length > best.pattern.length)
		)
			best = { value, star, pattern, prefix };
	}
	return best;
}

const isStringList = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === "string");

/** The repo paths a solution-style tsconfig's `references` name (a directory means its tsconfig.json). */
function referenceTargets(configPath: string, config: unknown): string[] {
	if (!isRecord(config) || !Array.isArray(config.references)) return [];
	const dir = posix.dirname(configPath);
	const out: string[] = [];
	for (const ref of config.references) {
		if (!isRecord(ref) || typeof ref.path !== "string") continue;
		const target = posix.normalize(posix.join(dir, ref.path));
		out.push(target.endsWith(".json") ? target : `${target}/tsconfig.json`);
	}
	return out;
}

/**
 * Which files a tsconfig takes (`include`, `files`; inherited through `extends` when it names
 * neither): a directory entry stands for everything below it, no entry for every file.
 */
function includesOf(
	repo: RepoFiles,
	configPath: string,
	seen = new Set<string>(),
): (path: string) => boolean {
	const text = repo.text(configPath);
	const config = text === undefined ? undefined : parseJsonc(configPath, text);
	if (
		isRecord(config) &&
		config.include === undefined &&
		config.files === undefined &&
		!seen.has(configPath)
	) {
		seen.add(configPath);
		const [parent] = extendsTargets(configPath, config);
		if (parent && repo.text(parent) !== undefined) return includesOf(repo, parent, seen);
	}
	const dir = posix.dirname(configPath);
	const at = (entry: string) => posix.normalize(posix.join(dir, entry));
	const files = isRecord(config) && isStringList(config.files) ? config.files : undefined;
	const include =
		isRecord(config) && isStringList(config.include) ? config.include : files ? [] : ["**/*"];
	const globs = include.map((entry) =>
		/[*?{]/.test(entry) || posix.extname(entry) ? at(entry) : `${at(entry)}/**`,
	);
	const exact = new Set((files ?? []).map(at));
	const matches = createMatcher(globs);
	return (path) => exact.has(path) || matches(path);
}

interface ConfigScope {
	paths: CompilerPaths;
	/**
	 * Projects a solution-style config references (Vite's `tsconfig.json` with `files: []` and
	 * `tsconfig.app.json` holding the paths): the first that takes the file and has paths answers.
	 */
	references: { includes: (path: string) => boolean; paths: CompilerPaths }[];
}

const hasPaths = (config: CompilerPaths) =>
	config.paths !== undefined || config.baseUrl !== undefined;

export const tsconfigPathsResolver: ResolverFactory = (repo) => {
	const byDir = new Map<string, ConfigScope>();
	const scopeOf = (configPath: string): ConfigScope => {
		const text = repo.text(configPath);
		const config = text === undefined ? undefined : parseJsonc(configPath, text);
		return {
			paths: readCompilerPaths(repo, configPath, new Set()),
			references: referenceTargets(configPath, config)
				.filter((target) => repo.text(target) !== undefined)
				.map((target) => ({
					includes: includesOf(repo, target),
					paths: readCompilerPaths(repo, target, new Set()),
				})),
		};
	};
	// The nearest tsconfig.json (or jsconfig.json, for a JavaScript project) up the directories.
	const nearest = (dir: string): ConfigScope => {
		const cached = byDir.get(dir);
		if (cached) return cached;
		const root = dir === "." || dir === "";
		const configPath = ["tsconfig.json", "jsconfig.json"]
			.map((name) => (root ? name : `${dir}/${name}`))
			.find((path) => repo.has(path));
		let result: ConfigScope;
		if (configPath) result = scopeOf(configPath);
		else if (root) result = { paths: {}, references: [] };
		else result = nearest(posix.dirname(dir));
		byDir.set(dir, result);
		return result;
	};
	return {
		name: "tsconfig-paths",
		resolve(specifier, from) {
			if (isRelative(specifier) || specifier.startsWith("/")) return undefined;
			const scope = nearest(posix.dirname(from));
			const config = hasPaths(scope.paths)
				? scope.paths
				: (scope.references.find((r) => hasPaths(r.paths) && r.includes(from))?.paths ??
					scope.paths);
			if (config.paths) {
				const match = bestPattern(config.paths, specifier);
				if (match) {
					const base = config.baseUrl ?? config.pathsBase ?? "";
					for (const target of match.value) {
						const path = probe(
							repo,
							posix.normalize(posix.join(base, target.replace("*", match.star))),
						);
						if (path) return { kind: "file", path };
					}
					// A catch-all `*` also sees npm packages: not finding a file there is not an error.
					if (match.pattern !== "*") return { kind: "unresolved", resolver: "tsconfig-paths" };
				}
			}
			if (config.baseUrl !== undefined) {
				const path = probe(repo, posix.normalize(posix.join(config.baseUrl, specifier)));
				if (path) return { kind: "file", path };
			}
			return undefined;
		},
	};
};

// ---------------------------------------------------------------------------------------------
// Workspace packages (every package.json with a `name`)
// ---------------------------------------------------------------------------------------------

export interface WorkspacePackage {
	name: string;
	/** Repo dir of the package (`""` for the root). */
	dir: string;
	manifest: Record<string, unknown>;
}

/** Every `package.json` of the commit that has a `name`. */
export function workspacePackages(repo: RepoFiles): WorkspacePackage[] {
	const out: WorkspacePackage[] = [];
	for (const path of repo.paths()) {
		if (path !== "package.json" && !path.endsWith("/package.json")) continue;
		const text = repo.text(path);
		if (text === undefined) continue;
		let manifest: unknown;
		try {
			manifest = JSON.parse(text);
		} catch {
			continue;
		}
		if (!isRecord(manifest) || typeof manifest.name !== "string" || !manifest.name) continue;
		const dir = path === "package.json" ? "" : path.slice(0, -"/package.json".length);
		out.push({ name: manifest.name, dir, manifest });
	}
	return out;
}

/** Preferred conditions, in this order; any other condition is tried after them. */
const CONDITIONS = ["bun", "import", "types", "default"];

/**
 * Every target an `exports` value (string, condition object, array) can stand for, with `*`
 * replaced, most preferred first. The caller takes the first that is a file of the commit: a
 * `types` target that points into an uncommitted `dist/` must not hide a `default` that exists.
 */
function exportTargets(target: unknown, star: string): string[] {
	if (typeof target === "string") return [target.replaceAll("*", star)];
	if (Array.isArray(target)) return target.flatMap((entry) => exportTargets(entry, star));
	if (!isRecord(target)) return []; // `null` excludes the subpath
	const keys = [
		...CONDITIONS.filter((c) => c in target),
		...Object.keys(target).filter((k) => !CONDITIONS.includes(k)),
	];
	return keys.flatMap((key) => exportTargets(target[key], star));
}

/**
 * The targets `exports` gives a subpath (`.`, `./x`), most preferred first; `undefined` when no
 * key matches the subpath (an empty list when the matching key maps it to `null`).
 */
export function resolveExports(exports: unknown, subpath: string): string[] | undefined {
	const isSubpathMap = isRecord(exports) && Object.keys(exports).some((k) => k.startsWith("."));
	const map: [string, unknown][] = isSubpathMap ? Object.entries(exports) : [[".", exports]];
	const match = bestPattern(map, subpath);
	if (!match) return undefined;
	return exportTargets(match.value, match.star);
}

export const workspaceResolver: ResolverFactory = (repo) => {
	// Two manifests with one name (a fixture copy, an example): the shallower one wins.
	const depth = (dir: string) => (dir === "" ? 0 : dir.split("/").length);
	const packages = new Map<string, WorkspacePackage>();
	for (const pkg of workspacePackages(repo)) {
		const known = packages.get(pkg.name);
		if (!known || depth(pkg.dir) < depth(known.dir)) packages.set(pkg.name, pkg);
	}
	const inPackage = (pkg: WorkspacePackage, target: string) =>
		probe(repo, posix.normalize(posix.join(pkg.dir || ".", target)));
	return {
		name: "workspace",
		resolve(specifier) {
			if (isRelative(specifier) || specifier.startsWith("/")) return undefined;
			const [name, subpath] = splitPackageSpecifier(specifier);
			const pkg = packages.get(name);
			if (!pkg) return undefined;
			const unresolved: Resolution = { kind: "unresolved", resolver: "workspace" };
			const { manifest } = pkg;
			if (manifest.exports !== undefined) {
				const targets = resolveExports(manifest.exports, subpath);
				for (const target of targets ?? []) {
					const path = inPackage(pkg, target);
					if (path) return { kind: "file", path };
				}
				// With `exports`, Node and Bun refuse every subpath it does not list.
				if (targets !== undefined || subpath !== ".") return unresolved;
			}
			if (subpath !== ".") {
				const path = inPackage(pkg, subpath);
				return path ? { kind: "file", path } : unresolved;
			}
			for (const field of ["module", "main"]) {
				const value = manifest[field];
				if (typeof value !== "string") continue;
				const path = inPackage(pkg, value);
				if (path) return { kind: "file", path };
			}
			const path = inPackage(pkg, "src/index") ?? inPackage(pkg, ".");
			return path ? { kind: "file", path } : unresolved;
		},
	};
};

// ---------------------------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------------------------

export const DEFAULT_RESOLVERS: readonly ResolverFactory[] = [
	relativeResolver,
	tsconfigPathsResolver,
	workspaceResolver,
];

/**
 * What npm accepts as a package name (old names may hold capitals). `@/lib`, `~/lib`, `@x` are
 * none: such a specifier is an alias that no resolver understood, not a package.
 */
const NPM_NAME = /^(?:@[a-z0-9-][a-z0-9-._~]*\/)?[a-z0-9-][a-z0-9-._~]*$/i;

/**
 * Builds the chain for one commit. A specifier no resolver claims is an external package (or a
 * `node:` / `bun:` builtin) when it can be one; otherwise (`#…` package-imports alias, `/…`
 * absolute, `@/…` or `~/…` alias, …) it is unresolved, which makes `atlas:check` fail on it.
 */
export function createResolve(
	repo: RepoFiles,
	factories: readonly ResolverFactory[] = DEFAULT_RESOLVERS,
): Resolve {
	const resolvers = factories.map((factory) => factory(repo));
	return (rawSpecifier, from) => {
		const specifier = stripQuery(rawSpecifier);
		for (const resolver of resolvers) {
			const result = resolver.resolve(specifier, from);
			if (result) return result;
		}
		if (/^[a-z]+:/i.test(specifier))
			return { kind: "external", package: externalPackage(specifier) };
		const [name] = splitPackageSpecifier(specifier);
		if (!NPM_NAME.test(name)) return { kind: "unresolved", resolver: "none" };
		return { kind: "external", package: externalPackage(specifier) };
	};
}

// ---------------------------------------------------------------------------------------------
// Loading what resolvers may read
// ---------------------------------------------------------------------------------------------

const CONFIG_FILE = /(?:^|\/)(?:package\.json|[tj]sconfig[^/]*\.json)$/;

/**
 * The commit's file list plus the text of every `package.json`, `tsconfig*.json` and
 * `jsconfig*.json`, and of whatever their `extends` and `references` name, read through one batch
 * per round.
 */
export async function loadRepoFiles(source: RepoSource): Promise<RepoFiles> {
	const texts = await source.readTexts(source.paths().filter((p) => CONFIG_FILE.test(p)));
	for (let round = 0; round < 10; round++) {
		const missing = new Set<string>();
		for (const [path, text] of texts) {
			if (posix.basename(path) === "package.json") continue;
			const config = parseJsonc(path, text);
			for (const target of [...extendsTargets(path, config), ...referenceTargets(path, config)])
				if (!texts.has(target) && source.has(target)) missing.add(target);
		}
		if (missing.size === 0) break;
		for (const [path, text] of await source.readTexts([...missing])) texts.set(path, text);
	}
	return repoFilesOf(source.paths(), texts);
}

/** A `RepoFiles` from a path list and config texts (also what tests use). */
export function repoFilesOf(
	paths: Iterable<string>,
	texts: ReadonlyMap<string, string> = new Map(),
): RepoFiles {
	const set = new Set(paths);
	return {
		has: (path) => set.has(path),
		paths: () => set,
		text: (path) => texts.get(path),
	};
}
