/**
 * Copying text. The Clipboard API exists only in a secure context: on `localhost`, not on the
 * server reached by a plain http address from another machine (`--host 0.0.0.0`). There the old
 * way still works in most browsers: select the text in a field and ask the document to copy it.
 */

/** A dialog that holds the focus: a field outside it could not be selected while it is open. */
const DIALOG = '[role="dialog"], [role="alertdialog"]';

/**
 * The old way: a field off screen with the text in it, selected, and `execCommand("copy")`.
 * Leaves the focus where it was.
 */
function copyBySelection(text: string): boolean {
	const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const field = document.createElement("textarea");
	field.value = text;
	field.readOnly = true;
	field.setAttribute("aria-hidden", "true");
	field.tabIndex = -1;
	// Fixed and off screen: nothing scrolls to it and nothing of it is seen. Not `display: none`,
	// which cannot be selected.
	field.style.cssText = "position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0";
	(active?.closest(DIALOG) ?? document.body).append(field);
	try {
		field.select();
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		field.remove();
		active?.focus({ preventScroll: true });
	}
}

/**
 * Puts `text` on the clipboard: through the Clipboard API, else the old way. `false` when the
 * browser allows neither; the caller then shows the text for copying by hand.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		// `navigator.clipboard` is missing outside a secure context; a call can also be refused.
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// Refused (no permission, the page not focused): the old way may still work.
	}
	return copyBySelection(text);
}
