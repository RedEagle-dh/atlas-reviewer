/**
 * The map's nodes (group, file, frame) and its one edge type, as React Flow components.
 *
 * Sizes inside a node are in px, not on the rem scale: the layout computes every box in px from
 * names measured in px (`FONTS` in MapView.tsx, the room around a name in labels.ts), so the text
 * is drawn exactly that large whatever the reader's default font size is. The map's own zoom is
 * how its text gets bigger.
 */
import {
	type EdgeProps,
	type Edge as FlowEdge,
	Handle,
	type Node,
	type NodeProps,
	Position,
} from "@xyflow/react";
import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ChangedFile } from "../../../core/types";
import {
	Delta,
	Progress,
	SizeBar,
	STATUS_SOLID,
	StatusMark,
	ViewedMark,
} from "../../components/marks";
import { ltr, type ViewedMark as Mark } from "../../lib/files";
import { fmt, S } from "../../strings";
import type { Group, GroupStats } from "./grouping";
import { type EdgeGeometry, labelSize, strokeWidth } from "./layout";
import type { DrawnEdge } from "./level";

export type GroupNodeData = {
	group: Group;
	stats: GroupStats;
	seen: number;
	/** The full title (tooltip); `text` is what fits (a context node's name may be cut). */
	label: string;
	text: string;
	context: boolean;
};
export type FileNodeData = {
	file: ChangedFile;
	mark: Mark;
	hint: string;
	/** The file name as drawn: cut in the middle when it does not fit. */
	name: string;
	context: boolean;
	/** The file the URL points at (`?focus=`, "Auf der Karte zeigen"). */
	focus: boolean;
};
/**
 * Not React Flow's built-in `group` type: that one brings a square #bbb border of its own
 * around the node, which doubled the rounded border and made muted context nodes the brightest
 * outline on a dark canvas.
 */
export type GroupFlowNode = Node<GroupNodeData, "atlas-group">;
export type FileFlowNode = Node<FileNodeData, "file">;
export type FrameFlowNode = Node<Record<string, never>, "frame">;
export type MapFlowNode = GroupFlowNode | FileFlowNode | FrameFlowNode;

/** The statuses in the order every stack and list shows them. */
export const STATUSES = ["added", "modified", "renamed", "deleted"] as const;

/**
 * The class MapView gives React Flow's wrapper of a node: the wrapper holds the keyboard focus
 * (its own outline is off, see map.css), and the card inside shows it.
 */
export const NODE_WRAPPER = "group/node";

/**
 * A node's card. `font-sans` is the family MapView measures the names in. The ring is the focus
 * of the card's own wrapper and of nothing above it: a shell that moves the focus to its main
 * area after a navigation by keyboard must not light every card.
 */
const CARD =
	"relative size-full cursor-pointer rounded-lg border bg-card font-sans text-card-foreground shadow-xs transition-colors hover:border-ring group-focus-visible/node:border-ring group-focus-visible/node:ring-3 group-focus-visible/node:ring-ring/50";
/**
 * The file the URL points at: a ring that stands off the card, so it reads apart from the hover
 * border and from the keyboard's ring.
 */
const POINTED_AT = "outline-2 outline-offset-2 outline-primary";
/**
 * A neighbour outside the current group steps back: flat, a dashed outline, muted text. Opaque all
 * the same: the lines to a second column of neighbours run behind the first.
 */
export const CONTEXT_CARD =
	"border-dashed border-muted-foreground/40 bg-background text-muted-foreground shadow-none";
/** A status or viewed mark beside a name: the 16 px that labels.ts counts for it. */
const MARK = "size-[16px] text-[12px] leading-none";
const SMALL = "text-[12px] leading-[16px]";
/**
 * The style `small` of MapView's `FONTS`: a context node's count and directory are measured. What
 * is measured is drawn without `tabular-nums`: the canvas that measures knows no such figures.
 */
const SMALL_MEASURED = "text-[11.5px] leading-[16px]";
const CONTEXT_NAME = "min-w-0 truncate text-[13px] leading-[18px] font-[550]";

