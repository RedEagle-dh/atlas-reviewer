/**
 * The `/api` handlers: thin, they parse the request, ask the session and shape the answer.
 */
import { UnknownRangeError } from "../core/build";
import {
	InvalidCommentError,
	MAX_COMMENT_SNIPPET,
	MAX_COMMENT_TEXT,
	readCommentDraft,
	readCommentEdit,
} from "../core/comments";
import { RangeMovedError, type ReviewSession } from "../core/session";
import { GitError } from "../core/source";
import type { ApiErrorBody, ViewedUpdate } from "../core/types";

const NO_STORE = { "cache-control": "no-store" };

function json(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: NO_STORE });
}

function failure(status: number, error: ApiErrorBody["error"], message: string): Response {
	const body: ApiErrorBody = { error, message };
	return json(body, status);
}

/** A request the handler cannot read; the message says why. */
class BadRequestError extends Error {}

/** Maps errors to the contract's error body; unknown errors are 500s with their message. */
async function guarded(handler: () => Promise<Response>): Promise<Response> {
	try {
		return await handler();
	} catch (error) {
		if (error instanceof BadRequestError || error instanceof InvalidCommentError)
			return failure(400, "bad-request", error.message);
		if (error instanceof UnknownRangeError) return failure(404, "unknown-range", error.message);
		if (error instanceof RangeMovedError) return failure(409, "range-moved", error.message);
		const message =
			error instanceof GitError || error instanceof Error ? error.message : String(error);
		console.error(`[review-atlas] ${message}`);
		return failure(500, "internal", message);
	}
}

function rangeParam(url: URL): string | undefined {
	return url.searchParams.get("range") ?? undefined;
}

function isViewedUpdate(value: unknown): value is ViewedUpdate {
	if (typeof value !== "object" || value === null) return false;
	if (!("path" in value) || typeof value.path !== "string" || value.path === "") return false;
	if (!("viewed" in value) || typeof value.viewed !== "boolean") return false;
	const optionalText = (field: unknown) => field === undefined || typeof field === "string";
	return (
		optionalText("range" in value ? value.range : undefined) &&
		optionalText("blob" in value ? value.blob : undefined)
	);
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * The largest request body in bytes (also the server's `maxRequestBodySize`), made from what it
 * has to hold: a comment draft at its limits. JSON spends at most six bytes on one character
 * (`\u001f`); the 16 KiB on top are room for the path, the numbers and the field names.
 */
export const MAX_BODY = 6 * (MAX_COMMENT_TEXT + MAX_COMMENT_SNIPPET) + 16 * 1024;

/** `application/json`, with or without parameters (`; charset=utf-8`). */
const JSON_TYPE = /^application\/json\s*(?:;|$)/i;

/**
 * The body as JSON, and it has to say so (`content-type: application/json`). A page of any other
 * site can make the browser send a form or plain text to this server, but before a request of
 * this type the browser asks first (a CORS preflight), and nothing here answers yes. Without the
 * check any page the reader has open could write a comment, and comments end up in a prompt for
 * a coding agent.
 *
 * Bun turns a larger body away before a handler runs (413, without a body); the size check here
 * holds for whoever calls a handler another way.
 */
async function jsonBody(req: Request): Promise<unknown> {
	if (!JSON_TYPE.test(req.headers.get("content-type") ?? ""))
		throw new BadRequestError("the body must be sent as application/json");
	const text = await req.text();
	if (text.length > MAX_BODY) throw new BadRequestError("body too large");
	try {
		return JSON.parse(text);
	} catch {
		throw new BadRequestError("body must be JSON");
	}
}

/** A request of the route `/api/comments/:id`: Bun reads the id out of the path. */
export type CommentRequest = Request & { params: { id: string } };

export function createApi(session: ReviewSession) {
	return {
		/** GET /api/review */
		review: () => guarded(async () => json(session.meta())),

		/** GET /api/model?range=<id> */
		model: (req: Request) =>
			guarded(async () => json(await session.model(rangeParam(new URL(req.url))))),

		/** GET /api/file?range=<id>&path=<repo path>[&base=<sha>&head=<sha>] */
		file: (req: Request) =>
			guarded(async () => {
				const url = new URL(req.url);
				const path = url.searchParams.get("path");
				if (!path) return failure(400, "bad-request", "query parameter `path` is required");
				const base = url.searchParams.get("base");
				const head = url.searchParams.get("head");
				if ((base === null) !== (head === null))
					return failure(400, "bad-request", "give both `base` and `head`, or neither");
				if (base !== null && head !== null && !(SHA.test(base) && SHA.test(head)))
					return failure(400, "bad-request", "`base` and `head` must be full commit shas");
				const at = base !== null && head !== null ? { base, head } : undefined;
				const view = await session.file(rangeParam(url), path, at);
				if (!view) return failure(404, "not-found", `${path} is not a file of this range`);
				return json(view);
			}),

		/** GET /api/state */
		getState: () => guarded(async () => json(await session.viewed())),

		/** PUT /api/state { path, viewed, range?, blob? } */
		putState: (req: Request) =>
			guarded(async () => {
				const body = await jsonBody(req);
				if (!isViewedUpdate(body))
					return failure(
						400,
						"bad-request",
						"body must be { path: string, viewed: boolean, range?: string, blob?: string }",
					);
				const state = await session.setViewed(body);
				if (!state) return failure(404, "not-found", `${body.path} is not a file of this range`);
				return json(state);
			}),

		/** GET /api/comments */
		getComments: () => guarded(async () => json(await session.comments())),

		/** POST /api/comments { path, line?, endLine?, snippet?, text, range?, head? } */
		addComment: (req: Request) =>
			guarded(async () => {
				const draft = readCommentDraft(await jsonBody(req));
				const state = await session.addComment(draft);
				if (!state) return failure(404, "not-found", `${draft.path} is not a file of this range`);
				return json(state);
			}),

		/** PUT /api/comments/:id { text } */
		editComment: (req: CommentRequest) =>
			guarded(async () => {
				const { id } = req.params;
				const state = await session.editComment(id, readCommentEdit(await jsonBody(req)));
				if (!state) return failure(404, "not-found", `there is no comment with the id "${id}"`);
				return json(state);
			}),

		/** DELETE /api/comments/:id */
		removeComment: (req: CommentRequest) =>
			guarded(async () => json(await session.removeComment(req.params.id))),

		/** DELETE /api/comments */
		clearComments: () => guarded(async () => json(await session.clearComments())),

		/** Anything else under /api (also a known path with another method). */
		notFound: (req: Request) =>
			failure(404, "not-found", `no such endpoint: ${req.method} ${new URL(req.url).pathname}`),
	};
}
