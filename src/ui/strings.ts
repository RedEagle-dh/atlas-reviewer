/**
 * Every word the UI shows, in ONE module: another language is another copy of this file.
 * Plain strings where the text is fixed, small functions where a number goes in.
 */
import type { FileStatus, ImportKind, ReviewMeta } from "../core/types";

const number = new Intl.NumberFormat("de-DE");

/** A count in German notation (`1.589`). */
export const fmt = (n: number): string => number.format(n);

const plural = (n: number, one: string, many: string): string =>
	`${fmt(n)} ${n === 1 ? one : many}`;

/** The words for core's built-in category ids (a review file may give its own label). */
const CATEGORY_WORDS: Readonly<Record<string, string>> = {
	generated: "Generiert",
	migration: "Migrationen",
	docs: "Dokumentation",
	test: "Tests",
	locale: "Übersetzungen",
	asset: "Medien",
	config: "Konfiguration",
	logic: "Logik",
	other: "Sonstiges",
};

export const S = {
	loading: "Lade …",
	loadingFile: (name: string) => `Lade ${name} …`,
	retry: "Erneut versuchen",
	errorTitle: "Der Server hat nicht geantwortet",
	errorHint: "Läuft `bun run atlas` noch? Die Meldung:",
	errorTitleServer: "Der Server meldet einen Fehler",
	errorHintServer: "Die Meldung des Servers:",
	unknownRange: (id: string) => `Den Bereich „${id}“ kennt dieses Review nicht.`,
	toFirstRange: "Zum ersten Bereich",
	unknownView: "Diese Seite gibt es nicht.",
	rangeMoved: (from: string, to: string) =>
		`Der Bereich hat neue Commits (${from} → ${to}): Karte, Liste und Code zeigen jetzt den neuen Stand. Was sich seitdem geändert hat, gilt als nicht gesehen.`,
	dismiss: "Ausblenden",

	category: CATEGORY_WORDS,
	/** The chapter of the files no chapter matches (when the review names it not). */
	restChapter: "Übrige",

	// Top bar
	range: "Bereich",
	rangeCurrent: (label: string) => `Bereich: ${label}`,
	rangeShas: (base: string, head: string) => `${base} bis ${head}`,
	categories: "Kategorien",
	categoryToggle: (label: string, on: boolean) =>
		on ? `${label} ausblenden` : `${label} einblenden`,
	categoryFiles: (label: string, n: number) => `${label}: ${plural(n, "Datei", "Dateien")}`,
	search: "Suchen",
	searchShortcut: (mac: boolean) => (mac ? "⌘K" : "Strg K"),
	progress: (seen: number, total: number) => `${fmt(seen)} von ${fmt(total)} gesehen`,
	progressShort: (seen: number, total: number) => `${fmt(seen)}/${fmt(total)} gesehen`,
	theme: { system: "Wie das System", light: "Hell", dark: "Dunkel" },
	themeToggle: (current: string) => `Farbschema: ${current} (wechseln)`,
	sidebarShow: "Seitenleiste zeigen",
	sidebarHide: "Seitenleiste ausblenden",
	skipFiles: "Dateiliste überspringen",

	// Sidebar
	tabChapters: "Kapitel",
	tabFolders: "Ordner",
	chapterProgress: (seen: number, total: number) => `${fmt(seen)}/${fmt(total)}`,
	chapterOnMap: "Kapitel auf der Karte zeigen",
	folderOnMap: "Ordner auf der Karte zeigen",
	collapse: "Zuklappen",
	expand: "Aufklappen",
	noVisibleFiles: "Keine Datei in den gewählten Kategorien.",
	noVisibleFilesHint: "Oben eine Kategorie einblenden.",

	// File status
	status: {
		added: "neu",
		modified: "geändert",
		deleted: "gelöscht",
		renamed: "umbenannt",
		unchanged: "unverändert",
	} satisfies Record<FileStatus | "unchanged", string>,
	statusGlyph: {
		added: "+",
		modified: "±",
		deleted: "−",
		renamed: "»",
		unchanged: "·",
	} satisfies Record<FileStatus | "unchanged", string>,
	viewed: "gesehen",
	changedSinceViewed: "seit dem Ansehen geändert",
	lines: (added: number, deleted: number) => `+${fmt(added)} −${fmt(deleted)}`,
	linesTitle: (added: number, deleted: number) =>
		`${plural(added, "Zeile", "Zeilen")} hinzu, ${plural(deleted, "Zeile", "Zeilen")} entfernt`,
	files: (n: number) => plural(n, "Datei", "Dateien"),

	// Search
	searchPlaceholder: "Datei suchen …",
	searchEmpty: "Keine sichtbare Datei passt.",
	searchHint: "Enter öffnet, ↑ ↓ wählt, Esc schließt",
	searchLabel: "Dateien durchsuchen",
	/** The same hint as `searchHint`, one word per key (the keys are drawn next to them). */
	searchKeys: { open: "öffnet", move: "wählt", close: "schließt" },
	keyEsc: "Esc",

	// Map
	mapTitle: "Karte",
	overview: "Übersicht",
	groupingLabel: "Gruppierung",
	groupingChapters: "Kapitel",
	groupingDirs: "Pakete & Ordner",
	rootUnit: "Wurzel des Repositorys",
	fit: "Einpassen",
	fitTitle: "Alles in den Blick nehmen",
	directionLabel: "Richtung",
	directionLtr: "Grundlagen links",
	directionRtl: "Grundlagen rechts",
	directionTitle:
		"Links oder rechts: wo stehen die importierten Dateien (die Grundlagen), wo die importierenden?",
	legend: "Legende",
	legendArrow: "A → B: A importiert B",
	legendCount: "Zahl: so viele Importe zwischen Dateien",
	legendTypes: "gestrichelt: nur Typen",
	legendCycle: "Zyklus: hängen gegenseitig voneinander ab",
	legendContext: "blass: Nachbarn außerhalb dieser Gruppe",
	legendBefore: "gepunktet: vor der Änderung (zu einer gelöschten Datei)",
	outsideImporters: (n: number) => `+${fmt(n)} außerhalb`,
	outsideImportersTitle: (n: number) =>
		`${plural(n, "unveränderte Datei importiert", "unveränderte Dateien importieren")} diese Datei`,
	groupSeen: (seen: number, total: number) => `${fmt(seen)}/${fmt(total)} gesehen`,
	tooltipImports: "importiert",
	tooltipImportedBy: "wird importiert von",
	tooltipNone: "keine Verbindung auf dieser Ebene",
	tooltipMore: (n: number) => `und ${fmt(n)} weitere`,
	tooltipOpenGroup: "Klick: eine Ebene tiefer",
	tooltipOpenFile: "Klick: Datei öffnen",
	edgeTitle: (count: number, typeOnly: boolean) =>
		`${plural(count, "Import", "Importe")}${typeOnly ? ", nur Typen" : ""}`,
	cycleMark: "Zyklus",
	contextHidden: (n: number) =>
		`${plural(n, "Nachbargruppe", "Nachbargruppen")} ohne Verbindung ausgeblendet`,
	mapCut: "Nicht alles im Blick: ziehen, zoomen oder „Einpassen“",
	beforeChange: "vor der Änderung (eine Seite ist gelöscht)",
	emptyLevel: "Hier ist keine Datei der gewählten Kategorien.",
	mapEmpty: "Keine Datei in den gewählten Kategorien.",

	// File page
	fileNotFound: "Diese Datei gibt es in diesem Stand nicht.",
	fileNotFoundHint: (path: string, sha: string) => `${path} fehlt im Commit ${sha}.`,
	toMap: "Zur Karte",
	viewedToggle: "Gesehen",
	prevFile: "Vorherige Datei",
	nextFile: "Nächste Datei",
	showOnMap: "Auf der Karte zeigen",
	pathNav: "Ordner der Datei",
	copyPath: "Pfad kopieren",
	copied: "Kopiert",
	copyFailed: "Kopieren nicht möglich: der Browser gibt die Zwischenablage nicht frei.",
	chapter: "Kapitel",
	renamedFrom: "umbenannt von",
	newFile: "neue Datei",
	deletedFile: "Gelöschte Datei: gezeigt wird der alte Stand.",
	unchangedHint: "Gehört nicht zu den Änderungen; nur zum Nachlesen.",
	excludedHint: (category: string) =>
		`Geändert, aber ausgeschlossen (${category}); nur zum Nachlesen.`,
	binaryFile: (size: string) => `Binärdatei (${size}): kein Text anzuzeigen.`,
	truncatedFile: (lines: number) =>
		`Zu groß zum Hervorheben: gezeigt werden die ersten ${fmt(lines)} Zeilen als reiner Text.`,
	emptyFile: "Die Datei ist leer.",
	bytes: (n: number) =>
		n < 1024
			? `${fmt(n)} B`
			: n < 1024 * 1024
				? `${fmt(Math.round(n / 1024))} KB`
				: `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`,

	// Neighbourhood
	neighbourhood: "Zusammenhang",
	importsColumn: (n: number) =>
		n === 0
			? "importiert keine Datei des Repositorys"
			: `importiert ${plural(n, "Datei", "Dateien")}`,
	importersColumn: (n: number) =>
		n === 0
			? "wird von keiner Datei importiert"
			: `wird von ${plural(n, "Datei", "Dateien")} importiert`,
	noExtractor: "Für diesen Dateityp werden keine Importe gelesen; keine Datei importiert ihn.",
	moreUnchanged: (n: number) => `+ ${fmt(n)} unveränderte`,
	moreExcluded: (n: number) => `+ ${fmt(n)} ausgeschlossene`,
	fewer: "weniger zeigen",
	packages: "Pakete",
	unresolved: "nicht aufgelöst",
	excluded: (category: string) => `${category}, ausgeschlossen`,
	importKind: {
		value: "Wert",
		"re-export": "Re-Export",
		dynamic: "dynamisch",
		"side-effect": "nur Seiteneffekt",
		type: "nur Typen",
	} satisfies Record<ImportKind, string>,
	names: (names: string[]) => (names.length === 0 ? "keine Namen" : names.join(", ")),
	openAtLine: (line: number) => `öffnen bei Zeile ${fmt(line)}`,

	// Code
	modeLabel: "Ansicht des Codes",
	modeFull: "Ganze Datei",
	modeChanges: "Nur Änderungen",
	showRemoved: "Entferntes zeigen",
	wrap: "Umbruch",
	prevChange: "Vorherige Änderung",
	nextChange: "Nächste Änderung",
	changeOf: (i: number, n: number) => `${fmt(i)} von ${fmt(n)}`,
	changes: (n: number) => plural(n, "Änderung", "Änderungen"),
	folded: (n: number) => `… ${plural(n, "unveränderte Zeile", "unveränderte Zeilen")}`,
	importLink: (target: string) => `Zu ${target}`,
	removedLines: (n: number) => plural(n, "Zeile entfernt", "Zeilen entfernt"),
} as const;

/** The label of a category id: the review's own label, else the word for a built-in id, else the id. */
export function categoryLabel(
	categories: readonly { id: string; label?: string }[],
	id: string,
): string {
	return categories.find((c) => c.id === id)?.label ?? S.category[id] ?? id;
}

/** `ReviewMeta` with every word filled in: category labels and the rest chapter's title. */
export type NamedMeta = Omit<ReviewMeta, "categories" | "chapters"> & {
	categories: { id: string; label: string; defaultVisible: boolean }[];
	chapters: { id: string; title: string; summary?: string }[];
};

export function withWords(meta: ReviewMeta): NamedMeta {
	return {
		...meta,
		categories: meta.categories.map((c) => ({
			...c,
			label: categoryLabel(meta.categories, c.id),
		})),
		chapters: meta.chapters.map((c) => ({ ...c, title: c.title ?? S.restChapter })),
	};
}
