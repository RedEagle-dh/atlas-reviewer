/**
 * Fuzzy matching for the search palette: the query's characters in order, anywhere in the path.
 * Of all ways to place them, the best one counts: a character scores more at the start of a path
 * segment or a word, inside the file name, and right after the previous match; a jump costs a
 * little. Shorter paths win ties. Dynamic programming over (query char, text position), O(q·t).
 */

export interface FuzzyMatch {
	score: number;
	/** Indices into the text of the matched characters, ascending. */
	indices: number[];
}

const BOUNDARY = new Set(["/", "-", "_", ".", " ", "$"]);
const WORD_START = 6;
const IN_NAME = 3;
const CONSECUTIVE = 5;
const GAP = 1;

function isWordStart(text: string, i: number): boolean {
	if (i === 0) return true;
	const prev = text[i - 1] ?? "";
	if (BOUNDARY.has(prev)) return true;
	const ch = text[i] ?? "";
	// camelCase: a capital after a lower-case letter
	return ch !== ch.toLowerCase() && prev === prev.toLowerCase() && prev !== prev.toUpperCase();
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
	const q = query.toLowerCase().replace(/\s+/g, "");
	if (q === "") return { score: 0, indices: [] };
	const lower = text.toLowerCase();
	const n = lower.length;
	const nameStart = text.lastIndexOf("/") + 1;
	const NONE = Number.NEGATIVE_INFINITY;
	const bonus = Array.from(
		{ length: n },
		(_, i) => 1 + (isWordStart(text, i) ? WORD_START : 0) + (i >= nameStart ? IN_NAME : 0),
	);
	// score[qi][ti]: best score with q[qi] placed at ti; from[qi][ti]: where q[qi - 1] was placed.
	const score: number[][] = [];
	const from: number[][] = [];
	for (let qi = 0; qi < q.length; qi++) {
		const prev = score[qi - 1];
		const row = new Array<number>(n).fill(NONE);
		const back = new Array<number>(n).fill(-1);
		let bestBefore = NONE; // best prev[tj] for tj <= ti - 2
		let bestBeforeAt = -1;
		for (let ti = 0; ti < n; ti++) {
			if (prev && ti >= 2) {
				const candidate = prev[ti - 2] ?? NONE;
				if (candidate > bestBefore) {
					bestBefore = candidate;
					bestBeforeAt = ti - 2;
				}
			}
			if (lower[ti] !== q[qi]) continue;
			const own = bonus[ti] ?? 1;
			if (!prev) {
				row[ti] = own;
				continue;
			}
			const adjacent = ti >= 1 ? (prev[ti - 1] ?? NONE) + CONSECUTIVE : NONE;
			const jump = bestBefore - GAP;
			if (adjacent === NONE && jump === NONE) continue;
			if (adjacent >= jump) {
				row[ti] = own + adjacent;
				back[ti] = ti - 1;
			} else {
				row[ti] = own + jump;
				back[ti] = bestBeforeAt;
			}
		}
		score.push(row);
		from.push(back);
	}
	const last = score[q.length - 1] ?? [];
	let end = -1;
	let best = NONE;
	last.forEach((s, i) => {
		if (s > best) {
			best = s;
			end = i;
		}
	});
	if (end === -1) return null;
	const indices: number[] = [];
	for (let qi = q.length - 1, ti = end; qi >= 0 && ti >= 0; qi--) {
		indices.push(ti);
		ti = from[qi]?.[ti] ?? -1;
	}
	return { score: best - text.length * 0.02, indices: indices.reverse() };
}

/** The items that match, best first; ties keep the input order. */
export function fuzzyFilter<T>(
	query: string,
	items: readonly T[],
	text: (item: T) => string,
	limit = 50,
): { item: T; match: FuzzyMatch }[] {
	const results: { item: T; match: FuzzyMatch; order: number }[] = [];
	items.forEach((item, order) => {
		const match = fuzzyMatch(query, text(item));
		if (match) results.push({ item, match, order });
	});
	results.sort((a, b) => b.match.score - a.match.score || a.order - b.order);
	return results.slice(0, limit).map(({ item, match }) => ({ item, match }));
}
