/** Single-key shortcuts (`j`, `k`, `v`, `n`, `p`, …) that stay out of the way of text fields. */
import { useEffect, useRef } from "react";

function typingInto(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

/**
 * Calls `bindings[event.key]` on a plain key press (no Ctrl, Alt or Meta) outside text fields.
 * The latest bindings are always used, so callers may pass a new object on every render.
 */
export function useKeys(bindings: Readonly<Record<string, () => void>>, enabled = true): void {
	const latest = useRef(bindings);
	latest.current = bindings;
	useEffect(() => {
		if (!enabled) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
			if (typingInto(event.target)) return;
			if (document.querySelector("[data-modal-open]")) return;
			const action = latest.current[event.key];
			if (!action) return;
			event.preventDefault();
			action();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [enabled]);
}
