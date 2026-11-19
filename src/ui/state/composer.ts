/**
 * The comment that is being written on a file page (its "composer"): where it goes, and what is
 * typed so far. One per file, and kept outside the page's components, because a file page is
 * built anew when the range gets new commits or the reader looks at another file and comes back:
 * what is typed must still be there then.
 */
import { useSyncExternalStore } from "react";

/** The lines a composer is for; neither: the whole file. */
export interface ComposerPlace {
	line?: number;
	/** Only when it is after `line`. */
	endLine?: number;
}

export interface Composer extends ComposerPlace {
	/** The line the selection started on: a shift-click extends the range from here. */
	anchor?: number;
	/**
	 * What survives when the page is built anew. It is written while the reader types and read
	 * when a composer appears; changing it tells nobody, so typing redraws nothing but the field.
	 */
	memory: {
		text: string;
		/** Why the last attempt to save failed, as the composer says it. */
		problem: string | null;
	};
}

const holdsText = (composer: Composer | undefined): boolean =>
	composer !== undefined && composer.memory.text.trim() !== "";

function placed(a: number, b: number): ComposerPlace {
	const [line, endLine] = a <= b ? [a, b] : [b, a];
	return endLine > line ? { line, endLine } : { line };
}

export function createComposerStore() {
	const open = new Map<string, Composer>();
	const listeners = new Set<() => void>();
	const changed = () => {
		for (const listener of listeners) listener();
	};
	const close = (path: string): void => {
		if (open.delete(path)) changed();
	};

	return {
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		/** The same object until the composer's place changes. */
		get: (path: string): Composer | null => open.get(path) ?? null,
		/** True when a composer is open on the file with more in it than blanks. */
		holdsText: (path: string): boolean => holdsText(open.get(path)),
		/**
		 * Opens the composer of a file for the lines `from`..`to` (in either order; `from` is where
		 * the selection started), or without lines for the whole file. An empty composer that is
		 * open elsewhere on the file moves. One that holds text stays where it is, so nothing typed
		 * is lost: then the answer is `false`, and the caller shows the reader the open one.
		 */
		open(path: string, from?: number, to: number | undefined = from): boolean {
			const current = open.get(path);
			if (holdsText(current)) return false;
			const place = from === undefined || to === undefined ? {} : placed(from, to);
			if (current && current.line === place.line && current.endLine === place.endLine) return true;
			open.set(path, {
				...place,
				...(from === undefined ? {} : { anchor: from }),
				memory: { text: "", problem: null },
			});
			changed();
			return true;
		},
		/**
		 * A shift-click on `line`: the open composer for lines, while it is still empty, now reaches
		 * from where its selection started to `line`. `false` when there is no such composer.
		 */
		extend(path: string, line: number): boolean {
			const current = open.get(path);
			if (!current || current.line === undefined || holdsText(current)) return false;
			const anchor = current.anchor ?? current.line;
			open.set(path, { ...placed(anchor, line), anchor, memory: current.memory });
			changed();
			return true;
		},
		/**
		 * The composer's lines are no longer there (the file got shorter): it becomes a comment on
		 * the whole file and keeps what is typed.
		 */
		toFile(path: string): void {
			const current = open.get(path);
			if (!current || current.line === undefined) return;
			open.set(path, { memory: current.memory });
			changed();
		},
		close,
		/** The reader leaves the file: a composer without text is not kept open for the return. */
		leave(path: string): void {
			const current = open.get(path);
			if (current && !holdsText(current)) close(path);
		},
	};
}

export type ComposerStore = ReturnType<typeof createComposerStore>;

/** The composers of this page (a page shows one review). */
export const composers = createComposerStore();

/** The composer that is open on a file, `null` when none is. */
export function useComposer(path: string): Composer | null {
	return useSyncExternalStore(composers.subscribe, () => composers.get(path));
}
