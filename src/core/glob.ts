/**
 * A small glob matcher for repo paths (always `/`-separated, never with a leading `./`).
 *
 * - `**` as a whole segment matches zero or more segments (`**\/x`, `a/**\/b`, `a/**`)
 * - `*` matches any run of characters except `/`; `**` inside a segment acts like `*`
 * - `?` matches one character except `/`
 * - `{a,b}` matches one of the alternatives; alternatives may contain globs and nest
 * - `\x` matches `x` literally
 *
 * Patterns are anchored at the repo root: `*.md` matches only files at the root, use
 * `**\/*.md` for every depth. A dot is an ordinary character, so `*` also matches `.env`.
 */

const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
	const cached = cache.get(glob);
	if (cached) return cached;
	const pattern = glob.replace(/^\.?\//, "");
	const compiled = new RegExp(`^${new GlobParser(pattern).parse()}$`, "u");
	cache.set(glob, compiled);
	return compiled;
}

/** One function for a list of globs: true when any of them matches. */
export function createMatcher(globs: readonly string[]): (path: string) => boolean {
	const regexps = globs.map(globToRegExp);
	return (path) => regexps.some((re) => re.test(path));
}

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\/]/g;

function escapeRegExp(text: string): string {
	return text.replace(REGEXP_SPECIAL, "\\$&");
}

class GlobParser {
	private pos = 0;
	private depth = 0;

	constructor(private readonly glob: string) {}

	parse(): string {
		return this.sequence();
	}

	/** Reads until the end, or until `,` / `}` when inside braces. */
	private sequence(): string {
		let out = "";
		while (this.pos < this.glob.length) {
			const c = this.glob[this.pos];
			if (this.depth > 0 && (c === "," || c === "}")) break;
			if (c === "\\") {
				const next = this.glob[this.pos + 1];
				out += escapeRegExp(next ?? "\\");
				this.pos += next === undefined ? 1 : 2;
			} else if (c === "*") {
				out += this.star();
			} else if (c === "?") {
				out += "[^/]";
				this.pos++;
			} else if (c === "{") {
				out += this.braces();
			} else {
				out += escapeRegExp(c ?? "");
				this.pos++;
			}
		}
		return out;
	}

	private star(): string {
		const start = this.pos;
		let end = start;
		while (this.glob[end] === "*") end++;
		this.pos = end;
		if (end - start < 2) return "[^/]*";
		const before = start === 0 ? undefined : this.glob[start - 1];
		const after = this.glob[end];
		const segmentStart = before === undefined || before === "/" || this.atBraceEdge(before);
		const segmentEnd = after === undefined || after === "/" || this.atBraceEdge(after);
		if (!segmentStart || !segmentEnd) return "[^/]*";
		if (after === "/") {
			// `**/`: zero or more whole segments, each followed by its slash.
			this.pos++;
			return "(?:.*/)?";
		}
		return ".*";
	}

	private atBraceEdge(c: string): boolean {
		return this.depth > 0 && (c === "{" || c === "," || c === "}");
	}

	private braces(): string {
		const open = this.pos;
		this.pos++;
		this.depth++;
		const alternatives: string[] = [];
		let closed = false;
		while (this.pos <= this.glob.length) {
			alternatives.push(this.sequence());
			const c = this.glob[this.pos];
			if (c === ",") {
				this.pos++;
				continue;
			}
			if (c === "}") {
				this.pos++;
				closed = true;
			}
			break;
		}
		this.depth--;
		if (!closed) {
			// An unterminated brace is a literal `{`.
			this.pos = open + 1;
			return "\\{";
		}
		return `(?:${alternatives.join("|")})`;
	}
}
