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
/** What a theme choice comes down to: `system` follows the operating system. */
export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): ResolvedTheme {
	try {
		return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
	} catch {
		return "light";
	}
}

/**
 * The theme choice, and what it resolves to. Writes `class="dark"` on `<html>` (the variant
 * every `dark:` utility and the shadcn tokens hang on); the script in `index.html` does the same
 * before the first paint. Call it once, at the root of the app.
 */
export function useTheme(): [Theme, (theme: Theme) => void, ResolvedTheme] {
	const [theme, setTheme] = useChoice<Theme>("theme", THEMES, "system");
	const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
	useEffect(() => {
		const query = window.matchMedia(DARK_QUERY);
		const onChange = () => setSystem(query.matches ? "dark" : "light");
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);
	const resolved = theme === "system" ? system : theme;
	useEffect(() => {
		document.documentElement.classList.toggle("dark", resolved === "dark");
	}, [resolved]);
	return [theme, setTheme, resolved];
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
