/**
 * Review comments: one JSON file per review, the comments in the order they were written, and
 * the rules a comment has to keep. The reader collects comments while reading and hands them to
 * a coding agent as one prompt; until then this file is the only place they live.
 */
import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { CommentDraft, CommentEdit, CommentsState, ReviewComment } from "./types";

/** Characters as `String.length` counts them, so the browser counts the same. */
export const MAX_COMMENT_TEXT = 10_000;
export const MAX_COMMENT_SNIPPET = 8_000;

/** A draft, an edit or a stored entry that breaks a rule; the message names the field. */
export class InvalidCommentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidCommentError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isLineNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function readText(value: unknown): string {
	if (typeof value !== "string") throw new InvalidCommentError("`text` must be a string");
	const text = value.trim();
	if (text === "") throw new InvalidCommentError("`text` must not be empty");
	if (text.length > MAX_COMMENT_TEXT)
		throw new InvalidCommentError(`\`text\` must be at most ${MAX_COMMENT_TEXT} characters`);
	return text;
}

type Place = Pick<ReviewComment, "path" | "line" | "endLine" | "snippet">;

/** Where a comment points, in its one stored form: no `endLine` on `line`, no snippet of a whole file. */
function readPlace(value: Record<string, unknown>): Place {
	const { path, line, endLine, snippet } = value;
	if (typeof path !== "string" || path === "")
		throw new InvalidCommentError("`path` must be a non-empty string");
	if (line !== undefined && !isLineNumber(line))
		throw new InvalidCommentError("`line` must be a positive integer");
	if (endLine !== undefined && !isLineNumber(endLine))
		throw new InvalidCommentError("`endLine` must be a positive integer");
	if (snippet !== undefined && typeof snippet !== "string")
		throw new InvalidCommentError("`snippet` must be a string");
	if (snippet !== undefined && snippet.length > MAX_COMMENT_SNIPPET)
		throw new InvalidCommentError(`\`snippet\` must be at most ${MAX_COMMENT_SNIPPET} characters`);
	const place: Place = { path };
	if (line === undefined) {
		if (endLine !== undefined) throw new InvalidCommentError("`endLine` needs `line`");
		return place;
	}
	place.line = line;
	if (endLine !== undefined) {
		if (endLine < line) throw new InvalidCommentError("`endLine` must not be before `line`");
		if (endLine > line) place.endLine = endLine;
	}
	if (snippet !== undefined) place.snippet = snippet;
	return place;
}

/**
 * A request body as a draft: checked, `text` trimmed, the place in its stored form, unknown
 * fields dropped. Throws `InvalidCommentError`.
 */
export function readCommentDraft(value: unknown): CommentDraft {
	if (!isRecord(value)) throw new InvalidCommentError("a comment must be a JSON object");
	const draft: CommentDraft = { ...readPlace(value), text: readText(value.text) };
	if (value.range !== undefined) {
		if (typeof value.range !== "string") throw new InvalidCommentError("`range` must be a string");
		draft.range = value.range;
	}
	// Not empty: "no commit" is said by leaving the field out. An empty one would be answered as
	// a range that has moved on, from nowhere.
	for (const field of ["head", "base"] as const) {
		const commit = value[field];
		if (commit === undefined) continue;
		if (typeof commit !== "string" || commit === "")
			throw new InvalidCommentError(`\`${field}\` must be a non-empty string`);
		draft[field] = commit;
	}
	return draft;
}

/** A request body as an edit; throws `InvalidCommentError`. */
export function readCommentEdit(value: unknown): CommentEdit {
	if (!isRecord(value)) throw new InvalidCommentError("an edit must be a JSON object");
	return { text: readText(value.text) };
}

/** A whole comment, as the store keeps it; throws `InvalidCommentError`. */
function readComment(value: unknown): ReviewComment {
	if (!isRecord(value)) throw new InvalidCommentError("a comment must be a JSON object");
	const word = (field: "id" | "range" | "head" | "base" | "createdAt" | "updatedAt"): string => {
		const text = value[field];
		if (typeof text !== "string" || text === "")
			throw new InvalidCommentError(`\`${field}\` must be a non-empty string`);
		return text;
	};
	// A timestamp in its one stored form, as `toISOString` writes it: comments are ordered by
	// comparing these texts, and a page that formats one must not meet a hand-written "yesterday".
	const time = (field: "createdAt" | "updatedAt"): string => {
		const at = Date.parse(word(field));
		if (Number.isNaN(at)) throw new InvalidCommentError(`\`${field}\` must be a date`);
		return new Date(at).toISOString();
	};
	return {
		id: word("id"),
		...readPlace(value),
		text: readText(value.text),
		range: word("range"),
		head: word("head"),
		...(value.base === undefined ? {} : { base: word("base") }),
		createdAt: time("createdAt"),
		updatedAt: time("updatedAt"),
	};
}

