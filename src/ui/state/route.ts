/**
 * The current hash route as React state, navigation that keeps back/forward working, and the
 * reading position of every history entry, so Back returns to where the reader was.
 */
import { type RefObject, useEffect, useMemo, useSyncExternalStore } from "react";
import { formatHash, parseHash, type Route } from "../router";

function subscribe(onChange: () => void): () => void {
	window.addEventListener("hashchange", onChange);
	return () => window.removeEventListener("hashchange", onChange);
}

const snapshot = () => window.location.hash;

export function useRoute(): Route {
	const hash = useSyncExternalStore(subscribe, snapshot);
	return useMemo(() => parseHash(hash), [hash]);
}

/** Pushes a history entry (or replaces the current one) for `route`. */
export function navigate(route: Route, options: { replace?: boolean } = {}): void {
	const hash = formatHash(route);
	if (hash === window.location.hash) return;
	if (options.replace) {
		window.history.replaceState(window.history.state, "", hash);
		window.dispatchEvent(new HashChangeEvent("hashchange"));
	} else {
		window.location.hash = hash;
	}
}

/** `href` for a link to a route (so middle-click and "open in new tab" work). */
export function hrefOf(route: Route): string {
	return formatHash(route);
}

// ---------------------------------------------------------------------------------------------
// Reading positions per history entry
// ---------------------------------------------------------------------------------------------

/** Where the reader was on an entry: the scroll of the main area, the map's viewport. */
export interface Position {
	scroll?: number;
	viewport?: { x: number; y: number; zoom: number };
}

const positions = new Map<string, Position>();
let current = "";
/** The position to restore on the entry just reached by back/forward, until its view takes it. */
let pending: { position: Position; since: number } | null = null;
let counter = 0;

function entryOf(state: unknown): string {
	return typeof state === "object" &&
		state !== null &&
		"atlasEntry" in state &&
		typeof state.atlasEntry === "string"
		? state.atlasEntry
		: "";
}

/**
 * Runs on every hash change, before React sees it (registered when this module loads). A new
 * entry has no key in `history.state` yet and gets one; an entry that has one was reached by
 * back/forward, and its saved position waits for its view. A replaced entry keeps its key.
 */
function track(): void {
	const known = entryOf(window.history.state);
	if (known !== "" && known === current) return;
	if (known !== "") {
		current = known;
		const position = positions.get(known);
		pending = position ? { position, since: Date.now() } : null;
		return;
	}
	current = `${Date.now().toString(36)}.${counter++}`;
	const state: unknown = window.history.state;
	const base = typeof state === "object" && state !== null ? state : {};
	window.history.replaceState({ ...base, atlasEntry: current }, "");
	pending = null;
}

if (typeof window !== "undefined") {
	window.addEventListener("hashchange", track);
	track();
}

function remember(update: Position): void {
	positions.set(current, { ...positions.get(current), ...update });
}

/**
 * The saved position of the entry just reached by back/forward, for one view to take once
 * (`undefined` on a new entry). A `?line=` deep link is applied after it, so the link wins.
 */
export function takeRestore<K extends keyof Position>(kind: K): Position[K] | undefined {
	if (!pending) return undefined;
	const value = pending.position[kind];
	pending = null;
	return value;
}

/** Keeps the map's viewport of the current entry. */
export function rememberViewport(viewport: { x: number; y: number; zoom: number }): void {
	remember({ viewport });
}

/**
 * Keeps the scroll position of the main area for the current entry. While a restore is pending
 * the area is still showing the previous view (or a loading state that clamps the scroll), so
 * those scroll events are not the reader's.
 */
export function useScrollMemory(main: RefObject<HTMLElement | null>): void {
	useEffect(() => {
		const el = main.current;
		if (!el) return;
		const onScroll = () => {
			if (pending && Date.now() - pending.since < 4000) return;
			remember({ scroll: el.scrollTop });
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [main]);
}
