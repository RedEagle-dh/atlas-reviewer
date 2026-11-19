/**
 * The file page (`#/file/<path>?line=<n>`): header with path, status and actions, the
 * neighbourhood ("Zusammenhang"), the comments on the file as a whole, and the code with the
 * comments on its lines. Works for any file of the head commit; a file outside the review is
 * shown read-only and marked as such (it can be commented all the same).
 */
import {
	BinaryIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronUpIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	CircleIcon,
	CopyIcon,
	FileIcon,
	FileXIcon,
	MapIcon,
	MessageSquarePlusIcon,
	ScissorsIcon,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button, buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Kbd } from "@/components/ui/kbd";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChangedFile, FileView, ReviewComment } from "../../../core/types";
import { ApiError, getFile } from "../../api";
import { CommentCard } from "../../components/comments/CommentCard";
import { Composer, openComposer } from "../../components/comments/Composer";
import { Delta, StatusBadge } from "../../components/marks";
import { ErrorView, Loading, Notice } from "../../components/states";
import { copyText } from "../../lib/clipboard";
import { baseName, ltr, viewedMark } from "../../lib/files";
import { readStored } from "../../lib/storage";
import { placeComments } from "../../lib/threads";
import { fileRoute, type Grouping, mapRoute, type Route, readFileParams } from "../../router";
import { isRangeMoved, useAtlas } from "../../state/atlas";
import { useComments } from "../../state/comments";
import { type Composer as ComposerState, composers, useComposer } from "../../state/composer";
import { useKeys } from "../../state/keys";
import { useChoice, useFlag } from "../../state/prefs";
import { useResource } from "../../state/resource";
import { takeRestore } from "../../state/route";
import { categoryLabel, fmt, S } from "../../strings";
import { buildGroupTree, groupOfFile } from "../map/grouping";
import { CodeView } from "./CodeView";
import { BELOW_HEADER, Neighbourhood } from "./Neighbourhood";
import { importLinks, neighboursOf } from "./neighbours";
import { nextChange } from "./rows";

/** The last few file views, so going back and forth between files is instant. */
class RecentFiles<V> extends Map<string, V> {
	override set(key: string, value: V): this {
		super.delete(key);
		super.set(key, value);
		while (this.size > 12) {
			const oldest = this.keys().next().value;
			if (oldest === undefined) break;
			super.delete(oldest);
		}
		return this;
	}
}
const recent = new RecentFiles<FileView>();

/** Where the sticky header ends: rows scrolled to by `n` / `p` land just below it. */
function stickyBottom(): number {
	return document.querySelector(".file-head")?.getBoundingClientRect().bottom ?? 0;
}

/** Lines of context kept above a change that `n` / `p` scroll to (at 20 px per line). */
const CONTEXT_ABOVE = 3 * 20;

/**
 * Scrolls the next (or previous) change block to a fixed place three lines below the sticky
 * header, so the lines before it stay in view and the following press starts from there. Returns
 * the block's index. `current` is the block the last press went to.
 */
function jumpToChange(direction: 1 | -1, current: number | null): number | null {
	const main = document.querySelector(".main");
	if (!main) return null;
	const landing = stickyBottom() + CONTEXT_ABOVE;
	const tops = [...document.querySelectorAll(".code-view [data-anchor]")].map(
		(anchor) => anchor.getBoundingClientRect().top,
	);
	const atEnd = main.scrollHeight - main.scrollTop - main.clientHeight < 2;
	const index = nextChange(tops, landing, direction, current, atEnd);
	const top = tops[index];
	if (top === undefined) return null;
	main.scrollBy({ top: top - landing });
	return index;
}

/**
 * The classes of a link that looks like a button. A link stays an `<a>`: Base UI's Button gives
 * its element the role `button`. `cn` settles what the variant overrides of the base classes
 * (`border-border` over `border-transparent`), as the Button component does.
 */
function buttonLook(look: Parameters<typeof buttonVariants>[0]): string {
	return cn(buttonVariants(look));
}

/** What a control does and which key does the same: on hover and on keyboard focus. */
function Hint({ label, keys }: { label: string; keys?: string }) {
	return (
		<TooltipContent>
			{label}
			{keys ? <Kbd>{keys}</Kbd> : null}
		</TooltipContent>
	);
}

