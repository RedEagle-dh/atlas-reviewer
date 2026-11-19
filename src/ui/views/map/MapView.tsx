/**
 * The map (`#/map/<group>`): one level of the group tree as a layered graph. Grouping, level,
 * drawing, labels and layout are pure functions (grouping.ts, level.ts, labels.ts, layout.ts);
 * this component turns them into React Flow nodes and edges and handles hover, clicks, the
 * viewport and the controls.
 */
import {
	MiniMap,
	type NodeMouseHandler,
	ReactFlow,
	type ReactFlowInstance,
	ReactFlowProvider,
	useReactFlow,
	type Viewport,
} from "@xyflow/react";
import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Icon } from "../../components/icons";
import { baseName, countViewed, dirName, viewedMark } from "../../lib/files";
import { writeStored } from "../../lib/storage";
import { fileRoute, type Grouping, mapRoute, type Route, readMapParams } from "../../router";
import { useAtlas } from "../../state/atlas";
import { useChoice, useFlag } from "../../state/prefs";
import { rememberViewport, takeRestore } from "../../state/route";
import { S } from "../../strings";
import { buildGroupTree, type Group, groupStats, locateGroup, ROOT_UNIT, trail } from "./grouping";
import { labelNodes, type Measure } from "./labels";
import { type Box, type Direction, layoutLevel, nodeSize, placeTip, type Rect } from "./layout";
import { buildLevel, drawLevel, type LevelNode, neighbourhood, relationsOf } from "./level";
import { EDGE_TYPES, type ImportFlowEdge, type MapFlowNode, NODE_TYPES } from "./nodes";

/** Below this zoom the node text gets too small to read: the first view never goes lower… */
const READABLE_ZOOM = 0.72;
/** …except on a small level, which rather fits whole (13 chapters at 1100 px). */
const SMALL_LEVEL_ZOOM = 0.6;
const SMALL_LEVEL = 15;
const MAX_FIRST_ZOOM = 1.1;
const FRAME_ID = "\u0000frame";
/** The first view keeps the drawing below the floating controls and off the edges. */
const PAD = 24;
const TOP = 60;
/** React Flow's minimap: 200 × 150 px, 15 px from the corner. */
const MINIMAP = { width: 200, height: 150, margin: 15 };

export function groupLabel(group: Group): string {
	if (group.kind === "unit" && group.id === ROOT_UNIT) return S.rootUnit;
	return group.label;
}

function nodeLabel(node: LevelNode): string {
	return node.kind === "group" ? groupLabel(node.group) : node.file.path;
}

