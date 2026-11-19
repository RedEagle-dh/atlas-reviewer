/**
 * The app: loads the review and the model of the current range, provides them (`AtlasContext`),
 * and renders the shell (sidebar, header bar, search) around the view the hash route names.
 */
import { InfoIcon } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ReviewMeta, ReviewModel } from "../core/types";
import { getModel, getReview } from "./api";
import { AppSidebar } from "./components/AppSidebar";
import { SearchPalette } from "./components/SearchPalette";
import { SiteHeader } from "./components/SiteHeader";
import { ErrorView, Loading, Notice } from "./components/states";
import { shortSha } from "./lib/files";
import { mapRoute, type Route, readFileParams, withRange } from "./router";
import { AtlasContext, useAtlasValue, useViewedState } from "./state/atlas";
import { ResolvedThemeProvider, type Theme, useCategories, useFlag, useTheme } from "./state/prefs";
import { useResource } from "./state/resource";
import { hrefOf, navigate, useRoute, useScrollMemory } from "./state/route";
import { S, withWords } from "./strings";
import { VIEWS } from "./views";

const models = new Map<string, ReviewModel>();
const metas = new Map<string, ReviewMeta>();

/** Wider than the component's own 16rem: file names need the room. */
const SIDEBAR_WIDTH = { "--sidebar-width": "20rem" } as CSSProperties;

/** A text field has the focus: `/` is a character there, not the shortcut for the search. */
function typingInto(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement)
	);
}

function UnknownView({ route }: { route: Route }) {
	return (
		<Notice
			title={S.unknownView}
			actions={
				// A link that looks like a button: it stays a link for a screen reader and a middle click.
				<a
					className={buttonVariants({ variant: "outline" })}
					href={hrefOf(mapRoute({ group: "", grouping: "chapters" }))}
				>
					{S.toMap}
				</a>
			}
		>
			<code className="font-mono">#/{route.view}</code>
		</Notice>
	);
}

/** The range has new commits and was loaded again: said until the reader dismisses it. */
function RangeMoved({
	moved,
	onDismiss,
}: {
	moved: { from: string; to: string };
	onDismiss: () => void;
}) {
	return (
		// Below the view, not over it: nothing the reader works with is covered. `pr-28`: the
		// alert keeps less room for its action than this button's label takes.
		<div className="shrink-0 border-t p-2">
			<Alert role="status" className="has-data-[slot=alert-action]:pr-28">
				<InfoIcon aria-hidden="true" />
				<AlertDescription>
					{S.rangeMoved(shortSha(moved.from), shortSha(moved.to))}
				</AlertDescription>
				<AlertAction>
					<Button variant="outline" size="sm" onClick={onDismiss}>
						{S.dismiss}
					</Button>
				</AlertAction>
			</Alert>
		</div>
	);
}

