#!/usr/bin/env bun
/**
 * review-atlas serve <review-file> [--port 4610] [--host 127.0.0.1] [--range <id>] [--open] [--dev]
 * review-atlas check <review-file> [--range <id>] [--cold]
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { RangeBuild } from "../src/core/build";
import { loadReview, REST_CHAPTER_ID, type Review } from "../src/core/define";
import { createMatcher } from "../src/core/glob";
import { importedOnlyByTests } from "../src/core/graph";
import { ImportCache } from "../src/core/imports/analyze";
import { workspacePackages } from "../src/core/imports/resolve";
import { DEFAULT_DATA_DIR, ReviewSession } from "../src/core/session";
import { DEFAULT_HOST, DEFAULT_PORT, startServer } from "../src/server/main";

const USAGE = `usage:
  review-atlas serve <review-file> [--port ${DEFAULT_PORT}] [--host ${DEFAULT_HOST}] [--range <id>] [--open] [--dev]
  review-atlas check <review-file> [--range <id>] [--cold]

  serve   build the range's model, then serve the review in the browser
  check   print what the model holds; exit 1 when a relative, alias or workspace import is
          unresolved (except those the review lists in expectedUnresolved)
  --cold  check: ignore the extraction cache on the first build (the second build reads it)`;

/** What ends `serve`: Ctrl-C, a plain `kill`, the terminal that goes away. */
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * The tool's directory: its `bunfig.toml` registers the Tailwind plugin of the UI bundle. The
 * real path, as the working directory of a process is one: reached through a link, the two
 * would otherwise never be equal, and `serve` would start itself again without end.
 */
const TOOL_DIR = realpathSync(resolve(import.meta.dir, ".."));

/**
 * Bun reads `bunfig.toml` from the working directory when the process starts, and without it
 * the page is served unstyled. So `serve`, started from elsewhere, runs itself again from the
 * tool's directory (the review file made absolute first).
 */
