/**
 * The HTTP server: the UI as an HTML import (Bun bundles its TSX and CSS) and the `/api` routes.
 */
import type { Review } from "../core/define";
import { ReviewSession, type SessionOptions } from "../core/session";
import ui from "../ui/index.html";
import { createApi } from "./api";

export interface ServerOptions extends SessionOptions {
	/** Default 4610; 0 picks a free port. */
	port?: number;
	/** Default 127.0.0.1. */
	host?: string;
	/** Bun's development mode: no minification, source maps, re-bundling and hot reload of the UI. */
	development?: boolean;
	/** An existing session (the CLI builds the default range before it starts the server). */
	session?: ReviewSession;
}

export interface RunningServer {
	server: Bun.Server<undefined>;
	session: ReviewSession;
	url: string;
	stop(): Promise<void>;
}

export const DEFAULT_PORT = 4610;
export const DEFAULT_HOST = "127.0.0.1";

export function startServer(review: Review, options: ServerOptions = {}): RunningServer {
	const session = options.session ?? new ReviewSession(review, options);
	const api = createApi(session);
	const server = Bun.serve({
		hostname: options.host ?? DEFAULT_HOST,
		port: options.port ?? DEFAULT_PORT,
		development: options.development ?? false,
		// The only body the API takes is a small `PUT /api/state`.
		maxRequestBodySize: 64 * 1024,
		routes: {
			"/": ui,
			"/api/review": { GET: api.review },
			"/api/model": { GET: api.model },
			"/api/file": { GET: api.file },
			"/api/state": { GET: api.getState, PUT: api.putState },
			"/api/*": api.notFound,
		},
		fetch() {
			return new Response("Not found", { status: 404 });
		},
	});
	const url = server.url.href;
	return { server, session, url, stop: () => server.stop(true) };
}