/** The directory hint of a file node: where it sits below the shown group. */
function fileHint(path: string, group: Group, context: boolean): string {
	const dir = dirName(path);
	if (context) return dir.split("/").slice(-2).join("/");
	const rel =
		group.dir && dir.startsWith(group.dir) ? dir.slice(group.dir.length).replace(/^\//, "") : dir;
	if (rel) return `${rel}/`;
	const last = dir.split("/").pop();
	return last ? `${last}/` : "";
}

// ---------------------------------------------------------------------------------------------
// Measuring names in the map's fonts
// ---------------------------------------------------------------------------------------------

/** As in map.css: file name, context label, group title, small counts. */
const FONTS = {
	file: "600 14px",
	context: "550 13px",
	group: "650 14.5px",
	small: "400 11.5px",
} as const;
let canvas: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

/** Text width on a canvas in the UI font (`--font-ui`); a rough estimate without a canvas. */
const measureText: Measure = (text, style) => {
	const key = `${style}|${text}`;
	const known = widths.get(key);
	if (known !== undefined) return known;
	if (canvas === undefined) canvas = document.createElement("canvas").getContext("2d");
	let width = text.length * 7.5;
	if (canvas) {
		const family = getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim();
		canvas.font = `${FONTS[style]} ${family || "sans-serif"}`;
		width = canvas.measureText(text).width;
	}
	widths.set(key, width);
	return width;
};

// ---------------------------------------------------------------------------------------------

interface Tip {
	nodeId: string;
	/** The hovered node and the nodes that stay lit, relative to the canvas. */
	anchor: Rect;
	lit: Rect[];
}

function Breadcrumb({ trail, grouping }: { trail: Group[]; grouping: Grouping }) {
	const { href } = useAtlas();
	return (
		<nav className="breadcrumb" aria-label={S.mapTitle}>
			{trail.map((group, i) => {
				const last = i === trail.length - 1;
				const text = group.kind === "root" ? S.overview : groupLabel(group);
				const index = group.chapter ? `${group.chapter.index} ` : "";
				return (
					<span key={group.id || "root"} className="crumb">
						{i > 0 ? (
							<span className="crumb-sep" aria-hidden="true">
								/
							</span>
						) : null}
						{last ? (
							<span className="crumb-current" aria-current="page">
								{index}
								{text}
							</span>
						) : (
							<a href={href(mapRoute({ group: group.id, grouping }))}>
								{index}
								{text}
							</a>
						)}
					</span>
				);
			})}
		</nav>
	);
}

function Legend() {
	return (
		<div className="map-legend" role="note" aria-label={S.legend}>
			<div className="legend-row">
				<svg width="44" height="12" aria-hidden="true">
					<path d="M2 6h32" className="legend-line" />
					<polygon points="42,6 33,1.5 33,10.5" className="legend-arrow" />
				</svg>
				<span>{S.legendArrow}</span>
			</div>
			<div className="legend-row">
				<span className="legend-count num">12</span>
				<span>{S.legendCount}</span>
			</div>
			<div className="legend-row">
				<svg width="44" height="12" aria-hidden="true">
					<path d="M2 6h40" className="legend-line is-type" />
				</svg>
				<span>{S.legendTypes}</span>
			</div>
			<div className="legend-row">
				<svg width="44" height="12" aria-hidden="true">
					<path d="M2 6h40" className="legend-line is-cycle" />
				</svg>
				<span>{S.legendCycle}</span>
			</div>
			<div className="legend-row">
				<svg width="44" height="12" aria-hidden="true">
					<path d="M2 6h40" className="legend-line is-before" />
				</svg>
				<span>{S.legendBefore}</span>
			</div>
			<div className="legend-row">
				<span className="legend-context" />
				<span>{S.legendContext}</span>
			</div>
			<div className="legend-row legend-status">
				{(["added", "modified", "renamed", "deleted"] as const).map((s) => (
					<span key={s} className={`legend-status-item st-${s}`}>
						<i />
						{S.status[s]}
					</span>
				))}
			</div>
		</div>
	);
}

function Tooltip({
	tip,
	level,
	canvas,
}: {
	tip: Tip;
	level: ReturnType<typeof buildLevel>;
	canvas: { width: number; height: number };
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		setPosition(
			placeTip(tip.anchor, tip.lit, { width: el.offsetWidth, height: el.offsetHeight }, canvas),
		);
	}, [tip, canvas]);
	const node = level.nodes.find((n) => n.id === tip.nodeId);
	if (!node) return null;
	const { imports, importedBy } = relationsOf(level, tip.nodeId);
	const list = (relations: typeof imports) => {
		const shown = relations.slice(0, 3);
		return (
			<>
				{shown.map((r, i) => (
					<span key={r.node.id}>
						{i > 0 ? ", " : ""}
						<b>{r.node.kind === "group" ? groupLabel(r.node.group) : baseName(r.node.file.path)}</b>
						<span className="num"> ({r.count})</span>
					</span>
				))}
				{relations.length > 3 ? <span>, {S.tooltipMore(relations.length - 3)}</span> : null}
			</>
		);
	};
	return (
		<div
			ref={ref}
			className="map-tip"
			style={
				position
					? { left: position.left, top: position.top }
					: { left: 0, top: 0, visibility: "hidden" }
			}
			role="tooltip"
		>
			<div className="map-tip-title">{nodeLabel(node)}</div>
			{imports.length === 0 && importedBy.length === 0 ? (
				<div className="map-tip-row">{S.tooltipNone}</div>
			) : null}
			{imports.length > 0 ? (
				<div className="map-tip-row">
					<span className="map-tip-key">{S.tooltipImports}</span> {list(imports)}
				</div>
			) : null}
			{importedBy.length > 0 ? (
				<div className="map-tip-row">
					<span className="map-tip-key">{S.tooltipImportedBy}</span> {list(importedBy)}
				</div>
			) : null}
			<div className="map-tip-hint">
				{node.kind === "group" ? S.tooltipOpenGroup : S.tooltipOpenFile}
			</div>
		</div>
	);
}

