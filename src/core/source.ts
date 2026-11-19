/**
 * Reading a git repository. Every call is `Bun.spawn` with an argument array (no shell) and
 * `cwd` = the repository. Content always comes from git OBJECTS, never from the working tree.
 */

import { existsSync } from "node:fs";

export class GitError extends Error {
	constructor(
		message: string,
		readonly args: readonly string[],
		readonly stderr: string,
		/** git's exit code; `null` when git did not run (or the error is not git's). */
		readonly exitCode: number | null = null,
	) {
		super(message);
		this.name = "GitError";
	}
}

/** Config that makes git's output independent of the user's settings. */
const GIT_CONFIG = ["-c", "core.quotePath=false", "-c", "color.ui=false"];

/** Runs git and returns its stdout; throws a `GitError` on a non-zero exit. */
export async function runGit(
	repo: string,
	args: readonly string[],
	stdin?: Uint8Array,
): Promise<Uint8Array> {
	const proc = spawnGit(repo, args, stdin);
	const [out, err, code] = await Promise.all([
		Bun.readableStreamToBytes(proc.stdout),
		Bun.readableStreamToText(proc.stderr),
		proc.exited,
	]);
	if (code !== 0) throw gitFailure(repo, args, err, code);
	return out;
}

export async function gitText(repo: string, args: readonly string[]): Promise<string> {
	return new TextDecoder().decode(await runGit(repo, args));
}

function spawnGit(repo: string, args: readonly string[], stdin?: Uint8Array) {
	try {
		return Bun.spawn(["git", ...GIT_CONFIG, ...args], {
			cwd: repo,
			stdin: stdin ?? "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
		});
	} catch (error) {
		// A missing cwd makes the spawn itself fail with an ENOENT that reads like "no git".
		if (!existsSync(repo))
			throw new GitError(`repository directory ${repo} does not exist`, args, "");
		const reason = error instanceof Error ? error.message : String(error);
		throw new GitError(`cannot run git in ${repo}: ${reason}`, args, "");
	}
}

function gitFailure(repo: string, args: readonly string[], stderr: string, code: number): GitError {
	const first = stderr.trim().split("\n")[0] ?? "";
	let message = `git ${args.join(" ")} failed in ${repo}: ${first}`;
	if (/not a git repository/i.test(stderr)) message = `${repo} is not a git repository`;
	else if (
		/unknown revision|bad revision|not a valid object name|Needed a single revision/i.test(stderr)
	)
		message = `unknown git ref in ${repo}: ${first}`;
	return new GitError(message, args, stderr, code);
}

/** Throws a clear error when `repo` is missing or not a git repository. */
export async function assertRepository(repo: string): Promise<void> {
	const exists = await Bun.file(`${repo}/.`)
		.stat()
		.then((s) => s.isDirectory())
		.catch(() => false);
	if (!exists) throw new GitError(`repository directory ${repo} does not exist`, [], "");
	await runGit(repo, ["rev-parse", "--git-dir"]);
}

/** The commit sha a ref points to. */
export async function resolveCommit(repo: string, ref: string): Promise<string> {
	if (ref.startsWith("-")) throw new GitError(`invalid ref ${ref}`, [], "");
	const sha = (
		await gitText(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).catch(
			(error: unknown) => {
				// `--verify --quiet` exits non-zero WITHOUT a message for a ref that does not exist.
				if (error instanceof GitError && error.exitCode !== null && error.stderr.trim() === "")
					throw new GitError(`unknown git ref "${ref}" in ${repo}`, error.args, error.stderr);
				throw error;
			},
		)
	).trim();
	if (!sha) throw new GitError(`unknown git ref "${ref}" in ${repo}`, [], "");
	return sha;
}

export async function mergeBase(repo: string, a: string, b: string): Promise<string> {
	return (await gitText(repo, ["merge-base", a, b])).trim();
}

export interface TreeEntry {
	blob: string;
	/** Bytes. */
	size: number;
	/** Git file mode, e.g. `100644`, `100755`, `120000` (symlink). */
	mode: string;
}

/**
 * ONE commit of a repository: its file list and its blobs.
 */
export class RepoSource {
	private constructor(
		readonly repo: string,
		readonly ref: string,
		readonly sha: string,
		private readonly entries: ReadonlyMap<string, TreeEntry>,
	) {}

	/** Resolves `ref` and lists the commit's files (`git ls-tree -r`). */
	static async open(repo: string, ref: string): Promise<RepoSource> {
		const sha = await resolveCommit(repo, ref);
		return new RepoSource(repo, ref, sha, await listTree(repo, sha));
	}

	/** Path → blob sha. */
	list(): ReadonlyMap<string, string> {
		const out = new Map<string, string>();
		for (const [path, entry] of this.entries) out.set(path, entry.blob);
		return out;
	}

	paths(): string[] {
		return [...this.entries.keys()];
	}

	has(path: string): boolean {
		return this.entries.has(path);
	}