/**
 * The comments of a file on disk; none when there is no file, and without the entries that break
 * a rule. A file that is there but holds no list of comments (a hand-edit gone wrong) is moved
 * aside first: the next write would put a new list in its place, and what it held would be gone.
 */
async function readComments(file: string): Promise<ReviewComment[]> {
	const comments: ReviewComment[] = [];
	const ids = new Set<string>();
	if (!(await Bun.file(file).exists())) return comments;
	let data: unknown;
	try {
		data = JSON.parse(await Bun.file(file).text());
	} catch {
		// Not JSON: handled with every other shape that is no list, below.
	}
	if (!isRecord(data) || !Array.isArray(data.comments)) {
		const aside = `${file}.unreadable-${Date.now()}`;
		await rename(file, aside);
		console.error(`[review-atlas] ${file} holds no list of comments; it is kept as ${aside}`);
		return comments;
	}
	for (const entry of data.comments) {
		try {
			const comment = readComment(entry);
			// An id names one comment: of two with the same id the later one could never be edited.
			if (ids.has(comment.id)) continue;
			ids.add(comment.id);
			comments.push(comment);
		} catch {
			// A hand-edited entry that breaks a rule is left out; the others stay.
		}
	}
	return comments;
}

/** What `add` is given; the store makes the id and the timestamps. */
export type NewComment = Omit<ReviewComment, "id" | "createdAt" | "updatedAt">;

export interface CommentStore {
	list(): Promise<CommentsState>;
	/** Appends: the new comment is the last entry of the answer. */
	add(comment: NewComment): Promise<CommentsState>;
	/** `null` for an unknown id. The same text again changes nothing, `updatedAt` included. */
	edit(id: string, text: string): Promise<CommentsState | null>;
	/** An unknown id changes nothing. */
	remove(id: string): Promise<CommentsState>;
	clear(): Promise<CommentsState>;
}

/**
 * Every entry passes the same check on its way in as when the file is read, so the store never
 * writes what it would not read back; a comment that breaks a rule rejects with
 * `InvalidCommentError`.
 */
export function createCommentStore(file: string): CommentStore {
	/**
	 * The file is the list: nothing of it is kept in memory. Every request reads it first, so a
	 * second server of the same review (started on another port while the first still runs) sees
	 * what this one wrote, instead of writing its own older list over it. Requests run one after
	 * the other: two quick ones cannot lose each other's comment.
	 */
	let queue: Promise<unknown> = Promise.resolve();
	const inTurn = <T>(task: () => Promise<T>): Promise<T> => {
		const run = queue.then(task);
		queue = run.catch(() => undefined);
		return run;
	};

	const snapshot = (comments: readonly ReviewComment[]): CommentsState => ({
		comments: comments.map((comment) => ({ ...comment })),
	});

	/**
	 * `next` makes the new list from the current one; the current list itself means "nothing to
	 * write".
	 */
	const change = (
		next: (current: readonly ReviewComment[]) => readonly ReviewComment[],
	): Promise<CommentsState> =>
		inTurn(async () => {
			const current: readonly ReviewComment[] = await readComments(file);
			const comments = next(current);
			if (comments !== current) {
				await mkdir(dirname(file), { recursive: true });
				const tmp = `${file}.${process.pid}.tmp`;
				await Bun.write(tmp, `${JSON.stringify({ comments }, null, "\t")}\n`);
				await rename(tmp, file);
			}
			return snapshot(comments);
		});

	return {
		list() {
			return inTurn(async () => snapshot(await readComments(file)));
		},
		add(comment) {
			return change((current) => {
				const now = new Date().toISOString();
				const id = crypto.randomUUID();
				return [...current, readComment({ ...comment, id, createdAt: now, updatedAt: now })];
			});
		},
		async edit(id, text) {
			let known = true;
			const state = await change((current) => {
				const clean = readText(text);
				const at = current.findIndex((comment) => comment.id === id);
				const old = current[at];
				known = old !== undefined;
				if (!old || old.text === clean) return current;
				return current.with(at, { ...old, text: clean, updatedAt: new Date().toISOString() });
			});
			return known ? state : null;
		},
		remove(id) {
			return change((current) =>
				current.some((comment) => comment.id === id)
					? current.filter((comment) => comment.id !== id)
					: current,
			);
		},
		clear() {
			return change((current) => (current.length === 0 ? current : []));
		},
	};
}
