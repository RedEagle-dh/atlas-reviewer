/** Test data for the map's pure functions (imported only by tests). */
import type { ChangedFile, Edge, ImportKind } from "../../../core/types";

export function file(
	path: string,
	chapter: string,
	unit: string,
	extra: Partial<ChangedFile> = {},
): ChangedFile {
	return {
		path,
		status: "modified",
		added: 1,
		deleted: 1,
		binary: false,
		category: "logic",
		chapter,
		unit,
		language: "typescript",
		blob: `blob-${path}`,
		baseBlob: `base-${path}`,
		outside: { imports: 0, importers: 0 },
		...extra,
	};
}

export function edge(from: string, to: string, kind: ImportKind = "value"): Edge {
	return { from, to, kind, names: ["x"], line: 1 };
}

export const CHAPTERS = [
	{ id: "sdk", title: "SDK" },
	{ id: "host", title: "Host", summary: "Der Plugin-Host" },
	{ id: "web", title: "Web" },
	{ id: "empty", title: "Leer" },
];

/**
 * A small monorepo:
 *
 *   packages/sdk/src/{index,manifest,digest}.ts                       chapter sdk
 *   apps/api/src/modules/plugins/{service,store,routes}.ts             chapter host
 *   apps/api/src/modules/plugins/ops/{install,remove}.ts               chapter host
 *   apps/web/src/lib/registry.ts, apps/web/src/routes/{a,b}.tsx,
 *   apps/web/src/routes/deep/x/only.tsx                                chapter web
 *   README.md                                                          chapter web, unit "."
 */
export const FILES: ChangedFile[] = [
	file("packages/sdk/src/index.ts", "sdk", "packages/sdk"),
	file("packages/sdk/src/manifest.ts", "sdk", "packages/sdk"),
	file("packages/sdk/src/digest.ts", "sdk", "packages/sdk", { status: "added" }),
	file("apps/api/src/modules/plugins/service.ts", "host", "apps/api", { status: "added" }),
	file("apps/api/src/modules/plugins/store.ts", "host", "apps/api"),
	file("apps/api/src/modules/plugins/routes.ts", "host", "apps/api"),
	file("apps/api/src/modules/plugins/ops/install.ts", "host", "apps/api"),
	file("apps/api/src/modules/plugins/ops/remove.ts", "host", "apps/api"),
	file("apps/web/src/lib/registry.ts", "web", "apps/web"),
	file("apps/web/src/routes/a.tsx", "web", "apps/web"),
	file("apps/web/src/routes/b.tsx", "web", "apps/web"),
	file("apps/web/src/routes/deep/x/only.tsx", "web", "apps/web"),
	file("README.md", "web", ".", { category: "docs" }),
].sort((a, b) => (a.path < b.path ? -1 : 1));

export const EDGES: Edge[] = [
	edge("packages/sdk/src/index.ts", "packages/sdk/src/manifest.ts", "re-export"),
	edge("packages/sdk/src/manifest.ts", "packages/sdk/src/digest.ts"),
	edge("apps/api/src/modules/plugins/service.ts", "packages/sdk/src/index.ts"),
	edge("apps/api/src/modules/plugins/service.ts", "apps/api/src/modules/plugins/store.ts"),
	edge("apps/api/src/modules/plugins/routes.ts", "apps/api/src/modules/plugins/service.ts"),
	edge("apps/api/src/modules/plugins/ops/install.ts", "apps/api/src/modules/plugins/store.ts"),
	edge("apps/api/src/modules/plugins/ops/install.ts", "packages/sdk/src/manifest.ts", "type"),
	edge("apps/api/src/modules/plugins/ops/remove.ts", "apps/api/src/modules/plugins/store.ts"),
	edge(
		"apps/api/src/modules/plugins/store.ts",
		"apps/api/src/modules/plugins/ops/remove.ts",
		"type",
	),
	edge("apps/web/src/routes/a.tsx", "apps/web/src/lib/registry.ts"),
	edge("apps/web/src/routes/b.tsx", "apps/web/src/lib/registry.ts"),
	edge("apps/web/src/lib/registry.ts", "packages/sdk/src/index.ts", "type"),
];
