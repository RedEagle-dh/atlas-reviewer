/** Small marks used everywhere: status, +/−, size of change, viewed, progress. */
import type { FileStatus } from "../../core/types";
import { changeScale, type ViewedMark as Mark } from "../lib/files";
import { S } from "../strings";
import { Icon } from "./icons";

type AnyStatus = FileStatus | "unchanged";

export function StatusMark({ status }: { status: AnyStatus }) {
	return (
		<span
			className={`status-mark st-${status}`}
			title={S.status[status]}
			role="img"
			aria-label={S.status[status]}
		>
			{S.statusGlyph[status]}
		</span>
	);
}

export function StatusBadge({ status, label }: { status: AnyStatus; label?: string }) {
	return <span className={`status-badge st-${status}`}>{label ?? S.status[status]}</span>;
}

export function Delta({ added, deleted }: { added: number; deleted: number }) {
	return (
		<span className="delta" title={S.linesTitle(added, deleted)}>
			<span className="plus">+{added.toLocaleString("de-DE")}</span>
			<span className="minus">−{deleted.toLocaleString("de-DE")}</span>
		</span>
	);
}

/** Total width on a log scale; the green and red parts split it by added and deleted lines. */
export function SizeBar({ added, deleted }: { added: number; deleted: number }) {
	const total = added + deleted;
	const width = changeScale(total) * 100;
	const add = total === 0 ? 0 : (added / total) * width;
	return (
		<span className="size-bar" title={S.linesTitle(added, deleted)} aria-hidden="true">
			<i className="add" style={{ width: `${add}%` }} />
			<i className="del" style={{ width: `${width - add}%` }} />
		</span>
	);
}

export function ViewedMark({ mark }: { mark: Mark }) {
	if (mark === "viewed")
		return (
			<span className="viewed-mark viewed" title={S.viewed} role="img" aria-label={S.viewed}>
				<Icon name="check" />
			</span>
		);
	if (mark === "stale")
		return (
			<span
				className="viewed-mark stale"
				title={S.changedSinceViewed}
				role="img"
				aria-label={S.changedSinceViewed}
			>
				<Icon name="stale" />
			</span>
		);
	return <span className="viewed-mark" aria-hidden="true" />;
}

export function Progress({ seen, total, label }: { seen: number; total: number; label?: string }) {
	const share = total === 0 ? 0 : (seen / total) * 100;
	return (
		<span
			className="progress"
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={total}
			aria-valuenow={seen}
			aria-label={label ?? S.progress(seen, total)}
		>
			<i style={{ width: `${share}%` }} />
		</span>
	);
}
