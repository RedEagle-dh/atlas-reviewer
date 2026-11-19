/**
 * The code: line numbers, highlighted tokens (colours from the file's palette, light and dark),
 * change marks in the gutter and as a tint, removed lines inline, folds, import links. Rows are
 * rendered in chunks with `content-visibility: auto`, so a 1 600-line file scrolls smoothly and
 * the browser's find-in-page still sees every line. How a row looks is in `styles/code.css`.
 */
import { ArrowUpRightIcon, UnfoldVerticalIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { FileView, TokenLine } from "../../../core/types";
import { baseName } from "../../lib/files";
import { fileRoute } from "../../router";
import { useAtlas } from "../../state/atlas";
import { S } from "../../strings";
import { buildRows, type Row } from "./rows";

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

const CodeRow = memo(function CodeRow({
	row,
	index,
	view,
	links,
	target,
	path,
	onUnfold,
}: {
	row: Row;
	index: number;
	view: FileView;
	links: ReadonlyMap<number, string[]>;
	target: number | undefined;
	path: string;
	onUnfold: (from: number) => void;
}) {
	const { href } = useAtlas();
	if (row.kind === "fold") {
		const n = row.to - row.from + 1;
		return (
			<button
				type="button"
				className="ln-fold"
				data-row={index}
				aria-expanded="false"
				onClick={() => onUnfold(row.from)}
			>
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
	return (
		<div
			className={`ln${row.change ? ` ch-${row.change}` : ""}${row.line === target ? " is-target" : ""}`}
			data-row={index}
			data-line={row.line}
			data-anchor={row.anchor ? (row.block ?? undefined) : undefined}
		>
			<span className="ln-mark" />
			<a className="ln-no" href={href(fileRoute({ path, line: row.line }))} tabIndex={-1}>
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
		</div>
	);
});

export function CodeView({
	view,
	options,
	target,
	links,
}: {
	view: FileView;
	options: CodeOptions;
	target: number | undefined;
	links: ReadonlyMap<number, string[]>;
}) {
	const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(new Set());
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new file starts folded again.
	useEffect(() => setUnfolded(new Set()), [view.path]);

	const rows = useMemo(
		() =>
			buildRows(view.lines.length, view.changes, {
				mode: options.mode,
				showRemoved: options.showRemoved,
				context: CONTEXT,
				unfolded,
				plain: options.plain,
			}),
		[view, options.mode, options.showRemoved, options.plain, unfolded],
	);

	// A target line inside a fold: open that fold.
	useEffect(() => {
		if (target === undefined) return;
		const fold = rows.find((r) => r.kind === "fold" && r.from <= target && target <= r.to);
		if (fold && fold.kind === "fold") setUnfolded((prev) => new Set([...prev, fold.from]));
	}, [rows, target]);

	// Bring the target line into view (only when it is not already visible below the sticky header);
	// again after the rows changed, because a fold that hid it has just opened.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `rows` is the trigger, not an input.
	useEffect(() => {
		if (target === undefined) return;
		const el = document.querySelector<HTMLElement>(`.code-view [data-line="${target}"]`);
		if (!el) return;
		const header = document.querySelector(".file-head")?.getBoundingClientRect().bottom ?? 0;
		const rect = el.getBoundingClientRect();
		if (rect.top < header || rect.bottom > window.innerHeight - 20)
			el.scrollIntoView({ block: "center" });
	}, [target, rows]);

	const chunks = useMemo(() => {
		const list: { start: number; rows: Row[]; height: number }[] = [];
		for (let i = 0; i < rows.length; i += CHUNK) {
			const part = rows.slice(i, i + CHUNK);
			list.push({
				start: i,
				rows: part,
				height: part.reduce((h, r) => h + (r.kind === "fold" ? FOLD_H : LINE_H), 0),
			});
		}
		return list;
	}, [rows]);

	// The palette, and the width of the line-number column (a custom property in the same sheet).
	const digits = String(view.lines.length).length;
	const css = useMemo(
		() => `.code-view{--digits:${digits}}\n${paletteCss(view.palette)}`,
		[view.palette, digits],
	);
	const onUnfold = (from: number) => setUnfolded((prev) => new Set([...prev, from]));

	return (
		<div
			className={`code-view${options.wrap ? " is-wrap" : ""}${options.plain ? " is-plain" : ""}`}
			data-testid="code"
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
					{chunk.rows.map((row, i) => (
						<CodeRow
							key={
								row.kind === "line"
									? `l${row.line}`
									: row.kind === "fold"
										? `f${row.from}`
										: `${row.kind}${row.block}:${"index" in row ? row.index : 0}`
							}
							row={row}
							index={chunk.start + i}
							view={view}
							links={links}
							target={target}
							path={view.path}
							onUnfold={onUnfold}
						/>
					))}
				</div>
			))}
		</div>
	);
}
