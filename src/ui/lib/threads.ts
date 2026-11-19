/**
 * What a file's comments mean for its code view: below which line each comment hangs, which
 * lines carry a mark, which lines never fold, and how much room the cards take. Pure, so the code
 * view only draws what comes out of here.
 */
import type { ReviewComment } from "../../core/types";

/** Lines `from`..`to`, 1-based and inclusive. */
export interface LineRange {
	from: number;
	to: number;
}

/** The lines a comment is on; `null` for a comment on the whole file. */
export function rangeOf(comment: Pick<ReviewComment, "line" | "endLine">): LineRange | null {
	if (comment.line === undefined) return null;
	return { from: comment.line, to: comment.endLine ?? comment.line };
}

/** Two lines in either order (a selection dragged upwards) as a range. */
export function spanOf(a: number, b: number): LineRange {
	return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export interface PlacedComments {
	/**
	 * The comments on lines the file has, by the line they END on (their card hangs below it); a
	 * line's comments in the order they were written.
	 */
	threads: ReadonlyMap<number, readonly ReviewComment[]>;
	/**
	 * What is shown with the file instead of in the code: the comments on the whole file, then
	 * those whose lines are no longer there (the file got shorter), in the order given.
	 */
	file: readonly ReviewComment[];
}

/**
 * Sorts a file's comments into the code and the file's own list. `comments` in the order a
 * file's comments are kept (`commentsByPath`); `lineCount` is how many lines the page shows.
 */
export function placeComments(
	comments: readonly ReviewComment[],
	lineCount: number,
): PlacedComments {
	const threads = new Map<number, ReviewComment[]>();
	const whole: ReviewComment[] = [];
	const gone: ReviewComment[] = [];
	for (const comment of comments) {
		const range = rangeOf(comment);
		if (range === null) whole.push(comment);
		else if (range.to > lineCount) gone.push(comment);
		else {
			const thread = threads.get(range.to);
			if (thread) thread.push(comment);
			else threads.set(range.to, [comment]);
		}
	}
	// A range and a single line can end on the same line: what counts there is when they were written.
	for (const thread of threads.values())
		thread.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
	return { threads, file: [...whole, ...gone] };
}

/** A line has a comment: the quiet mark in the gutter. */
export const MARK_COMMENT = 1;
/** A line of the range that is being selected, written about, or whose card is pointed at. */
export const MARK_SELECTED = 2;
/** The line a selection started on: its "+" stays in view. */
export const MARK_ANCHOR = 4;

/**
 * The marks of every line that has one, as a set of the bits above. A row is given only its own
 * number, so a change redraws the rows whose number changed and no others.
 */
export function lineMarks(
	commented: readonly LineRange[],
	selected: readonly LineRange[],
	anchor: number | null,
): ReadonlyMap<number, number> {
	const marks = new Map<number, number>();
	const add = (range: LineRange, bit: number) => {
		for (let line = range.from; line <= range.to; line++)
			marks.set(line, (marks.get(line) ?? 0) | bit);
	};
	for (const range of commented) add(range, MARK_COMMENT);
	for (const range of selected) add(range, MARK_SELECTED);
	if (anchor !== null) add({ from: anchor, to: anchor }, MARK_ANCHOR);
	return marks;
}

/**
 * The lines that never fold (`RowOptions.pinned`): what the reader opened, and every line of the
 * given ranges (commented lines, the lines under an open composer).
 */
export function pinnedLines(
	opened: ReadonlySet<number>,
	ranges: readonly LineRange[],
): ReadonlySet<number> {
	if (ranges.length === 0) return opened;
	const pinned = new Set(opened);
	for (const range of ranges)
		for (let line = range.from; line <= range.to; line++) pinned.add(line);
	return pinned;
}

/*
 * The room a thread takes below its line, in px: measured on the markup of `CodeView`'s thread
 * and `CommentCard` (`.ln-thread` in styles/code.css). An estimate for the chunks of rows that
 * are not rendered yet; the browser replaces it with the real height once a chunk has been on
 * screen. What it cannot know is where a long text wraps: that depends on the window's width.
 */
/** The strip: its two borders and its padding. */
const THREAD_FRAME = 18;
/** Between two cards of a strip. */
const CARD_GAP = 8;
/** A card without its text: border, padding, the row with the place and the actions. */
const CARD_FRAME = 50;
/** One line of comment text, and about how many characters fit a line of a card. */
const TEXT_LINE = 22.75;
const TEXT_COLUMNS = 110;
/** An open composer: the place, the empty field, the buttons. */
const COMPOSER = 148;

function cardHeight(comment: ReviewComment): number {
	let lines = 0;
	for (const line of comment.text.split("\n"))
		lines += Math.max(1, Math.ceil(line.length / TEXT_COLUMNS));
	return CARD_FRAME + lines * TEXT_LINE;
}

/** The height of the strip below a line: its cards and, when it is open there, the composer. */
export function threadHeight(comments: readonly ReviewComment[], composer: boolean): number {
	const parts = comments.map(cardHeight);
	if (composer) parts.push(COMPOSER);
	if (parts.length === 0) return 0;
	return THREAD_FRAME + parts.reduce((sum, part) => sum + part, 0) + (parts.length - 1) * CARD_GAP;
}
