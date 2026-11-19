/** The few line icons the UI needs, drawn on a 16-unit grid; colour comes from `currentColor`. */
import type { ReactNode } from "react";

const PATHS = {
	sidebar: (
		<>
			<rect x="2" y="2.5" width="12" height="11" rx="1.5" />
			<path d="M6 2.5v11" />
		</>
	),
	search: (
		<>
			<circle cx="7" cy="7" r="4.25" />
			<path d="M10.25 10.25 13.5 13.5" />
		</>
	),
	system: (
		<>
			<circle cx="8" cy="8" r="5.5" />
			<path d="M8 2.5v11" />
			<path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" />
		</>
	),
	light: (
		<>
			<circle cx="8" cy="8" r="2.75" />
			<path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
		</>
	),
	dark: <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3 5.5 5.5 0 1 0 13 9.5Z" />,
	map: (
		<>
			<rect x="1.5" y="5.5" width="4" height="5" rx="1" />
			<rect x="10.5" y="2" width="4" height="4.5" rx="1" />
			<rect x="10.5" y="9.5" width="4" height="4.5" rx="1" />
			<path d="M5.5 8h2.5M8 4.25v7.5M8 4.25h2.5M8 11.75h2.5" />
		</>
	),
	copy: (
		<>
			<rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
			<path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
		</>
	),
	check: <path d="m3 8.5 3.25 3L13 4.5" />,
	prev: <path d="m10 3.5-4.5 4.5 4.5 4.5" />,
	next: <path d="m6 3.5 4.5 4.5L6 12.5" />,
	up: <path d="m3.5 10 4.5-4.5 4.5 4.5" />,
	down: <path d="m3.5 6 4.5 4.5L12.5 6" />,
	fit: <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />,
	legend: (
		<>
			<circle cx="8" cy="8" r="5.75" />
			<path d="M8 7.25V11M8 5h.01" />
		</>
	),
	direction: <path d="M2.5 5.5h10l-2.5-2.5M13.5 10.5h-10l2.5 2.5" />,
	goto: <path d="M4 12 12 4M6 4h6v6" />,
	stale: (
		<>
			<circle cx="8" cy="8" r="5.5" />
			<path d="M8 5v3.5M8 10.75h.01" />
		</>
	),
	dot: <circle cx="8" cy="8" r="2" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

/** Decorative: the element around it carries the label (`aria-label`, `title` or text). */
export function Icon({ name }: { name: IconName }) {
	return (
		<svg className="icon-svg" viewBox="0 0 16 16" aria-hidden="true">
			{PATHS[name]}
		</svg>
	);
}
