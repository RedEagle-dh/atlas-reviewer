/** Ctrl/Cmd-K: fuzzy search over the visible files; Enter opens the chosen one. */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { viewedMark } from "../lib/files";
import { fuzzyFilter } from "../lib/fuzzy";
import { fileRoute } from "../router";
import { useAtlas } from "../state/atlas";
import { S } from "../strings";
import { StatusMark, ViewedMark } from "./marks";

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
		const cls = `${runMarked ? "hit" : ""}${runInName ? " name" : ""}`.trim();
		parts.push(
			cls ? (
				<span key={key} className={cls}>
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

export function SearchPalette({ onClose }: { onClose: () => void }) {
	const { reading, meta, viewed, go } = useAtlas();
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const dialog = useRef<HTMLDialogElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const results = useMemo(() => fuzzyFilter(query, reading, (f) => f.path, 40), [query, reading]);
	const chapterTitle = useMemo(() => new Map(meta.chapters.map((c) => [c.id, c.title])), [meta]);

	useEffect(() => {
		// A modal <dialog>: focus stays inside, Escape closes it, the page behind is inert.
		if (dialog.current && !dialog.current.open) dialog.current.showModal();
		input.current?.focus();
	}, []);
	useEffect(() => {
		list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const open = (index: number) => {
		const hit = results[index];
		if (!hit) return;
		onClose();
		go(fileRoute({ path: hit.item.path }));
	};

	return (
		<dialog
			ref={dialog}
			className="palette"
			aria-label={S.searchLabel}
			data-modal-open
			onClose={onClose}
			onMouseDown={(e) => {
				// A press on the backdrop lands on the <dialog> itself; its content fills it otherwise.
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="palette-body">
				<input
					ref={input}
					className="palette-input"
					type="search"
					placeholder={S.searchPlaceholder}
					aria-label={S.searchLabel}
					aria-controls="palette-results"
					aria-activedescendant={results[active] ? `palette-${active}` : undefined}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setActive(0);
					}}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setActive((a) => Math.min(a + 1, results.length - 1));
						} else if (e.key === "ArrowUp") {
							e.preventDefault();
							setActive((a) => Math.max(a - 1, 0));
						} else if (e.key === "Enter") {
							e.preventDefault();
							open(active);
						} else if (e.key === "Escape") {
							e.preventDefault();
							onClose();
						}
					}}
				/>
				<div className="palette-results" id="palette-results" ref={list} role="listbox">
					{results.length === 0 ? <div className="palette-empty">{S.searchEmpty}</div> : null}
					{results.map(({ item, match }, i) => (
						<div
							key={item.path}
							id={`palette-${i}`}
							role="option"
							tabIndex={-1}
							aria-selected={i === active}
							data-index={i}
							className="palette-item"
							onMouseMove={() => setActive(i)}
							onClick={() => open(i)}
							onKeyDown={() => {}}
						>
							<StatusMark status={item.status} />
							<span className="palette-path">{highlight(item.path, match.indices)}</span>
							<span className="palette-chapter">
								{chapterTitle.get(item.chapter) ?? item.chapter}
							</span>
							<ViewedMark mark={viewedMark(item, viewed)} />
						</div>
					))}
				</div>
				<div className="palette-foot">{S.searchHint}</div>
			</div>
		</dialog>
	);
}
