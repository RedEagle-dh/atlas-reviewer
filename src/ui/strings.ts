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

/** The end of "Nicht gespeichert: …" when the range has new commits; said in two places. */
const RANGE_MOVED = "der Code hat sich geändert (neue Commits).";

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
	theme: { system: "Wie das System", light: "Hell", dark: "Dunkel" },
	themeToggle: (current: string) => `Farbschema: ${current} (wechseln)`,
	sidebarShow: "Seitenleiste zeigen",
	sidebarHide: "Seitenleiste ausblenden",
	/** What a screen reader hears for the sidebar as a sheet (narrow windows). */
	sidebarTitle: "Seitenleiste",
	sidebarDescription: "Bereich, Kapitel und Dateien des Reviews.",
	skipFiles: "Dateiliste überspringen",

	// Sidebar
	tabChapters: "Kapitel",
	tabFolders: "Ordner",
	chapterProgress: (seen: number, total: number) => `${fmt(seen)}/${fmt(total)}`,
	chapterOnMap: "Kapitel auf der Karte zeigen",
	folderOnMap: "Ordner auf der Karte zeigen",
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
	minimap: "Minikarte",
	nodeKeys: "Enter oder Leertaste: öffnen",

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

	// Comments
	comments: "Kommentare",
	commentCount: (n: number) => plural(n, "Kommentar", "Kommentare"),
	/** Where a comment points: a line, a range of lines, or (without a line) the whole file. */
	place: (line?: number, endLine?: number) =>
		line === undefined
			? "Ganze Datei"
			: endLine === undefined || endLine === line
				? `Zeile ${fmt(line)}`
				: `Zeilen ${fmt(line)}–${fmt(endLine)}`,
	/** What a screen reader hears for a comment or its text field: `place` in a sentence. */
	commentOn: (line?: number, endLine?: number) =>
		line === undefined
			? "Kommentar zur ganzen Datei"
			: endLine === undefined || endLine === line
				? `Kommentar zu Zeile ${fmt(line)}`
				: `Kommentar zu den Zeilen ${fmt(line)}–${fmt(endLine)}`,
	commentLine: (line: number) => `Zeile ${fmt(line)} kommentieren`,
	commentFile: "Datei kommentieren",
	/**
	 * The tooltip of "Datei kommentieren", followed by the key `c`: the key comments the line a
	 * link points at when there is one, and the whole file otherwise.
	 */
	commentFileHint: (line?: number) =>
		line === undefined
			? "Die ganze Datei kommentieren"
			: `Die ganze Datei kommentieren. Zeile ${fmt(line)} kommentieren:`,
	fileComments: "Kommentare zur Datei",
	commentPlaceholder:
		"Auftrag oder Frage an den Coding-Agenten, z. B. „Fehlerfall behandeln“ oder „Warum wird hier zweimal geladen?“",
	commentSubmit: "Kommentieren",
	commentSave: "Speichern",
	cancel: "Abbrechen",
	submitShortcut: (mac: boolean) => (mac ? "⌘↵" : "Strg ↵"),
	commentEdit: "Bearbeiten",
	commentDelete: "Löschen",
	commentDeleted: "Kommentar gelöscht",
	undo: "Rückgängig",
	/** These three are followed by why: `whyFailed`. */
	commentNotSaved: (why: string) => `Nicht gespeichert: ${why}`,
	commentNotDeleted: (why: string) => `Nicht gelöscht: ${why}`,
	commentNotRestored: (why: string) => `Nicht wiederhergestellt: ${why}`,
	/**
	 * Why a request about a comment failed: in the reader's words when the range has moved on or
	 * no answer came at all (the browser's own word for that is "Failed to fetch"), else what the
	 * server said.
	 */
	whyFailed: (failure: { message: string; moved: boolean; answered: boolean } | null) =>
		failure === null
			? ""
			: failure.moved
				? RANGE_MOVED
				: failure.answered
					? failure.message
					: "der Server antwortet nicht. Läuft er noch?",
	/** A new comment that was refused because of it: the composer keeps the text. */
	commentMoved: `Nicht gespeichert: ${RANGE_MOVED} Stelle prüfen und erneut senden.`,
	/** Esc is pressed in a field that holds text: why nothing happened. */
	escKeepsText: "Esc schließt nur ein leeres Feld. „Abbrechen“ verwirft den Text.",
	escKeepsEdit: "Esc schließt nur ohne Änderung. „Abbrechen“ verwirft sie.",
	commentOutdated: "Code seitdem geändert",
	commentOutdatedHint:
		"Die Zeilen lauten nicht mehr wie beim Kommentieren. Der Prompt zitiert sie so, wie sie damals waren.",
	commentGoneHint:
		"Diese Zeilen gibt es in der Datei nicht mehr. Der Prompt zitiert sie so, wie sie damals waren.",
	commentsOpen: (n: number) =>
		n === 0 ? "Kommentare öffnen" : `Kommentare öffnen (${plural(n, "Kommentar", "Kommentare")})`,
	commentsHint: "Sammlung für den Coding-Agenten: als Prompt kopieren und ihm geben.",
	tabList: "Liste",
	tabPrompt: "Prompt",
	promptLabel: "Prompt für den Coding-Agenten",
	copyPrompt: "Als Prompt kopieren",
	promptCopied: (n: number) => `Prompt mit ${plural(n, "Kommentar", "Kommentaren")} kopiert`,
	copyByHand: (mac: boolean) =>
		`Der Browser gibt die Zwischenablage nicht frei. Der Prompt ist markiert: mit ${mac ? "⌘C" : "Strg+C"} kopieren.`,
	clearComments: "Alle löschen",
	clearTitle: (n: number) =>
		n === 1 ? "Den Kommentar löschen?" : `Alle ${fmt(n)} Kommentare löschen?`,
	clearHint: "Das lässt sich nicht rückgängig machen.",
	noComments: "Noch keine Kommentare",
	noCommentsHint:
		"Im Code auf das + neben einer Zeilennummer klicken; für die ganze Datei „Datei kommentieren“ über dem Code wählen oder c drücken. Ein Kommentar ist ein Auftrag oder eine Frage an den Coding-Agenten.",
	commentsNotLoaded: "Die Kommentare wurden nicht geladen.",
	commentUnsaved: "Ein Kommentar ist noch in Arbeit: erst speichern oder abbrechen.",
	close: "Schließen",
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
