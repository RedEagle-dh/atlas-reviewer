/**
 * The editor of a comment: the place it is about, the text field and its two buttons. The same
 * for a new comment (in the composer) and for one that is being changed (in its card); the box
 * around it is the caller's.
 */
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MAX_COMMENT_TEXT } from "../../lib/comments";
import { isMac } from "../../lib/platform";
import { fmt, S } from "../../strings";

/** The field grows with its text by itself where the browser can do that (`field-sizing`). */
const GROWS =
	typeof CSS !== "undefined" && typeof CSS.supports === "function"
		? CSS.supports("field-sizing", "content")
		: false;

/** From here on the field shows how much room is left: at the limit it takes no more characters. */
const NEAR_LIMIT = MAX_COMMENT_TEXT * 0.9;

export function CommentEditor({
	line,
	endLine,
	mode,
	initial = "",
	draft,
	problem: firstProblem = null,
	autoFocus = false,
	onSubmit,
	onCancel,
	onText,
}: {
	/** The place the comment is about; without a line, the whole file. */
	line?: number;
	endLine?: number;
	/** `new`: empty means nothing to lose. `edit`: unchanged means nothing to lose. */
	mode: "new" | "edit";
	initial?: string;
	/** `edit` only: the text as far as it was changed when this editor was last taken away. */
	draft?: string;
	/** What to say next to the buttons from the start (a save that failed before the page was built anew). */
	problem?: string | null;
	/**
	 * The cursor goes into the field when the editor appears, after the text. A composer asks for
	 * it only on the page that was built anew because its save was refused: otherwise it can appear
	 * without having been asked for (the reader comes back to the file), and whoever opens one
	 * focuses it.
	 */
	autoFocus?: boolean;
	/** Saves the trimmed text. Resolves to what went wrong, in words for the reader, or `null`. */
	onSubmit: (text: string) => Promise<string | null>;
	onCancel: () => void;
	/** Every change of the text, for whoever keeps it beyond this editor's life. */
	onText?: (text: string) => void;
}) {
	const [text, setText] = useState(draft ?? initial);
	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState(firstProblem);
	const [escPressed, setEscPressed] = useState(false);
	const field = useRef<HTMLTextAreaElement>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: once, when the editor appears.
	useEffect(() => {
		const el = field.current;
		if (!autoFocus || !el) return;
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
	}, []);
	const id = useId();
	const noteId = `${id}-note`;

	const empty = text.trim() === "";
	const dirty = mode === "new" ? !empty : text !== initial;

	// Without `field-sizing` the height follows the text by hand; the class caps it either way.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `text` is the trigger, not an input.
	useEffect(() => {
		const el = field.current;
		if (GROWS || !el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight + 2}px`;
	}, [text]);

	const submit = async () => {
		if (empty || saving) return;
		setSaving(true);
		setProblem(null);
		setEscPressed(false);
		const failed = await onSubmit(text.trim());
		// Saved: the caller has usually taken this editor away by now.
		if (!mounted.current) return;
		setSaving(false);
		setProblem(failed);
		if (failed !== null) field.current?.focus();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		// A key that only confirms a composed character (an input method) is not a command.
		if (event.nativeEvent.isComposing) return;
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			submit();
		} else if (event.key === "Escape") {
			// The key ends here: a sheet around this editor must not close with what is typed in it.
			event.stopPropagation();
			if (dirty) setEscPressed(true);
			else onCancel();
		}
	};

	const note =
		problem ?? (escPressed && dirty ? S[mode === "new" ? "escKeepsText" : "escKeepsEdit"] : null);

	return (
		<form
			className="flex flex-col gap-2"
			onSubmit={(event: FormEvent) => {
				event.preventDefault();
				submit();
			}}
		>
			<label htmlFor={id} className="text-xs font-medium text-muted-foreground">
				{S.place(line, endLine)}
			</label>
			<Textarea
				ref={field}
				id={id}
				value={text}
				rows={2}
				maxLength={MAX_COMMENT_TEXT}
				placeholder={S.commentPlaceholder}
				aria-label={S.commentOn(line, endLine)}
				aria-describedby={note ? noteId : undefined}
				readOnly={saving}
				// Marked while there is something to lose: whoever closes what is around it looks here.
				data-dirty={dirty ? "" : undefined}
				// It grows with the text up to this height (no handle to drag). Brought into view by the
				// focus, it stops below the sticky header with its buttons in view.
				className="max-h-60 resize-none scroll-mt-36 scroll-mb-16"
				onChange={(event) => {
					setText(event.target.value);
					setEscPressed(false);
					onText?.(event.target.value);
				}}
				onKeyDown={onKeyDown}
			/>
			<div className="flex flex-wrap items-center justify-end gap-2">
				<p
					id={noteId}
					role={problem ? "alert" : "status"}
					className={cn(
						"mr-auto min-w-0 flex-1 basis-60 text-xs wrap-anywhere",
						problem ? "text-destructive" : "text-muted-foreground",
					)}
				>
					{note}
				</p>
				{text.length >= NEAR_LIMIT ? (
					<span className="text-xs text-muted-foreground tabular-nums">
						{fmt(text.length)} / {fmt(MAX_COMMENT_TEXT)}
					</span>
				) : null}
				<Button type="button" variant="outline" size="sm" disabled={saving} onClick={onCancel}>
					{S.cancel}
				</Button>
				<Button
					type="submit"
					size="sm"
					disabled={empty || saving}
					aria-keyshortcuts={isMac ? "Meta+Enter" : "Control+Enter"}
				>
					{saving ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
					{mode === "new" ? S.commentSubmit : S.commentSave}
					<Kbd aria-hidden="true" className="bg-primary-foreground/15 text-primary-foreground">
						{S.submitShortcut(isMac)}
					</Kbd>
				</Button>
			</div>
		</form>
	);
}
