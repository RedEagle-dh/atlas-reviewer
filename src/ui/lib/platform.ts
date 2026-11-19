/** What the page can know of the machine it runs on, for the words that depend on it (⌘ or Strg). */

/** A Mac (or an iPhone, an iPad): the command key is ⌘, not Ctrl. */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
