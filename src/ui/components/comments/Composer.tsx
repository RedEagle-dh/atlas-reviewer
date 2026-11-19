/**
 * The composer: the editor for a NEW comment, where the reader opened it (below the last line of
 * a range, or with the file's comments). What is typed lives in the composer's memory
 * (`state/composer.ts`), so it is still there when the page is built anew.
 */
import { useEffect } from "react";
import { flushSync } from "react-dom";
import type { TokenLine } from "../../../core/types";
import { snippetOf } from "../../lib/comments";
import { useAtlas } from "../../state/atlas";
import { useCommentActions } from "../../state/comments";
import { type Composer as ComposerState, composers } from "../../state/composer";
import { S } from "../../strings";
import { CommentEditor } from "./CommentEditor";

/** Puts the cursor into the open composer, after its text, and brings the composer into view. */
export function focusComposer(): void {
	const field = document.querySelector<HTMLTextAreaElement>("[data-composer] textarea");
	if (!field) return;
	// The whole composer comes into view, its buttons included: the focus alone shows the field.
	field.focus({ preventScroll: true });
	field.setSelectionRange(field.value.length, field.value.length);
	field.closest("[data-composer]")?.scrollIntoView({ block: "nearest" });
}

/**
 * Opens the composer of a file for the lines `from`..`to` (or the whole file) and puts the cursor
 * into it. When a composer on the file already holds text it stays where it is, and the cursor
 * goes there: what is typed is never dropped for a click elsewhere.
 *
 * The composer is on the page and has the focus before this returns (`flushSync`): the key the
 * reader presses right after `c` is the first letter of the comment, not `j` for the next file.
 */
export function openComposer(path: string, from?: number, to?: number): void {
	flushSync(() => {
		composers.open(path, from, to);
	});
	focusComposer();
}

/**
 * A shift-click on the "+" of `line`: stretches the open, still empty composer for lines to it
 * (see `extend` in `state/composer.ts`). `false` when there is no such composer.
 */
export function extendComposer(path: string, line: number): boolean {
	let extended = false;
	flushSync(() => {
		extended = composers.extend(path, line);
	});
	if (extended) focusComposer();
	return extended;
}

/**
 * Where the focus goes when the composer closes without a new comment, to what opened it: the "+"
 * of the line the selection started on, or the file header's "Datei kommentieren".
 */
function opener(composer: ComposerState): HTMLElement | null {
	const line = composer.anchor ?? composer.line;
	return document.querySelector<HTMLElement>(
		line === undefined ? "[data-comment-file]" : `.code-view .ln[data-line="${line}"] .ln-add`,
	);
}

export function Composer({
	path,
	composer,
	lines,
}: {
	path: string;
	composer: ComposerState;
	/** The file's lines as the page shows them: the comment quotes its own. */
	lines: readonly TokenLine[];
}) {
	const { add, failure } = useCommentActions();
	const { line, endLine, memory } = composer;
	// A draft outlives the page it was begun on (the range gets commits, the reader switches the
	// range). Its line numbers were chosen on that page: under another head they can be other
	// lines, and the composer says so instead of quietly quoting them.
	const head = useAtlas().model.range.head.sha;
	// biome-ignore lint/correctness/useExhaustiveDependencies: `composer` is the trigger — lines chosen anew (a shift-click) start a new note.
	useEffect(() => {
		memory.head ??= head;
	}, [composer, memory, head]);
	const elsewhere = line !== undefined && memory.head !== undefined && memory.head !== head;
	const hint = composer.lost ? S.composerLinesGone : elsewhere ? S.composerElsewhere : null;

	const save = async (text: string): Promise<string | null> => {
		const created = await add(
			line === undefined
				? { path, text }
				: { path, line, endLine, snippet: snippetOf(lines, line, endLine), text },
		);
		if (!created) {
			const why = failure();
			// Kept with the text: when the range has moved, the page is about to be built anew.
			memory.problem = why?.moved ? S.commentMoved : S.commentNotSaved(S.whyFailed(why));
			return memory.problem;
		}
		composers.close(path);
		// The new card takes the focus: a screen reader reads it, Tab goes on to its actions.
		requestAnimationFrame(() =>
			document.querySelector<HTMLElement>(`[data-comment="${created.id}"]`)?.focus(),
		);
		return null;
	};

	const cancel = () => {
		const back = opener(composer);
		composers.close(path);
		back?.focus();
	};

	return (
		<div
			data-composer=""
			// Scrolled into view as a whole, it stops below the sticky header.
			className="scroll-mt-36 scroll-mb-4 rounded-lg border bg-card px-3 pt-2.5 pb-3 text-card-foreground"
		>
			<CommentEditor
				// Another place is another comment: a new editor, focused by whoever moved it.
				key={`${line ?? ""}-${endLine ?? ""}`}
				mode="new"
				line={line}
				endLine={endLine}
				initial={memory.text}
				problem={memory.problem ?? hint}
				// A composer that appears with a save that failed (the range moved, the page was built
				// anew): the reader was in it, and is put back into it.
				autoFocus={memory.problem !== null}
				onSubmit={save}
				onCancel={cancel}
				onText={(text) => {
					memory.text = text;
				}}
			/>
		</div>
	);
}
