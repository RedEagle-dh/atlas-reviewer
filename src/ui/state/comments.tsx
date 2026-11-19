/**
 * The review's comments in the browser: loaded once, changed only through the server, and every
 * answer of the server is the new state (it always sends the whole list). `CommentsProvider`
 * provides them, `useComments()` reads them, `useCommentActions()` only changes them.
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
import {
	ApiError,
	addComment,
	clearComments,
	editComment,
	getComments,
	removeComment,
} from "../api";
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
	/**
	 * False when no answer came at all (the server is not running, the network is gone): then
	 * `message` is the browser's word for that, which tells a reader nothing.
	 */
	answered: boolean;
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
	 * The list is being asked for again (`reload`, the tab coming back): its answer is not there
	 * yet.
	 */
	refreshing: boolean;
	/**
	 * Asking for the list again failed after it had been loaded: what is shown is what this tab
	 * knew before, and another tab may have changed it since. Gone with the next answer.
	 */
	stale: boolean;
	/**
	 * Writes a comment in the current range, for the head commit the page shows. The comment as
	 * the server recorded it; `null` when it failed. When the range has moved on since, nothing is
	 * written and the app loads the new state.
	 */
	add: (draft: Omit<CommentDraft, "range" | "head" | "base">) => Promise<ReviewComment | null>;
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
	/** False when `error` stands for no answer at all (see `CommentFailure.answered`). */
	answered: boolean;
	/** From the moment `load()` is called until its answer (or its failure) is published. */
	refreshing: boolean;
	/** The last attempt to get the list failed while a list was loaded (see `Comments.stale`). */
	stale: boolean;
}

/**
 * The comments outside React, so the rules are plain to see (and to test): one request at a
 * time, the server's answer is the state, and after a failure the list is asked for again,
 * because the request may have reached the server or not. The one failure that says what the
 * server did is a comment refused because the range has moved on (409 `range-moved`): nothing
 * was written, so the list is not asked for, and `onMoved` is told to load the new state.
 */
