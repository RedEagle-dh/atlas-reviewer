/**
 * "Zusammenhang": the file in the middle, what it imports on the left, what imports it on the
 * right, joined by lines (arrowhead at the imported side; dashed = types only). Changed files
 * first; unchanged and left-out ones behind a toggle; npm packages as a compact list.
 */
import { type ReactNode, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FileView, ImportKind } from "../../../core/types";
import { StatusMark } from "../../components/marks";
import { baseName, dirName } from "../../lib/files";
import { fileRoute } from "../../router";
import { useAtlas } from "../../state/atlas";
import { categoryLabel, S } from "../../strings";
import type { Neighbour, Neighbours, Side } from "./neighbours";

/*
 * The geometry the connector lines are computed from. The markup takes its heights from the same
 * constants, so a line ends exactly at the middle of its row.
 */
/** The line above each list ("importiert 2 Dateien"). */
const HEAD_H = 28;
/** One row of a list: the 28 px row and the 4 px between two rows. */
const ROW_H = 32;
/** The column between a list and the centre box, where the lines run. */
const GAP_W = 72;
/** The box of the file itself. */
const CENTRE_H = 56;

/** On what Tab reaches: scrolled into view from further down, it stops below the sticky header. */
const BELOW_HEADER = "scroll-mt-32";

/** What is imported and how, for the tooltip of a row or a package. */
function ImportedNames({ kind, names }: { kind: ImportKind; names: string[] }) {
	return (
		<span>
			<span className="font-medium">{S.importKind[kind]}:</span>{" "}
			<span className="font-mono">{S.names(names)}</span>
		</span>
	);
}

function NeighbourRow({ n, side }: { n: Neighbour; side: "imports" | "importers" }) {
	const { href, meta } = useAtlas();
	const status = n.file ? n.file.status : "unchanged";
	const tag =
		n.where === "review"
			? S.status[status]
			: n.where === "excluded"
				? S.excluded(categoryLabel(meta.categories, n.category))
				: S.status.unchanged;
	const link =
		side === "importers" ? fileRoute({ path: n.path, line: n.line }) : fileRoute({ path: n.path });
	const dir = dirName(n.path);
	return (
		<li className="flex items-center" style={{ height: ROW_H }}>
			<Tooltip>
				<TooltipTrigger
					render={
						<a
							href={href(link)}
							data-path={n.path}
							aria-description={`${S.importKind[n.kind]}: ${S.names(n.names)}`}
						/>
					}
					className={cn(
						"grid h-7 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 text-xs outline-none hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
						BELOW_HEADER,
						n.kind === "type" && "border-dashed",
						// A file of the review is a card; one outside it stays flat and quiet.
						n.where === "review" ? "bg-card" : "text-muted-foreground",
					)}
				>
					{/* The tag says the status in words: the mark is for the eye only, without its own tooltip. */}
					<span className="pointer-events-none flex" aria-hidden="true">
						<StatusMark status={status} />
					</span>
					{/* Cut from the left: the name stays, the folders go. */}
					<span className="truncate text-left [direction:rtl]">
						{"‎"}
						{dir === "" ? null : <span className="text-muted-foreground">{dir}/</span>}
						<span className={cn("font-medium", n.where === "review" && "text-foreground")}>
							{baseName(n.path)}
						</span>
						{"‎"}
					</span>
					<span className="whitespace-nowrap text-muted-foreground">{tag}</span>
				</TooltipTrigger>
				<TooltipContent side="bottom" align="start" className="max-w-sm">
					<div className="grid gap-1 wrap-anywhere">
						<span className="font-mono">
							{side === "importers" ? `${n.path}: ${S.openAtLine(n.line)}` : n.path}
						</span>
						<ImportedNames kind={n.kind} names={n.names} />
					</div>
				</TooltipContent>
			</Tooltip>
		</li>
	);
}

/** The rows a side shows: changed, then the expanded groups. */
function shownRows(side: Side, showUnchanged: boolean, showExcluded: boolean): Neighbour[] {
	return [
		...side.changed,
		...(showExcluded ? side.excluded : []),
		...(showUnchanged ? side.unchanged : []),
	];
}

/** "+ 3 unveränderte": shows a group of rows that is left out at first, or hides it again. */
function MoreButton({
	shown,
	more,
	onToggle,
}: {
	shown: boolean;
	more: string;
	onToggle: (shown: boolean) => void;
}) {
	return (
		<Button
			variant="ghost"
			size="xs"
			className={cn("text-muted-foreground", BELOW_HEADER)}
			onClick={() => onToggle(!shown)}
		>
			{shown ? S.fewer : more}
		</Button>
	);
}

function Column({
	which,
	side,
	rows,
	showUnchanged,
	showExcluded,
	setUnchanged,
	setExcluded,
	children,
}: {
	which: "imports" | "importers";
	side: Side;
	rows: Neighbour[];
	showUnchanged: boolean;
	showExcluded: boolean;
	setUnchanged: (on: boolean) => void;
	setExcluded: (on: boolean) => void;
	children?: ReactNode;
}) {
	const total = side.changed.length + side.excluded.length + side.unchanged.length;
	const head = useId();
	return (
		<div className="min-w-0">
			<div
				id={head}
				className="truncate text-xs text-muted-foreground"
				style={{ height: HEAD_H, lineHeight: `${HEAD_H}px` }}
			>
				{which === "imports" ? S.importsColumn(total) : S.importersColumn(total)}
			</div>
			<ul aria-labelledby={head}>
				{rows.map((n) => (
					<NeighbourRow key={n.path} n={n} side={which} />
				))}
			</ul>
			{side.excluded.length + side.unchanged.length > 0 ? (
				<div className="-ml-2 flex flex-wrap gap-1">
					{side.excluded.length > 0 ? (
						<MoreButton
							shown={showExcluded}
							more={S.moreExcluded(side.excluded.length)}
							onToggle={setExcluded}
						/>
					) : null}
					{side.unchanged.length > 0 ? (
						<MoreButton
							shown={showUnchanged}
							more={S.moreUnchanged(side.unchanged.length)}
							onToggle={setUnchanged}
						/>
					) : null}
				</div>
			) : null}
			{children}
		</div>
	);
}

