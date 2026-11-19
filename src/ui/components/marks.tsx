/** Small marks used everywhere: status, +/−, size of change, viewed, progress. */
import { CheckIcon, CircleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress as ProgressBar } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { FileStatus } from "../../core/types";
import { changeScale, type ViewedMark as Mark } from "../lib/files";
import { fmt, S } from "../strings";

export type AnyStatus = FileStatus | "unchanged";

/** The colour of a status as text, as a soft background and as a solid one (bars, stacks). */
const STATUS_TEXT: Readonly<Record<AnyStatus, string>> = {
	added: "text-added",
	modified: "text-modified",
	deleted: "text-deleted",
	renamed: "text-renamed",
	unchanged: "text-muted-foreground",
};
const STATUS_SOFT: Readonly<Record<AnyStatus, string>> = {
	added: "bg-added/15",
	modified: "bg-modified/15",
	deleted: "bg-deleted/15",
	renamed: "bg-renamed/15",
	unchanged: "bg-muted",
};
/** A line in the status colour, for a status written out on the page's own ground. */
const STATUS_LINE: Readonly<Record<AnyStatus, string>> = {
	added: "border-added/50",
	modified: "border-modified/50",
	deleted: "border-deleted/50",
	renamed: "border-renamed/50",
	unchanged: "border-border",
};
export const STATUS_SOLID: Readonly<Record<AnyStatus, string>> = {
	added: "bg-added",
	modified: "bg-modified",
	deleted: "bg-deleted",
	renamed: "bg-renamed",
	unchanged: "bg-muted-foreground",
};

/** Glyph + colour: the glyph keeps the status readable without colour. */
export function StatusMark({ status, className }: { status: AnyStatus; className?: string }) {
	return (
		<span
			className={cn(
				"inline-grid size-4 shrink-0 place-items-center rounded-sm text-xs leading-none font-bold",
				STATUS_TEXT[status],
				STATUS_SOFT[status],
				className,
			)}
			title={S.status[status]}
			role="img"
			aria-label={S.status[status]}
		>
			{S.statusGlyph[status]}
		</span>
	);
}

export function StatusBadge({ status, label }: { status: AnyStatus; label?: string }) {
	return (
		// On the page's ground, not on a tint of its own colour: there the word is too faint to
		// read in the light theme (4.1:1 for "geändert").
		<Badge variant="outline" className={cn(STATUS_TEXT[status], STATUS_LINE[status])}>
			{label ?? S.status[status]}
		</Badge>
	);
}

export function Delta({
	added,
	deleted,
	className,
}: {
	added: number;
	deleted: number;
	className?: string;
}) {
	return (
		<span
			className={cn("inline-flex gap-1.5 text-xs whitespace-nowrap tabular-nums", className)}
			title={S.linesTitle(added, deleted)}
		>
			<span className="text-added">+{fmt(added)}</span>
			<span className="text-deleted">−{fmt(deleted)}</span>
		</span>
	);
}

/** Total width on a log scale; the green and red parts split it by added and deleted lines. */
export function SizeBar({
	added,
	deleted,
	className,
}: {
	added: number;
	deleted: number;
	className?: string;
}) {
	const total = added + deleted;
	const width = changeScale(total) * 100;
	const add = total === 0 ? 0 : (added / total) * width;
	return (
		<span
			className={cn(
				"inline-flex h-1 w-8 shrink-0 overflow-hidden rounded-full bg-muted",
				className,
			)}
			title={S.linesTitle(added, deleted)}
			aria-hidden="true"
		>
			<span className="h-full bg-added" style={{ width: `${add}%` }} />
			<span className="h-full bg-deleted" style={{ width: `${width - add}%` }} />
		</span>
	);
}

/** A check for a viewed file, a warning for one that changed since; an empty box otherwise. */
export function ViewedMark({ mark, className }: { mark: Mark; className?: string }) {
	if (mark === "viewed")
		return (
			<span
				className={cn("inline-grid size-4 shrink-0 place-items-center text-foreground", className)}
				title={S.viewed}
				role="img"
				aria-label={S.viewed}
			>
				<CheckIcon className="size-3.5" aria-hidden="true" />
			</span>
		);
	if (mark === "stale")
		return (
			<span
				className={cn("inline-grid size-4 shrink-0 place-items-center text-modified", className)}
				title={S.changedSinceViewed}
				role="img"
				aria-label={S.changedSinceViewed}
			>
				<CircleAlertIcon className="size-3.5" aria-hidden="true" />
			</span>
		);
	return <span className={cn("inline-block size-4 shrink-0", className)} aria-hidden="true" />;
}

export function Progress({
	seen,
	total,
	label,
	className,
}: {
	seen: number;
	total: number;
	label?: string;
	className?: string;
}) {
	return (
		<ProgressBar
			value={seen}
			max={Math.max(total, 1)}
			aria-label={label ?? S.progress(seen, total)}
			{...(className ? { className } : {})}
		/>
	);
}
