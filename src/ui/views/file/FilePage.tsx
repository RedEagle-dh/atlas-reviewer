/**
 * The file page (`#/file/<path>?line=<n>`): header with path, status and actions, the
 * neighbourhood ("Zusammenhang"), and the code. Works for any file of the head commit; a file
 * outside the review is shown read-only and marked as such.
 */
import "../../styles/file.css";
import "../../styles/code.css";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { ChangedFile, FileView } from "../../../core/types";
import { ApiError, getFile } from "../../api";
import { Icon } from "../../components/icons";
import { Delta, StatusBadge } from "../../components/marks";
import { ErrorView, Loading } from "../../components/states";
import { baseName, viewedMark } from "../../lib/files";
import { readStored } from "../../lib/storage";
import { fileRoute, type Grouping, mapRoute, type Route, readFileParams } from "../../router";
import { isRangeMoved, useAtlas } from "../../state/atlas";
import { useKeys } from "../../state/keys";
import { useChoice, useFlag } from "../../state/prefs";
import { useResource } from "../../state/resource";
import { takeRestore } from "../../state/route";
import { categoryLabel, fmt, S } from "../../strings";
import { buildGroupTree, groupOfFile } from "../map/grouping";
import { CodeView } from "./CodeView";
import { Neighbourhood } from "./Neighbourhood";
import { importLinks, neighboursOf } from "./neighbours";

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
 * the block's index.
 */
function jumpToChange(direction: 1 | -1): number | null {
	const main = document.querySelector(".main");
	const anchors = [...document.querySelectorAll<HTMLElement>(".code-view [data-anchor]")];
	const landing = stickyBottom() + CONTEXT_ABOVE;
	const target =
		direction === 1
			? anchors.find((a) => a.getBoundingClientRect().top > landing + 2)
			: [...anchors].reverse().find((a) => a.getBoundingClientRect().top < landing - 2);
	if (!target || !main) return null;
	main.scrollBy({ top: target.getBoundingClientRect().top - landing });
	return anchors.indexOf(target);
}

