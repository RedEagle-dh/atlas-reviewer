/**
 * "Zusammenhang": the file in the middle, what it imports on the left, what imports it on the
 * right, joined by lines (arrowhead at the imported side; dashed = types only). Changed files
 * first; unchanged and left-out ones behind a toggle; npm packages as a compact list.
 */
import { type ReactNode, useState } from "react";
import type { FileView } from "../../../core/types";
import { StatusMark } from "../../components/marks";
import { baseName, dirName } from "../../lib/files";
import { fileRoute } from "../../router";
import { useAtlas } from "../../state/atlas";
import { categoryLabel, S } from "../../strings";
import type { Neighbour, Neighbours, Side } from "./neighbours";

const HEAD_H = 28;
const ROW_H = 30;
const GAP_W = 72;
const CENTRE_H = 56;

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
	return (
		<li>
			<a
				className={`nb-row where-${n.where}${n.kind === "type" ? " is-type" : ""}`}
				href={href(link)}
				title={side === "importers" ? `${n.path}: ${S.openAtLine(n.line)}` : n.path}
				data-path={n.path}
			>
				<StatusMark status={status} />
				<span className="nb-path">
					<span className="nb-dir">{dirName(n.path)}/</span>
					<span className="nb-name">{baseName(n.path)}</span>
				</span>
				<span className="nb-tag">{tag}</span>
				<span className="nb-names" role="tooltip">
					<b>{S.importKind[n.kind]}</b>
					{S.names(n.names)}
				</span>
			</a>
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
	return (
		<div className={`nb-column nb-${which}`}>
			<div className="nb-head">
				{which === "imports" ? S.importsColumn(total) : S.importersColumn(total)}
			</div>
			<ul className="nb-list">
				{rows.map((n) => (
					<NeighbourRow key={n.path} n={n} side={which} />
				))}
			</ul>
			<div className="nb-more">
				{side.excluded.length > 0 ? (
					<button type="button" className="btn quiet" onClick={() => setExcluded(!showExcluded)}>
						{showExcluded ? S.fewer : S.moreExcluded(side.excluded.length)}
					</button>
				) : null}
				{side.unchanged.length > 0 ? (
					<button type="button" className="btn quiet" onClick={() => setUnchanged(!showUnchanged)}>
						{showUnchanged ? S.fewer : S.moreUnchanged(side.unchanged.length)}
					</button>
				) : null}
			</div>
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
		<svg className="nb-lines" width={GAP_W} height={height} aria-hidden="true">
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
					<g
						key={n.path}
						className={`nb-line where-${n.where}${n.kind === "type" ? " is-type" : ""}`}
					>
						<path d={d} />
						<polygon points={arrow} />
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
		return <p className="nb-none">{S.noExtractor}</p>;
	const tallest = Math.max(left.length, right.length, 2);
	const centre = HEAD_H + Math.min((tallest * ROW_H) / 2, 150);
	const height = HEAD_H + tallest * ROW_H;
	return (
		<div className="nb-grid">
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
					<div className="nb-packages">
						<span className="nb-packages-label">{S.packages}</span>
						{neighbours.packages.map((p) => (
							<span
								key={p.name}
								className={`nb-package${p.kind === "type" ? " is-type" : ""}`}
								title={`${S.importKind[p.kind]}: ${S.names(p.names)}`}
							>
								{p.name}
							</span>
						))}
					</div>
				) : null}
				{neighbours.unresolved.length > 0 ? (
					<div className="nb-packages nb-unresolved">
						<span className="nb-packages-label">{S.unresolved}</span>
						{neighbours.unresolved.map((u) => (
							<code key={`${u.line}:${u.specifier}`}>{u.specifier}</code>
						))}
					</div>
				) : null}
			</Column>
			<Lines rows={left} centre={centre} rowsOnLeft height={height} />
			<div className="nb-centre" style={{ marginTop: centre - CENTRE_H / 2 }}>
				<StatusMark status={view.status} />
				<span className="nb-centre-name">{baseName(view.path)}</span>
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