/** Invisible anchors: React Flow wants handles; the lines are drawn from the layout's geometry. */
function Anchors() {
	return (
		<>
			<Handle
				type="target"
				position={Position.Left}
				className="pointer-events-none opacity-0"
				isConnectable={false}
			/>
			<Handle
				type="source"
				position={Position.Right}
				className="pointer-events-none opacity-0"
				isConnectable={false}
			/>
		</>
	);
}

/**
 * How a group's files split by status: one bar, and the same in words (on hover, and for a screen
 * reader) for who cannot tell its colours apart.
 */
function StatusStack({ status, total }: { status: GroupStats["status"]; total: number }) {
	const present = STATUSES.filter((s) => status[s] > 0);
	const words = present.map((s) => `${fmt(status[s])} ${S.status[s]}`).join(", ");
	return (
		<span
			className="flex h-[6px] flex-1 gap-px overflow-hidden rounded-full bg-muted"
			role="img"
			aria-label={words}
			title={words}
		>
			{present.map((s) => (
				<span key={s} className={STATUS_SOLID[s]} style={{ flexGrow: status[s] / total }} />
			))}
		</span>
	);
}

export const GroupNode = memo(function GroupNode({ data }: NodeProps<GroupFlowNode>) {
	const { group, stats, seen, label, text, context } = data;
	if (context)
		return (
			<div
				className={cn(CARD, CONTEXT_CARD, "flex items-center gap-[8px] px-[10px]")}
				title={label}
				data-slot="map-node"
			>
				<Anchors />
				<span className={cn(CONTEXT_NAME, "flex-1")} data-slot="map-node-name">
					{text}
				</span>
				<span className={SMALL_MEASURED}>{fmt(stats.files)}</span>
			</div>
		);
	return (
		<div
			className={cn(CARD, "flex flex-col overflow-hidden px-[10px] pt-[8px] pb-[9px]")}
			title={label}
			data-slot="map-node"
		>
			<Anchors />
			<div className="flex items-baseline gap-[6px] text-[14.5px] leading-[1.22] font-[650]">
				{group.chapter ? (
					<span className="shrink-0 text-muted-foreground">{group.chapter.index}</span>
				) : null}
				{/* Two lines at most, so the counts below keep their place; the card's title has it whole. */}
				<span className="line-clamp-2 wrap-anywhere" data-slot="map-node-name">
					{label}
				</span>
			</div>
			<div className={cn(SMALL, "mt-auto flex items-end justify-between gap-[8px]")}>
				<span className="whitespace-nowrap text-muted-foreground tabular-nums">
					{S.files(stats.files)}
				</span>
				<Delta added={stats.added} deleted={stats.deleted} className={SMALL} />
			</div>
			<div className="mt-[6px] flex items-center gap-[8px]">
				<StatusStack status={stats.status} total={stats.files} />
				<span
					className={cn(SMALL, "whitespace-nowrap text-muted-foreground tabular-nums")}
					title={S.groupSeen(seen, stats.files)}
				>
					{S.chapterProgress(seen, stats.files)}
				</span>
			</div>
			{/* How much of the group is seen, along the card's lower edge. */}
			<Progress
				seen={seen}
				total={stats.files}
				label={S.groupSeen(seen, stats.files)}
				className="absolute inset-x-0 bottom-0 *:data-[slot=progress-track]:h-[2px] *:data-[slot=progress-track]:rounded-none *:data-[slot=progress-track]:bg-transparent"
			/>
		</div>
	);
});