/**
 * The first view: as much as fits while the text stays readable; the "Grundlagen" side first.
 * `fits` says whether the whole drawing is in view.
 */
function firstViewport(
	bounds: Box,
	width: number,
	height: number,
	direction: Direction,
	focus: Box | null,
	floor: number,
) {
	const fit = Math.min((width - 2 * PAD) / bounds.width, (height - TOP - PAD) / bounds.height);
	const zoom = Math.max(floor, Math.min(MAX_FIRST_ZOOM, fit));
	const w = bounds.width * zoom;
	const h = bounds.height * zoom;
	const fits = w <= width - 2 * PAD + 0.5 && h <= height - TOP - PAD + 0.5;
	let x: number;
	let y: number;
	if (focus && !fits) {
		x = width / 2 - (focus.x + focus.width / 2) * zoom;
		y = height / 2 - (focus.y + focus.height / 2) * zoom;
	} else {
		x =
			w <= width - 2 * PAD
				? (width - w) / 2 - bounds.x * zoom
				: direction === "ltr"
					? PAD - bounds.x * zoom
					: width - PAD - (bounds.x + bounds.width) * zoom;
		y =
			h <= height - TOP - PAD
				? TOP + (height - TOP - PAD - h) / 2 - bounds.y * zoom
				: TOP - bounds.y * zoom;
	}
	return { x, y, zoom, fits };
}

/** "Einpassen": everything in view; with the minimap shown, out of its corner. */
function fitViewport(bounds: Box, width: number, height: number, minimap: boolean): Viewport {
	const area = (w: number, h: number) => ({
		w,
		h,
		zoom: Math.max(0.15, Math.min(2, w / bounds.width, h / bounds.height)),
	});
	const full = area(width - 2 * PAD, height - TOP - PAD);
	const reserve = MINIMAP.margin + 6;
	const besideMap = area(full.w - MINIMAP.width - reserve, full.h);
	const aboveMap = area(full.w, full.h - MINIMAP.height - reserve);
	const choice = !minimap ? full : besideMap.zoom >= aboveMap.zoom ? besideMap : aboveMap;
	return {
		zoom: choice.zoom,
		x: PAD + (choice.w - bounds.width * choice.zoom) / 2 - bounds.x * choice.zoom,
		y: TOP + (choice.h - bounds.height * choice.zoom) / 2 - bounds.y * choice.zoom,
	};
}

function useSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
	const [size, setSize] = useState({ width: 0, height: 0 });
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
		update();
		const observer = new ResizeObserver(update);
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref]);
	return size;
}

