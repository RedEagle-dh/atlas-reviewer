/** The map's nodes (group, file, frame) and its one edge type, as React Flow components. */
import {
	type EdgeProps,
	type Edge as FlowEdge,
	Handle,
	type Node,
	type NodeProps,
	Position,
} from "@xyflow/react";
import { memo } from "react";
import type { ChangedFile } from "../../../core/types";
import { Delta, SizeBar, ViewedMark } from "../../components/marks";
import { ltr, type ViewedMark as Mark } from "../../lib/files";
import { S } from "../../strings";
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

/** Invisible anchors: React Flow wants handles; the lines are drawn from the layout's geometry. */
function Anchors() {
	return (
		<>
			<Handle type="target" position={Position.Left} className="map-anchor" isConnectable={false} />
			<Handle
				type="source"
				position={Position.Right}
				className="map-anchor"
				isConnectable={false}
			/>
		</>
	);
}

function StatusStack({ status, total }: { status: GroupStats["status"]; total: number }) {
	return (
		<span className="status-stack" aria-hidden="true">
			{(["added", "modified", "renamed", "deleted"] as const).map((s) =>
				status[s] > 0 ? (
					<i key={s} className={`st-${s}`} style={{ flexGrow: status[s] / total }} />
				) : null,
			)}
		</span>
	);
}

export const GroupNode = memo(function GroupNode({ data }: NodeProps<GroupFlowNode>) {
	const { group, stats, seen, label, text, context } = data;
	if (context)
		return (
			<div className="map-node map-group is-context" title={label}>
				<Anchors />
				<span className="map-context-label">{text}</span>
				<span className="map-context-count num">{stats.files}</span>
			</div>
		);
	return (
		<div className="map-node map-group" title={label}>
			<Anchors />
			<div className="map-group-title">
				{group.chapter ? <span className="map-group-index num">{group.chapter.index}</span> : null}
				<span className="map-group-label">{label}</span>
			</div>
			<div className="map-group-meta">
				<span className="map-group-files num">{S.files(stats.files)}</span>
				<Delta added={stats.added} deleted={stats.deleted} />
			</div>
			<div className="map-group-foot">
				<StatusStack status={stats.status} total={stats.files} />
				<span className="map-group-seen num" title={S.groupSeen(seen, stats.files)}>
					{S.chapterProgress(seen, stats.files)}
				</span>
			</div>
			<span
				className="map-group-progress"
				style={{ width: `${stats.files ? (seen / stats.files) * 100 : 0}%` }}
			/>
		</div>
	);
});

export const FileNode = memo(function FileNode({ data }: NodeProps<FileFlowNode>) {
	const { file, mark, hint, name, context } = data;
	if (context)
		return (
			<div className={`map-node map-file is-context st-${file.status}`} title={file.path}>
				<Anchors />
				<span className="map-context-label">{name}</span>
				<span className="map-context-hint">{ltr(hint)}</span>
			</div>
		);
	return (
		<div
			className={`map-node map-file st-${file.status}${mark === "viewed" ? " is-viewed" : ""}`}
			title={file.path}
		>
			<Anchors />
			<div className="map-file-row">
				<span className="map-file-name">{name}</span>
				<ViewedMark mark={mark} />
			</div>
			<div className="map-file-row">
				<span className="map-file-hint">{ltr(hint)}</span>
			</div>
			<div className="map-file-row">
				<span
					className="map-file-outside num"
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

export function FrameNode() {
	return (
		<div className="map-frame">
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

export const ImportEdge = memo(function ImportEdge({ data }: EdgeProps<ImportFlowEdge>) {
	if (!data) return null;
	const { geometry, edge, kind, before } = data;
	const total = edge.count + (edge.back?.count ?? 0);
	const typeOnly = edge.typeOnly && (edge.back?.typeOnly ?? true);
	const label = edge.back ? `${edge.count}⇄${edge.back.count}` : String(edge.count);
	const size = labelSize({ ...edge, labelled: true });
	return (
		<g
			className={`imp-edge kind-${kind}${typeOnly ? " is-type" : ""}${edge.cycle ? " is-cycle" : ""}${before ? " is-before" : ""}`}
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
					<rect x={-size.width / 2} y={-9} width={size.width} height={18} rx={4} />
					<text y={0.5} dominantBaseline="middle" textAnchor="middle">
						{edge.cycle && !edge.back ? <tspan className="imp-cycle-mark">↻ </tspan> : null}
						{label}
					</text>
				</g>
			) : null}
		</g>
	);
});

export const EDGE_TYPES = { import: ImportEdge };
