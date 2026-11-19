/**
 * What every view and component reads: the review, the model of the current range, the visible
 * files, the viewed marks, and navigation that keeps the range. Provided once by `app.tsx`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ChangedFile, ReviewModel, ViewedState } from "../../core/types";
import { ApiError, getViewed, setViewed as putViewed } from "../api";
import { readingList, viewedKey, visibleFiles } from "../lib/files";
import { type Route, withRange } from "../router";
import type { NamedMeta } from "../strings";
import { hrefOf, navigate } from "./route";

export interface Atlas {
	/** The review, with the UI's words for category ids and the rest chapter filled in. */
	meta: NamedMeta;
	model: ReviewModel;
	/** The range shown (resolved: the first range when the URL names none). */
	rangeId: string;
	categories: ReadonlySet<string>;
	toggleCategory: (category: string) => void;
	/** Files of the visible categories, by path. */
	visible: ChangedFile[];
	/** The visible files in reading order. */
	reading: ChangedFile[];
	/** Every file of the model by path (visible or not). */
	byPath: ReadonlyMap<string, ChangedFile>;
	viewed: Readonly<Record<string, string>>;
	setViewed: (file: ChangedFile, viewed: boolean) => void;
	/** Loads the model of the range again (the server said the range has moved on). */
	reloadModel: () => void;
	/** Opens a route in the current range. */
	go: (route: Route, options?: { replace?: boolean }) => void;
	/** `href` of a route in the current range. */
	href: (route: Route) => string;
}

export const AtlasContext = createContext<Atlas | null>(null);

export function useAtlas(): Atlas {
	const atlas = useContext(AtlasContext);
	if (!atlas) throw new Error("useAtlas outside <AtlasContext.Provider>");
	return atlas;
}

/** A 409 from the server: the range has new commits since the model was loaded. */
export function isRangeMoved(error: unknown): boolean {
	return error instanceof ApiError && error.body.error === "range-moved";
}

/**
 * The viewed marks: loaded once, changed optimistically, corrected by the server's answer. A mark
 * names the blob the page shows; when the server has a newer one (409), the mark is not written,
 * the marks are loaded again and `onMoved` reloads the model.
 */
export function useViewedState(
	rangeId: string,
	onMoved: () => void,
): {
	viewed: Readonly<Record<string, string>>;
	setViewed: (file: ChangedFile, viewed: boolean) => void;
	error: string | null;
} {
	const [state, setState] = useState<ViewedState>({ viewed: {} });
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		getViewed({ signal: controller.signal }).then(setState, (e: unknown) => {
			if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
		});
		return () => controller.abort();
	}, []);
	const setViewed = useCallback(
		(file: ChangedFile, viewed: boolean) => {
			const blob = viewedKey(file);
			setState((prev) => {
				const next = { ...prev.viewed };
				if (viewed && blob) next[file.path] = blob;
				else delete next[file.path];
				return { viewed: next };
			});
			const update = { path: file.path, viewed, range: rangeId };
			putViewed(viewed && blob ? { ...update, blob } : update).then(
				(answer) => {
					setState(answer);
					setError(null);
				},
				(e: unknown) => {
					if (isRangeMoved(e)) {
						getViewed().then(setState, () => undefined);
						onMoved();
						return;
					}
					setError(e instanceof Error ? e.message : String(e));
				},
			);
		},
		[rangeId, onMoved],
	);
	return { viewed: state.viewed, setViewed, error };
}

export function useAtlasValue(input: {
	meta: NamedMeta;
	model: ReviewModel;
	rangeId: string;
	rangeParam: string | undefined;
	categories: ReadonlySet<string>;
	toggleCategory: (category: string) => void;
	viewed: Readonly<Record<string, string>>;
	setViewed: (file: ChangedFile, viewed: boolean) => void;
	reloadModel: () => void;
}): Atlas {
	const {
		meta,
		model,
		rangeId,
		rangeParam,
		categories,
		toggleCategory,
		viewed,
		setViewed,
		reloadModel,
	} = input;
	const visible = useMemo(() => visibleFiles(model, categories), [model, categories]);
	const reading = useMemo(() => readingList(model, visible), [model, visible]);
	const byPath = useMemo(() => new Map(model.files.map((f) => [f.path, f])), [model]);
	const go = useCallback(
		(route: Route, options?: { replace?: boolean }) =>
			navigate(withRange(route, rangeParam), options),
		[rangeParam],
	);
	const href = useCallback((route: Route) => hrefOf(withRange(route, rangeParam)), [rangeParam]);
	return useMemo(
		() => ({
			meta,
			model,
			rangeId,
			categories,
			toggleCategory,
			visible,
			reading,
			byPath,
			viewed,
			setViewed,
			reloadModel,
			go,
			href,
		}),
		[
			meta,
			model,
			rangeId,
			categories,
			toggleCategory,
			visible,
			reading,
			byPath,
			viewed,
			setViewed,
			reloadModel,
			go,
			href,
		],
	);
}