function Shell({
	meta: rawMeta,
	model,
	rangeId,
	route,
	reloadModel,
	moved,
	onDismissMoved,
	theme,
	setTheme,
}: {
	meta: ReviewMeta;
	model: ReviewModel;
	rangeId: string;
	route: Route;
	reloadModel: () => void;
	/** The heads before and after the model was reloaded because the range moved on. */
	moved: { from: string; to: string } | null;
	onDismissMoved: () => void;
	theme: Theme;
	setTheme: (theme: Theme) => void;
}) {
	const meta = useMemo(() => withWords(rawMeta), [rawMeta]);
	const [categories, toggleCategory] = useCategories(
		meta.id,
		meta.categories.filter((c) => c.defaultVisible).map((c) => c.id),
		meta.categories.map((c) => c.id),
	);
	const { viewed, setViewed } = useViewedState(rangeId, reloadModel);
	const atlas = useAtlasValue({
		meta,
		model,
		rangeId,
		rangeParam: route.query.range,
		categories,
		toggleCategory,
		viewed,
		setViewed,
		reloadModel,
	});
	const [sidebarOpen, setSidebarOpen] = useFlag("sidebar", true);
	const [searching, setSearching] = useState(false);
	const main = useRef<HTMLDivElement>(null);
	useScrollMemory(main);
	const inset = useRef<HTMLElement>(null);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const mod = event.metaKey || event.ctrlKey;
			if (mod && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setSearching((s) => !s);
			} else if (event.key === "/" && !mod && !typingInto(event.target)) {
				event.preventDefault();
				setSearching(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		if (route.view !== "file") document.title = `${S.mapTitle} · ${meta.title}`;
	}, [route.view, meta.title]);

	const View = VIEWS[route.view];
	const current = route.view === "file" ? readFileParams(route).path : null;
	const openSearch = useCallback(() => setSearching(true), []);
	const closeSearch = useCallback(() => setSearching(false), []);

	return (
		<AtlasContext.Provider value={atlas}>
			<SidebarProvider
				open={sidebarOpen}
				onOpenChange={setSidebarOpen}
				// The sidebar slides in and out; not for a reader who asked for less motion.
				className="h-svh motion-reduce:**:data-[slot=sidebar-container]:transition-none motion-reduce:**:data-[slot=sidebar-gap]:transition-none"
				style={SIDEBAR_WIDTH}
			>
				{/*
				 * The sidebar comes first in the document, with a link per file: the first Tab stop
				 * takes a keyboard past them, to the header bar and the view. Not an `href`: the hash
				 * is the route.
				 */}
				<Button
					variant="outline"
					size="sm"
					className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:h-7 focus-visible:px-2.5"
					onClick={() => inset.current?.focus()}
				>
					{S.skipFiles}
				</Button>
				<AppSidebar current={current} />
				<SidebarInset ref={inset} tabIndex={-1} className="min-w-0 overflow-hidden outline-none">
					<SiteHeader onSearch={openSearch} theme={theme} onTheme={setTheme} />
					{/*
					 * The scroll container of every view; the views find it as `.main`. The map pans
					 * instead of scrolling and takes the full height.
					 */}
					<div
						ref={main}
						className={cn(
							"main min-h-0 flex-1",
							route.view === "map" ? "overflow-hidden" : "overflow-auto",
						)}
						data-view={route.view}
					>
						{View ? <View route={route} /> : <UnknownView route={route} />}
					</div>
					{moved ? <RangeMoved moved={moved} onDismiss={onDismissMoved} /> : null}
				</SidebarInset>
				{searching ? <SearchPalette onClose={closeSearch} /> : null}
			</SidebarProvider>
		</AtlasContext.Provider>
	);
}

/** The root: the theme (once, for every state of the page), tooltips and toasts around it all. */
export function App() {
	const [theme, setTheme, resolved] = useTheme();
	return (
		<ResolvedThemeProvider value={resolved}>
			<TooltipProvider delay={300}>
				<Content theme={theme} setTheme={setTheme} />
				<Toaster theme={resolved} position="bottom-center" />
			</TooltipProvider>
		</ResolvedThemeProvider>
	);
}

function Content({ theme, setTheme }: { theme: Theme; setTheme: (theme: Theme) => void }) {
	const route = useRoute();
	const meta = useResource("meta", (signal) => getReview({ signal }), metas);
	const rangeId =
		meta.status === "ready" ? (route.query.range ?? meta.value.ranges[0]?.id ?? null) : null;
	const known = meta.status === "ready" && meta.value.ranges.some((r) => r.id === rangeId);
	const model = useResource(
		known ? rangeId : null,
		(signal) => getModel(rangeId ?? undefined, { signal }),
		models,
	);
	const reloadModel = model.status === "ready" ? model.reload : noop;

	// A reload that brings another head of the same range: say so until the reader dismisses it.
	const [moved, setMoved] = useState<{ from: string; to: string } | null>(null);
	const shown = useRef<{ range: string; head: string } | null>(null);
	const head = model.status === "ready" ? model.value.range.head.sha : null;
	useEffect(() => {
		if (head === null || rangeId === null) return;
		const before = shown.current;
		if (before && before.range === rangeId && before.head !== head)
			setMoved({ from: before.head, to: head });
		else if (before && before.range !== rangeId) setMoved(null);
		shown.current = { range: rangeId, head };
	}, [head, rangeId]);
	const dismissMoved = useCallback(() => setMoved(null), []);

	if (meta.status === "loading") return <Loading />;
	if (meta.status === "error") return <ErrorView error={meta.error} retry={meta.retry} />;
	if (!known || rangeId === null)
		return (
			<Notice
				title={S.unknownRange(route.query.range ?? "")}
				actions={
					<Button
						variant="outline"
						onClick={() => navigate(withRange(route, undefined), { replace: true })}
					>
						{S.toFirstRange}
					</Button>
				}
			/>
		);
	if (model.status === "loading") return <Loading />;
	if (model.status === "error") return <ErrorView error={model.error} retry={model.retry} />;
	return (
		<Shell
			meta={meta.value}
			model={model.value}
			rangeId={rangeId}
			route={route}
			reloadModel={reloadModel}
			moved={moved}
			onDismissMoved={dismissMoved}
			theme={theme}
			setTheme={setTheme}
		/>
	);
}

function noop(): void {}
