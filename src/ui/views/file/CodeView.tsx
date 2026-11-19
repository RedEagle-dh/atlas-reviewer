/**
 * The code: line numbers, highlighted tokens (colours from the file's palette, light and dark),
 * change marks in the gutter and as a tint, removed lines inline, folds, import links, and the
 * review comments: a "+" on every numbered line, the cards below the line a comment ends on, and
 * the composer for a new one. Rows are rendered in chunks with `content-visibility: auto`, so a
 * 1 600-line file scrolls smoothly and the browser's find-in-page still sees every line. How a
 * row looks is in `styles/code.css`.
 *
 * The rows are memoised and get no callbacks: what happens on a row (a press on its "+", a fold)
 * is heard once, on the view. A row is given only what concerns it, so writing a comment redraws
 * the rows it marks and no others.
 */
import { ArrowUpRightIcon, UnfoldVerticalIcon } from "lucide-react";
import {
	Fragment,
	type MouseEvent,
	memo,
	type PointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { FileView, ReviewComment, TokenLine } from "../../../core/types";
import { CommentCard } from "../../components/comments/CommentCard";
import {
	Composer,
	extendComposer,
	openComposer,
	showHeldComposer,
} from "../../components/comments/Composer";
import { isOutdated } from "../../lib/comments";
import { baseName } from "../../lib/files";
import {
	type LineRange,
	lineMarks,
	MARK_ANCHOR,
	MARK_COMMENT,
	MARK_SELECTED,
	pinnedLines,
	rangeOf,
	spanOf,
	threadHeight,
} from "../../lib/threads";
import { fileRoute } from "../../router";
import { useAtlas } from "../../state/atlas";
import { type Composer as ComposerState, composers, pageEdits } from "../../state/composer";
import { S } from "../../strings";
import { buildRows, type Row, sameRow } from "./rows";

export interface CodeOptions {
	mode: "full" | "changes";
	showRemoved: boolean;
	wrap: boolean;
	/** No change marks: added, deleted or unchanged file. */
	plain: boolean;
}

const CHUNK = 150;
/** The heights `styles/code.css` gives a row and a fold: a chunk off screen is reserved their sum. */
const LINE_H = 20;
const FOLD_H = 26;
const CONTEXT = 3;
const COLOUR = /^#[0-9a-f]{3,8}$/i;
const NO_LINES: ReadonlySet<number> = new Set();
/**
 * A range dragged to the edge of the page scrolls on, like a text selection: within this many px
 * of the edge, by this many px per frame.
 */
const DRAG_EDGE = 36;
const DRAG_STEP = 14;

/**
 * One CSS rule per palette entry: `light-dark()` picks the colour for the active scheme. Entry 0
 * is the plain text colour, so it also colours the view itself (a token without a span inherits it).
 */
export function paletteCss(palette: FileView["palette"]): string {
	return palette
		.map(([light, dark], i) => {
			if (!COLOUR.test(light) || !COLOUR.test(dark)) return "";
			const selector = i === 0 ? ".code-view,.code-view .c0" : `.code-view .c${i}`;
			return `${selector}{color:light-dark(${light},${dark})}`;
		})
		.join("\n");
}

function tokenClass(colour: number, style: number | undefined): string {
	let cls = `c${colour}`;
	if (style) {
		if (style & 1) cls += " fi";
		if (style & 2) cls += " fb";
		if (style & 4) cls += " fu";
		if (style & 8) cls += " fs";
	}
	return cls;
}

function Tokens({ line }: { line: TokenLine }) {
	// A zero-width space, written as an escape so it can be seen.
	if (line.length === 0) return "\u200b";
	return line.map(([text, colour, style], i) =>
		colour === 0 && !style ? (
			text
		) : (
			// biome-ignore lint/suspicious/noArrayIndexKey: tokens of one line never reorder.
			<span key={i} className={tokenClass(colour, style)}>
				{text}
			</span>
		),
	);
}

interface RowProps {
	row: Row;
	index: number;
	view: FileView;
	links: ReadonlyMap<number, string[]>;
	/** The line a link points at (`?line=`). */
	isTarget: boolean;
	/** The comment marks of the line: bits of `MARK_*` (`lib/threads.ts`); 0 for none. */
	mark: number;
}

const CodeRow = memo(
	function CodeRow({ row, index, view, links, isTarget, mark }: RowProps) {
		const { href } = useAtlas();
		if (row.kind === "fold") {
			const n = row.to - row.from + 1;
			return (
				<button type="button" className="ln-fold" data-row={index} aria-expanded="false">
					<UnfoldVerticalIcon className="ln-fold-icon" aria-hidden="true" />
					<span className="ln-fold-text">{S.folded(n)}</span>
				</button>
			);
		}
		if (row.kind === "removal-marker")
			return (
				<div className="ln is-marker" data-row={index} data-anchor={row.block}>
					<span className="ln-mark" />
					<span className="ln-no" />
					<span className="ln-code">{S.removedLines(row.count)}</span>
				</div>
			);
		if (row.kind === "removed") {
			const tokens = view.changes[row.block]?.removed[row.index] ?? [];
			return (
				<div
					className="ln is-removed"
					data-row={index}
					data-anchor={row.anchor ? row.block : undefined}
				>
					<span className="ln-mark" />
					<span className="ln-no" aria-hidden="true">
						−
					</span>
					<span className="ln-code">
						<Tokens line={tokens} />
					</span>
				</div>
			);
		}
		const targets = links.get(row.line);
		let cls = "ln";
		if (row.change) cls += ` ch-${row.change}`;
		if (mark & MARK_COMMENT) cls += " has-comment";
		if (mark & MARK_SELECTED) cls += " is-selected";
		if (mark & MARK_ANCHOR) cls += " is-anchor";
		if (isTarget) cls += " is-target";
		return (
			<div
				className={cls}
				data-row={index}
				data-line={row.line}
				data-anchor={row.anchor ? (row.block ?? undefined) : undefined}
			>
				<span className="ln-mark" />
				<a
					className="ln-no"
					href={href(fileRoute({ path: view.path, line: row.line }))}
					tabIndex={-1}
				>
					{row.line}
				</a>
				<span className="ln-code">
					<Tokens line={view.lines[row.line - 1] ?? []} />
					{targets?.map((t) => (
						<a
							key={t}
							className="imp-link"
							href={href(fileRoute({ path: t }))}
							title={S.importLink(t)}
						>
							<ArrowUpRightIcon aria-hidden="true" />
							{baseName(t)}
						</a>
					))}
				</span>
				{/*
				 * No Tab stop: a file has a thousand of them, and the keyboard has `c`. No content: the
				 * plus is drawn by the sheet, so copied code never carries a "+".
				 */}
				<button
					type="button"
					className="ln-add"
					tabIndex={-1}
					aria-label={S.commentLine(row.line)}
					title={S.commentLineHint}
				/>
			</div>
		);
	},
	// The rows are built anew when a line is pinned; a row that shows the same is not drawn again.
	(prev, next) =>
		prev.index === next.index &&
		prev.mark === next.mark &&
		prev.isTarget === next.isTarget &&
		prev.view === next.view &&
		prev.links === next.links &&
		sameRow(prev.row, next.row),
);

/** The numbered row an element is in or is; `null` for anything else (a card, a fold, a removed line). */
function lineOf(target: EventTarget | null): number | null {
	if (!(target instanceof Element)) return null;
	const line = Number(target.closest<HTMLElement>(".code-view .ln[data-line]")?.dataset.line);
	return Number.isInteger(line) && line > 0 ? line : null;
}

/** Comment ids the pointer is over and the focus is in; the pointer counts first. */
interface Pointed {
	pointer: string | null;
	focus: string | null;
}

export function CodeView({
	view,
	options,
	target,
	links,
	threads,
	composer,
}: {
	view: FileView;
	options: CodeOptions;
	target: number | undefined;
	links: ReadonlyMap<number, string[]>;
	/** The comments on lines of this file, by the line they end on (`placeComments`). */
	threads: ReadonlyMap<number, readonly ReviewComment[]>;
	/** The composer when it is open on lines of this file. */
	composer: ComposerState | null;
}) {
	const { path } = view;
	const [opened, setOpened] = useState<ReadonlySet<number>>(NO_LINES);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new file starts folded again.
	useEffect(() => setOpened(NO_LINES), [path]);
	const open = useCallback((from: number, to: number) => {
		setOpened((prev) => {
			const next = new Set(prev);
			for (let line = from; line <= to; line++) next.add(line);
			return next;
		});
	}, []);

	// A selection in progress: from the line whose "+" was pressed to the line under the pointer.
	const [drag, setDrag] = useState<{ anchor: number; head: number } | null>(null);
	const dragNow = useRef(drag);
	const [pointed, setPointed] = useState<Pointed>({ pointer: null, focus: null });
	const onPointed = useCallback((id: string, by: keyof Pointed, on: boolean) => {
		setPointed((prev) => {
			if (on) return prev[by] === id ? prev : { ...prev, [by]: id };
			return prev[by] === id ? { ...prev, [by]: null } : prev;
		});
	}, []);

	const composerFrom = composer?.line;
	const composerTo = composer?.endLine ?? composer?.line;
	const composerAnchor = composer?.anchor ?? composer?.line;
	const commented = useMemo(() => {
		const ranges: LineRange[] = [];
		for (const thread of threads.values())
			for (const comment of thread) {
				const range = rangeOf(comment);
				if (range) ranges.push(range);
			}
		return ranges;
	}, [threads]);
	const written = useMemo(
		() =>
			composerFrom === undefined || composerTo === undefined
				? null
				: { from: composerFrom, to: composerTo },
		[composerFrom, composerTo],
	);
	const marks = useMemo(() => {
		// While a range is dragged it is the only one that counts: the composer has not moved yet,
		// and a card that still has the focus is not what the reader looks at.
		if (drag) return lineMarks(commented, [spanOf(drag.anchor, drag.head)], drag.anchor);
		const selected: LineRange[] = written ? [written] : [];
		// A card that was deleted under the pointer never said that the pointer left it: an id
		// without a comment counts as none, so the card with the focus is not kept from its mark.
		const rangeOfCard = (id: string | null): LineRange | null => {
			if (id === null) return null;
			for (const thread of threads.values())
				for (const comment of thread) if (comment.id === id) return rangeOf(comment);
			return null;
		};
		const marked = rangeOfCard(pointed.pointer) ?? rangeOfCard(pointed.focus);
		if (marked) selected.push(marked);
		return lineMarks(commented, selected, composerAnchor ?? null);
	}, [commented, written, composerAnchor, drag, pointed, threads]);

	// Only "Nur Änderungen" folds: elsewhere a new comment must not build the rows anew.
	const folds = options.mode === "changes" && !options.plain;
	const pinned = useMemo(
		() => (folds ? pinnedLines(opened, written ? [...commented, written] : commented) : NO_LINES),
		[folds, opened, commented, written],
	);
	const rows = useMemo(
		() =>
			buildRows(view.lines.length, view.changes, {
				mode: options.mode,
				showRemoved: options.showRemoved,
				context: CONTEXT,
				pinned,
				plain: options.plain,
			}),
		[view, options.mode, options.showRemoved, options.plain, pinned],
	);

	// A target line inside a fold: open that fold.
	useEffect(() => {
		if (target === undefined) return;
		const fold = rows.find((r) => r.kind === "fold" && r.from <= target && target <= r.to);
		if (fold && fold.kind === "fold") open(fold.from, fold.to);
	}, [rows, target, open]);

	// Bring the target line into view (only when it is not already visible below the sticky header):
	// once per link followed and per way of showing the file. `rows` is the trigger for the one
	// case that needs a second look, a fold that hid the line and has just opened. Any other change
	// of the rows (a fold the reader opens, a line a comment pins) leaves the page where it is: the
	// reader is somewhere else by then, and writing a comment must not scroll the page away.
	const arrived = useRef<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `rows` is the trigger, not an input.
	useEffect(() => {
		if (target === undefined) {
			arrived.current = null;
			return;
		}
		const arrival = `${path}:${target}:${options.mode}:${options.showRemoved}`;
		if (arrived.current === arrival) return;
		const el = document.querySelector<HTMLElement>(`.code-view [data-line="${target}"]`);
		if (!el) return;
		arrived.current = arrival;
		// The page was built anew under a comment whose save was refused (the range moved): the
		// reader is in that composer, which has just taken the focus, and stays there.
		if (document.activeElement?.closest("[data-composer]")) return;
		const header = document.querySelector(".file-head")?.getBoundingClientRect().bottom ?? 0;
		const rect = el.getBoundingClientRect();
		if (rect.top < header || rect.bottom > window.innerHeight - 20)
			el.scrollIntoView({ block: "center" });
	}, [target, rows]);

	const chunks = useMemo(() => {
		const list: { start: number; rows: Row[]; height: number }[] = [];
		for (let i = 0; i < rows.length; i += CHUNK) {
			const part = rows.slice(i, i + CHUNK);
			let height = 0;
			for (const row of part) {
				if (row.kind === "fold") height += FOLD_H;
				else if (row.kind !== "line") height += LINE_H;
				else height += LINE_H + threadHeight(threads.get(row.line) ?? [], composerTo === row.line);
			}
			list.push({ start: i, rows: part, height });
		}
		return list;
	}, [rows, threads, composerTo]);

	// The palette, and the width of the line-number column (a custom property in the same sheet).
	const digits = String(view.lines.length).length;
	const css = useMemo(
		() => `.code-view{--digits:${digits}}\n${paletteCss(view.palette)}`,
		[view.palette, digits],
	);

	// While a "+" is held down the pointer may be anywhere: the window hears where it goes.
	const dragging = drag !== null;
	useEffect(() => {
		if (!dragging) return;
		let pointer: { x: number; y: number } | null = null;
		let frame = 0;
		const stop = () => {
			dragNow.current = null;
			setDrag(null);
		};
		const reach = (x: number, y: number) => {
			const now = dragNow.current;
			const line = lineOf(document.elementFromPoint(x, y));
			if (!now || line === null || line === now.head) return;
			dragNow.current = { anchor: now.anchor, head: line };
			setDrag(dragNow.current);
		};
		// Held near the top or the bottom of the page: it scrolls on, and the range follows.
		const scroll = () => {
			frame = 0;
			const main = document.querySelector(".main");
			const now = dragNow.current;
			if (!main || !pointer || !now) return;
			const top = document.querySelector(".file-head")?.getBoundingClientRect().bottom ?? 0;
			const bottom = main.getBoundingClientRect().bottom;
			// A press on a "+" that happens to be at the edge is a click, not a wish to scroll: the page
			// moves once the range has left its first line, or the pointer the page.
			const leftPage = pointer.y > bottom || pointer.y < top;
			if (now.head === now.anchor && !leftPage) return;
			const by =
				pointer.y > bottom - DRAG_EDGE ? DRAG_STEP : pointer.y < top + DRAG_EDGE ? -DRAG_STEP : 0;
			if (by === 0) return;
			main.scrollBy(0, by);
			// The row at the edge, also when the pointer has left the window.
			reach(pointer.x, Math.min(Math.max(pointer.y, top + 2), bottom - 2));
			frame = requestAnimationFrame(scroll);
		};
		const onMove = (event: globalThis.PointerEvent) => {
			pointer = { x: event.clientX, y: event.clientY };
			reach(pointer.x, pointer.y);
			if (frame === 0) frame = requestAnimationFrame(scroll);
		};
		const onUp = () => {
			const done = dragNow.current;
			stop();
			if (done) openComposer(path, done.anchor, done.head);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") stop();
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", stop);
		window.addEventListener("blur", stop);
		window.addEventListener("keydown", onKey);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", stop);
			window.removeEventListener("blur", stop);
			window.removeEventListener("keydown", onKey);
		};
	}, [dragging, path]);

	const addButtonOf = (event: { target: EventTarget }): Element | null =>
		event.target instanceof Element ? event.target.closest(".ln-add") : null;

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		const line = event.button === 0 && addButtonOf(event) ? lineOf(event.target) : null;
		if (line === null) return;
		// Shift: the open, still empty composer now reaches to this line.
		if (event.shiftKey && extendComposer(path, line)) return;
		// A composer that holds text stays where it is; the reader is shown it instead, and told.
		if (composers.holdsText(path)) {
			showHeldComposer();
			return;
		}
		dragNow.current = { anchor: line, head: line };
		setDrag(dragNow.current);
	};

	// A press on a "+" starts neither a text selection nor a move of the focus to the button.
	const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
		if (addButtonOf(event)) event.preventDefault();
	};

	const onClick = (event: MouseEvent<HTMLDivElement>) => {
		if (!(event.target instanceof Element)) return;
		const fold = event.target.closest<HTMLElement>(".ln-fold");
		if (fold) {
			const row = rows[Number(fold.dataset.row)];
			if (row?.kind === "fold") open(row.from, row.to);
			return;
		}
		// A "+" that has the focus, pressed with Enter or Space (a click without a pointer): the
		// pointer's own presses are answered above, when the button is released.
		const line = event.detail === 0 && addButtonOf(event) ? lineOf(event.target) : null;
		if (line !== null) openComposer(path, line);
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the one listener for its rows' buttons.
		// biome-ignore lint/a11y/useKeyWithClickEvents: the buttons are real ones; a key press on one arrives as a click.
		<div
			className={`code-view${options.wrap ? " is-wrap" : ""}${options.plain ? " is-plain" : ""}${dragging ? " is-selecting" : ""}`}
			data-testid="code"
			onPointerDown={onPointerDown}
			onMouseDown={onMouseDown}
			onClick={onClick}
		>
			<style>{css}</style>
			{chunks.map((chunk) => (
				<div
					key={chunk.start}
					className="code-chunk"
					// Only the height is reserved. One value would stand for the width too, and a chunk
					// off screen would make the code scroll sideways as far as the chunk is tall.
					style={{ containIntrinsicSize: `auto none auto ${chunk.height}px` }}
				>
					{chunk.rows.map((row, i) => {
						const line = row.kind === "line" ? row.line : 0;
						const thread = threads.get(line);
						const composing = composer !== null && composerTo === line;
						return (
							<Fragment
								key={
									row.kind === "line"
										? `l${row.line}`
										: row.kind === "fold"
											? `f${row.from}`
											: `${row.kind}${row.block}:${"index" in row ? row.index : 0}`
								}
							>
								<CodeRow
									row={row}
									index={chunk.start + i}
									view={view}
									links={links}
									isTarget={line !== 0 && line === target}
									mark={marks.get(line) ?? 0}
								/>
								{thread || composing ? (
									<div className="ln-thread" data-thread={line}>
										<div className="ln-thread-body" data-comments="">
											{thread?.map((comment) => (
												<CommentCard
													key={comment.id}
													comment={comment}
													edits={pageEdits}
													outdated={isOutdated(comment, view.lines) && "changed"}
													onPointed={onPointed}
													fallbackFocus={`.code-view .ln[data-line="${line}"] .ln-add`}
												/>
											))}
											{composing ? (
												<Composer
													path={path}
													composer={composer}
													lines={view.lines}
													deleted={view.status === "deleted"}
												/>
											) : null}
										</div>
									</div>
								) : null}
							</Fragment>
						);
					})}
				</div>
			))}
		</div>
	);
}
