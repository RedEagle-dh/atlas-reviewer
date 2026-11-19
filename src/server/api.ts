/**
 * The `/api` handlers: thin, they parse the request, ask the session and shape the answer.
 */
import { UnknownRangeError } from "../core/build";
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

/** Maps errors to the contract's error body; unknown errors are 500s with their message. */
async function guarded(handler: () => Promise<Response>): Promise<Response> {
	try {
		return await handler();
	} catch (error) {
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

const MAX_BODY = 64 * 1024;

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
				const text = await req.text();
				if (text.length > MAX_BODY) return failure(400, "bad-request", "body too large");
				let body: unknown;
				try {
					body = JSON.parse(text);
				} catch {
					return failure(400, "bad-request", "body must be JSON");
				}
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

		/** Anything else under /api (also a known path with another method). */
		notFound: (req: Request) =>
			failure(404, "not-found", `no such endpoint: ${req.method} ${new URL(req.url).pathname}`),
	};
}
