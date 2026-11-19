/** Per-viewer choices kept in localStorage: theme, filters, toggles. */
import { useCallback, useEffect, useState } from "react";
import { readStored, writeStored } from "../lib/storage";

/** A string choice out of `allowed`, remembered under `key`. */
export function useChoice<T extends string>(
	key: string,
	allowed: readonly T[],
	fallback: T,
): [T, (value: T) => void] {
	const [value, setValue] = useState<T>(() => {
		const stored = readStored(key);
		return allowed.find((a) => a === stored) ?? fallback;
	});
	const set = useCallback(
		(next: T) => {
			setValue(next);
			writeStored(key, next);
		},
		[key],
	);
	return [value, set];
}

/** An on/off switch, remembered under `key`. */
export function useFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
	const [value, set] = useChoice(key, ["on", "off"], fallback ? "on" : "off");
	return [value === "on", useCallback((next: boolean) => set(next ? "on" : "off"), [set])];
}

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** The theme choice; writes `data-theme` on `<html>` (none = follow the system). */
export function useTheme(): [Theme, (theme: Theme) => void] {
	const [theme, setTheme] = useChoice<Theme>("theme", THEMES, "system");
	useEffect(() => {
		const root = document.documentElement;
		if (theme === "system") delete root.dataset.theme;
		else root.dataset.theme = theme;
	}, [theme]);
	return [theme, setTheme];
}

/** The visible categories of a review; defaults from the review, remembered per review. */
export function useCategories(
	reviewId: string,
	defaults: readonly string[],
	known: readonly string[],
): [ReadonlySet<string>, (category: string) => void] {
	const key = `${reviewId}:categories`;
	const [visible, setVisible] = useState<ReadonlySet<string>>(() => {
		const stored = readStored(key);
		if (stored !== null) {
			try {
				const parsed: unknown = JSON.parse(stored);
				if (Array.isArray(parsed))
					return new Set(
						parsed.filter((c): c is string => typeof c === "string" && known.includes(c)),
					);
			} catch {
				// fall through to the defaults
			}
		}
		return new Set(defaults);
	});
	const toggle = useCallback(
		(category: string) => {
			setVisible((prev) => {
				const next = new Set(prev);
				if (next.has(category)) next.delete(category);
				else next.add(category);
				writeStored(key, JSON.stringify([...next]));
				return next;
			});
		},
		[key],
	);
	return [visible, toggle];
}