export function createCommentsStore(api: CommentsApi = SERVER, onMoved: () => void = () => {}) {
	/** Nothing has failed. */
	const fine = { error: null, moved: false, answered: true, stale: false };
	/** The `load()`s that have been called and whose answer is not published yet. */
	let asking = 0;
	let snapshot: CommentsSnapshot = { comments: [], loaded: false, ...fine, refreshing: false };
	const listeners = new Set<() => void>();
	const publish = (next: Omit<CommentsSnapshot, "refreshing">) => {
		snapshot = { ...next, refreshing: asking > 0 };
		for (const listener of listeners) listener();
	};
	/**
	 * A list of the server with the objects the page already has for every comment that did not
	 * change (its text is all that can). Whatever shows one comment is given the same object and
	 * is not drawn again because another comment was written: with 200 cards that is felt.
	 */
	const settled = (comments: readonly ReviewComment[]): readonly ReviewComment[] => {
		const known = new Map(snapshot.comments.map((comment) => [comment.id, comment]));
		return comments.map((comment) => {
			const before = known.get(comment.id);
			return before?.updatedAt === comment.updatedAt && before.text === comment.text
				? before
				: comment;
		});
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
				publish({ comments: settled(state.comments), loaded: true, ...fine });
				return state;
			} catch (error) {
				const moved = isRangeMoved(error);
				const now = askAgain && !moved ? await api.get().catch(() => null) : null;
				publish({
					comments: now ? settled(now.comments) : snapshot.comments,
					loaded: snapshot.loaded || now !== null,
					error: error instanceof Error ? error.message : String(error),
					moved,
					answered: error instanceof ApiError,
					// The list could not be had, and the one shown may be behind the server's. A refusal
					// because the range moved on wrote nothing: the list is as current as it was.
					stale: now !== null ? false : moved ? snapshot.stale : snapshot.loaded,
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
		load: (): Promise<boolean> => {
			asking++;
			if (!snapshot.refreshing) publish(snapshot);
			// Counted off just before its answer is published: the answer and the end of the wait come
			// in one snapshot.
			const get = async () => {
				try {
					return await api.get();
				} finally {
					asking--;
				}
			};
			return run(get, false).then((state) => state !== null);
		},
		/** The server appends: the new comment is the last one of its answer. */
		add: (draft: CommentDraft): Promise<ReviewComment | null> =>
			run(() => api.add(draft), true).then((state) => state?.comments.at(-1) ?? null),
		edit: (id: string, text: string): Promise<boolean> =>
			run(() => api.edit(id, { text }), true).then((state) => state !== null),
		remove: (id: string): Promise<boolean> =>
			run(() => api.remove(id), true).then((state) => state !== null),
		clear: (): Promise<boolean> => run(() => api.clear(), true).then((state) => state !== null),
		failure: (): CommentFailure | null =>
			snapshot.error === null
				? null
				: { message: snapshot.error, moved: snapshot.moved, answered: snapshot.answered },
	};
}

/**
 * The requests without the list: the same functions for as long as the provider lives. A
 * component that shows one comment asks for these alone (`useCommentActions`), so it is not
 * drawn again when the list changes.
 */
export type CommentActions = Pick<
	Comments,
	"add" | "edit" | "remove" | "clear" | "reload" | "failure"
>;

const CommentsContext = createContext<Comments | null>(null);
const ActionsContext = createContext<CommentActions | null>(null);

/**
 * Comments belong to the review, not to a range, so the provider stays where it is when the
 * range changes. `rangeId`, `head` and `base` (the range shown and the commits of its model,
 * `null` while that loads) say where a new comment is written and which commits its lines are
 * read off;
 * `onMoved` loads the model again when the server says the range has left that commit.
 */
export function CommentsProvider({
	rangeId,
	head,
	base,
	onMoved,
	children,
}: {
	rangeId: string;
	head: string | null;
	base: string | null;
	onMoved: () => void;
	children: ReactNode;
}) {
	// The store lives as long as the provider, and so does `add`: both read what the latest render
	// was given. An "undo" that is pressed after the range changed still writes for the range and
	// the head the page shows by then.
	const latest = useRef({ rangeId, head, base, onMoved });
	latest.current = { rangeId, head, base, onMoved };
	const [store] = useState(() => createCommentsStore(SERVER, () => latest.current.onMoved()));
	useEffect(() => {
		store.load();
		// Another tab of the same review writes comments too: back in this one, ask again.
		const onVisible = () => {
			if (document.visibilityState === "visible") store.load();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, [store]);
	const { comments, loaded, error, refreshing, stale } = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
	);
	const byPath = useMemo(() => commentsByPath(comments), [comments]);
	const add = useCallback(
		(draft: Omit<CommentDraft, "range" | "head" | "base">) => {
			const { rangeId: range, head: shownHead, base: shownBase } = latest.current;
			return store.add({
				...draft,
				range,
				...(shownHead === null ? {} : { head: shownHead }),
				...(shownBase === null ? {} : { base: shownBase }),
			});
		},
		[store],
	);
	const actions = useMemo<CommentActions>(
		() => ({
			add,
			edit: store.edit,
			remove: store.remove,
			clear: store.clear,
			reload: store.load,
			failure: store.failure,
		}),
		[add, store],
	);
	const value = useMemo<Comments>(
		() => ({ comments, byPath, loaded, error, refreshing, stale, ...actions }),
		[comments, byPath, loaded, error, refreshing, stale, actions],
	);
	return (
		<ActionsContext.Provider value={actions}>
			<CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>
		</ActionsContext.Provider>
	);
}

export function useCommentActions(): CommentActions {
	const actions = useContext(ActionsContext);
	if (!actions) throw new Error("useCommentActions outside <CommentsProvider>");
	return actions;
}

export function useComments(): Comments {
	const comments = useContext(CommentsContext);
	if (!comments) throw new Error("useComments outside <CommentsProvider>");
	return comments;
}
