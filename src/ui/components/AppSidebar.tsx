/**
 * The sidebar: the review's title and the range switch, the visible files by chapter (in reading
 * order) or by folder, and the overall progress. One row per file.
 */
import { ChevronRightIcon, ChevronsUpDownIcon, GitCompareArrowsIcon, MapIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	useSidebar,
} from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChangedFile } from "../../core/types";
import { baseName, countViewed, dirName, ltr, shortSha, viewedMark } from "../lib/files";
import { buildDirTree, type DirNode } from "../lib/tree";
import { fileRoute, mapRoute, withRange } from "../router";
import { useAtlas } from "../state/atlas";
import { useChoice } from "../state/prefs";
import { navigate, useRoute } from "../state/route";
import { fmt, S } from "../strings";
import { Progress, SizeBar, StatusMark, ViewedMark } from "./marks";

function RangeSwitch() {
	const { meta, model, rangeId } = useAtlas();
	const route = useRoute();
	const label = meta.ranges.find((r) => r.id === rangeId)?.label ?? rangeId;
	const choose = (id: string) =>
		// The first range is the default: keep the URL short.
		navigate(withRange(route, id === meta.ranges[0]?.id ? undefined : id));
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={<SidebarMenuButton variant="outline" aria-label={S.rangeCurrent(label)} />}
					>
						<GitCompareArrowsIcon aria-hidden="true" />
						<span className="truncate">{label}</span>
						<ChevronsUpDownIcon className="ml-auto text-muted-foreground" aria-hidden="true" />
					</DropdownMenuTrigger>
					<DropdownMenuContent className="min-w-72">
						<DropdownMenuGroup>
							<DropdownMenuLabel>{S.range}</DropdownMenuLabel>
							<DropdownMenuRadioGroup value={rangeId} onValueChange={choose}>
								{meta.ranges.map((range) => (
									<DropdownMenuRadioItem key={range.id} value={range.id} closeOnClick>
										<span className="grid gap-0.5 py-0.5">
											<span className="font-medium">{range.label}</span>
											{range.note ? (
												<span className="text-xs text-muted-foreground">{range.note}</span>
											) : null}
											{range.id === rangeId ? (
												<span className="text-xs text-muted-foreground tabular-nums">
													{S.rangeShas(
														`${model.range.base.ref} (${shortSha(model.range.base.sha)})`,
														`${model.range.head.ref} (${shortSha(model.range.head.sha)})`,
													)}
												</span>
											) : null}
										</span>
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

/**
 * How a "show on the map" link next to a row appears: always where there is no hover (touch),
 * otherwise when its row is hovered or it takes the focus. Not the sidebar's own `showOnHover`:
 * that one answers to every enclosing menu item, so a file deep in the tree would light up the
 * links of all its folders. The `after:` part widens what a pointer can hit from 20 to 24 px.
 */
const MAP_LINK =
	"pointer-fine:opacity-0 pointer-fine:hover:opacity-100 focus-visible:opacity-100 after:-inset-0.5 md:after:block";

/** The track of a progress bar on the sidebar's ground, where the bar's own `bg-muted` is lost. */
const TRACK = "**:data-[slot=progress-track]:bg-sidebar-border";

function MapLink({
	as: Action,
	href,
	label,
	className,
}: {
	as: typeof SidebarGroupAction | typeof SidebarMenuAction;
	href: string;
	label: string;
	className: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Action
						className={cn(MAP_LINK, className)}
						aria-label={label}
						render={<a href={href} />}
					/>
				}
			>
				<MapIcon aria-hidden="true" />
			</TooltipTrigger>
			<TooltipContent side="right">{label}</TooltipContent>
		</Tooltip>
	);
}

const FileRow = memo(function FileRow({
	file,
	hint,
	current,
	mark,
	href,
}: {
	file: ChangedFile;
	hint?: string;
	current: boolean;
	mark: ReturnType<typeof viewedMark>;
	href: string;
}) {
	const ref = useRef<HTMLAnchorElement>(null);
	useEffect(() => {
		if (current) ref.current?.scrollIntoView({ block: "nearest" });
	}, [current]);
	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				size="sm"
				isActive={current}
				// `pr-2!`: inside a folder that has a map link, the button would reserve room for one.
				// Semibold, not the component's medium: many system fonts have no medium weight, and
				// the current file would differ from a hovered one by nothing.
				className="pr-2! text-sm data-active:font-semibold"
				render={
					<a
						ref={ref}
						href={href}
						aria-current={current ? "page" : undefined}
						title={file.path}
						data-path={file.path}
					/>
				}
			>
				<StatusMark status={file.status} />
				<span className={cn("truncate", mark === "viewed" && "text-muted-foreground")}>
					{baseName(file.path)}
				</span>
				{/* Cut from the left: the end of a directory says more than its start. */}
				<span className="min-w-0 flex-1 truncate text-left text-xs font-normal text-muted-foreground [direction:rtl]">
					{ltr(hint ?? "")}
				</span>
				<SizeBar added={file.added} deleted={file.deleted} />
				{/* The mark's own size: the button would draw every icon inside it larger. */}
				<ViewedMark mark={mark} className="[&_svg]:size-3.5!" />
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
});

/** The directory below a chapter's common prefix, as a short hint next to the file name. */
function hintFor(path: string, prefix: string): string {
	const dir = dirName(path);
	const rel = prefix && dir.startsWith(prefix) ? dir.slice(prefix.length).replace(/^\//, "") : dir;
	const parts = rel.split("/").filter(Boolean);
	return parts.slice(-2).join("/");
}

function commonDir(files: readonly ChangedFile[]): string {
	const dirs = files.map((f) => dirName(f.path).split("/"));
	const [first, ...rest] = dirs;
	if (!first) return "";
	let n = first.length;
	for (const d of rest) {
		let i = 0;
		while (i < n && d[i] === first[i]) i++;
		n = i;
	}
	return first.slice(0, n).join("/");
}

/** The chapters or folders the reader has closed; everything else is open. */
function useClosed(): [ReadonlySet<string>, (id: string) => void] {
	const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
	const toggle = (id: string) =>
		setClosed((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	return [closed, toggle];
}

function ChapterList({ current }: { current: string | null }) {
	const { meta, reading, viewed, href } = useAtlas();
	const [closed, toggle] = useClosed();
	const chapters = meta.chapters
		.map((chapter, i) => ({
			chapter,
			index: i + 1,
			files: reading.filter((f) => f.chapter === chapter.id),
		}))
		.filter((c) => c.files.length > 0);
	return chapters.map(({ chapter, index, files }) => {
		const seen = countViewed(files, viewed);
		const holdsCurrent = current !== null && files.some((f) => f.path === current);
		const open = !closed.has(chapter.id) || holdsCurrent;
		const prefix = commonDir(files);
		return (
			<Collapsible
				key={chapter.id}
				open={open}
				onOpenChange={() => toggle(chapter.id)}
				render={<SidebarGroup data-chapter={chapter.id} />}
			>
				<div className="group/chapter relative">
					<SidebarGroupLabel
						render={<CollapsibleTrigger />}
						// The pointer of the file links around it: one list, one cursor.
						className="group/label h-auto min-h-8 w-full cursor-pointer items-start gap-2 py-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
					>
						<span className="w-4 shrink-0 text-right text-xs/5 text-muted-foreground tabular-nums">
							{index}
						</span>
						<span className="min-w-0 flex-1 leading-5 font-semibold">{chapter.title}</span>
						{/* Room for the map link, which lies over the label. */}
						<span className="w-5 shrink-0" aria-hidden="true" />
						<ChevronRightIcon
							className="mt-0.5 text-muted-foreground transition-transform group-data-panel-open/label:rotate-90"
							aria-hidden="true"
						/>
					</SidebarGroupLabel>
					<MapLink
						as={SidebarGroupAction}
						href={href(mapRoute({ group: chapter.id, grouping: "chapters" }))}
						label={S.chapterOnMap}
						className="top-1.5 right-8 pointer-fine:group-hover/chapter:opacity-100"
					/>
				</div>
				<div className="flex items-center gap-2 pr-2 pl-8">
					<Progress seen={seen} total={files.length} className={cn("min-w-0 flex-1", TRACK)} />
					<span className="text-xs text-muted-foreground tabular-nums" aria-hidden="true">
						{S.chapterProgress(seen, files.length)}
					</span>
				</div>
				<CollapsibleContent>
					{chapter.summary ? (
						<p className="pt-2 pr-2 pl-8 text-xs/relaxed text-muted-foreground">
							{chapter.summary}
						</p>
					) : null}
					<SidebarGroupContent className="pt-1.5">
						<SidebarMenu>
							{files.map((file) => (
								<FileRow
									key={file.path}
									file={file}
									hint={hintFor(file.path, prefix)}
									current={file.path === current}
									mark={viewedMark(file, viewed)}
									href={href(fileRoute({ path: file.path }))}
								/>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</CollapsibleContent>
			</Collapsible>
		);
	});
}

function DirBranch({
	node,
	current,
	closed,
	toggle,
}: {
	node: DirNode;
	current: string | null;
	closed: ReadonlySet<string>;
	toggle: (dir: string) => void;
}) {
	const { viewed, href } = useAtlas();
	return (
		<>
			{node.dirs.map((dir) => {
				const holdsCurrent = current?.startsWith(`${dir.dir}/`) ?? false;
				const open = !closed.has(dir.dir) || holdsCurrent;
				return (
					<Collapsible
						key={dir.dir}
						open={open}
						onOpenChange={() => toggle(dir.dir)}
						render={<SidebarMenuItem />}
					>
						<SidebarMenuButton
							size="sm"
							className="cursor-pointer text-sm"
							render={<CollapsibleTrigger />}
						>
							<ChevronRightIcon
								className="text-muted-foreground transition-transform group-data-panel-open/menu-button:rotate-90"
								aria-hidden="true"
							/>
							<span className="truncate" title={dir.dir}>
								{dir.name}
							</span>
							<span className="ml-auto text-xs text-muted-foreground tabular-nums">
								{fmt(dir.count)}
							</span>
						</SidebarMenuButton>
						<MapLink
							as={SidebarMenuAction}
							href={href(mapRoute({ group: dir.dir, grouping: "dirs" }))}
							label={S.folderOnMap}
							className="pointer-fine:peer-hover/menu-button:opacity-100"
						/>
						<CollapsibleContent>
							{/* One guide line per level, under the folder's chevron; no room wasted on depth. */}
							<SidebarMenuSub className="mx-0 ml-3.5 gap-0 px-0 py-0">
								<DirBranch node={dir} current={current} closed={closed} toggle={toggle} />
							</SidebarMenuSub>
						</CollapsibleContent>
					</Collapsible>
				);
			})}
			{node.files.map((file) => (
				<FileRow
					key={file.path}
					file={file}
					current={file.path === current}
					mark={viewedMark(file, viewed)}
					href={href(fileRoute({ path: file.path }))}
				/>
			))}
		</>
	);
}

function FolderTree({ current }: { current: string | null }) {
	const { visible } = useAtlas();
	const tree = useMemo(() => buildDirTree(visible), [visible]);
	const [closed, toggle] = useClosed();
	return (
		<SidebarGroup>
			<SidebarGroupContent>
				<SidebarMenu>
					<DirBranch node={tree} current={current} closed={closed} toggle={toggle} />
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

export function AppSidebar({ current }: { current: string | null }) {
	const { meta, visible, viewed } = useAtlas();
	const { open, isMobile, setOpenMobile } = useSidebar();
	const [tab, setTab] = useChoice("sidebar-tab", ["chapters", "folders"], "chapters");
	const seen = countViewed(visible, viewed);
	// On a narrow window the sidebar is a sheet over the page: a chosen file or map closes it.
	const route = useRoute();
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the route changes.
	useEffect(() => setOpenMobile(false), [route, setOpenMobile]);
	return (
		// Closed, the sidebar is only moved out of sight: `inert` keeps its links out of the Tab order.
		<Sidebar inert={!open && !isMobile}>
			<SidebarHeader>
				<h1
					className="truncate px-2 pt-1 text-sm font-semibold"
					title={`${meta.title} (${meta.repoPath})`}
				>
					{meta.title}
				</h1>
				<RangeSwitch />
			</SidebarHeader>
			<Tabs
				value={tab}
				onValueChange={(value) => setTab(value === "folders" ? "folders" : "chapters")}
				className="min-h-0 flex-1 gap-0"
				render={<nav aria-label={tab === "chapters" ? S.tabChapters : S.tabFolders} />}
			>
				<div className="px-2 pb-2">
					<TabsList className="w-full">
						<TabsTrigger value="chapters">{S.tabChapters}</TabsTrigger>
						<TabsTrigger value="folders">{S.tabFolders}</TabsTrigger>
					</TabsList>
				</div>
				<SidebarContent>
					{/* The focus ring of the scrolling box inside it: outside, the sidebar cuts it off. */}
					<ScrollArea className="h-full **:data-[slot=scroll-area-viewport]:focus-visible:ring-inset">
						{visible.length === 0 ? (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>{S.noVisibleFiles}</EmptyTitle>
									<EmptyDescription>{S.noVisibleFilesHint}</EmptyDescription>
								</EmptyHeader>
							</Empty>
						) : (
							// `tabIndex`: a panel full of links needs no Tab stop of its own.
							<>
								<TabsContent value="chapters" tabIndex={-1}>
									<ChapterList current={current} />
								</TabsContent>
								<TabsContent value="folders" tabIndex={-1}>
									<FolderTree current={current} />
								</TabsContent>
							</>
						)}
					</ScrollArea>
				</SidebarContent>
			</Tabs>
			<SidebarFooter className="gap-1.5 border-t px-4 py-3" data-testid="progress">
				<output className="text-xs text-muted-foreground tabular-nums">
					{S.progress(seen, visible.length)}
				</output>
				<Progress seen={seen} total={visible.length} className={TRACK} />
			</SidebarFooter>
		</Sidebar>
	);
}