/**
 * The two labelled controls of the header's first row in a narrow header: the path is the page's
 * heading and needs the room (a deep path keeps its file name whole and its last folder in view),
 * so they are left with their icons. The name stays for a screen reader, and the tooltip says it.
 * "Auf der Karte zeigen" gives way first: the map is also a click on any folder of the path away.
 */
const NARROW = {
	map: { button: "px-2 @4xl/file:pr-2.5", label: "sr-only @4xl/file:not-sr-only" },
	comment: { button: "px-2 @2xl/file:pr-2.5", label: "sr-only @2xl/file:not-sr-only" },
} as const;

const NO_COMMENTS: readonly ReviewComment[] = [];

/**
 * "Kommentare zur Datei": the comments on the file as a whole, those whose lines are no longer
 * there, and the composer for a new one. Not rendered when it would hold nothing.
 */
function FileComments({
	view,
	comments,
	composer,
}: {
	view: FileView;
	comments: readonly ReviewComment[];
	/** The composer when it is open for the whole file. */
	composer: ComposerState | null;
}) {
	return (
		<section className="border-b px-4 pt-2 pb-4" aria-labelledby="file-comments">
			{/* The size and weight of the section before it ("Zusammenhang"), whose heading is a button. */}
			<h3 id="file-comments" className="flex min-h-7 items-center text-[0.8rem] font-medium">
				{S.fileComments}
			</h3>
			<div className="flex max-w-4xl flex-col gap-2 pt-1" data-comments="">
				{comments.map((comment) => (
					<CommentCard
						key={comment.id}
						comment={comment}
						// On lines, and listed here: the lines are gone.
						outdated={comment.line !== undefined && "gone"}
						fallbackFocus="[data-comment-file]"
					/>
				))}
				{composer ? <Composer path={view.path} composer={composer} lines={view.lines} /> : null}
			</div>
		</section>
	);
}

/**
 * The path: the folders as crumbs (each leads to the map at that folder), then the file name,
 * which is the page's heading. When the row gets narrow the folders give way first, cut from the
 * LEFT (a right-to-left box around the left-to-right list of folders); then the name is cut.
 */
function PathCrumbs({ path, onDir }: { path: string; onDir: (dir: string) => string }) {
	const parts = path.split("/");
	const name = parts.pop() ?? path;
	return (
		<div className="flex min-w-0 items-baseline text-base">
			{parts.length > 0 ? (
				<Breadcrumb
					aria-label={S.pathNav}
					// Tab reaches the folders that are cut off too: the box scrolls to the one with the
					// focus (the browser does not for one that is partly visible) and back to the end of
					// the path afterwards. The ellipsis would blank what is scrolled in, so there is none
					// meanwhile. Not for a click: a link that moves under the pointer would miss it.
					className="-ml-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [direction:rtl] has-focus-visible:text-clip"
					onFocus={(event) => {
						if (event.target.matches(":focus-visible"))
							event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
					}}
					onBlur={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget))
							event.currentTarget.scrollLeft = 0;
					}}
				>
					<BreadcrumbList className="inline text-base [direction:ltr]">
						{parts.map((part, i) => {
							const dir = parts.slice(0, i + 1).join("/");
							return (
								<Fragment key={dir}>
									<BreadcrumbItem className="inline">
										<Tooltip>
											<TooltipTrigger
												render={
													<BreadcrumbLink href={onDir(dir)} aria-description={S.folderOnMap} />
												}
												// The padding is the space around the slashes (the box's negative margin
												// takes the first one back) and makes the link easier to hit. The ring is
												// inside the link: the box cuts off what is around it.
												className="rounded-sm px-1 py-0.5 outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
											>
												{part}
											</TooltipTrigger>
											<Hint label={S.folderOnMap} />
										</Tooltip>
									</BreadcrumbItem>
									<BreadcrumbSeparator className="inline text-muted-foreground/60">
										/
									</BreadcrumbSeparator>
								</Fragment>
							);
						})}
					</BreadcrumbList>
				</Breadcrumb>
			) : null}
			<h2
				className={cn("max-w-full shrink-0 truncate font-semibold", parts.length > 0 && "pl-1")}
				title={path}
			>
				{name}
			</h2>
		</div>
	);
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1400);
		return () => clearTimeout(t);
	}, [copied]);
	const copy = async () => {
		if (await copyText(text)) setCopied(true);
		else toast.error(S.copyFailed);
	};
	return (
		<Tooltip>
			{/* The tooltip stays open on the click: it is where "Kopiert" is said. */}
			<TooltipTrigger
				closeOnClick={false}
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						className="shrink-0 text-muted-foreground"
						aria-label={S.copyPath}
						onClick={copy}
					/>
				}
			>
				{copied ? <CheckIcon /> : <CopyIcon />}
			</TooltipTrigger>
			<Hint label={copied ? S.copied : S.copyPath} />
			<span className="sr-only" role="status">
				{copied ? S.copied : null}
			</span>
		</Tooltip>
	);
}

