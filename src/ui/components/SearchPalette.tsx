/** Ctrl/Cmd-K: fuzzy search over the visible files; Enter opens the chosen one. */
import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { viewedMark } from "../lib/files";
import { fuzzyFilter } from "../lib/fuzzy";
import { fileRoute } from "../router";
import { useAtlas } from "../state/atlas";
import { S } from "../strings";
import { StatusMark, ViewedMark } from "./marks";

/** Keeps a path left-to-right inside a box that cuts from the left (`direction: rtl`). */
const LRM = "\u200e";

/**
 * Secondary text of a result: muted, and on the fill of the selected row the row's own text
 * colour, as the component's shortcut hint does (muted on that fill falls below 4.5:1).
 */
const QUIET = "text-muted-foreground group-data-selected/command-item:text-foreground";

/** The path with the matched characters marked; the file name in full weight. */
function highlight(path: string, indices: readonly number[]): ReactNode[] {
	const marked = new Set(indices);
	const nameStart = path.lastIndexOf("/") + 1;
	const parts: ReactNode[] = [];
	let run = "";
	let runMarked = false;
	let runInName = false;
	const flush = (key: number) => {
		if (run === "") return;
		parts.push(
			runMarked ? (
				<mark key={key} className="bg-transparent font-semibold text-foreground">
					{run}
				</mark>
			) : runInName ? (
				<span key={key} className="text-foreground">
					{run}
				</span>
			) : (
				run
			),
		);
		run = "";
	};
	for (let i = 0; i < path.length; i++) {
		const m = marked.has(i);
		const inName = i >= nameStart;
		if (m !== runMarked || inName !== runInName) {
			flush(i);
			runMarked = m;
			runInName = inName;
		}
		run += path[i];
	}
	flush(path.length);
	return parts;
}

/** The field, the results and the key hints. Lives only while the dialog is open: a new search starts empty. */
function Search({ onClose }: { onClose: () => void }) {
	const { reading, meta, viewed, go } = useAtlas();
	const [query, setQuery] = useState("");
	const results = useMemo(() => fuzzyFilter(query, reading, (f) => f.path, 40), [query, reading]);
	// The selected row is ours to say, not cmdk's to keep: left alone, it stays on the row that was
	// selected before the key (now somewhere down the list), scrolls the list there, and then
	// moves to the first row without scrolling back: the best matches were out of sight.
	const [selected, setSelected] = useState("");
	const search = (next: string) => {
		setQuery(next);
		setSelected(fuzzyFilter(next, reading, (f) => f.path, 1)[0]?.item.path ?? "");
	};
	const chapterTitle = useMemo(() => new Map(meta.chapters.map((c) => [c.id, c.title])), [meta]);
	return (
		// Our own ranking, not cmdk's; and no Ctrl-K for "one up", which closes the palette here.
		<Command
			shouldFilter={false}
			vimBindings={false}
			label={S.searchLabel}
			value={selected}
			onValueChange={setSelected}
		>
			<CommandInput placeholder={S.searchPlaceholder} value={query} onValueChange={search} />
			<CommandList className="max-h-[min(24rem,50svh)]">
				<CommandEmpty>{S.searchEmpty}</CommandEmpty>
				{results.length > 0 ? (
					<CommandGroup>
						{results.map(({ item, match }) => (
							<CommandItem
								key={item.path}
								value={item.path}
								// The item's own trailing check mark has no meaning here.
								className="[&>svg:last-child]:hidden"
								onSelect={() => {
									onClose();
									go(fileRoute({ path: item.path }));
								}}
							>
								<StatusMark status={item.status} />
								{/* Cut from the left, so a long path keeps its file name. */}
								<span className={cn("min-w-0 flex-1 truncate text-left [direction:rtl]", QUIET)}>
									{LRM}
									{highlight(item.path, match.indices)}
									{LRM}
								</span>
								<span className={cn("max-w-56 shrink-0 truncate text-xs", QUIET)}>
									{chapterTitle.get(item.chapter) ?? item.chapter}
								</span>
								<ViewedMark mark={viewedMark(item, viewed)} />
							</CommandItem>
						))}
					</CommandGroup>
				) : null}
			</CommandList>
			{/* For the eye; a screen reader gets the same as the dialog's description. */}
			<div
				className="-mx-1 mt-1 -mb-1 flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground"
				aria-hidden="true"
			>
				<span className="flex items-center gap-1.5">
					<Kbd>
						<CornerDownLeftIcon />
					</Kbd>
					{S.searchKeys.open}
				</span>
				<span className="flex items-center gap-1.5">
					<Kbd>
						<ArrowUpIcon />
					</Kbd>
					<Kbd>
						<ArrowDownIcon />
					</Kbd>
					{S.searchKeys.move}
				</span>
				<span className="flex items-center gap-1.5">
					<Kbd>{S.keyEsc}</Kbd>
					{S.searchKeys.close}
				</span>
			</div>
		</Command>
	);
}

/**
 * Rendered only while the search is open: the dialog's title and description (for screen
 * readers) are part of the page as long as the dialog component is.
 */
export function SearchPalette({ onClose }: { onClose: () => void }) {
	return (
		<CommandDialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title={S.searchLabel}
			description={S.searchHint}
			className="top-1/6 sm:max-w-2xl"
		>
			<Search onClose={onClose} />
		</CommandDialog>
	);
}
