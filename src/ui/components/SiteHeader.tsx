/**
 * The header bar above the views: the sidebar switch, the category filter, and on the right the
 * search button and the theme menu. New actions go into the group on the right.
 */
import { MonitorIcon, MoonIcon, SearchIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { categoryCounts } from "../lib/files";
import { useAtlas } from "../state/atlas";
import { THEMES, type Theme } from "../state/prefs";
import { fmt, S } from "../strings";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** One switch per category that has files; what is off is missing from the list, map and search. */
function CategoryFilter() {
	const { meta, model, categories, toggleCategory } = useAtlas();
	const counts = categoryCounts(model);
	return (
		// Too many categories for the bar: the row scrolls (and fades where it goes on), so every
		// label stays whole. The padding is room for the focus ring, which a scrolling box cuts off.
		<fieldset
			className="no-scrollbar -m-1 flex min-w-0 scroll-fade-x items-center gap-1 overflow-x-auto p-1"
			aria-label={S.categories}
			// A browser leaves a half-visible switch where it is; the keyboard's focus shows it whole.
			onFocus={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
		>
			{meta.categories
				.filter((c) => (counts.get(c.id) ?? 0) > 0)
				.map((c) => {
					const on = categories.has(c.id);
					const count = counts.get(c.id) ?? 0;
					return (
						<Tooltip key={c.id}>
							<TooltipTrigger
								render={
									<Toggle
										variant="outline"
										size="sm"
										pressed={on}
										onPressedChange={() => toggleCategory(c.id)}
										aria-label={S.categoryFiles(c.label, count)}
										data-category={c.id}
										// The fill says "on" and nothing else: hovering a switch that is off must not look like on.
										className="shrink-0 gap-1.5 text-muted-foreground hover:bg-transparent aria-pressed:text-foreground aria-pressed:hover:bg-muted"
									/>
								}
							>
								{c.label}
								{/* On the fill of a pressed switch the count takes the label's colour: muted is too faint there. */}
								<span className="text-xs font-normal text-muted-foreground tabular-nums group-aria-pressed/toggle:text-foreground">
									{fmt(count)}
								</span>
							</TooltipTrigger>
							<TooltipContent side="bottom">{S.categoryToggle(c.label, on)}</TooltipContent>
						</Tooltip>
					);
				})}
		</fieldset>
	);
}

const THEME_ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

function ThemeMenu({ theme, onTheme }: { theme: Theme; onTheme: (theme: Theme) => void }) {
	const label = S.themeToggle(S.theme[theme]);
	const Current = THEME_ICON[theme];
	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger
					render={
						<DropdownMenuTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={label}
									data-theme-choice={theme}
								/>
							}
						>
							<Current aria-hidden="true" />
						</DropdownMenuTrigger>
					}
				/>
				<TooltipContent side="bottom" align="end">
					{label}
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end" className="w-auto min-w-44">
				<DropdownMenuRadioGroup
					value={theme}
					onValueChange={(value) => onTheme(THEMES.find((t) => t === value) ?? "system")}
				>
					{THEMES.map((t) => {
						const ThemeIcon = THEME_ICON[t];
						return (
							<DropdownMenuRadioItem key={t} value={t} closeOnClick>
								<ThemeIcon aria-hidden="true" />
								{S.theme[t]}
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function SiteHeader({
	onSearch,
	theme,
	onTheme,
}: {
	onSearch: () => void;
	theme: Theme;
	onTheme: (theme: Theme) => void;
}) {
	const { meta } = useAtlas();
	const { open, isMobile } = useSidebar();
	// Below the sidebar's breakpoint it is a sheet that the switch opens; it is never "shown" then.
	const sidebarShown = open && !isMobile;
	const sidebarLabel = sidebarShown ? S.sidebarHide : S.sidebarShow;
	return (
		<header className="@container/header flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
			<Tooltip>
				<TooltipTrigger render={<SidebarTrigger aria-label={sidebarLabel} />} />
				<TooltipContent side="bottom" align="start">
					{sidebarLabel}
				</TooltipContent>
			</Tooltip>
			<Separator orientation="vertical" className="h-4 data-vertical:self-center" />
			{sidebarShown ? null : (
				// Without the sidebar the page still says which review it shows. It gives way before
				// the categories do, and leaves a bar that has no room for it. It grows from nothing up
				// to its own width, so it takes only what the categories leave: a title that shrank
				// side by side with them cut the last category off while it still had room to give.
				<h1
					className="mr-1 hidden max-w-max min-w-24 flex-1 truncate text-sm font-semibold @lg/header:block"
					title={`${meta.title} (${meta.repoPath})`}
				>
					{meta.title}
				</h1>
			)}
			<CategoryFilter />
			<div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="outline"
								size="sm"
								aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
								className="justify-start font-normal text-muted-foreground @4xl/header:w-52"
								onClick={onSearch}
							/>
						}
					>
						<SearchIcon aria-hidden="true" />
						{/* In a narrow bar only the icon is left; the name stays for a screen reader. */}
						<span className="sr-only @4xl/header:not-sr-only">{S.search}</span>
						<Kbd className="ml-auto hidden @2xl/header:inline-flex" aria-hidden="true">
							{S.searchShortcut(isMac)}
						</Kbd>
					</TooltipTrigger>
					<TooltipContent side="bottom">{S.searchLabel}</TooltipContent>
				</Tooltip>
				<ThemeMenu theme={theme} onTheme={onTheme} />
			</div>
		</header>
	);
}
