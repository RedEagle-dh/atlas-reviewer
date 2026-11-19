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
	useState,
	useSyncExternalStore,
} from "react";
import type { CommentDraft, CommentEdit, CommentsState, ReviewComment } from "../../core/types";
import { addComment, clearComments, editComment, getComments, removeComment } from "../api";
import { commentsByPath } from "../lib/comments";

export interface Comments {
	/** In the order they were written; `sortComments` puts them in reading order. */
	comments: readonly ReviewComment[];
	/** A file's comments: those on the whole file first, then by line. */
	byPath: ReadonlyMap<string, readonly ReviewComment[]>;
	/** False until the server has answered once. */
	loaded: boolean;
	/** The message of the last request that failed; gone when the next one succeeds. */
	error: string | null;
	/** Writes a comment in the current range. The comment as the server recorded it; `null` when it failed. */
	add: (draft: Omit<CommentDraft, "range">) => Promise<ReviewComment | null>;
	/** These three: `false` when the request failed (`error` says why). */
	edit: (id: string, text: string) => Promise<boolean>;
	remove: (id: string) => Promise<boolean>;
	clear: () => Promise<boolean>;
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
}

/**
 * The comments outside React, so the rules are plain to see (and to test): one request at a
 * time, the server's answer is the state, and after a failure the list is asked for again,
 * because the request may have reached the server or not.
 */
export function createCommentsStore(api: CommentsApi = SERVER) {
	let snapshot: CommentsSnapshot = { comments: [], loaded: false, error: null };
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
				publish({ comments: state.comments, loaded: true, error: null });
				return state;
			} catch (error) {
				const now = askAgain ? await api.get().catch(() => null) : null;
				publish({
					comments: now?.comments ?? snapshot.comments,
					loaded: snapshot.loaded || now !== null,
					error: error instanceof Error ? error.message : String(error),
				});
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
	};
}

const CommentsContext = createContext<Comments | null>(null);

/**
 * Comments belong to the review, not to a range, so the provider stays where it is when the
 * range changes; `rangeId` (the range shown) only says where a new comment is written.
 */
export function CommentsProvider({ rangeId, children }: { rangeId: string; children: ReactNode }) {
	const [store] = useState(() => createCommentsStore());
	useEffect(() => {
		store.load();
	}, [store]);
	const { comments, loaded, error } = useSyncExternalStore(store.subscribe, store.getSnapshot);
	const byPath = useMemo(() => commentsByPath(comments), [comments]);
	const add = useCallback(
		(draft: Omit<CommentDraft, "range">) => store.add({ ...draft, range: rangeId }),
		[store, rangeId],
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
