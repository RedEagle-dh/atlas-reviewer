/**
 * Hash routes: `#/<view>/<path>?<query>`. The first segment names the view (`map`, `file`, …,
 * see `views/index.ts`), the rest is a repo path or a group path, and the query carries the
 * range and the view's options. Pure functions; the hook that follows the hash is `state/route.ts`.
 *
 *   #/map                                  the map at the top level
 *   #/map/host/apps/api/src?by=chapters    a group (chapter id, then a directory)
 *   #/map/apps/web/src/routes?by=dirs      a group of the grouping "Pakete & Ordner"
 *   #/file/apps/api/src/app.ts?line=42     a file, scrolled to a line
 *   …&range=all                            on any route: the range (default: the first one)
 */

export interface Route {
	/** First path segment; `map` when the hash is empty. */
	view: string;
	/** The rest of the path, decoded; `""` when there is none. */
	path: string;
	query: Readonly<Record<string, string>>;
}

export const DEFAULT_VIEW = "map";

function decode(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/** Encodes like `encodeURIComponent` but keeps `/` readable. */
function encode(text: string): string {
	return encodeURIComponent(text).replaceAll("%2F", "/");
}

export function parseHash(hash: string): Route {
	const raw = hash.replace(/^#/, "").replace(/^\/+/, "");
	const q = raw.indexOf("?");
	const pathPart = q === -1 ? raw : raw.slice(0, q);
	const queryPart = q === -1 ? "" : raw.slice(q + 1);
	const segments = pathPart.split("/").filter((s) => s !== "");
	const query: Record<string, string> = {};
	for (const pair of queryPart.split("&")) {
		if (pair === "") continue;
		const eq = pair.indexOf("=");
		const key = decode((eq === -1 ? pair : pair.slice(0, eq)).replaceAll("+", " "));
		const value = eq === -1 ? "" : decode(pair.slice(eq + 1).replaceAll("+", " "));
		if (key !== "") query[key] = value;
	}
	const [view, ...rest] = segments.map(decode);
	return { view: view ?? DEFAULT_VIEW, path: rest.join("/"), query };
}

export function formatHash(route: Route): string {
	const path = route.path === "" ? "" : `/${route.path.split("/").map(encode).join("/")}`;
	const query = Object.entries(route.query)
		.filter(([, value]) => value !== "")
		.map(([key, value]) => `${encode(key)}=${encode(value)}`)
		.join("&");
	return `#/${encode(route.view)}${path}${query ? `?${query}` : ""}`;
}

/** The same route in another range (`undefined` = the default range). */
export function withRange(route: Route, range: string | undefined): Route {
	const { range: _old, ...rest } = route.query;
	return { ...route, query: range === undefined ? rest : { ...rest, range } };
}

// ---------------------------------------------------------------------------------------------
// The two built-in views
// ---------------------------------------------------------------------------------------------

export type Grouping = "chapters" | "dirs";

export interface MapParams {
	/** Group id (`""` = top level), see `views/map/grouping.ts`. */
	group: string;
	grouping: Grouping;
	/** A file to mark on the map ("Auf der Karte zeigen"). */
	focus?: string;
}

export function mapRoute(params: MapParams, range?: string): Route {
	const query: Record<string, string> = {};
	if (params.grouping === "dirs") query.by = "dirs";
	if (params.focus) query.focus = params.focus;
	if (range !== undefined) query.range = range;
	return { view: "map", path: params.group, query };
}

export function readMapParams(route: Route): MapParams {
	const params: MapParams = {
		group: route.path,
		grouping: route.query.by === "dirs" ? "dirs" : "chapters",
	};
	if (route.query.focus) params.focus = route.query.focus;
	return params;
}

export interface FileParams {
	path: string;
	/** 1-based line to show. */
	line?: number;
}

export function fileRoute(params: FileParams, range?: string): Route {
	const query: Record<string, string> = {};
	if (params.line !== undefined) query.line = String(params.line);
	if (range !== undefined) query.range = range;
	return { view: "file", path: params.path, query };
}

export function readFileParams(route: Route): FileParams {
	const line = Number(route.query.line);
	return Number.isInteger(line) && line > 0 ? { path: route.path, line } : { path: route.path };
}
