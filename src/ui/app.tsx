/**
 * The app: loads the review and the model of the current range, provides them (`AtlasContext`),
 * and renders the shell (top bar, sidebar, search) around the view the hash route names.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReviewMeta, ReviewModel } from "../core/types";
import { getModel, getReview } from "./api";
import { SearchPalette } from "./components/SearchPalette";
import { Sidebar } from "./components/Sidebar";
import { ErrorView, Loading } from "./components/states";
import { TopBar } from "./components/TopBar";
import { shortSha } from "./lib/files";
import { mapRoute, type Route, readFileParams, withRange } from "./router";
import { AtlasContext, useAtlasValue, useViewedState } from "./state/atlas";
import { type Theme, useCategories, useFlag, useTheme } from "./state/prefs";
import { useResource } from "./state/resource";
import { hrefOf, navigate, useRoute, useScrollMemory } from "./state/route";
import { S, withWords } from "./strings";
import { VIEWS } from "./views";

const models = new Map<string, ReviewModel>();
const metas = new Map<string, ReviewMeta>();

function UnknownView({ route }: { route: Route }) {
	return (
		<div className="state" role="alert">
			<h2>{S.fileNotFound}</h2>
			<p>
				<code>#/{route.view}</code>
			</p>
			<div className="actions">
				<a className="btn" href={hrefOf(mapRoute({ group: "", grouping: "chapters" }))}>
					{S.toMap}
				</a>
			</div>
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
	const main = useRef<HTMLElement>(null);
	useScrollMemory(main);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const mod = event.metaKey || event.ctrlKey;
			if (mod && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setSearching((s) => !s);
			} else if (event.key === "/" && !mod && !(event.target instanceof HTMLInputElement)) {
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
	const closeSearch = useCallback(() => setSearching(false), []);

	return (
		<AtlasContext.Provider value={atlas}>
			<div className={`app${sidebarOpen ? "" : " sidebar-closed"}`}>
				<TopBar
					sidebarOpen={sidebarOpen}
					onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
					onSearch={() => setSearching(true)}
					theme={theme}
					onTheme={setTheme}
				/>
				{sidebarOpen ? <Sidebar current={current} /> : null}
				<main className={`main view-${route.view}`} ref={main}>
					{View ? <View route={route} /> : <UnknownView route={route} />}
				</main>
				{searching ? <SearchPalette onClose={closeSearch} /> : null}
				{moved ? (
					<div className="range-notice" role="status">
						<span>{S.rangeMoved(shortSha(moved.from), shortSha(moved.to))}</span>
						<button type="button" className="btn quiet" onClick={onDismissMoved}>
							{S.dismiss}
						</button>
					</div>
				) : null}
			</div>
		</AtlasContext.Provider>
	);
}

/** The root: the theme (once, for every state of the page), tooltips and toasts around it all. */
export function App() {
	const [theme, setTheme, resolved] = useTheme();
	return (
		<TooltipProvider delay={300}>
			<Content theme={theme} setTheme={setTheme} />
			<Toaster theme={resolved} position="bottom-center" />
		</TooltipProvider>
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
			<div className="state" role="alert">
				<h2>{S.unknownRange(route.query.range ?? "")}</h2>
				<div className="actions">
					<button
						type="button"
						className="btn"
						onClick={() => navigate(withRange(route, undefined), { replace: true })}
					>
						{S.toFirstRange}
					</button>
				</div>
			</div>
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
