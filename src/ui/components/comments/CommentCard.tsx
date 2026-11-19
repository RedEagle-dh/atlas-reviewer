/**
 * A saved comment as a card: its place, whether the code under it has changed since, its text,
 * and the two things to do with it (change the text, delete it). The same card below a line of
 * the code, in the list of a file's comments and in the panel that collects them all.
 */
import { CircleAlertIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { type MouseEvent, memo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ReviewComment } from "../../../core/types";
import { useComments } from "../../state/comments";
import { S } from "../../strings";
import { CommentEditor } from "./CommentEditor";

/** How long "Rückgängig" is on offer: longer than a plain confirmation, it has to be read and hit. */
const UNDO_MS = 8000;

/**
 * The card that takes the focus when `card` is deleted: the next one of its list, else the one
 * before it. A list is what the nearest element with `data-comments` holds (the cards below a
 * line, a file's comments, the whole panel). Looked up before the card is gone.
 */
function neighbourOf(card: HTMLElement): HTMLElement | null {
	const list = card.closest("[data-comments]");
	if (!list) return null;
	const cards = [...list.querySelectorAll<HTMLElement>("[data-comment]")];
	const at = cards.indexOf(card);
	return cards[at + 1] ?? cards[at - 1] ?? null;
}

export const CommentCard = memo(function CommentCard({
	comment,
	outdated = false,
	placeHref,
	onFollow,
	onPointed,
	fallbackFocus,
}: {
	comment: ReviewComment;
	/** The code under the comment reads differently now (`changed`) or its lines are gone (`gone`). */
	outdated?: false | "changed" | "gone";
	/** The place as a link to its line (the panel); without it the place is plain text. */
	placeHref?: string;
	/** A click on that link, before the browser follows it. */
	onFollow?: (event: MouseEvent<HTMLAnchorElement>) => void;
	/**
	 * The pointer is over the card or the focus is in it (`on`), or no longer: the code view marks
	 * the comment's lines more clearly meanwhile.
	 */
	onPointed?: (id: string, by: "pointer" | "focus", on: boolean) => void;
	/**
	 * Where the focus goes when this card is deleted and was the only one of its list: a selector
	 * (not a function, so the memo holds).
	 */
	fallbackFocus?: string;
}) {
	const { add, edit, remove, failure } = useComments();
	const [editing, setEditing] = useState(false);
	const card = useRef<HTMLElement>(null);
	const editButton = useRef<HTMLButtonElement>(null);
	const { id, line, endLine } = comment;

	// Writes the same comment again; the server gives it a new id and puts it last.
	const restore = async () => {
		const { path, snippet, text } = comment;
		if (await add({ path, line, endLine, snippet, text })) return;
		toast.error(S.commentNotRestored(failure()?.message ?? ""), {
			action: { label: S.retry, onClick: restore },
		});
	};

	const onDelete = async () => {
		const next =
			(card.current && neighbourOf(card.current)) ??
			(fallbackFocus ? document.querySelector<HTMLElement>(fallbackFocus) : null);
		if (!(await remove(id))) {
			toast.error(S.commentNotDeleted(failure()?.message ?? ""));
			return;
		}
		// The card is gone, and the focus with it: on to its neighbour instead of nowhere.
		next?.focus();
		toast(S.commentDeleted, { duration: UNDO_MS, action: { label: S.undo, onClick: restore } });
	};

	const closeEditor = () => {
		setEditing(false);
		// After the editor is gone and the button is back.
		requestAnimationFrame(() => editButton.current?.focus());
	};

	const onSave = async (text: string): Promise<string | null> => {
		// The same text: nothing to send.
		if (text !== comment.text && !(await edit(id, text)))
			return S.commentNotSaved(failure()?.message ?? "");
		closeEditor();
		return null;
	};

	return (
		<article
			ref={card}
			data-comment={id}
			tabIndex={-1}
			aria-label={S.commentOn(line, endLine)}
			// Focused by the page (after saving, after its neighbour was deleted): below the sticky header.
			className="scroll-mt-36 rounded-lg border bg-card px-3 py-2 text-card-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
			onMouseEnter={onPointed && (() => onPointed(id, "pointer", true))}
			onMouseLeave={onPointed && (() => onPointed(id, "pointer", false))}
			// The focus of the keyboard (and of a text field): after a press with the pointer, which
			// has the hover, the lines do not stay marked.
			onFocus={
				onPointed &&
				((event) => {
					if (event.target.matches(":focus-visible")) onPointed(id, "focus", true);
				})
			}
			onBlur={
				onPointed &&
				((event) => {
					if (!event.currentTarget.contains(event.relatedTarget)) onPointed(id, "focus", false);
				})
			}
		>
			{editing ? (
				<div className="py-1">
					<CommentEditor
						mode="edit"
						line={line}
						endLine={endLine}
						initial={comment.text}
						autoFocus
						onSubmit={onSave}
						onCancel={closeEditor}
					/>
				</div>
			) : (
				<>
					<div className="flex min-h-7 items-center gap-2">
						{/* In a narrow card the badge goes below the place; neither is broken in two. */}
						<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
							{placeHref ? (
								<a
									href={placeHref}
									onClick={onFollow}
									className="rounded-sm text-xs font-medium whitespace-nowrap text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 outline-none hover:text-foreground hover:decoration-current focus-visible:ring-3 focus-visible:ring-ring/50"
								>
									{S.place(line, endLine)}
								</a>
							) : (
								<span className="text-xs font-medium whitespace-nowrap text-muted-foreground">
									{S.place(line, endLine)}
								</span>
							)}
							{outdated ? (
								<Tooltip>
									{/*
									 * A button, so the keyboard reaches what the badge means too. The colour of
									 * "changed", as an outline: on its soft fill the small text falls below 4.5:1.
									 */}
									<TooltipTrigger
										render={
											<Badge
												variant="outline"
												className="cursor-default border-modified/50 text-modified"
												render={<button type="button" />}
											/>
										}
									>
										<CircleAlertIcon aria-hidden="true" />
										{S.commentOutdated}
									</TooltipTrigger>
									<TooltipContent className="max-w-72">
										{outdated === "gone" ? S.commentGoneHint : S.commentOutdatedHint}
									</TooltipContent>
								</Tooltip>
							) : null}
						</div>
						<div className="flex shrink-0 items-center">
							<Tooltip>
								<TooltipTrigger
									render={
										<Button
											ref={editButton}
											variant="ghost"
											size="icon-sm"
											className="text-muted-foreground"
											aria-label={S.commentEdit}
											onClick={() => setEditing(true)}
										/>
									}
								>
									<PencilIcon />
								</TooltipTrigger>
								<TooltipContent>{S.commentEdit}</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger
									render={
										<Button
											variant="ghost"
											size="icon-sm"
											className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
											aria-label={S.commentDelete}
											onClick={onDelete}
										/>
									}
								>
									<Trash2Icon />
								</TooltipTrigger>
								<TooltipContent>{S.commentDelete}</TooltipContent>
							</Tooltip>
						</div>
					</div>
					{/* As text, never as markup; a long word breaks instead of widening the card. */}
					<p className="max-w-[90ch] pb-1 text-sm/relaxed wrap-anywhere whitespace-pre-wrap">
						{comment.text}
					</p>
				</>
			)}
		</article>
	);
});
