/** Loading an API answer into React state: loading, error (with retry) or the value. */
import { useCallback, useEffect, useState } from "react";

export type Resource<T> =
	| { status: "loading" }
	| { status: "error"; error: unknown; retry: () => void }
	| { status: "ready"; value: T; reload: () => void };

/**
 * Loads `load()` whenever `key` changes; answers already loaded for a key are kept in `cache`
 * so switching back (another range, a file seen before) is instant.
 */
export function useResource<T>(
	key: string | null,
	load: (signal: AbortSignal) => Promise<T>,
	cache?: Map<string, T>,
): Resource<T> {
	const [state, setState] = useState<{ key: string | null; resource: Resource<T> }>({
		key: null,
		resource: { status: "loading" },
	});
	const [attempt, setAttempt] = useState(0);
	// A retry or reload forgets the cached answer, so the effect fetches again.
	const retry = useCallback(() => {
		if (key !== null) cache?.delete(key);
		setAttempt((n) => n + 1);
	}, [key, cache]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `load` changes identity on every render; `key` names what it loads.
	useEffect(() => {
		if (key === null) return;
		const cached = cache?.get(key);
		if (cached !== undefined) {
			setState({ key, resource: { status: "ready", value: cached, reload: retry } });
			return;
		}
		const controller = new AbortController();
		setState((prev) => (prev.key === key ? prev : { key, resource: { status: "loading" } }));
		load(controller.signal).then(
			(value) => {
				cache?.set(key, value);
				setState({ key, resource: { status: "ready", value, reload: retry } });
			},
			(error: unknown) => {
				if (controller.signal.aborted) return;
				setState({ key, resource: { status: "error", error, retry } });
			},
		);
		return () => controller.abort();
	}, [key, attempt, retry]);

	if (key === null || state.key !== key) return { status: "loading" };
	return state.resource;
}
