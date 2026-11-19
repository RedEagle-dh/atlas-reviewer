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
	if (value.head !== undefined) {
		// Not empty: "no commit" is said by leaving the field out. An empty one would be answered
		// as a range that has moved on, from nowhere.
		if (typeof value.head !== "string" || value.head === "")
			throw new InvalidCommentError("`head` must be a non-empty string");
		draft.head = value.head;
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
	const word = (field: "id" | "range" | "head" | "createdAt" | "updatedAt"): string => {
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
		createdAt: time("createdAt"),
		updatedAt: time("updatedAt"),
	};
}

/** The comments of a file on disk; none when it is missing or no JSON, without the entries that break a rule. */
async function readComments(file: string): Promise<ReviewComment[]> {
	const comments: ReviewComment[] = [];
	const ids = new Set<string>();
	let data: unknown;
	try {
		data = JSON.parse(await Bun.file(file).text());
	} catch {
		// No comments yet (or unreadable): none.
		return comments;
	}
	if (!isRecord(data) || !Array.isArray(data.comments)) return comments;
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
	// Read once, and only once: a second read that finished after a write would bring the old list back.
	let loaded: Promise<{ comments: readonly ReviewComment[] }> | undefined;
	const load = () => {
		loaded ??= readComments(file).then((comments) => ({ comments }));
		return loaded;
	};
	// Writes run one after the other, so two quick requests cannot lose each other's comment.
	let queue: Promise<unknown> = Promise.resolve();

	const snapshot = (comments: readonly ReviewComment[]): CommentsState => ({
		comments: comments.map((comment) => ({ ...comment })),
	});

	/**
	 * `next` makes the new list from the current one; the current list itself means "nothing to
	 * write". The list in memory changes only after the file is written: the two never differ.
	 */
	const change = (
		next: (current: readonly ReviewComment[]) => readonly ReviewComment[],
	): Promise<CommentsState> => {
		const run = queue.then(async () => {
			const state = await load();
			const comments = next(state.comments);
			if (comments !== state.comments) {
				await mkdir(dirname(file), { recursive: true });
				const tmp = `${file}.${process.pid}.tmp`;
				await Bun.write(tmp, `${JSON.stringify({ comments }, null, "\t")}\n`);
				await rename(tmp, file);
				state.comments = comments;
			}
			return snapshot(comments);
		});
		queue = run.catch(() => undefined);
		return run;
	};

	return {
		async list() {
			return snapshot((await load()).comments);
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
