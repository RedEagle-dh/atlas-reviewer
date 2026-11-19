/**
 * The views, by the first segment of the hash route (`#/<view>/…`). A new page is one file that
 * exports a component taking `ViewProps`, plus one line here; link to it with
 * `href({ view: "<name>", path: "…", query: {} })` from `useAtlas()`.
 */
import type { ComponentType } from "react";
import type { Route } from "../router";
import { FilePage } from "./file/FilePage";
import { MapView } from "./map/MapView";

export interface ViewProps {
	route: Route;
}

export const VIEWS: Readonly<Record<string, ComponentType<ViewProps>>> = {
	map: MapView,
	file: FilePage,
};