async function serveFromToolDir(argv: string[], fileAt: number): Promise<number> {
	const args = argv.map((arg, i) => (i === fileAt ? resolve(arg) : arg));
	const child = Bun.spawn([process.execPath, import.meta.path, ...args], {
		cwd: TOOL_DIR,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	// Whatever asks this process to stop is passed on, and its end is the server's end. From a
	// terminal the server gets the signal a second time, by itself: it stops once (see `serve`).
	// Only a SIGKILL of this process cannot be passed on.
	for (const signal of STOP_SIGNALS) process.on(signal, () => child.kill(signal));
	return child.exited;
}

async function main(argv: string[]): Promise<number> {
	const { values, positionals, tokens } = parseArgs({
		args: argv,
		allowPositionals: true,
		tokens: true,
		options: {
			port: { type: "string" },
			host: { type: "string" },
			range: { type: "string" },
			open: { type: "boolean" },
			dev: { type: "boolean" },
			cold: { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
	});
	const [command, file] = positionals;
	if (values.help || !command || !file || (command !== "serve" && command !== "check")) {
		console.log(USAGE);
		return values.help ? 0 : 2;
	}
	if (command === "serve" && realpathSync(process.cwd()) !== TOOL_DIR) {
		const fileAt = tokens.filter((t) => t.kind === "positional")[1]?.index;
		if (fileAt !== undefined) return serveFromToolDir(argv, fileAt);
	}
	const review = await loadReview(file);
	if (values.range !== undefined && !review.ranges.some((r) => r.id === values.range)) {
		console.error(
			`unknown range "${values.range}"; ranges: ${review.ranges.map((r) => r.id).join(", ")}`,
		);
		return 2;
	}
	if (command === "check") return check(review, values.range, values.cold ?? false);
	const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		console.error(`--port must be a port number, got "${values.port}"`);
		return 2;
	}
	return serve(review, {
		port,
		host: values.host ?? DEFAULT_HOST,
		range: values.range,
		open: values.open ?? false,
		dev: values.dev ?? false,
	});
}

async function serve(
	review: Review,
	options: { port: number; host: string; range: string | undefined; open: boolean; dev: boolean },
): Promise<number> {
	console.log(`review-atlas — ${review.title}`);
	console.log(`repo   ${review.repo}`);
	for (const [i, r] of review.ranges.entries())
		console.log(`range  ${r.id.padEnd(12)} ${r.label}${i === 0 ? "  (default)" : ""}`);
	const session = new ReviewSession(review);
	const rangeId = options.range ?? review.ranges[0]?.id;
	const started = performance.now();
	const build = await session.build(rangeId);
	console.log(
		`built  ${build.resolved.range.id}: ${build.model.files.length} files, ${build.model.edges.length} edges in ${Math.round(performance.now() - started)} ms`,
	);
	let running: ReturnType<typeof startServer>;
	try {
		running = startServer(review, {
			session,
			port: options.port,
			host: options.host,
			development: options.dev,
		});
	} catch (error) {
		console.error(
			`cannot listen on ${options.host}:${options.port}: ${error instanceof Error ? error.message : error}`,
		);
		return 1;
	}
	const url = `${running.url}#/map${options.range ? `?range=${encodeURIComponent(options.range)}` : ""}`;
	console.log(`url    ${url}`);
	console.log("ready");
	if (options.open) {
		const opener = process.platform === "darwin" ? "open" : "xdg-open";
		try {
			Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
		} catch {
			console.log(`(could not run ${opener}; open the URL yourself)`);
		}
	}
	// `on`, not `once`: a signal can come twice (from the terminal, and passed on by the process
	// that started this one from another directory), and the second must not end the process
	// while the server is still closing.
	await new Promise<void>((resolve) => {
		for (const signal of STOP_SIGNALS) process.on(signal, () => resolve());
	});
	await running.stop();
	return 0;
}

// ---------------------------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------------------------

function tally(items: Iterable<string>): [string, number][] {
	const counts = new Map<string, number>();
	for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function line(pairs: [string, number][]): string {
	return pairs.length === 0 ? "—" : pairs.map(([k, n]) => `${k} ${n}`).join(" · ");
}

async function check(review: Review, rangeId: string | undefined, cold: boolean): Promise<number> {
	const cacheFile = `${DEFAULT_DATA_DIR}/cache/imports.json`;
	const first = new ReviewSession(review, {
		importCache: cold ? await emptyCache(cacheFile) : await ImportCache.open(cacheFile),
	});
	const build = await first.build(rangeId);
	// A second start: a fresh session that reads the extraction cache the first one wrote.
	const second = new ReviewSession(review, { importCache: await ImportCache.open(cacheFile) });
	const again = await second.build(rangeId);
	const isExpected = expectedUnresolved(review);
	const unexpected = build.model.unresolved.filter((u) => !isExpected(u.specifier));
	print(review, build, again);
	return unexpected.length > 0 ? 1 : 0;
}

/**
 * The review's `expectedUnresolved` globs as a test of a specifier. A glob drops a leading `./`
 * (globs are written for repo paths), so the specifier is tried without it as well.
 */
function expectedUnresolved(review: Review): (specifier: string) => boolean {
	const matches = createMatcher(review.expectedUnresolved);
	return (specifier) => matches(specifier) || matches(specifier.replace(/^\.\//, ""));
}

/** An empty cache that still saves to `file`, so the next start is warm. */
async function emptyCache(file: string): Promise<ImportCache> {
	await Bun.file(file)
		.delete()
		.catch(() => undefined);
	return ImportCache.open(file);
}

function print(review: Review, build: RangeBuild, again: RangeBuild): void {
	const { model } = build;
	const out: string[] = [];
	const short = (sha: string) => sha.slice(0, 10);
	out.push(`review  ${review.title} (${review.id})`);
	out.push(`repo    ${review.repo}`);
	out.push(
		`range   ${model.range.id} — ${model.range.label}: ${model.range.base.ref}${model.range.mergeBase ? " (merge base)" : ""} ${short(model.range.base.sha)} .. ${model.range.head.ref} ${short(model.range.head.sha)}`,
	);
	const excludedTotal = Object.values(model.excluded).reduce((a, b) => a + b, 0);
	out.push("");
	out.push(
		`files   ${model.files.length + excludedTotal} changed: ${model.files.length} in the review, ${excludedTotal} left out`,
	);
	out.push(`  status:     ${line(tally(model.files.map((f) => f.status)))}`);
	out.push(`  category:   ${line(tally(model.files.map((f) => f.category)))}`);
	out.push(`  left out:   ${line(Object.entries(model.excluded).sort((a, b) => b[1] - a[1]))}`);
	out.push(
		`  logic/unit: ${line(tally(model.files.filter((f) => f.category === "logic").map((f) => f.unit)))}`,
	);
	out.push("  chapters:");
	const chapters = [
		...review.chapters,
		{ id: REST_CHAPTER_ID, title: review.restTitle ?? "(files no chapter matches)" },
	];
	for (const [i, chapter] of chapters.entries()) {
		const files = model.files.filter((f) => f.chapter === chapter.id);
		const byCategory = line(tally(files.map((f) => f.category)));
		out.push(
			`    ${String(i + 1).padStart(2)} ${chapter.id.padEnd(10)} ${String(files.length).padStart(4)}  ${chapter.title}  (${byCategory})`,
		);
	}

	out.push("");
	const typeOnly = model.edges.filter((e) => e.kind === "type").length;
	out.push(`edges   ${model.edges.length} between review files (${typeOnly} type-only)`);
	out.push(`  kind:       ${line(tally(model.edges.map((e) => e.kind)))}`);
	const outsideImporters = model.files.reduce((n, f) => n + f.outside.importers, 0);
	const outsideImports = model.files.reduce((n, f) => n + f.outside.imports, 0);
	out.push(
		`  outside:    ${outsideImports} imports of unchanged files, ${outsideImporters} importers among unchanged files`,
	);

	out.push("");
	const isExpected = expectedUnresolved(review);
	const grouped = (list: typeof model.unresolved) => {
		const bySpecifier = new Map<string, string[]>();
		for (const u of list) {
			const places = bySpecifier.get(u.specifier) ?? [];
			places.push(`${u.from}:${u.line}`);
			bySpecifier.set(u.specifier, places);
		}
		return [...bySpecifier]
			.sort()
			.map(
				([specifier, places]) =>
					`  ${specifier}  ← ${places.slice(0, 5).join(", ")}${places.length > 5 ? ` (+${places.length - 5})` : ""}`,
			);
	};
	const unexpected = model.unresolved.filter((u) => !isExpected(u.specifier));
	const expected = model.unresolved.filter((u) => isExpected(u.specifier));
	out.push(`unresolved ${unexpected.length} (relative, alias, workspace)`);
	out.push(...grouped(unexpected));
	if (expected.length > 0) {
		out.push(
			`expected unresolved ${expected.length} (the review's expectedUnresolved; not a failure)`,
		);
		out.push(...grouped(expected));
	}

	// Helpers of the tests that a rule took for logic: a review file can add them to `test`. A
	// package's entry point is left out: the program runs it, only its tests import it.
	const entryPoints = new Set<string>();
	for (const pkg of workspacePackages(build.repo.files)) {
		const entry = build.repo.resolve(
			pkg.name,
			pkg.dir ? `${pkg.dir}/package.json` : "package.json",
		);
		if (entry.kind === "file") entryPoints.add(entry.path);
	}
	const testOnly = importedOnlyByTests(
		model.files
			.filter((f) => f.category === "logic" && !entryPoints.has(f.path))
			.map((f) => f.path),
		(path) => build.relations.importers(path).map((i) => i.from),
		(path) => build.classifier.classify({ path, binary: false }) === "test",
	);
	out.push(
		`only tests import ${testOnly.length} logic file(s)${testOnly.length ? " — add them to the review's test rule?" : ""} (package entry points not counted)`,
	);
	for (const path of testOnly) out.push(`  ${path}`);

	const externals = new Map<string, number>();
	for (const file of model.files)
		for (const i of build.relations.imports(file.path))
			if (i.resolution.kind === "external")
				externals.set(i.resolution.package, (externals.get(i.resolution.package) ?? 0) + 1);
	const builtins = [...externals].filter(([p]) => /^(?:node|bun):|^bun$/.test(p));
	const packages = [...externals].filter(([p]) => !/^(?:node|bun):|^bun$/.test(p));
	out.push(
		`external  ${packages.length} npm packages, ${builtins.length} builtins (imported by review files)`,
	);
	out.push(
		`  packages:   ${line(packages.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))}`,
	);
	out.push(
		`  builtins:   ${line(builtins.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))}`,
	);

	out.push("");
	out.push(`cycles  ${model.cycles.length}`);
	for (const cycle of model.cycles) out.push(`  ${cycle.join(" ⇄ ")}`);

	out.push("");
	const s = build.repo.stats;
	const t = build.timings;
	out.push(
		`repo    ${build.head.paths().length} files at head; ${s.files} parsed by an extractor (${s.parsed} parsed now, ${s.cached} from the disk cache, ${s.skipped} too large), ${s.imports} import statements`,
	);
	out.push(
		`timing  first build ${t.total} ms (refs ${t.refs}, list ${t.list}, diff ${t.diff}, analyze ${t.analyze} [configs ${s.ms.configs}, extract ${s.ms.extract}, resolve ${s.ms.resolve}], model ${t.model})`,
	);
	const s2 = again.repo.stats;
	out.push(
		`        second start ${again.timings.total} ms (analyze ${again.timings.analyze}: ${s2.parsed} parsed, ${s2.cached} from the disk cache)`,
	);
	console.log(out.join("\n"));
}

main(Bun.argv.slice(2)).then(
	(code) => process.exit(code),
	(error: unknown) => {
		// A review file that does not load says which file and every problem (ReviewLoadError).
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	},
);