function MapCanvas({ route }: { route: Route }) {
	const atlas = useAtlas();
	const { meta, visible, model, viewed, go } = atlas;
	const params = readMapParams(route);
	const [direction, setDirection] = useChoice<Direction>("map-direction", ["ltr", "rtl"], "ltr");
	const [legend, setLegend] = useFlag("map-legend", false);
	const [hoverState, setHovered] = useState<Tip | null>(null);
	const wrapper = useRef<HTMLDivElement>(null);
	const size = useSize(wrapper);
	const flow = useReactFlow<MapFlowNode, ImportFlowEdge>();

	const visibleEdges = useMemo(() => {
		const paths = new Set(visible.map((f) => f.path));
		return model.edges.filter((e) => paths.has(e.from) && paths.has(e.to));
	}, [visible, model]);
	const deleted = useMemo(
		() => new Set(model.files.filter((f) => f.status === "deleted").map((f) => f.path)),
		[model],
	);
	const tree = useMemo(
		() => buildGroupTree(visible, params.grouping, meta.chapters),
		[visible, params.grouping, meta],
	);
	const group = locateGroup(tree, params.group);
	const level = useMemo(
		() => buildLevel(tree, group, visibleEdges, model.cycles),
		[tree, group, visibleEdges, model.cycles],
	);
	const drawing = useMemo(() => drawLevel(level), [level]);
	const labels = useMemo(
		() =>
			labelNodes(
				level.nodes.map((node) =>
					node.kind === "group"
						? {
								node,
								name:
									node.context && node.group.chapter
										? `${node.group.chapter.index} ${groupLabel(node.group)}`
										: groupLabel(node.group),
								index: node.group.chapter ? String(node.group.chapter.index) : "",
								count: String(node.group.all.length),
							}
						: {
								node,
								name: baseName(node.file.path),
								hint: fileHint(node.file.path, group, node.context),
							},
				),
				measureText,
			),
		[level, group],
	);
	const layout = useMemo(
		() => layoutLevel(level.nodes, drawing, direction, (n) => labels.get(n.id) ?? nodeSize(n)),
		[level, drawing, direction, labels],
	);
	// Context nodes count: they take room and carry text like the group's own nodes.
	const floor = level.nodes.length <= SMALL_LEVEL ? SMALL_LEVEL_ZOOM : READABLE_ZOOM;

	// A URL that names a collapsed or vanished group shows the group that stands for it: say so in the URL.
	useEffect(() => {
		if (group.id !== params.group) go(mapRoute({ ...params, group: group.id }), { replace: true });
	}, [group.id, params, go]);

	// A node that vanishes under the pointer (the level changed) never reports the mouse leaving:
	// a hover counts only while its node is drawn.
	const hovered =
		hoverState && level.nodes.some((n) => n.id === hoverState.nodeId) ? hoverState : null;
	const lit = useMemo(
		() => (hovered ? neighbourhood(drawing, hovered.nodeId) : null),
		[hovered, drawing],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new level starts without a hover.
	useEffect(() => setHovered(null), [level]);
	const focusId = params.focus ? `f:${params.focus}` : null;

	const nodes = useMemo(() => {
		const list: MapFlowNode[] = [];
		if (layout.frame)
			list.push({
				id: FRAME_ID,
				type: "frame",
				data: {},
				position: { x: layout.frame.x, y: layout.frame.y },
				width: layout.frame.width,
				height: layout.frame.height,
				style: { width: layout.frame.width, height: layout.frame.height, pointerEvents: "none" },
				selectable: false,
				draggable: false,
				focusable: false,
				zIndex: -1,
			});
		for (const node of level.nodes) {
			const box = layout.boxes.get(node.id);
			if (!box) continue;
			const state = lit ? (lit.nodes.has(node.id) ? " is-lit" : " is-dim") : "";
			const focus = node.id === focusId ? " is-focus" : "";
			const text = labels.get(node.id)?.text ?? nodeLabel(node);
			const common = {
				id: node.id,
				position: { x: box.x, y: box.y },
				width: box.width,
				height: box.height,
				style: { width: box.width, height: box.height },
				className: `${node.context ? "is-context-node" : ""}${state}${focus}`,
				draggable: false,
			};
			if (node.kind === "group")
				list.push({
					...common,
					type: "atlas-group",
					data: {
						group: node.group,
						stats: groupStats(node.group),
						seen: countViewed(node.group.all, viewed),
						label: groupLabel(node.group),
						text,
						context: node.context,
					},
				});
			else
				list.push({
					...common,
					type: "file",
					data: {
						file: node.file,
						mark: viewedMark(node.file, viewed),
						hint: fileHint(node.file.path, group, node.context),
						name: text,
						context: node.context,
					},
				});
		}
		return list;
	}, [layout, level, lit, focusId, viewed, group, labels]);

	const edges = useMemo(() => {
		const list: ImportFlowEdge[] = [];
		const state = (id: string) => (lit ? (lit.edges.has(id) ? " is-lit" : " is-dim") : "");
		for (const [kind, set] of [
			["inner", drawing.inner],
			["detail", drawing.details],
		] as const)
			for (const e of set) {
				const geometry = layout.edges.get(e.id);
				if (!geometry) continue;
				// Every import behind the line touches a deleted file: a relation of the base commit.
				const before = e.imports.every((i) => deleted.has(i.from) || deleted.has(i.to));
				list.push({
					id: e.id,
					type: "import",
					source: e.source,
					target: e.target,
					className: state(e.id),
					data: { geometry, edge: e, kind, before },
					focusable: false,
					selectable: false,
				});
			}
		for (const link of drawing.links) {
			const geometry = layout.edges.get(link.id);
			const main = link.side === "dependency" ? link.uses : link.usedBy;
			const back = link.side === "dependency" ? link.usedBy : link.uses;
			if (!geometry || !main) continue;
			list.push({
				id: link.id,
				type: "import",
				source: link.side === "dependency" ? FRAME_ID : link.node,
				target: link.side === "dependency" ? link.node : FRAME_ID,
				className: state(link.id),
				data: {
					geometry,
					kind: "link",
					before: false,
					edge: {
						count: main.count,
						typeOnly: main.typeOnly,
						cycle: link.cycle,
						labelled: true,
						...(back ? { back } : {}),
					},
				},
				focusable: false,
				selectable: false,
			});
		}
		return list;
	}, [drawing, layout, lit, deleted]);

	const first = useMemo(() => {
		const focus = focusId ? (layout.boxes.get(focusId) ?? null) : null;
		return firstViewport(layout.bounds, size.width, size.height, direction, focus, floor);
	}, [layout, size, direction, focusId, floor]);
	// The minimap (and a note) whenever the first view does not show the whole drawing.
	const tooLarge = size.width > 0 && !first.fits;

	const applyFirstView = useCallback(
		(instance: ReactFlowInstance<MapFlowNode, ImportFlowEdge>) => {
			const el = wrapper.current;
			if (!el) return;
			// Back to this level (browser history): the viewport the reader left it with.
			const saved = takeRestore("viewport");
			if (saved) {
				instance.setViewport(saved);
				return;
			}
			const focus = focusId ? (layout.boxes.get(focusId) ?? null) : null;
			const { x, y, zoom } = firstViewport(
				layout.bounds,
				el.clientWidth,
				el.clientHeight,
				direction,
				focus,
				floor,
			);
			instance.setViewport({ x, y, zoom });
		},
		[layout, direction, focusId, floor],
	);

	const onNodeClick: NodeMouseHandler<MapFlowNode> = (_, node) => {
		if (node.type === "atlas-group")
			go(mapRoute({ group: node.data.group.id, grouping: params.grouping }));
		else if (node.type === "file") go(fileRoute({ path: node.data.file.path }));
	};
	const onNodeEnter: NodeMouseHandler<MapFlowNode> = (event, node) => {
		if (node.type === "frame") return;
		const box = wrapper.current?.getBoundingClientRect();
		const target = event.currentTarget;
		if (!box || !(target instanceof Element)) return;
		const rect = target.getBoundingClientRect();
		const viewport = flow.getViewport();
		const litIds = neighbourhood(drawing, node.id).nodes;
		const litRects: Rect[] = [];
		for (const id of litIds) {
			const b = layout.boxes.get(id);
			if (!b || id === node.id) continue;
			litRects.push({
				left: viewport.x + b.x * viewport.zoom,
				top: viewport.y + b.y * viewport.zoom,
				width: b.width * viewport.zoom,
				height: b.height * viewport.zoom,
			});
		}
		setHovered({
			nodeId: node.id,
			anchor: {
				left: rect.left - box.left,
				top: rect.top - box.top,
				width: rect.width,
				height: rect.height,
			},
			lit: litRects,
		});
	};

	return (
		<div className="map-canvas" ref={wrapper} data-testid="map" data-level={group.id}>
			{level.nodes.length === 0 ? (
				<div className="state">
					<p>{visible.length === 0 ? S.mapEmpty : S.emptyLevel}</p>
				</div>
			) : (
				<ReactFlow<MapFlowNode, ImportFlowEdge>
					key={`${params.grouping}|${group.id}|${direction}|${visible.length}`}
					nodes={nodes}
					edges={edges}
					nodeTypes={NODE_TYPES}
					edgeTypes={EDGE_TYPES}
					onInit={applyFirstView}
					onNodeClick={onNodeClick}
					onNodeMouseEnter={onNodeEnter}
					onNodeMouseLeave={() => setHovered(null)}
					onMoveStart={() => setHovered(null)}
					onMoveEnd={(_, viewport) => rememberViewport(viewport)}
					nodesDraggable={false}
					nodesConnectable={false}
					elementsSelectable={false}
					edgesFocusable={false}
					minZoom={0.15}
					maxZoom={2}
					proOptions={{ hideAttribution: true }}
				>
					{tooLarge ? (
						<MiniMap<MapFlowNode>
							pannable
							zoomable
							className="map-minimap"
							nodeClassName={(n) =>
								n.type === "frame"
									? "mm-frame"
									: n.className?.includes("is-context-node")
										? "mm-context"
										: "mm-node"
							}
						/>
					) : null}
				</ReactFlow>
			)}
			<div className="map-controls">
				<button
					type="button"
					className="btn"
					onClick={() => {
						const el = wrapper.current;
						if (!el) return;
						flow.setViewport(
							fitViewport(layout.bounds, el.clientWidth, el.clientHeight, tooLarge),
							{ duration: 250 },
						);
					}}
					title={S.fitTitle}
				>
					<Icon name="fit" />
					{S.fit}
				</button>
				<fieldset className="segmented" aria-label={S.directionLabel} title={S.directionTitle}>
					<button
						type="button"
						aria-pressed={direction === "ltr"}
						onClick={() => setDirection("ltr")}
					>
						{S.directionLtr}
					</button>
					<button
						type="button"
						aria-pressed={direction === "rtl"}
						onClick={() => setDirection("rtl")}
					>
						{S.directionRtl}
					</button>
				</fieldset>
				<button
					type="button"
					className="btn"
					aria-pressed={legend}
					onClick={() => setLegend(!legend)}
				>
					<Icon name="legend" />
					{S.legend}
				</button>
			</div>
			{legend ? <Legend /> : null}
			{level.hiddenContext > 0 || tooLarge ? (
				<div className="map-note">
					{tooLarge ? <span>{S.mapCut}</span> : null}
					{level.hiddenContext > 0 ? <span>{S.contextHidden(level.hiddenContext)}</span> : null}
				</div>
			) : null}
			{hovered ? <Tooltip tip={hovered} level={level} canvas={size} /> : null}
		</div>
	);
}

export function MapView({ route }: { route: Route }) {
	const { meta, visible, model, go } = useAtlas();
	const params = readMapParams(route);
	const tree = useMemo(
		() => buildGroupTree(visible, params.grouping, meta.chapters),
		[visible, params.grouping, meta],
	);
	const group = locateGroup(tree, params.group);
	const setGrouping = (grouping: Grouping) => go(mapRoute({ group: "", grouping }));
	// The file page's "Auf der Karte zeigen" opens the grouping last used here.
	useEffect(() => writeStored("map-grouping", params.grouping), [params.grouping]);
	return (
		<div className="map-view">
			<div className="map-bar">
				<Breadcrumb trail={trail(group)} grouping={params.grouping} />
				<span className="map-bar-spacer" />
				<span className="map-bar-label">{S.groupingLabel}</span>
				<fieldset className="segmented" aria-label={S.groupingLabel}>
					<button
						type="button"
						aria-pressed={params.grouping === "chapters"}
						onClick={() => setGrouping("chapters")}
					>
						{S.groupingChapters}
					</button>
					<button
						type="button"
						aria-pressed={params.grouping === "dirs"}
						onClick={() => setGrouping("dirs")}
					>
						{S.groupingDirs}
					</button>
				</fieldset>
			</div>
			<ReactFlowProvider key={model.range.head.sha}>
				<MapCanvas route={route} />
			</ReactFlowProvider>
		</div>
	);
}
