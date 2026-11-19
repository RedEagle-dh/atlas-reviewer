/**
 * The collection: the button in the header bar with the number of comments, and the sheet it
 * opens. There the comments are listed by file in reading order, and shown as the prompt a
 * coding agent gets: one click copies it.
 */
import {
	CheckIcon,
	CircleAlertIcon,
	ClipboardCopyIcon,
	ClipboardXIcon,
	MessageSquareDashedIcon,
	MessageSquareTextIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import {
	type KeyboardEvent,
	type MouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyText } from "../../lib/clipboard";
import { commentsByPath, sortComments } from "../../lib/comments";
import { baseName, dirName } from "../../lib/files";
import { isMac } from "../../lib/platform";
import { buildPrompt } from "../../lib/prompt";
import { fileRoute, type Route, withRange } from "../../router";
import { useAtlas } from "../../state/atlas";
import { useComments } from "../../state/comments";
import { pageEdits, panelEdits } from "../../state/composer";
import { hrefOf, useRoute } from "../../state/route";
import { fmt, S } from "../../strings";
import { StatusMark } from "../marks";
import { CommentCard } from "./CommentCard";

type Tab = "list" | "prompt";

/** The path of a group: a link to the file, the folders quiet, cut from the left like every path. */
function FileLink({
	path,
	href,
	onFollow,
}: {
	path: string;
	href: string;
	onFollow: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
	const { byPath } = useAtlas();
	const file = byPath.get(path);
	const dir = dirName(path);
	return (
		<a
			href={href}
			onClick={onFollow}
			title={path}
			className="flex min-w-0 items-center gap-2 rounded-sm text-sm outline-none hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50"
		>
			{file ? <StatusMark status={file.status} /> : null}
			<span className="truncate text-left [direction:rtl]">
				{"\u200e"}
				{dir === "" ? null : <span className="text-muted-foreground">{dir}/</span>}
				<span className="font-medium">{baseName(path)}</span>
				{"\u200e"}
			</span>
		</a>
	);
}

export function CommentsPanel() {
	const { comments, loaded, error, clear, reload, failure } = useComments();
	const { meta, model, byPath, href } = useAtlas();
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<Tab>("list");
	const [copied, setCopied] = useState(false);
	/** The browser gave no clipboard: the prompt is shown selected, to be copied by hand. */
	const [byHand, setByHand] = useState(false);
	/**
	 * The "delete all?" dialog, and how many comments it asks about: the number it was opened
	 * with, so its title does not count down to nothing while it closes.
	 */
	const [clearing, setClearing] = useState({ open: false, count: 0 });
	const [working, setWorking] = useState(false);
	// Another tab of the review may have written comments since this one asked: the list is asked
	// for again when the sheet opens, and the prompt is not copied before the answer is there
	// (whatever it is: with the server gone, the comments this tab knows are still worth copying).
	const [asking, setAsking] = useState(false);
	useEffect(() => {
		if (!open) return;
		let current = true;
		setAsking(true);
		reload().then(() => {
			if (current) setAsking(false);
		});
		return () => {
			current = false;
		};
	}, [open, reload]);
	const popup = useRef<HTMLDivElement>(null);
	/** The comments as they are now, for `heldBack`, which stays the same function. */
	const latest = useRef(comments);
	latest.current = comments;
	/**
	 * The sheet's heading: where the focus is when the sheet opens, and where it goes when what
	 * had it is gone (the last card, the footer). Not the first control: that is the close button,
	 * whose tooltip would open with the sheet for a keyboard, and Esc would then close the tooltip
	 * and leave the sheet open.
	 */
	const heading = useRef<HTMLHeadingElement>(null);
	const clearButton = useRef<HTMLButtonElement>(null);
	const promptBox = useRef<HTMLPreElement>(null);
	const count = comments.length;

	// What a screen reader is told when the number changes: in words, and not when the page loads.
	const [announced, setAnnounced] = useState("");
	const known = useRef<number | null>(null);
	useEffect(() => {
		if (!loaded) return;
		if (known.current !== null && known.current !== count) setAnnounced(S.commentCount(count));
		known.current = count;
	}, [loaded, count]);

	// Files in reading order, a file's comments by line (`commentsByPath` keeps the files' order).
	const groups = useMemo(
		() => [...commentsByPath(sortComments(comments, model.readingOrder))],
		[comments, model.readingOrder],
	);
	const prompt = useMemo(
		() =>
			buildPrompt(comments, {
				repoName: meta.repoName,
				range: model.range,
				readingOrder: model.readingOrder,
				languageOf: (path) => byPath.get(path)?.language ?? null,
			}),
		[comments, meta.repoName, model, byPath],
	);

	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1600);
		return () => clearTimeout(timer);
	}, [copied]);

	// A comment is read where it was written: its links lead into its own range (the first range
	// has no name in the URL), as long as the review still has that range.
	const hrefIn = useCallback(
		(range: string, route: Route): string =>
			meta.ranges.some((r) => r.id === range)
				? hrefOf(withRange(route, range === meta.ranges[0]?.id ? undefined : range))
				: href(route),
		[meta.ranges, href],
	);

	const selectPrompt = useCallback(() => {
		const box = promptBox.current;
		if (!box) return;
		const range = document.createRange();
		range.selectNodeContents(box);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		// The box that scrolls it takes the focus: from there the copy key copies the selection.
		box.closest<HTMLElement>("[data-slot=scroll-area-viewport]")?.focus();
	}, []);
	// Once the tab with the prompt is there (it was switched to because copying failed).
	useEffect(() => {
		if (byHand && tab === "prompt") selectPrompt();
	}, [byHand, tab, selectPrompt]);

	const copy = async () => {
		if (await copyText(prompt)) {
			setByHand(false);
			setCopied(true);
			toast.success(S.promptCopied(count));
			return;
		}
		setByHand(true);
		setTab("prompt");
	};

	/**
	 * A text that is being changed in the sheet and is not saved: the sheet stays, so closing it
	 * (or following a link out of it) cannot lose the text. Says so unless the key was Esc, which
	 * the editor answers itself.
	 */
	const heldBack = useCallback((quiet = false): boolean => {
		// A sheet that is not open holds nothing back.
		if (!popup.current) return false;
		const field = popup.current.querySelector<HTMLTextAreaElement>("textarea[data-dirty]");
		if (field) {
			field.focus();
			// One toast however often it is tried: with an id a second one replaces the first.
			if (!quiet) toast(S.commentUnsaved, { id: "comment-unsaved" });
			return true;
		}
		// On the "Prompt" tab no card is on the page, and so no editor: a text that was being
		// changed waits in `panelEdits`. The list is shown again, where the reader finds it (and
		// it is said, for Esc too: no editor is there to answer the key).
		const waiting = latest.current.some((comment) => {
			const text = panelEdits.get(comment.id);
			return text !== undefined && text !== comment.text;
		});
		if (!waiting) return false;
		setTab("list");
		toast(S.commentUnsaved, { id: "comment-unsaved" });
		return true;
	}, []);

	// Another page was chosen while the sheet is open (the search opens over it): the sheet gives
	// way to the page, unless a text in it is unsaved.
	const route = useRoute();
	// biome-ignore lint/correctness/useExhaustiveDependencies: the route is the trigger, not an input.
	useEffect(() => {
		if (!heldBack()) setOpen(false);
	}, [route]);

	// The same function for as long as the sheet lives: it is a prop of every card in the list,
	// and a new one would draw them all again whenever the sheet changes (a tab, "copied").
	const onFollow = useCallback(
		(event: MouseEvent<HTMLAnchorElement>) => {
			// A new tab or window: this page, and its sheet, stay as they are.
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
				return;
			if (heldBack()) {
				event.preventDefault();
				return;
			}
			setOpen(false);
			// The link leads to where the page already is (the comment's own file; the same line as
			// the last time): no route changes, so nothing would move. The comment's card on the
			// page is brought into view instead.
			const link = event.currentTarget;
			if (link.hash !== window.location.hash) return;
			const id = link.closest<HTMLElement>("[data-comment]")?.dataset.comment;
			if (id === undefined) return;
			document
				.querySelector(`.main [data-comment="${CSS.escape(id)}"]`)
				?.scrollIntoView({ block: "center" });
		},
		[heldBack],
	);

	const clearAll = async () => {
		setWorking(true);
		const done = await clear();
		setWorking(false);
		if (!done) {
			toast.error(S.commentNotDeleted(S.whyFailed(failure())));
			return;
		}
		// With the comments go the changes to their texts that were not saved.
		pageEdits.clear();
		panelEdits.clear();
		setClearing((asked) => ({ ...asked, open: false }));
	};

	const onPromptKey = (event: KeyboardEvent<HTMLDivElement>) => {
		// "Select all" means the prompt here, not the whole sheet around it.
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
			event.preventDefault();
			selectPrompt();
		}
	};

	// Comments that did not load are not "no comments": the button says so, wherever the reader is.
	const failed = !loaded && error !== null;
	const label = failed ? `${S.commentsOpen(0)}. ${S.commentsNotLoaded}` : S.commentsOpen(count);
	return (
		<Sheet
			open={open}
			onOpenChange={(next, details) => {
				if (!next) {
					// A press on a toast ("Rückgängig") is outside the sheet, but no wish to close it.
					const target = details.event.target;
					const onToast = target instanceof Element && target.closest("[data-sonner-toaster]");
					if (onToast || heldBack(details.reason === "escape-key")) {
						details.cancel();
						return;
					}
				}
				setOpen(next);
			}}
		>
			<Tooltip>
				<TooltipTrigger
					render={
						<SheetTrigger
							render={
								<Button
									variant="outline"
									size="sm"
									aria-label={label}
									data-testid="comments-open"
								/>
							}
						>
							<MessageSquareTextIcon aria-hidden="true" />
							{/* In a narrow bar only the icon and the count are left. */}
							<span className="sr-only @4xl/header:not-sr-only">{S.comments}</span>
							{failed ? (
								<CircleAlertIcon className="text-destructive" aria-hidden="true" />
							) : count > 0 ? (
								<Badge
									variant="secondary"
									className="h-4.5 min-w-4.5 px-1 tabular-nums group-hover/button:bg-background"
									aria-hidden="true"
								>
									{fmt(count)}
								</Badge>
							) : null}
						</SheetTrigger>
					}
				/>
				<TooltipContent side="bottom">{label}</TooltipContent>
			</Tooltip>
			<span className="sr-only" role="status">
				{announced}
			</span>
			<SheetContent
				ref={popup}
				side="right"
				initialFocus={heading}
				// The close button of the component says "Close": this sheet brings its own.
				showCloseButton={false}
				className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
			>
				<SheetHeader className="gap-1 border-b">
					<div className="flex items-center gap-2">
						<SheetTitle
							ref={heading}
							tabIndex={-1}
							// The ring a control shows, for a keyboard: the reader sees where the focus is.
							className="-mx-1 rounded-sm px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							{S.comments}
						</SheetTitle>
						{count > 0 ? (
							<Badge variant="secondary" className="tabular-nums">
								{fmt(count)}
							</Badge>
						) : null}
						<Tooltip>
							<TooltipTrigger
								render={
									<SheetClose
										render={
											<Button
												variant="ghost"
												size="icon-sm"
												className="-my-1 ml-auto"
												aria-label={S.close}
											/>
										}
									/>
								}
							>
								<XIcon />
							</TooltipTrigger>
							<TooltipContent side="bottom">{S.close}</TooltipContent>
						</Tooltip>
					</div>
					<SheetDescription>{S.commentsHint}</SheetDescription>
				</SheetHeader>

				{!loaded ? (
					error === null ? (
						<Empty role="status" aria-live="polite">
							<EmptyHeader>
								<Spinner aria-hidden="true" className="text-muted-foreground" />
								<EmptyDescription>{S.loading}</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<div className="flex flex-col items-start gap-3 p-4">
							<Alert variant="destructive">
								<CircleAlertIcon aria-hidden="true" />
								<AlertTitle>{S.commentsNotLoaded}</AlertTitle>
								<AlertDescription className="wrap-anywhere">
									{failure()?.answered === false ? S.errorTitle : error}
								</AlertDescription>
							</Alert>
							<Button variant="outline" size="sm" onClick={() => reload()}>
								{S.retry}
							</Button>
						</div>
					)
				) : count === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<MessageSquareDashedIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>{S.noComments}</EmptyTitle>
							<EmptyDescription>{S.noCommentsHint}</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<>
						<Tabs
							value={tab}
							onValueChange={(value) => setTab(value === "prompt" ? "prompt" : "list")}
							className="min-h-0 flex-1 gap-0"
						>
							<div className="px-4 pt-3 pb-3">
								<TabsList>
									<TabsTrigger value="list" className="px-3">
										{S.tabList}
									</TabsTrigger>
									<TabsTrigger value="prompt" className="px-3">
										{S.tabPrompt}
									</TabsTrigger>
								</TabsList>
							</div>
							{/* `tabIndex`: a panel full of links and buttons needs no Tab stop of its own. */}
							<TabsContent value="list" tabIndex={-1} className="min-h-0">
								<ScrollArea className="h-full **:data-[slot=scroll-area-viewport]:focus-visible:ring-inset">
									<ul className="flex flex-col gap-5 px-4 pb-4" data-comments="">
										{groups.map(([path, list]) => (
											<li key={path} className="flex flex-col gap-2" data-comment-group={path}>
												<FileLink
													path={path}
													href={hrefIn(list[0]?.range ?? model.range.id, fileRoute({ path }))}
													onFollow={onFollow}
												/>
												<ul className="flex flex-col gap-2">
													{list.map((comment) => (
														<li key={comment.id}>
															<CommentCard
																comment={comment}
																edits={panelEdits}
																placeHref={hrefIn(
																	comment.range,
																	fileRoute(
																		comment.line === undefined
																			? { path }
																			: { path, line: comment.line },
																	),
																)}
																onFollow={onFollow}
																fallbackFocus="[data-slot=sheet-title]"
															/>
														</li>
													))}
												</ul>
											</li>
										))}
									</ul>
								</ScrollArea>
							</TabsContent>
							<TabsContent
								value="prompt"
								tabIndex={-1}
								className="flex min-h-0 flex-col gap-3 px-4 pb-4"
							>
								{byHand ? (
									<Alert role="status">
										<ClipboardXIcon aria-hidden="true" />
										<AlertDescription>{S.copyByHand(isMac)}</AlertDescription>
									</Alert>
								) : null}
								{/*
								 * Exactly what "Als Prompt kopieren" copies, character for character. The box that
								 * scrolls it is a Tab stop, so the arrow keys scroll it and "select all" is heard.
								 */}
								<ScrollArea
									role="group"
									aria-label={S.promptLabel}
									className="min-h-0 flex-1 rounded-lg border bg-muted/40"
									onKeyDown={onPromptKey}
								>
									<pre
										ref={promptBox}
										data-testid="prompt"
										className="p-3 font-mono text-xs/relaxed wrap-anywhere whitespace-pre-wrap"
									>
										{prompt}
									</pre>
								</ScrollArea>
							</TabsContent>
						</Tabs>
						{/* Both at the right edge: a toast comes up in the middle of the window's bottom, over the sheet's left. */}
						<SheetFooter className="flex-row items-center justify-end gap-3 border-t">
							<Button
								ref={clearButton}
								variant="ghost"
								className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
								onClick={() => setClearing({ open: true, count })}
							>
								<Trash2Icon data-icon="inline-start" />
								{S.clearComments}
							</Button>
							<Button onClick={copy} disabled={asking} data-testid="copy-prompt">
								{copied ? (
									<CheckIcon data-icon="inline-start" />
								) : (
									<ClipboardCopyIcon data-icon="inline-start" />
								)}
								{S.copyPrompt}
							</Button>
							<span className="sr-only" role="status">
								{copied ? S.promptCopied(count) : null}
							</span>
						</SheetFooter>
					</>
				)}

				<AlertDialog
					open={clearing.open}
					onOpenChange={(next) => {
						if (!next && !working) setClearing((asked) => ({ ...asked, open: false }));
					}}
				>
					<AlertDialogContent
						// Back to the button that asked; it is gone when the comments are.
						finalFocus={() => clearButton.current ?? heading.current}
					>
						<AlertDialogHeader>
							<AlertDialogTitle>{S.clearTitle(clearing.count)}</AlertDialogTitle>
							<AlertDialogDescription>{S.clearHint}</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={working}>{S.cancel}</AlertDialogCancel>
							<AlertDialogAction variant="destructive" disabled={working} onClick={clearAll}>
								{working ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
								{S.clearComments}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</SheetContent>
		</Sheet>
	);
}
