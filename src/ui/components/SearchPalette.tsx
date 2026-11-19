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
import { viewedMark } from "../lib/files";
import { fuzzyFilter } from "../lib/fuzzy";
import { fileRoute } from "../router";
import { useAtlas } from "../state/atlas";
import { S } from "../strings";
import { StatusMark, ViewedMark } from "./marks";

/** Keeps a path left-to-right inside a box that cuts from the left (`direction: rtl`). */
const LRM = "‎";

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
	const chapterTitle = useMemo(() => new Map(meta.chapters.map((c) => [c.id, c.title])), [meta]);
	return (
		// Our own ranking, not cmdk's; and no Ctrl-K for "one up", which closes the palette here.
		<Command shouldFilter={false} vimBindings={false} label={S.searchLabel}>
			<CommandInput placeholder={S.searchPlaceholder} value={query} onValueChange={setQuery} />
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
								<span className="min-w-0 flex-1 truncate text-left text-muted-foreground [direction:rtl]">
									{LRM}
									{highlight(item.path, match.indices)}
									{LRM}
								</span>
								<span className="max-w-56 shrink-0 truncate text-xs text-muted-foreground">
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