/**
 * Previous or next file: a link (so a new tab works) that looks like an icon button; at an end of
 * the list a disabled button.
 */
function FileStep({
	href,
	label,
	keys,
	children,
}: {
	href: string | undefined;
	label: string;
	keys: string;
	children: ReactNode;
}) {
	if (href === undefined)
		return (
			<Button variant="ghost" size="icon-sm" disabled aria-label={label}>
				{children}
			</Button>
		);
	return (
		<Tooltip>
			<TooltipTrigger
				render={<a href={href} aria-label={label} aria-keyshortcuts={keys} />}
				className={buttonLook({ variant: "ghost", size: "icon-sm" })}
			>
				{children}
			</TooltipTrigger>
			<Hint label={label} keys={keys} />
		</Tooltip>
	);
}

/** A note above the code: what is shown in place of, or about, the file's content. */
function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<Alert role="note">
			{icon}
			<AlertDescription>{children}</AlertDescription>
		</Alert>
	);
}

function Loaded({
	view,
	line,
	file,
}: {
	view: FileView;
	line: number | undefined;
	file: ChangedFile | undefined;
}) {
	const atlas = useAtlas();
	const { meta, reading, viewed, setViewed, href, go, visible, byPath } = atlas;
	const [mode, setMode] = useChoice<"full" | "changes">("code-mode", ["full", "changes"], "full");
	const [showRemoved, setShowRemoved] = useFlag("show-removed", true);
	const [wrap, setWrap] = useFlag("wrap", false);
	const [neighbourhoodOpen, setNeighbourhoodOpen] = useFlag("neighbourhood", true);
	const [changeIndex, setChangeIndex] = useState<number | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new file, or other rows, start without a current change.
	useEffect(() => setChangeIndex(null), [view.path, mode, showRemoved]);
	// Back to this file (browser history): where the reader was. Before the code view's own effect
	// for a `?line=` link, which therefore wins.
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per file shown.
	useLayoutEffect(() => {
		const scroll = takeRestore("scroll");
		const main = document.querySelector(".main");
		if (scroll !== undefined && main) main.scrollTop = scroll;
	}, [view.path]);

	const plain = view.status === "added" || view.status === "deleted" || view.status === "unchanged";
	const hasRemoved = view.changes.some((c) => c.removed.length > 0);
	const neighbours = useMemo(() => neighboursOf(view, byPath), [view, byPath]);
	const links = useMemo(() => importLinks(view), [view]);

	// The comments: on lines the page shows they hang in the code, the others are listed above it.
	const lineCount = view.binary ? 0 : view.lines.length;
	const comments = useComments().byPath.get(view.path) ?? NO_COMMENTS;
	const placed = useMemo(() => placeComments(comments, lineCount), [comments, lineCount]);
	const composer = useComposer(view.path);
	const composerEnd = composer?.endLine ?? composer?.line;
	const composerFits = composerEnd === undefined || composerEnd <= lineCount;
	// Written for lines that are gone since (the range moved on and the file got shorter).
	useEffect(() => {
		if (!composerFits) composers.toFile(view.path);
	}, [composerFits, view.path]);
	// The reader leaves the file: an empty composer closes, one with text waits for the return.
	useEffect(() => () => composers.leave(view.path), [view.path]);
	const fileComposer = composer && composer.line === undefined ? composer : null;
	const lineComposer = composer && composer.line !== undefined && composerFits ? composer : null;
	/** The line `c` comments: the one a link points at, when the page has it. */
	const keyLine = line !== undefined && line <= lineCount ? line : undefined;

	const position = reading.findIndex((f) => f.path === view.path);
	const prev = position > 0 ? reading[position - 1] : undefined;
	const next = position >= 0 ? reading[position + 1] : undefined;
	const mark = file ? viewedMark(file, viewed) : "none";
	const excluded = file === undefined && view.status !== "unchanged";
	const chapterIndex = file ? meta.chapters.findIndex((c) => c.id === file.chapter) : -1;
	const chapter = chapterIndex >= 0 ? meta.chapters[chapterIndex] : undefined;
	const grouping: Grouping = readStored("map-grouping") === "dirs" ? "dirs" : "chapters";

	const mapHref = () => {
		if (file && visible.includes(file)) {
			const tree = buildGroupTree(visible, grouping, meta.chapters);
			return href(mapRoute({ group: groupOfFile(tree, file.path).id, grouping, focus: file.path }));
		}
		const dir = view.path.includes("/") ? view.path.slice(0, view.path.lastIndexOf("/")) : "";
		return href(mapRoute({ group: dir, grouping: "dirs", focus: view.path }));
	};
	const dirHref = (dir: string) =>
		href(mapRoute({ group: dir, grouping: "dirs", focus: view.path }));

	const toChange = (direction: 1 | -1) => {
		const i = jumpToChange(direction, changeIndex);
		if (i !== null) setChangeIndex(i);
	};

	useKeys({
		j: () => next && go(fileRoute({ path: next.path })),
		k: () => prev && go(fileRoute({ path: prev.path })),
		v: () => file && setViewed(file, mark !== "viewed"),
		n: () => toChange(1),
		p: () => toChange(-1),
		c: () => openComposer(view.path, keyLine),
	});

	useEffect(() => {
		document.title = `${baseName(view.path)} · ${meta.title}`;
	}, [view.path, meta.title]);

	const changeCount = plain ? 0 : view.changes.length;
	const statusLabel = view.status === "added" ? S.newFile : undefined;
	const chapterLabel = chapter ? `${S.chapter} ${chapterIndex + 1}: ${chapter.title}` : undefined;
	// Why the file is here although it is not part of the review.
	const note =
		view.status === "unchanged"
			? S.unchangedHint
			: excluded
				? S.excludedHint(categoryLabel(meta.categories, view.category))
				: undefined;

	return (
		// The space below the code lets its last lines reach the place `n` / `p` scroll a change to.
		<article className="min-h-full bg-background pb-[40vh]" data-path={view.path}>
			<header className="file-head @container/file sticky top-0 z-10 flex flex-col gap-2 border-b bg-background px-4 py-2">
				<div className="flex min-w-0 items-center gap-2">
					<div className="flex min-w-0 items-center gap-1">
						<PathCrumbs path={view.path} onDir={dirHref} />
						<CopyButton text={view.path} />
					</div>
					<div className="ml-auto flex shrink-0 items-center gap-2">
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										variant="outline"
										size="sm"
										aria-keyshortcuts="c"
										data-comment-file=""
										className={NARROW.comment.button}
										onClick={() => openComposer(view.path)}
									/>
								}
							>
								<MessageSquarePlusIcon aria-hidden="true" />
								<span className={NARROW.comment.label}>{S.commentFile}</span>
							</TooltipTrigger>
							<Hint label={S.commentFileHint(keyLine)} keys="c" />
						</Tooltip>
						{file ? (
							<Toggle
								variant="outline"
								size="sm"
								pressed={mark === "viewed"}
								onPressedChange={(pressed) => setViewed(file, pressed)}
								aria-keyshortcuts="v"
								data-testid="viewed-toggle"
							>
								{mark === "viewed" ? (
									<CircleCheckIcon data-icon="inline-start" />
								) : mark === "stale" ? (
									<CircleAlertIcon data-icon="inline-start" className="text-modified" />
								) : (
									<CircleIcon data-icon="inline-start" className="text-muted-foreground" />
								)}
								{mark === "stale" ? S.changedSinceViewed : S.viewedToggle}
								<Kbd aria-hidden="true" className="group-aria-pressed/toggle:bg-background">
									v
								</Kbd>
							</Toggle>
						) : null}
						<div className="flex items-center">
							<FileStep
								href={prev ? href(fileRoute({ path: prev.path })) : undefined}
								label={S.prevFile}
								keys="k"
							>
								<ChevronLeftIcon />
							</FileStep>
							<span className="min-w-16 px-1 text-center text-xs whitespace-nowrap text-muted-foreground tabular-nums">
								{position >= 0 ? `${fmt(position + 1)} / ${fmt(reading.length)}` : "–"}
							</span>
							<FileStep
								href={next ? href(fileRoute({ path: next.path })) : undefined}
								label={S.nextFile}
								keys="j"
							>
								<ChevronRightIcon />
							</FileStep>
						</div>
						<Tooltip>
							<TooltipTrigger
								render={<a href={mapHref()} />}
								className={cn(buttonLook({ variant: "outline", size: "sm" }), NARROW.map.button)}
							>
								<MapIcon aria-hidden="true" />
								<span className={NARROW.map.label}>{S.showOnMap}</span>
							</TooltipTrigger>
							<Hint label={S.showOnMap} />
						</Tooltip>
					</div>
				</div>
				<div className="flex min-h-7 flex-wrap items-center gap-2">
					<StatusBadge status={view.status} {...(statusLabel ? { label: statusLabel } : {})} />
					{file ? <Delta added={file.added} deleted={file.deleted} /> : null}
					{chapter ? (
						// The title gives way (down to the chapter's number) before the code controls
						// take a third row: it starts narrow and grows to its full width where there is room.
						<a
							className="max-w-max min-w-0 flex-1 basis-24 truncate rounded-sm py-1 text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 outline-none hover:text-foreground hover:decoration-current focus-visible:ring-3 focus-visible:ring-ring/50"
							href={href(mapRoute({ group: chapter.id, grouping: "chapters" }))}
							title={chapterLabel}
						>
							{chapterLabel}
						</a>
					) : null}
					{view.oldPath ? (
						<span
							className="flex min-w-0 flex-1 basis-48 gap-1 text-xs text-muted-foreground"
							title={view.oldPath}
						>
							<span className="shrink-0">{S.renamedFrom} </span>
							{/* Cut from the left like every path: its end, the old name, says the most. */}
							<span className="truncate text-left [direction:rtl]">{ltr(view.oldPath)}</span>
						</span>
					) : null}
					{note ? (
						<span
							className="min-w-0 flex-1 basis-48 truncate text-xs text-muted-foreground"
							title={note}
						>
							{note}
						</span>
					) : null}
					{view.lines.length > 0 ? (
						<div className="ml-auto flex items-center gap-2">
							{!plain ? (
								<ToggleGroup
									variant="outline"
									size="sm"
									spacing={0}
									value={[mode]}
									// A press on the chosen option would leave none: the mode stays.
									onValueChange={([chosen]) => {
										if (chosen === "full" || chosen === "changes") setMode(chosen);
									}}
									aria-label={S.modeLabel}
								>
									<ToggleGroupItem value="full">{S.modeFull}</ToggleGroupItem>
									<ToggleGroupItem value="changes">{S.modeChanges}</ToggleGroupItem>
								</ToggleGroup>
							) : null}
							{!plain && hasRemoved ? (
								<Toggle
									variant="outline"
									size="sm"
									pressed={showRemoved}
									onPressedChange={setShowRemoved}
								>
									{S.showRemoved}
								</Toggle>
							) : null}
							<Toggle variant="outline" size="sm" pressed={wrap} onPressedChange={setWrap}>
								{S.wrap}
							</Toggle>
							{changeCount > 0 ? (
								<div className="flex items-center">
									<Tooltip>
										<TooltipTrigger
											render={
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={S.prevChange}
													aria-keyshortcuts="p"
													onClick={() => toChange(-1)}
												/>
											}
										>
											<ChevronUpIcon />
										</TooltipTrigger>
										<Hint label={S.prevChange} keys="p" />
									</Tooltip>
									<span
										className="min-w-28 px-1 text-center text-xs whitespace-nowrap text-muted-foreground tabular-nums"
										role="status"
										data-testid="change-pos"
									>
										{changeIndex === null
											? S.changes(changeCount)
											: S.changeOf(changeIndex + 1, changeCount)}
									</span>
									<Tooltip>
										<TooltipTrigger
											render={
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={S.nextChange}
													aria-keyshortcuts="n"
													onClick={() => toChange(1)}
												/>
											}
										>
											<ChevronDownIcon />
										</TooltipTrigger>
										<Hint label={S.nextChange} keys="n" />
									</Tooltip>
								</div>
							) : null}
						</div>
					) : null}
				</div>
			</header>

			<Collapsible
				render={<section />}
				className="border-b"
				open={neighbourhoodOpen}
				onOpenChange={setNeighbourhoodOpen}
			>
				<h3 className="px-4 py-1">
					<CollapsibleTrigger
						render={
							<Button
								variant="ghost"
								size="sm"
								// Open is this section's usual state, not a pressed button: no fill for it.
								className={cn(
									"-ml-2.5 aria-expanded:bg-transparent aria-expanded:hover:bg-muted dark:aria-expanded:hover:bg-muted/50",
									BELOW_HEADER,
								)}
							/>
						}
					>
						<ChevronRightIcon
							data-icon="inline-start"
							className="text-muted-foreground transition-transform group-aria-expanded/button:rotate-90 motion-reduce:transition-none"
						/>
						{S.neighbourhood}
					</CollapsibleTrigger>
				</h3>
				<CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden px-4 pb-4 transition-[height] duration-150 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
					<Neighbourhood view={view} neighbours={neighbours} />
				</CollapsibleContent>
			</Collapsible>

			{placed.file.length > 0 || fileComposer ? (
				<FileComments view={view} comments={placed.file} composer={fileComposer} />
			) : null}

			<div className="flex flex-col gap-3 p-4">
				{view.status === "deleted" ? <Note icon={<FileXIcon />}>{S.deletedFile}</Note> : null}
				{view.truncated ? (
					<Note icon={<ScissorsIcon />}>{S.truncatedFile(view.lines.length)}</Note>
				) : null}
				{view.binary ? (
					<Note icon={<BinaryIcon />}>{S.binaryFile(S.bytes(view.size))}</Note>
				) : view.lines.length === 0 ? (
					<Note icon={<FileIcon />}>{S.emptyFile}</Note>
				) : (
					<CodeView
						view={view}
						options={{ mode, showRemoved, wrap, plain }}
						target={line}
						links={links}
						threads={placed.threads}
						composer={lineComposer}
					/>
				)}
			</div>
		</article>
	);
}