export const FileNode = memo(function FileNode({ data }: NodeProps<FileFlowNode>) {
	const { file, mark, hint, name, context, focus } = data;
	const columns = "grid grid-cols-[16px_minmax(0,1fr)] content-center gap-x-[6px] px-[10px]";
	if (context)
		return (
			<div
				className={cn(CARD, CONTEXT_CARD, columns, focus && POINTED_AT)}
				title={file.path}
				data-slot="map-node"
			>
				<Anchors />
				<StatusMark status={file.status} className={cn(MARK, "row-span-2 self-center")} />
				<span className={CONTEXT_NAME} data-slot="map-node-name">
					{name}
				</span>
				<span className={cn(SMALL_MEASURED, "col-start-2 truncate")}>{ltr(hint)}</span>
			</div>
		);
	return (
		<div className={cn(CARD, columns, focus && POINTED_AT)} title={file.path} data-slot="map-node">
			<Anchors />
			<StatusMark status={file.status} className={cn(MARK, "self-center")} />
			<div className="flex min-w-0 items-center gap-[6px]">
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-[14px] leading-[20px] font-semibold",
						mark === "viewed" && "font-medium text-muted-foreground",
					)}
					data-slot="map-node-name"
				>
					{name}
				</span>
				<ViewedMark mark={mark} className={MARK} />
			</div>
			{/* Cut from the left: the end of a directory says more than its start. */}
			<span
				className={cn(
					SMALL,
					"col-start-2 truncate text-left text-muted-foreground [direction:rtl]",
				)}
			>
				{ltr(hint)}
			</span>
			{/* A line high with or without its text: every card has its name at the same height. */}
			<div className="col-start-2 flex h-[16px] min-w-0 items-center gap-[6px]">
				<span
					className={cn(SMALL, "min-w-0 flex-1 truncate text-muted-foreground tabular-nums")}
					title={
						file.outside.importers > 0 ? S.outsideImportersTitle(file.outside.importers) : undefined
					}
				>
					{file.outside.importers > 0 ? S.outsideImporters(file.outside.importers) : ""}
				</span>
				<SizeBar added={file.added} deleted={file.deleted} />
			</div>
		</div>
	);
});

/** The outline around the current group's own nodes, when neighbours are drawn beside it. */
export function FrameNode() {
	return (
		<div className="size-full rounded-xl border border-foreground/15 bg-foreground/3">
			<Anchors />
		</div>
	);
}

export const NODE_TYPES = { "atlas-group": GroupNode, file: FileNode, frame: FrameNode };

// ---------------------------------------------------------------------------------------------

export type ImportEdgeData = {
	geometry: EdgeGeometry;
	edge: Pick<DrawnEdge, "count" | "typeOnly" | "cycle" | "back" | "labelled">;
	kind: "inner" | "detail" | "link";
	/** Every import behind the line touches a deleted file: it existed before the change. */
	before: boolean;
};
export type ImportFlowEdge = FlowEdge<ImportEdgeData, "import">;

/**
 * The count on a line as a small pill, centred on the origin (the legend draws one as its
 * sample). `width` comes from `labelSize`; the look is map.css (`.imp-label`).
 */
export function CountLabel({ width, children }: { width: number; children: ReactNode }) {
	return (
		<>
			<rect x={-width / 2} y={-9} width={width} height={18} rx={9} />
			<text y={0.5} dominantBaseline="middle" textAnchor="middle">
				{children}
			</text>
		</>
	);
}

export const ImportEdge = memo(function ImportEdge({ data }: EdgeProps<ImportFlowEdge>) {
	if (!data) return null;
	const { geometry, edge, kind, before } = data;
	const total = edge.count + (edge.back?.count ?? 0);
	const typeOnly = edge.typeOnly && (edge.back?.typeOnly ?? true);
	const label = edge.back ? `${edge.count}⇄${edge.back.count}` : String(edge.count);
	const size = labelSize({ ...edge, labelled: true });
	return (
		<g
			className={cn(
				"imp-edge",
				`kind-${kind}`,
				typeOnly && "is-type",
				edge.cycle && "is-cycle",
				before && "is-before",
			)}
			data-count={total}
		>
			<title>
				{S.edgeTitle(total, typeOnly) +
					(edge.cycle ? `, ${S.cycleMark}` : "") +
					(before ? `, ${S.beforeChange}` : "")}
			</title>
			<path className="imp-line" d={geometry.path} style={{ strokeWidth: strokeWidth(total) }} />
			{geometry.arrows.map((points) => (
				<polygon key={points} className="imp-arrow" points={points} />
			))}
			{edge.labelled || kind === "link" ? (
				<g className="imp-label" transform={`translate(${geometry.label.x} ${geometry.label.y})`}>
					<CountLabel width={size.width}>
						{edge.cycle && !edge.back ? <tspan className="imp-cycle-mark">↻ </tspan> : null}
						{label}
					</CountLabel>
				</g>
			) : null}
		</g>
	);
});

export const EDGE_TYPES = { import: ImportEdge };
