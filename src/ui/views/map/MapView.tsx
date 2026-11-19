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
import { InfoIcon, MaximizeIcon } from "lucide-react";
import {
	type ComponentProps,
	Fragment,
	type KeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { StatusMark } from "../../components/marks";
import { baseName, countViewed, dirName, viewedMark } from "../../lib/files";
import { writeStored } from "../../lib/storage";
import { fileRoute, type Grouping, mapRoute, type Route, readMapParams } from "../../router";
import { useAtlas } from "../../state/atlas";
import { useChoice, useFlag, useResolvedTheme } from "../../state/prefs";
import { rememberViewport, takeRestore } from "../../state/route";
import { fmt, S } from "../../strings";
import { buildGroupTree, type Group, groupStats, locateGroup, ROOT_UNIT, trail } from "./grouping";
import { labelNodes, type Measure } from "./labels";
import { type Box, type Direction, layoutLevel, nodeSize, placeTip, type Rect } from "./layout";
import { buildLevel, drawLevel, type LevelNode, neighbourhood, relationsOf } from "./level";
import {
	CONTEXT_CARD,
	CountLabel,
	EDGE_TYPES,
	type ImportFlowEdge,
	type MapFlowNode,
	NODE_TYPES,
	NODE_WRAPPER,
	STATUSES,
} from "./nodes";

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
/** React Flow's minimap: 200 × 150 px, 15 px from the corner (the margin of React Flow's panels). */
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

/** As drawn in nodes.tsx: file name, context label, group title, small counts. */
const FONTS = {
	file: "600 14px",
	context: "550 13px",
	group: "650 14.5px",
	small: "400 11.5px",
} as const;
let canvas: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

/**
 * Text width on a canvas in the UI font: `--font-sans`, the family the nodes are drawn in
 * (`font-sans` in nodes.tsx). A rough estimate without a canvas.
 */
const measureText: Measure = (text, style) => {
	const key = `${style}|${text}`;
	const known = widths.get(key);
	if (known !== undefined) return known;
	if (canvas === undefined) canvas = document.createElement("canvas").getContext("2d");
	let width = text.length * 7.5;
	if (canvas) {
		const family = getComputedStyle(document.documentElement)
			.getPropertyValue("--font-sans")
			.trim();
		canvas.font = `${FONTS[style]} ${family || "sans-serif"}`;
		width = canvas.measureText(text).width;
	}
	widths.set(key, width);
	return width;
};

// ---------------------------------------------------------------------------------------------
// The pieces around the drawing
// ---------------------------------------------------------------------------------------------

/**
 * One of a few options, as a row of toggles. Base UI lets a group go empty (pressing the chosen
 * toggle again); here one option is always chosen, so that press changes nothing.
 */
function Choice<T extends string>({
	value,
	options,
	onChange,
	...group
}: {
	value: T;
	options: readonly (readonly [T, string])[];
	onChange: (value: T) => void;
} & Omit<
	ComponentProps<typeof ToggleGroup>,
	"value" | "defaultValue" | "onValueChange" | "onChange"
>) {
	return (
		<ToggleGroup
			variant="outline"
			size="sm"
			spacing={0}
			value={[value]}
			onValueChange={(pressed) => {
				const next = options.find(([option]) => pressed.includes(option));
				if (next) onChange(next[0]);
			}}
			{...group}
		>
			{options.map(([option, label]) => (
				<ToggleGroupItem key={option} value={option}>
					{label}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

const GROUPINGS = [
	["chapters", S.groupingChapters],
	["dirs", S.groupingDirs],
] as const satisfies readonly (readonly [Grouping, string])[];
const DIRECTIONS = [
	["ltr", S.directionLtr],
	["rtl", S.directionRtl],
] as const satisfies readonly (readonly [Direction, string])[];

/** Where the shown group stands: every level above it is a link that keeps the grouping. */
function Trail({ trail, grouping }: { trail: Group[]; grouping: Grouping }) {
	const { href } = useAtlas();
	return (
		<Breadcrumb aria-label={S.mapTitle} className="min-w-0">
			<BreadcrumbList>
				{trail.map((group, i) => {
					const name = (
						<>
							{group.chapter ? (
								<span className="text-muted-foreground tabular-nums">{group.chapter.index} </span>
							) : null}
							{group.kind === "root" ? S.overview : groupLabel(group)}
						</>
					);
					return (
						<Fragment key={group.id || "root"}>
							{i > 0 ? <BreadcrumbSeparator /> : null}
							<BreadcrumbItem>
								{i === trail.length - 1 ? (
									<BreadcrumbPage className="font-medium">{name}</BreadcrumbPage>
								) : (
									<BreadcrumbLink href={href(mapRoute({ group: group.id, grouping }))}>
										{name}
									</BreadcrumbLink>
								)}
							</BreadcrumbItem>
						</Fragment>
					);
				})}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

/** A sample of a line as map.css draws it: plain, type-only, on a cycle, before the change. */
function LineSample({ kind }: { kind?: "type" | "cycle" | "before" }) {
	return (
		<svg width="44" height="12" aria-hidden="true">
			<g className={cn("imp-edge", kind && `is-${kind}`)}>
				<path className="imp-line" d="M2 6h33" strokeWidth={2} />
				<polygon className="imp-arrow" points="42,6 34,2 34,10" />
			</g>
		</svg>
	);
}

function Legend() {
	const row = "grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3";
	return (
		<ul className="grid gap-2">
			<li className={row}>
				<LineSample />
				{S.legendArrow}
			</li>
			<li className={row}>
				<svg width="44" height="20" aria-hidden="true">
					<g className="imp-edge">
						<g className="imp-label" transform="translate(22 10)">
							<CountLabel width={24}>12</CountLabel>
						</g>
					</g>
				</svg>
				{S.legendCount}
			</li>
			<li className={row}>
				<LineSample kind="type" />
				{S.legendTypes}
			</li>
			<li className={row}>
				<LineSample kind="cycle" />
				{S.legendCycle}
			</li>
			<li className={row}>
				<LineSample kind="before" />
				{S.legendBefore}
			</li>
			<li className={row}>
				<span
					className={cn("h-4 w-9 justify-self-center rounded-sm border", CONTEXT_CARD)}
					aria-hidden="true"
				/>
				{S.legendContext}
			</li>
			<li className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t pt-2.5">
				{STATUSES.map((status) => (
					<span key={status} className="inline-flex items-center gap-1.5">
						<StatusMark status={status} />
						{S.status[status]}
					</span>
				))}
			</li>
		</ul>
	);
}

interface Tip {
	nodeId: string;
	/** The hovered node and the nodes that stay lit, relative to the canvas. */
	anchor: Rect;
	lit: Rect[];
}

/** What the hovered node imports and what imports it, placed where it covers the least of them. */
function NodeTip({
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
						<span className="font-medium">
							{r.node.kind === "group" ? groupLabel(r.node.group) : baseName(r.node.file.path)}
						</span>
						<span className="text-muted-foreground tabular-nums"> ({fmt(r.count)})</span>
					</span>
				))}
				{relations.length > 3 ? (
					<span className="text-muted-foreground">, {S.tooltipMore(relations.length - 3)}</span>
				) : null}
			</>
		);
	};
	return (
		<div
			ref={ref}
			className="pointer-events-none absolute z-20 grid w-80 gap-1 rounded-lg border bg-popover px-3 py-2.5 text-xs text-popover-foreground shadow-md"
			style={
				position
					? { left: position.left, top: position.top }
					: { left: 0, top: 0, visibility: "hidden" }
			}
			role="tooltip"
		>
			{/* A path wraps after a slash where it can, so a file name stays in one piece. */}
			<div className="text-sm font-medium wrap-anywhere">
				{nodeLabel(node).replaceAll("/", "/\u200b")}
			</div>
			{imports.length === 0 && importedBy.length === 0 ? (
				<div className="text-muted-foreground">{S.tooltipNone}</div>
			) : null}
			{imports.length > 0 ? (
				<div>
					<span className="text-muted-foreground">{S.tooltipImports}</span> {list(imports)}
				</div>
			) : null}
			{importedBy.length > 0 ? (
				<div>
					<span className="text-muted-foreground">{S.tooltipImportedBy}</span> {list(importedBy)}
				</div>
			) : null}
			<div className="mt-0.5 text-muted-foreground">
				{node.kind === "group" ? S.tooltipOpenGroup : S.tooltipOpenFile}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// The viewport
// ---------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------

/**
 * A control floating on the canvas stands on the page's colour: the outline controls are
 * translucent in the dark theme, and the lines of the map would show through them.
 */
const ON_CANVAS = "rounded-md bg-background";

/**
 * What a screen reader hears on a node, in place of React Flow's English text about selecting,
 * moving and deleting (none of which a node here does). React Flow reads one key or the other,
 * depending on its own keyboard handling.
 */
const ARIA_LABELS = {
	"node.a11yDescription.default": S.nodeKeys,
	"node.a11yDescription.keyboardDisabled": S.nodeKeys,
};

function MapCanvas({ route }: { route: Route }) {
	const atlas = useAtlas();
	const { meta, visible, model, viewed, go } = atlas;
	const params = readMapParams(route);
	const theme = useResolvedTheme();
	const [direction, setDirection] = useChoice<Direction>("map-direction", ["ltr", "rtl"], "ltr");
	const [legend, setLegend] = useFlag("map-legend", false);
	const [hoverState, setHovered] = useState<Tip | null>(null);
	const wrapper = useRef<HTMLDivElement>(null);
	const size = useSize(wrapper);
	const flow = useReactFlow<MapFlowNode, ImportFlowEdge>();
	const directionHint = useId();

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
								count: fmt(node.group.all.length),
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
			const text = labels.get(node.id)?.text ?? nodeLabel(node);
			const common = {
				id: node.id,
				position: { x: box.x, y: box.y },
				width: box.width,
				height: box.height,
				style: { width: box.width, height: box.height },
				// What the cards, map.css and the minimap go by.
				className: cn(
					NODE_WRAPPER,
					node.context && "is-context-node",
					lit && (lit.nodes.has(node.id) ? "is-lit" : "is-dim"),
				),
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
						focus: node.id === focusId,
					},
				});
		}
		return list;
	}, [layout, level, lit, focusId, viewed, group, labels]);

	const edges = useMemo(() => {
		const list: ImportFlowEdge[] = [];
		const state = (id: string) => (lit ? (lit.edges.has(id) ? "is-lit" : "is-dim") : "");
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

	/** A group opens one level deeper, a file opens its page. */
	const open = (node: MapFlowNode) => {
		if (node.type === "atlas-group")
			go(mapRoute({ group: node.data.group.id, grouping: params.grouping }));
		else if (node.type === "file") go(fileRoute({ path: node.data.file.path }));
	};
	const onNodeClick: NodeMouseHandler<MapFlowNode> = (_, node) => open(node);
	// The same from the keyboard: React Flow makes its wrapper of a node a tab stop (`data-id` is
	// the node's id) but leaves Enter and Space to the app when nodes cannot be selected.
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		const el = event.target;
		if (!(el instanceof HTMLElement) || !el.classList.contains("react-flow__node")) return;
		const node = nodes.find((n) => n.id === el.dataset.id);
		if (!node) return;
		event.preventDefault();
		open(node);
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
	const fit = () => {
		const el = wrapper.current;
		if (!el) return;
		const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		flow.setViewport(fitViewport(layout.bounds, el.clientWidth, el.clientHeight, tooLarge), {
			duration: still ? 0 : 250,
		});
	};

	const canvasProps = {
		// A tint under the cards; in the dark theme that tint would all but match the cards' own
		// colour, so there the canvas stays the page's.
		className: "relative min-h-0 flex-1 overflow-hidden bg-muted/40 dark:bg-background",
		ref: wrapper,
		"data-testid": "map",
		"data-level": group.id,
	};
	// Nothing to draw: say why, and leave out the controls that would act on nothing.
	if (level.nodes.length === 0)
		return (
			<div {...canvasProps}>
				<Empty className="h-full">
					<EmptyHeader>
						<EmptyTitle>{visible.length === 0 ? S.mapEmpty : S.emptyLevel}</EmptyTitle>
						<EmptyDescription>{S.noVisibleFilesHint}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</div>
		);

	return (
		<div {...canvasProps}>
			{/* Before the drawing in the document, as on the screen: Tab reaches them before the nodes. */}
			<div className="absolute top-3 right-3 z-10 flex items-center gap-2">
				<div className={ON_CANVAS}>
					<Tooltip>
						<TooltipTrigger render={<Button variant="outline" size="sm" onClick={fit} />}>
							<MaximizeIcon data-icon="inline-start" aria-hidden="true" />
							{S.fit}
						</TooltipTrigger>
						<TooltipContent side="bottom">{S.fitTitle}</TooltipContent>
					</Tooltip>
				</div>
				<Tooltip>
					<TooltipTrigger
						render={
							<Choice
								value={direction}
								options={DIRECTIONS}
								onChange={setDirection}
								className={ON_CANVAS}
								aria-label={S.directionLabel}
								aria-describedby={directionHint}
							/>
						}
					/>
					<TooltipContent side="bottom">{S.directionTitle}</TooltipContent>
				</Tooltip>
				{/* The tooltip is for the eye only; a screen reader gets the same as the group's description. */}
				<span id={directionHint} className="sr-only">
					{S.directionTitle}
				</span>
				<div className={ON_CANVAS}>
					{/*
					 * Open until its button or Esc closes it, and remembered: it is read next to the map
					 * while the map is panned and its nodes are pressed, which would close a plain popover.
					 */}
					<Popover
						open={legend}
						onOpenChange={(next, details) => {
							if (next || details.reason === "trigger-press" || details.reason === "escape-key")
								setLegend(next);
						}}
					>
						<PopoverTrigger render={<Button variant="outline" size="sm" />}>
							<InfoIcon data-icon="inline-start" aria-hidden="true" />
							{S.legend}
						</PopoverTrigger>
						<PopoverContent align="end" className="w-80 p-3" aria-label={S.legend}>
							<Legend />
						</PopoverContent>
					</Popover>
				</div>
			</div>
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
				onKeyDown={onKeyDown}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={false}
				edgesFocusable={false}
				minZoom={0.15}
				maxZoom={2}
				proOptions={{ hideAttribution: true }}
				// An explicit light or dark choice wins over the system's scheme.
				forceColorMode={theme}
				className="bg-transparent"
				aria-label={S.mapTitle}
				ariaLabelConfig={ARIA_LABELS}
			>
				{tooLarge ? (
					<MiniMap<MapFlowNode>
						pannable
						zoomable
						ariaLabel={S.minimap}
						className="overflow-hidden rounded-lg border bg-card shadow-sm"
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
			{/* On a veil of the page's colour: on a level that is cut, nodes lie under the note. */}
			{level.hiddenContext > 0 || tooLarge ? (
				<div className="pointer-events-none absolute bottom-2 left-1 z-10 grid gap-0.5 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground">
					{tooLarge ? <span>{S.mapCut}</span> : null}
					{level.hiddenContext > 0 ? <span>{S.contextHidden(level.hiddenContext)}</span> : null}
				</div>
			) : null}
			{hovered ? <NodeTip tip={hovered} level={level} canvas={size} /> : null}
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
	const groupingLabel = useId();
	// The file page's "Auf der Karte zeigen" opens the grouping last used here.
	useEffect(() => writeStored("map-grouping", params.grouping), [params.grouping]);
	return (
		<div className="flex h-full flex-col bg-background">
			<div className="flex min-h-12 shrink-0 items-center gap-3 border-b px-3 py-1.5">
				<Trail trail={trail(group)} grouping={params.grouping} />
				<div className="ml-auto flex shrink-0 items-center gap-2">
					<span id={groupingLabel} className="text-xs text-muted-foreground">
						{S.groupingLabel}
					</span>
					<Choice
						value={params.grouping}
						options={GROUPINGS}
						onChange={(grouping) => go(mapRoute({ group: "", grouping }))}
						aria-labelledby={groupingLabel}
					/>
				</div>
			</div>
			<ReactFlowProvider key={model.range.head.sha}>
				<MapCanvas route={route} />
			</ReactFlowProvider>
		</div>
	);
}
