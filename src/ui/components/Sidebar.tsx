/** The left sidebar: chapters in reading order, or the directory tree; one row per visible file. */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ChangedFile } from "../../core/types";
import { baseName, countViewed, dirName, ltr, viewedMark } from "../lib/files";
import { buildDirTree, type DirNode } from "../lib/tree";
import { fileRoute, mapRoute } from "../router";
import { useAtlas } from "../state/atlas";
import { useChoice } from "../state/prefs";
import { S } from "../strings";
import { Icon } from "./icons";
import { Progress, SizeBar, StatusMark, ViewedMark } from "./marks";

const FileRow = memo(function FileRow({
	file,
	hint,
	current,
	mark,
	href,
	depth = 0,
}: {
	file: ChangedFile;
	hint?: string;
	current: boolean;
	mark: ReturnType<typeof viewedMark>;
	href: string;
	depth?: number;
}) {
	const ref = useRef<HTMLAnchorElement>(null);
	useEffect(() => {
		if (current) ref.current?.scrollIntoView({ block: "nearest" });
	}, [current]);
	return (
		<li>
			<a
				ref={ref}
				href={href}
				className={`file-row${mark === "viewed" ? " is-viewed" : ""}`}
				aria-current={current ? "page" : undefined}
				title={file.path}
				style={depth > 0 ? { paddingLeft: `${10 + depth * 14}px` } : undefined}
				data-path={file.path}
			>
				<StatusMark status={file.status} />
				<span className="file-row-name">{baseName(file.path)}</span>
				<span className="file-row-hint">{ltr(hint ?? "")}</span>
				<SizeBar added={file.added} deleted={file.deleted} />
				<ViewedMark mark={mark} />
			</a>
		</li>
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

function ChapterList({ current }: { current: string | null }) {
	const { meta, reading, viewed, href } = useAtlas();
	const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
	const chapters = meta.chapters
		.map((chapter, i) => ({
			chapter,
			index: i + 1,
			files: reading.filter((f) => f.chapter === chapter.id),
		}))
		.filter((c) => c.files.length > 0);
	const toggle = (id: string) =>
		setClosed((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	return (
		<div className="chapters">
			{chapters.map(({ chapter, index, files }) => {
				const seen = countViewed(files, viewed);
				const holdsCurrent = current !== null && files.some((f) => f.path === current);
				const open = !closed.has(chapter.id) || holdsCurrent;
				const prefix = commonDir(files);
				return (
					<section key={chapter.id} className="chapter" data-chapter={chapter.id}>
						<div className="chapter-head">
							<button
								type="button"
								className="chapter-toggle"
								aria-expanded={open}
								title={open ? S.collapse : S.expand}
								onClick={() => toggle(chapter.id)}
							>
								<span className="chapter-index num">{index}</span>
								<span className="chapter-title">{chapter.title}</span>
								<span className="chapter-count num">{S.chapterProgress(seen, files.length)}</span>
							</button>
							<a
								className="btn icon quiet chapter-map"
								href={href(mapRoute({ group: chapter.id, grouping: "chapters" }))}
								title={S.chapterOnMap}
								aria-label={S.chapterOnMap}
							>
								<Icon name="map" />
							</a>
						</div>
						<Progress seen={seen} total={files.length} />
						{open ? (
							<>
								{chapter.summary ? <p className="chapter-summary">{chapter.summary}</p> : null}
								<ul className="file-list">
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
								</ul>
							</>
						) : null}
					</section>
				);
			})}
		</div>
	);
}

function DirBranch({
	node,
	depth,
	current,
	closed,
	toggle,
}: {
	node: DirNode;
	depth: number;
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
					<li key={dir.dir}>
						<div className="dir-row" style={{ paddingLeft: `${6 + depth * 14}px` }}>
							<button
								type="button"
								className="dir-toggle"
								aria-expanded={open}
								title={open ? S.collapse : S.expand}
								onClick={() => toggle(dir.dir)}
							>
								<Icon name={open ? "down" : "next"} />
								<span className="dir-name">{dir.name}</span>
								<span className="dir-count num">{dir.count}</span>
							</button>
							<a
								className="btn icon quiet dir-map"
								href={href(mapRoute({ group: dir.dir, grouping: "dirs" }))}
								title={S.folderOnMap}
								aria-label={S.folderOnMap}
							>
								<Icon name="map" />
							</a>
						</div>
						{open ? (
							<ul className="file-list">
								<DirBranch
									node={dir}
									depth={depth + 1}
									current={current}
									closed={closed}
									toggle={toggle}
								/>
							</ul>
						) : null}
					</li>
				);
			})}
			{node.files.map((file) => (
				<FileRow
					key={file.path}
					file={file}
					depth={depth}
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
	const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
	const toggle = (dir: string) =>
		setClosed((prev) => {
			const next = new Set(prev);
			if (next.has(dir)) next.delete(dir);
			else next.add(dir);
			return next;
		});
	return (
		<ul className="file-list folders">
			<DirBranch node={tree} depth={0} current={current} closed={closed} toggle={toggle} />
		</ul>
	);
}

export function Sidebar({ current }: { current: string | null }) {
	const { visible } = useAtlas();
	const [tab, setTab] = useChoice("sidebar-tab", ["chapters", "folders"], "chapters");
	return (
		<aside className="sidebar" aria-label={tab === "chapters" ? S.tabChapters : S.tabFolders}>
			<div className="sidebar-tabs segmented" role="tablist">
				<button
					type="button"
					role="tab"
					aria-selected={tab === "chapters"}
					onClick={() => setTab("chapters")}
				>
					{S.tabChapters}
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "folders"}
					onClick={() => setTab("folders")}
				>
					{S.tabFolders}
				</button>
			</div>
			<div className="sidebar-scroll">
				{visible.length === 0 ? (
					<div className="sidebar-empty">
						<p>{S.noVisibleFiles}</p>
						<p>{S.noVisibleFilesHint}</p>
					</div>
				) : tab === "chapters" ? (
					<ChapterList current={current} />
				) : (
					<FolderTree current={current} />
				)}
			</div>
		</aside>
	);
}