/** Curves from each row to the centre box, the arrowhead at the imported end. */
function Lines({
	rows,
	centre,
	rowsOnLeft,
	height,
}: {
	rows: Neighbour[];
	centre: number;
	rowsOnLeft: boolean;
	height: number;
}) {
	return (
		<svg className="overflow-visible" width={GAP_W} height={height} aria-hidden="true">
			{rows.map((n, i) => {
				const y = HEAD_H + i * ROW_H + ROW_H / 2;
				const rowX = rowsOnLeft ? 0 : GAP_W;
				const boxX = rowsOnLeft ? GAP_W : 0;
				const d = `M${boxX},${centre} C${GAP_W / 2},${centre} ${GAP_W / 2},${y} ${rowX},${y}`;
				// Arrowhead at the imported end: the row on the left (an import), the box on the right side.
				const tipX = rowsOnLeft ? rowX : boxX;
				const tipY = rowsOnLeft ? y : centre;
				const arrow = `${tipX},${tipY} ${tipX + 7},${tipY - 3.5} ${tipX + 7},${tipY + 3.5}`;
				return (
					// Stronger for a file of the review, like its row.
					<g
						key={n.path}
						className={
							n.where === "review" ? "fill-edge-strong stroke-edge-strong" : "fill-edge stroke-edge"
						}
					>
						<path
							d={d}
							fill="none"
							strokeWidth={1.3}
							strokeDasharray={n.kind === "type" ? "4 3" : undefined}
						/>
						<polygon points={arrow} stroke="none" />
					</g>
				);
			})}
		</svg>
	);
}

export function Neighbourhood({ view, neighbours }: { view: FileView; neighbours: Neighbours }) {
	const [importsUnchanged, setImportsUnchanged] = useState(false);
	const [importsExcluded, setImportsExcluded] = useState(false);
	const [importersUnchanged, setImportersUnchanged] = useState(false);
	const [importersExcluded, setImportersExcluded] = useState(false);
	const left = shownRows(neighbours.imports, importsUnchanged, importsExcluded);
	const right = shownRows(neighbours.importers, importersUnchanged, importersExcluded);
	const importers = neighbours.importers;
	// No extractor reads this kind of file (Markdown, a dotfile) and nothing imports it: there is
	// nothing to draw, and "imports 0 files" would claim more than is known.
	if (
		!view.importsRead &&
		importers.changed.length + importers.excluded.length + importers.unchanged.length === 0
	)
		return <p className="text-sm text-muted-foreground">{S.noExtractor}</p>;
	const tallest = Math.max(left.length, right.length, 2);
	const centre = HEAD_H + Math.min((tallest * ROW_H) / 2, 150);
	const height = HEAD_H + tallest * ROW_H;
	return (
		<div
			className="grid items-start"
			style={{
				gridTemplateColumns: `minmax(0, 1fr) ${GAP_W}px minmax(150px, 220px) ${GAP_W}px minmax(0, 1fr)`,
			}}
		>
			<Column
				which="imports"
				side={neighbours.imports}
				rows={left}
				showUnchanged={importsUnchanged}
				showExcluded={importsExcluded}
				setUnchanged={setImportsUnchanged}
				setExcluded={setImportsExcluded}
			>
				{neighbours.packages.length > 0 ? (
					<div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
						<span className="text-muted-foreground">{S.packages}</span>
						{neighbours.packages.map((p) => (
							<Tooltip key={p.name}>
								{/* In the tab order: the tooltip is the only place that says what is imported. */}
								<TooltipTrigger
									render={
										<Badge
											variant="outline"
											tabIndex={0}
											className={cn(
												"font-normal",
												p.kind === "type" && "border-dashed",
												BELOW_HEADER,
											)}
										/>
									}
								>
									{p.name}
								</TooltipTrigger>
								<TooltipContent side="bottom" className="max-w-sm">
									<div className="wrap-anywhere">
										<ImportedNames kind={p.kind} names={p.names} />
									</div>
								</TooltipContent>
							</Tooltip>
						))}
					</div>
				) : null}
				{neighbours.unresolved.length > 0 ? (
					<div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
						<span className="text-muted-foreground">{S.unresolved}</span>
						{neighbours.unresolved.map((u) => (
							<code key={`${u.line}:${u.specifier}`} className="font-mono text-destructive">
								{u.specifier}
							</code>
						))}
					</div>
				) : null}
			</Column>
			<Lines rows={left} centre={centre} rowsOnLeft height={height} />
			<div
				className="flex items-center justify-center gap-2 overflow-hidden rounded-lg border border-foreground/30 bg-card px-3 font-medium"
				style={{ height: CENTRE_H, marginTop: centre - CENTRE_H / 2 }}
			>
				<StatusMark status={view.status} />
				<span className="truncate">{baseName(view.path)}</span>
			</div>
			<Lines rows={right} centre={centre} rowsOnLeft={false} height={height} />
			<Column
				which="importers"
				side={neighbours.importers}
				rows={right}
				showUnchanged={importersUnchanged}
				showExcluded={importersExcluded}
				setUnchanged={setImportersUnchanged}
				setExcluded={setImportersExcluded}
			/>
		</div>
	);
}
