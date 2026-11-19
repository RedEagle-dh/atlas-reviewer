/**
 * The typed client for the four endpoints: the browser half of the contract in
 * `src/core/types.ts` (imported as types only, so nothing of the server reaches the bundle).
 */
import type {
	ApiErrorBody,
	FileView,
	ReviewMeta,
	ReviewModel,
	ViewedState,
	ViewedUpdate,
} from "../core/types";

/** A non-2xx answer; `body.error` says which kind (`not-found`, `unknown-range`, …). */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly body: ApiErrorBody,
	) {
		super(body.message);
		this.name = "ApiError";
	}
}

function isErrorBody(value: unknown): value is ApiErrorBody {
	return (
		typeof value === "object" &&
		value !== null &&
		"error" in value &&
		typeof value.error === "string" &&
		"message" in value &&
		typeof value.message === "string"
	);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, init);
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		throw new ApiError(
			response.status,
			isErrorBody(body)
				? body
				: { error: "internal", message: `${response.status} ${response.statusText}` },
		);
	}
	// The server answers with the contract's types (src/core/types.ts); the body is trusted as T.
	return body as T;
}

function query(params: Record<string, string | undefined>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params))
		if (value !== undefined) search.set(key, value);
	const text = search.toString();
	return text ? `?${text}` : "";
}

export interface RequestOptions {
	signal?: AbortSignal;
}

/** GET /api/review */
export function getReview(options: RequestOptions = {}): Promise<ReviewMeta> {
	return request("/api/review", options);
}

/** GET /api/model?range=<id> (no range = the review's first range) */
export function getModel(range?: string, options: RequestOptions = {}): Promise<ReviewModel> {
	return request(`/api/model${query({ range })}`, options);
}

/**
 * GET /api/file?range=<id>&path=<repo path>&base=<sha>&head=<sha> — any file of the head commit.
 * `at` names the state the page shows: when the range has moved on, the answer is 409
 * `range-moved` instead of a file of another state.
 */
export function getFile(
	path: string,
	range?: string,
	options: RequestOptions & { at?: { base: string; head: string } } = {},
): Promise<FileView> {
	const { at, ...init } = options;
	return request(`/api/file${query({ range, path, base: at?.base, head: at?.head })}`, init);
}

/** GET /api/state */
export function getViewed(options: RequestOptions = {}): Promise<ViewedState> {
	return request("/api/state", options);
}

/**
 * PUT /api/state — marks a file viewed at the blob the page shows (409 `range-moved` when the
 * file has changed since), or removes the mark
 */
export function setViewed(
	update: ViewedUpdate,
	options: RequestOptions = {},
): Promise<ViewedState> {
	return request("/api/state", {
		...options,
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(update),
	});
}