function PathCrumbs({ path, onDir }: { path: string; onDir: (dir: string) => string }) {
	const parts = path.split("/");
	const name = parts.pop() ?? path;
	return (
		<span className="file-path" title={path}>
			{/* The directories give way (cut from the left) before the file name does. */}
			<span className="file-path-dirs">
				{"\u200e"}
				{parts.map((part, i) => {
					const dir = parts.slice(0, i + 1).join("/");
					return (
						<span key={dir} className="file-path-dir">
							<a href={onDir(dir)} title={S.folderOnMap}>
								{part}
							</a>
							<span className="file-path-sep">/</span>
						</span>
					);
				})}
				{"\u200e"}
			</span>
			<span className="file-path-name">{name}</span>
		</span>
	);
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1400);
		return () => clearTimeout(t);
	}, [copied]);
	return (
		<button
			type="button"
			className="btn icon quiet"
			title={copied ? S.copied : S.copyPath}
			aria-label={S.copyPath}
			onClick={() => {
				navigator.clipboard?.writeText(text).then(
					() => setCopied(true),
					() => setCopied(false),
				);
			}}
		>
			<Icon name={copied ? "check" : "copy"} />
		</button>
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

	useKeys({
		j: () => next && go(fileRoute({ path: next.path })),
		k: () => prev && go(fileRoute({ path: prev.path })),
		v: () => file && setViewed(file, mark !== "viewed"),
		n: () => {
			const i = jumpToChange(1);
			if (i !== null) setChangeIndex(i);
		},
		p: () => {
			const i = jumpToChange(-1);
			if (i !== null) setChangeIndex(i);
		},
	});

	useEffect(() => {
		document.title = `${baseName(view.path)} · ${meta.title}`;
	}, [view.path, meta.title]);

	const changeCount = plain ? 0 : view.changes.length;
	const statusLabel = view.status === "added" ? S.newFile : undefined;

	return (
		<article className="file-page" data-path={view.path}>
			<header className="file-head">
				<div className="file-head-row">
					<PathCrumbs path={view.path} onDir={dirHref} />
					<CopyButton text={view.path} />
					<span className="file-head-spacer" />
					{file ? (
						<button
							type="button"
							className={`btn viewed-toggle is-${mark}`}
							aria-pressed={mark === "viewed"}
							onClick={() => setViewed(file, mark !== "viewed")}
							title={S.keyHint("v")}
							data-testid="viewed-toggle"
						>
							<Icon name={mark === "stale" ? "stale" : "check"} />
							{mark === "stale" ? S.changedSinceViewed : S.viewedToggle}
							<kbd>v</kbd>
						</button>
					) : null}
					<div className="file-nav">
						<a
							className="btn icon"
							href={prev ? href(fileRoute({ path: prev.path })) : undefined}
							aria-disabled={!prev}
							title={`${S.prevFile} (${S.keyHint("k")})`}
							aria-label={S.prevFile}
						>
							<Icon name="prev" />
						</a>
						<span className="file-nav-pos num">
							{position >= 0 ? `${fmt(position + 1)} / ${fmt(reading.length)}` : "–"}
						</span>
						<a
							className="btn icon"
							href={next ? href(fileRoute({ path: next.path })) : undefined}
							aria-disabled={!next}
							title={`${S.nextFile} (${S.keyHint("j")})`}
							aria-label={S.nextFile}
						>
							<Icon name="next" />
						</a>
					</div>
					<a className="btn" href={mapHref()}>
						<Icon name="map" />
						{S.showOnMap}
					</a>
				</div>
				<div className="file-head-row file-head-meta">
					<StatusBadge status={view.status} {...(statusLabel ? { label: statusLabel } : {})} />
					{file ? <Delta added={file.added} deleted={file.deleted} /> : null}
					{chapter ? (
						<a
							className="file-chapter"
							href={href(mapRoute({ group: chapter.id, grouping: "chapters" }))}
						>
							{S.chapter} {chapterIndex + 1}: {chapter.title}
						</a>
					) : null}
					{view.oldPath ? (
						<span className="file-renamed">{S.renamedFrom(view.oldPath)}</span>
					) : null}
					{view.status === "unchanged" ? (
						<span className="file-note">{S.unchangedHint}</span>
					) : null}
					{excluded ? (
						<span className="file-note">
							{S.excludedHint(categoryLabel(meta.categories, view.category))}
						</span>
					) : null}
					<span className="file-head-spacer" />
					{view.lines.length > 0 ? (
						<div className="code-controls">
							{!plain ? (
								<fieldset className="segmented" aria-label={S.modeLabel}>
									<button
										type="button"
										aria-pressed={mode === "full"}
										onClick={() => setMode("full")}
									>
										{S.modeFull}
									</button>
									<button
										type="button"
										aria-pressed={mode === "changes"}
										onClick={() => setMode("changes")}
									>
										{S.modeChanges}
									</button>
								</fieldset>
							) : null}
							{!plain && hasRemoved ? (
								<button
									type="button"
									className="btn"
									aria-pressed={showRemoved}
									onClick={() => setShowRemoved(!showRemoved)}
								>
									{S.showRemoved}
								</button>
							) : null}
							<button
								type="button"
								className="btn"
								aria-pressed={wrap}
								onClick={() => setWrap(!wrap)}
							>
								{S.wrap}
							</button>
							{changeCount > 0 ? (
								<div className="change-nav">
									<button
										type="button"
										className="btn icon"
										title={`${S.prevChange} (${S.keyHint("p")})`}
										aria-label={S.prevChange}
										onClick={() => {
											const i = jumpToChange(-1);
											if (i !== null) setChangeIndex(i);
										}}
									>
										<Icon name="up" />
									</button>
									<span className="change-pos num" data-testid="change-pos">
										{changeIndex === null
											? S.changes(changeCount)
											: S.changeOf(changeIndex + 1, changeCount)}
									</span>
									<button
										type="button"
										className="btn icon"
										title={`${S.nextChange} (${S.keyHint("n")})`}
										aria-label={S.nextChange}
										onClick={() => {
											const i = jumpToChange(1);
											if (i !== null) setChangeIndex(i);
										}}
									>
										<Icon name="down" />
									</button>
								</div>
							) : null}
						</div>
					) : null}
				</div>
			</header>

			<section className={`neighbourhood${neighbourhoodOpen ? " is-open" : ""}`}>
				<button
					type="button"
					className="section-toggle"
					aria-expanded={neighbourhoodOpen}
					onClick={() => setNeighbourhoodOpen(!neighbourhoodOpen)}
				>
					<Icon name={neighbourhoodOpen ? "down" : "next"} />
					<span>{S.neighbourhood}</span>
				</button>
				{neighbourhoodOpen ? <Neighbourhood view={view} neighbours={neighbours} /> : null}
			</section>

			{view.status === "deleted" ? <div className="banner">{S.deletedFile}</div> : null}
			{view.truncated ? <div className="banner">{S.truncatedFile(view.lines.length)}</div> : null}
			{view.binary ? (
				<div className="banner">{S.binaryFile(S.bytes(view.size))}</div>
			) : view.lines.length === 0 ? (
				<div className="banner">{S.emptyFile}</div>
			) : (
				<CodeView
					view={view}
					options={{ mode, showRemoved, wrap, plain }}
					target={line}
					links={links}
				/>
			)}
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
				<div className="state" role="alert">
					<h2>{S.fileNotFound}</h2>
					<p>{S.fileNotFoundHint(path, model.range.head.sha.slice(0, 10))}</p>
					<div className="actions">
						<a className="btn" href={href(mapRoute({ group: "", grouping: "chapters" }))}>
							{S.toMap}
						</a>
					</div>
				</div>
			);
		return <ErrorView error={resource.error} retry={resource.retry} />;
	}
	return <Loaded view={resource.value} line={line} file={byPath.get(path)} />;
}
