/**
 * Per-viewer conveniences in `localStorage` (theme, filters, toggles). Every access is guarded:
 * a private window or blocked storage just means the defaults.
 */
const PREFIX = "review-atlas:";

export function readStored(key: string): string | null {
	try {
		return window.localStorage.getItem(PREFIX + key);
	} catch {
		return null;
	}
}

export function writeStored(key: string, value: string | null): void {
	try {
		if (value === null) window.localStorage.removeItem(PREFIX + key);
		else window.localStorage.setItem(PREFIX + key, value);
	} catch {
		// Storage unavailable: the choice lasts until the page reloads.
	}
}
