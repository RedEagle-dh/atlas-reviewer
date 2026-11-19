/** The top bar: title, range switch, category chips, search, progress, theme. */
import { useEffect, useRef, useState } from "react";
import { categoryCounts, countViewed, shortSha } from "../lib/files";
import { withRange } from "../router";
import { useAtlas } from "../state/atlas";
import { THEMES, type Theme } from "../state/prefs";
import { navigate, useRoute } from "../state/route";
import { S } from "../strings";
import { Icon } from "./icons";
import { Progress } from "./marks";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function RangeSwitch() {
	const { meta, model, rangeId } = useAtlas();
	const route = useRoute();
	const [open, setOpen] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const current = meta.ranges.find((r) => r.id === rangeId);

	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			if (box.current && event.target instanceof Node && !box.current.contains(event.target))
				setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("mousedown", onDown);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("mousedown", onDown);
			window.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const choose = (id: string) => {
		setOpen(false);
		// The first range is the default: keep the URL short.
		navigate(withRange(route, id === meta.ranges[0]?.id ? undefined : id));
	};

	return (
		<div className="range-switch" ref={box}>
			<button
				type="button"
				className="btn range-button"
				aria-haspopup="true"
				aria-expanded={open}
				title={current?.note ?? current?.label}
				onClick={() => setOpen((o) => !o)}
			>
				<span className="range-label">{current?.label ?? rangeId}</span>
				<Icon name="down" />
			</button>
			{open ? (
				<div className="range-menu" role="menu" aria-label={S.range}>
					{meta.ranges.map((range) => (
						<button
							key={range.id}
							type="button"
							role="menuitemradio"
							aria-checked={range.id === rangeId}
							className="range-item"
							onClick={() => choose(range.id)}
						>
							<span className="range-item-label">{range.label}</span>
							{range.note ? <span className="range-item-note">{range.note}</span> : null}
							{range.id === rangeId ? (
								<span className="range-item-shas num">
									{S.rangeShas(
										`${model.range.base.ref} (${shortSha(model.range.base.sha)})`,
										`${model.range.head.ref} (${shortSha(model.range.head.sha)})`,
									)}
								</span>
							) : null}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}

function CategoryChips() {
	const { meta, model, categories, toggleCategory } = useAtlas();
	const counts = categoryCounts(model);
	return (
		<fieldset className="chips" aria-label={S.categories}>
			{meta.categories
				.filter((c) => (counts.get(c.id) ?? 0) > 0)
				.map((c) => {
					const on = categories.has(c.id);
					return (
						<button
							key={c.id}
							type="button"
							className="chip"
							aria-pressed={on}
							title={S.categoryToggle(c.label, on)}
							data-category={c.id}
							onClick={() => toggleCategory(c.id)}
						>
							<span className="chip-label">{c.label}</span>
							<span className="chip-count num">{counts.get(c.id) ?? 0}</span>
						</button>
					);
				})}
		</fieldset>
	);
}

const THEME_ICON = { system: "system", light: "light", dark: "dark" } as const;

export function TopBar({
	sidebarOpen,
	onToggleSidebar,
	onSearch,
	theme,
	onTheme,
}: {
	sidebarOpen: boolean;
	onToggleSidebar: () => void;
	onSearch: () => void;
	theme: Theme;
	onTheme: (theme: Theme) => void;
}) {
	const { meta, visible, viewed } = useAtlas();
	const seen = countViewed(visible, viewed);
	const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "system";
	return (
		<header className="topbar">
			<button
				type="button"
				className="btn icon quiet"
				aria-pressed={sidebarOpen}
				title={sidebarOpen ? S.sidebarHide : S.sidebarShow}
				aria-label={sidebarOpen ? S.sidebarHide : S.sidebarShow}
				onClick={onToggleSidebar}
			>
				<Icon name="sidebar" />
			</button>
			<h1 className="title" title={`${meta.title} (${meta.repoPath})`}>
				{meta.title}
			</h1>
			<RangeSwitch />
			<CategoryChips />
			<span className="topbar-spacer" />
			<button type="button" className="btn search-button" onClick={onSearch} title={S.searchLabel}>
				<Icon name="search" />
				<span className="search-label">{S.search}</span>
				<kbd>{S.searchShortcut(isMac)}</kbd>
			</button>
			<div className="topbar-progress" data-testid="progress">
				<span className="progress-text num" title={S.progress(seen, visible.length)}>
					<span className="progress-long">{S.progress(seen, visible.length)}</span>
					<span className="progress-short">{S.progressShort(seen, visible.length)}</span>
				</span>
				<Progress seen={seen} total={visible.length} />
			</div>
			<button
				type="button"
				className="btn icon quiet"
				title={S.themeToggle(S.theme[theme])}
				aria-label={S.themeToggle(S.theme[theme])}
				data-theme-choice={theme}
				onClick={() => onTheme(nextTheme)}
			>
				<Icon name={THEME_ICON[theme]} />
			</button>
		</header>
	);
}