export function FilePage({ route }: { route: Route }) {
	const { rangeId, model, byPath, href, reloadModel } = useAtlas();
	const { path, line } = readFileParams(route);
	const at = { base: model.range.base.sha, head: model.range.head.sha };
	const key = path ? `${rangeId}|${at.base}|${at.head}|${path}` : null;
	const resource = useResource(key, (signal) => getFile(path, rangeId, { signal, at }), recent);
	// The range has new commits: load its model again; this page then asks for the new state.
	const moved = resource.status === "error" && isRangeMoved(resource.error);
	useEffect(() => {
		if (moved) reloadModel();
	}, [moved, reloadModel]);

	if (resource.status === "loading" || moved)
		return <Loading label={S.loadingFile(baseName(path))} />;
	if (resource.status === "error") {
		if (resource.error instanceof ApiError && resource.error.status === 404)
			return (
				<Notice
					title={S.fileNotFound}
					actions={
						<a
							className={buttonLook({ variant: "outline" })}
							href={href(mapRoute({ group: "", grouping: "chapters" }))}
						>
							{S.toMap}
						</a>
					}
				>
					{S.fileNotFoundHint(path, model.range.head.sha.slice(0, 10))}
				</Notice>
			);
		return <ErrorView error={resource.error} retry={resource.retry} />;
	}
	return <Loaded view={resource.value} line={line} file={byPath.get(path)} />;
}
