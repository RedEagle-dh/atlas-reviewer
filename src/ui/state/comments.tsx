/**
 * The review's comments in the browser: loaded once, changed only through the server, and every
 * answer of the server is the new state (it always sends the whole list). `CommentsProvider`
 * provides them, `useComments()` reads them.
 */
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { CommentDraft, CommentEdit, CommentsState, ReviewComment } from "../../core/types";
import { addComment, clearComments, editComment, getComments, removeComment } from "../api";
import { commentsByPath } from "../lib/comments";
import { isRangeMoved } from "./atlas";

/** Why a request failed. */
export interface CommentFailure {
	/** The server's message, or the browser's when the server did not answer. */
	message: string;
	/**
	 * The range has new commits since the page loaded its model (409 `range-moved`): nothing was
	 * written, and the page is loading the new state.
	 */
	moved: boolean;
}

export interface Comments {
	/** In the order they were written; `sortComments` puts them in reading order. */
	comments: readonly ReviewComment[];
	/** A file's comments: those on the whole file first, then by line. */
	byPath: ReadonlyMap<string, readonly ReviewComment[]>;
	/** False until the server has answered once. */
	loaded: boolean;
	/** The message of the last request that failed; gone when the next one succeeds. */
	error: string | null;
	/**
	 * Writes a comment in the current range, for the head commit the page shows. The comment as
	 * the server recorded it; `null` when it failed. When the range has moved on since, nothing is
	 * written and the app loads the new state.
	 */
	add: (draft: Omit<CommentDraft, "range" | "head">) => Promise<ReviewComment | null>;
	/** These three: `false` when the request failed (`error` says why). */
	edit: (id: string, text: string) => Promise<boolean>;
	remove: (id: string) => Promise<boolean>;
	clear: () => Promise<boolean>;
	/** Asks the server for the list again (after a load that failed). */
	reload: () => Promise<boolean>;
	/**
	 * Why the last request failed, `null` when it did not. For whoever just got `null` or `false`
	 * from a request: unlike `error` it does not wait for the next render.
	 */
	failure: () => CommentFailure | null;
}

/** The requests the comments are kept with: `../api` in the app, a stand-in in tests. */
export interface CommentsApi {
	get: () => Promise<CommentsState>;
	add: (draft: CommentDraft) => Promise<CommentsState>;
	edit: (id: string, edit: CommentEdit) => Promise<CommentsState>;
	remove: (id: string) => Promise<CommentsState>;
	clear: () => Promise<CommentsState>;
}

const SERVER: CommentsApi = {
	get: getComments,
	add: addComment,
	edit: editComment,
	remove: removeComment,
	clear: clearComments,
};

export interface CommentsSnapshot {
	comments: readonly ReviewComment[];
	loaded: boolean;
	error: string | null;
	/** True when `error` is the server's "the range has moved on" (see `CommentFailure.moved`). */
	moved: boolean;
}

/**
 * The comments outside React, so the rules are plain to see (and to test): one request at a
 * time, the server's answer is the state, and after a failure the list is asked for again,
 * because the request may have reached the server or not. The one failure that says what the
 * server did is a comment refused because the range has moved on (409 `range-moved`): nothing
 * was written, so the list is not asked for, and `onMoved` is told to load the new state.
 */
export function createCommentsStore(api: CommentsApi = SERVER, onMoved: () => void = () => {}) {
	let snapshot: CommentsSnapshot = { comments: [], loaded: false, error: null, moved: false };
	const listeners = new Set<() => void>();
	const publish = (next: CommentsSnapshot) => {
		snapshot = next;
		for (const listener of listeners) listener();
	};
	// Every answer is the whole list, so the last answer to arrive has to be the newest: a request
	// waits for the one before it.
	let queue: Promise<unknown> = Promise.resolve();

	/** The answer becomes the state; `null` when the request failed. Never rejects. */
	const run = (
		send: () => Promise<CommentsState>,
		askAgain: boolean,
	): Promise<CommentsState | null> => {
		const done = queue.then(async () => {
			try {
				const state = await send();
				publish({ comments: state.comments, loaded: true, error: null, moved: false });
				return state;
			} catch (error) {
				const moved = isRangeMoved(error);
				const now = askAgain && !moved ? await api.get().catch(() => null) : null;
				publish({
					comments: now?.comments ?? snapshot.comments,
					loaded: snapshot.loaded || now !== null,
					error: error instanceof Error ? error.message : String(error),
					moved,
				});
				if (moved) onMoved();
				return null;
			}
		});
		queue = done;
		return done;
	};

	return {
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSnapshot: (): CommentsSnapshot => snapshot,
		load: (): Promise<boolean> => run(() => api.get(), false).then((state) => state !== null),
		/** The server appends: the new comment is the last one of its answer. */
		add: (draft: CommentDraft): Promise<ReviewComment | null> =>
			run(() => api.add(draft), true).then((state) => state?.comments.at(-1) ?? null),
		edit: (id: string, text: string): Promise<boolean> =>
			run(() => api.edit(id, { text }), true).then((state) => state !== null),
		remove: (id: string): Promise<boolean> =>
			run(() => api.remove(id), true).then((state) => state !== null),
		clear: (): Promise<boolean> => run(() => api.clear(), true).then((state) => state !== null),
		failure: (): CommentFailure | null =>
			snapshot.error === null ? null : { message: snapshot.error, moved: snapshot.moved },
	};
}

const CommentsContext = createContext<Comments | null>(null);

/**
 * Comments belong to the review, not to a range, so the provider stays where it is when the
 * range changes. `rangeId` and `head` (the range shown and the head commit of its model, `null`
 * while that loads) say where a new comment is written and which commit its lines are read off;
 * `onMoved` loads the model again when the server says the range has left that commit.
 */
export function CommentsProvider({
	rangeId,
	head,
	onMoved,
	children,
}: {
	rangeId: string;
	head: string | null;
	onMoved: () => void;
	children: ReactNode;
}) {
	// The store lives as long as the provider, and so does `add`: both read what the latest render
	// was given. An "undo" that is pressed after the range changed still writes for the range and
	// the head the page shows by then.
	const latest = useRef({ rangeId, head, onMoved });
	latest.current = { rangeId, head, onMoved };
	const [store] = useState(() => createCommentsStore(SERVER, () => latest.current.onMoved()));
	useEffect(() => {
		store.load();
	}, [store]);
	const { comments, loaded, error } = useSyncExternalStore(store.subscribe, store.getSnapshot);
	const byPath = useMemo(() => commentsByPath(comments), [comments]);
	const add = useCallback(
		(draft: Omit<CommentDraft, "range" | "head">) => {
			const { rangeId: range, head: shown } = latest.current;
			return store.add({ ...draft, range, ...(shown === null ? {} : { head: shown }) });
		},
		[store],
	);
	const value = useMemo<Comments>(
		() => ({
			comments,
			byPath,
			loaded,
			error,
			add,
			edit: store.edit,
			remove: store.remove,
			clear: store.clear,
			reload: store.load,
			failure: store.failure,
		}),
		[comments, byPath, loaded, error, add, store],
	);
	return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>;
}

export function useComments(): Comments {
	const comments = useContext(CommentsContext);
	if (!comments) throw new Error("useComments outside <CommentsProvider>");
	return comments;
}
