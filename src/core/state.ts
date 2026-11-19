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
	// One read of the file for everyone: a second read still in flight when a write lands would
	// bring the old marks back after it.
	let loaded: Promise<ViewedState> | undefined;
	// Writes run one after the other, so two quick toggles cannot interleave.
	let queue: Promise<unknown> = Promise.resolve();

	const read = async (): Promise<ViewedState> => {
		// No prototype: a path such as `__proto__` is an ordinary key here.
		const viewed: Record<string, string> = Object.create(null);
		try {
			const data: unknown = JSON.parse(await Bun.file(file).text());
			if (typeof data === "object" && data !== null && "viewed" in data) {
				const marks = data.viewed;
				if (typeof marks === "object" && marks !== null)
					for (const [path, blob] of Object.entries(marks))
						if (typeof blob === "string") viewed[path] = blob;
			}
		} catch {
			// No state yet (or unreadable): nothing viewed.
		}
		return { viewed };
	};
	const load = (): Promise<ViewedState> => {
		loaded ??= read();
		return loaded;
	};

	return {
		async read() {
			const current = await load();
			return { viewed: { ...current.viewed } };
		},
		set(path, blob) {
			const run = queue.then(async () => {
				const current = await load();
				if (blob === null) delete current.viewed[path];
				else current.viewed[path] = blob;
				await mkdir(dirname(file), { recursive: true });
				const tmp = `${file}.${process.pid}.tmp`;
				await Bun.write(tmp, `${JSON.stringify(current, null, "\t")}\n`);
				await rename(tmp, file);
				return { viewed: { ...current.viewed } };
			});
			queue = run.catch(() => undefined);
			return run;
		},
	};
}