	entry(path: string): TreeEntry | undefined {
		return this.entries.get(path);
	}

	blob(path: string): string | undefined {
		return this.entries.get(path)?.blob;
	}

	/** The content of one file of this commit. */
	async read(path: string): Promise<Uint8Array> {
		const entry = this.entries.get(path);
		if (!entry) throw new GitError(`${path} is not a file of ${this.ref} (${this.sha})`, [], "");
		return runGit(this.repo, ["cat-file", "blob", entry.blob]);
	}

	/** Several files through ONE `git cat-file --batch` process, decoded as UTF-8. */
	async readTexts(paths: readonly string[]): Promise<Map<string, string>> {
		const byBlob = new Map<string, string[]>();
		for (const path of paths) {
			const blob = this.entries.get(path)?.blob;
			if (!blob) continue;
			const list = byBlob.get(blob);
			if (list) list.push(path);
			else byBlob.set(blob, [path]);
		}
		const out = new Map<string, string>();
		const decoder = new TextDecoder();
		await readBlobs(this.repo, [...byBlob.keys()], (blob, bytes) => {
			const text = decoder.decode(bytes);
			for (const path of byBlob.get(blob) ?? []) out.set(path, text);
		});
		return out;
	}
}

async function listTree(repo: string, sha: string): Promise<Map<string, TreeEntry>> {
	const raw = await gitText(repo, ["ls-tree", "-r", "-z", "-l", "--full-tree", sha]);
	const entries = new Map<string, TreeEntry>();
	for (const record of raw.split("\0")) {
		if (!record) continue;
		const tab = record.indexOf("\t");
		const [mode, type, blob, size] = record.slice(0, tab).split(/ +/);
		// Submodules are `commit` entries; they have no content in this repository.
		if (type !== "blob" || !mode || !blob) continue;
		entries.set(record.slice(tab + 1), { blob, mode, size: Number(size) || 0 });
	}
	return entries;
}

/**
 * Reads many blobs through ONE `git cat-file --batch` process and hands each to `onBlob` as it
 * arrives (in request order), so the whole set never has to sit in memory at once.
 */
export async function readBlobs(
	repo: string,
	blobs: readonly string[],
	onBlob: (blob: string, bytes: Uint8Array) => void,
): Promise<void> {
	if (blobs.length === 0) return;
	const args = ["cat-file", "--batch"];
	const proc = spawnGit(repo, args, new TextEncoder().encode(`${blobs.join("\n")}\n`));
	const stderr = Bun.readableStreamToText(proc.stderr);
	const parser = new BatchParser(onBlob);
	try {
		for await (const chunk of proc.stdout) parser.push(chunk);
	} catch (error) {
		proc.kill(); // a missing object or a failing callback: do not leave git running
		await stderr.catch(() => "");
		throw error;
	}
	const code = await proc.exited;
	if (code !== 0) throw gitFailure(repo, args, await stderr, code);
	parser.finish();
}

type BatchState =
	| { kind: "header" }
	| { kind: "body"; blob: string; body: Uint8Array; filled: number }
	| { kind: "newline"; blob: string; body: Uint8Array };

/** Parses the output of `git cat-file --batch`: `<sha> <type> <size>\n<content>\n` per object. */
export class BatchParser {
	private state: BatchState = { kind: "header" };
	private carry: Uint8Array = new Uint8Array(0);
	private readonly decoder = new TextDecoder();

	constructor(private readonly onBlob: (blob: string, bytes: Uint8Array) => void) {}

	push(chunk: Uint8Array): void {
		let data = chunk;
		if (this.carry.length > 0) {
			data = new Uint8Array(this.carry.length + chunk.length);
			data.set(this.carry, 0);
			data.set(chunk, this.carry.length);
			this.carry = new Uint8Array(0);
		}
		let pos = 0;
		while (pos < data.length) {
			const state = this.state;
			if (state.kind === "header") {
				const newline = data.indexOf(10, pos);
				if (newline < 0) {
					this.carry = data.slice(pos);
					return;
				}
				const header = this.decoder.decode(data.subarray(pos, newline));
				pos = newline + 1;
				const [blob = "", type = "", size = ""] = header.split(" ");
				if (type === "missing") throw new GitError(`git object ${blob} is missing`, [], "");
				this.state = { kind: "body", blob, body: new Uint8Array(Number(size)), filled: 0 };
			} else if (state.kind === "body") {
				const take = Math.min(state.body.length - state.filled, data.length - pos);
				state.body.set(data.subarray(pos, pos + take), state.filled);
				state.filled += take;
				pos += take;
				if (state.filled === state.body.length)
					this.state = { kind: "newline", blob: state.blob, body: state.body };
			} else {
				pos++; // the LF after the content
				this.state = { kind: "header" };
				this.onBlob(state.blob, state.body);
			}
		}
	}

	finish(): void {
		if (this.state.kind !== "header" || this.carry.length > 0)
			throw new GitError("git cat-file --batch ended in the middle of an object", [], "");
	}
}
