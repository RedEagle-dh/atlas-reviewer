/**
 * "Viewed" marks: one JSON file per review, path → blob sha the file was viewed at. A file
 * counts as viewed only while its blob is still the recorded one.
 */
import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { ViewedState } from "./types";

export interface StateStore {
	read(): Promise<ViewedState>;
	/** `blob: null` removes the mark. */
	set(path: string, blob: string | null): Promise<ViewedState>;
}

export function createStateStore(file: string): StateStore {
	/**
	 * The file holds the marks: nothing of them is kept in memory. Every request reads it first,
	 * so a second server of the same review (on another port) sees what this one wrote instead of
	 * writing its older marks over it. Requests run one after the other: two quick toggles cannot
	 * interleave, and a read never brings back what a write has just replaced.
	 */
	let queue: Promise<unknown> = Promise.resolve();
	const inTurn = <T>(task: () => Promise<T>): Promise<T> => {
		const run = queue.then(task);
		queue = run.catch(() => undefined);
		return run;
	};

	/**
	 * The marks on disk. No file, or one whose text is no JSON or holds no `viewed`, means nothing
	 * viewed. A file that cannot be read (no permission, a directory in its place) rejects with the
	 * error of the read: "nothing viewed" would let the next `set` write its one mark over all the
	 * marks the file holds.
	 */
	const read = async (): Promise<ViewedState> => {
		// No prototype: a path such as `__proto__` is an ordinary key here.
		const viewed: Record<string, string> = Object.create(null);
		let text: string;
		try {
			text = await Bun.file(file).text();
		} catch (error) {
			// No state yet, or the file is gone since: nothing viewed.
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return { viewed };
			throw error;
		}
		try {
			const data: unknown = JSON.parse(text);
			if (typeof data === "object" && data !== null && "viewed" in data) {
				const marks = data.viewed;
				if (typeof marks === "object" && marks !== null)
					for (const [path, blob] of Object.entries(marks))
						if (typeof blob === "string") viewed[path] = blob;
			}
		} catch {
			// Not JSON: nothing viewed.
		}
		return { viewed };
	};

	return {
		read() {
			return inTurn(async () => ({ viewed: { ...(await read()).viewed } }));
		},
		set(path, blob) {
			return inTurn(async () => {
				const current = await read();
				if (blob === null) delete current.viewed[path];
				else current.viewed[path] = blob;
				await mkdir(dirname(file), { recursive: true });
				const tmp = `${file}.${process.pid}.tmp`;
				await Bun.write(tmp, `${JSON.stringify(current, null, "\t")}\n`);
				await rename(tmp, file);
				return { viewed: { ...current.viewed } };
			});
		},
	};
}
