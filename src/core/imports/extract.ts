/**
 * Extractors read the import statements of one file. They are a list: the first whose `test`
 * accepts a path handles it, so another language is one more entry in `DEFAULT_EXTRACTORS`.
 */
import ts from "typescript";
import type { ImportKind } from "../types";

export interface RawImport {
	specifier: string;
	/** 1-based line of the statement (of the call for `import()` / `require()`). */
	line: number;
	kind: ImportKind;
	/** Imported names: `default`, `*` for a namespace or `export *`, else the exported name. */
	names: string[];
}

export interface Extractor {
	/** Names the extractor and the shape of its output in the disk cache: bump it when that changes. */
	id: string;
	test(path: string): boolean;
	extract(path: string, code: string): RawImport[];
}

const TS_EXTENSIONS = /\.(?:[cm]?tsx?|[cm]?jsx?)$/;
/** Only files that contain one of these need the full tree walk for `import()` / `require()`. */
const CALL_HINT = /\bimport\s*\(|\brequire\s*\(/;

function scriptKind(path: string): ts.ScriptKind {
	if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
	if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
	return ts.ScriptKind.TS;
}

function nameText(name: ts.ModuleExportName): string {
	return name.text;
}

/** TypeScript and JavaScript through the TypeScript parser (`ts.createSourceFile`). */
export const typescriptExtractor: Extractor = {
	id: "typescript@1",
	test: (path) => TS_EXTENSIONS.test(path),
	extract(path, code) {
		const sf = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, false, scriptKind(path));
		const found: { pos: number; item: RawImport }[] = [];
		const add = (node: ts.Node, specifier: ts.Expression, kind: ImportKind, names: string[]) => {
			if (!ts.isStringLiteralLike(specifier)) return;
			const pos = node.getStart(sf);
			const line = sf.getLineAndCharacterOfPosition(pos).line + 1;
			found.push({ pos, item: { specifier: specifier.text, line, kind, names } });
		};

		for (const statement of sf.statements) {
			if (ts.isImportDeclaration(statement)) {
				const clause = statement.importClause;
				if (!clause) {
					add(statement, statement.moduleSpecifier, "side-effect", []);
					continue;
				}
				const names: string[] = [];
				let allTypes = clause.phaseModifier === ts.SyntaxKind.TypeKeyword;
				let anyValue = false;
				if (clause.name) {
					names.push("default");
					anyValue = true;
				}
				const bindings = clause.namedBindings;
				if (bindings && ts.isNamespaceImport(bindings)) {
					names.push("*");
					anyValue = true;
				} else if (bindings) {
					for (const element of bindings.elements) {
						names.push(nameText(element.propertyName ?? element.name));
						if (!element.isTypeOnly) anyValue = true;
					}
				}
				if (!allTypes && !anyValue && names.length > 0) allTypes = true; // import { type A, type B }
				const kind: ImportKind = allTypes ? "type" : names.length === 0 ? "side-effect" : "value";
				add(statement, statement.moduleSpecifier, kind, names);
			} else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
				const clause = statement.exportClause;
				if (!clause || ts.isNamespaceExport(clause)) {
					add(statement, statement.moduleSpecifier, statement.isTypeOnly ? "type" : "re-export", [
						"*",
					]);
					continue;
				}
				const names = clause.elements.map((e) => nameText(e.propertyName ?? e.name));
				const allTypes =
					statement.isTypeOnly ||
					(clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly));
				add(statement, statement.moduleSpecifier, allTypes ? "type" : "re-export", names);
			} else if (
				ts.isImportEqualsDeclaration(statement) &&
				ts.isExternalModuleReference(statement.moduleReference)
			) {
				// import x = require("y")
				add(
					statement,
					statement.moduleReference.expression,
					statement.isTypeOnly ? "type" : "value",
					["*"],
				);
			}
		}

		if (CALL_HINT.test(code)) {
			const visit = (node: ts.Node): void => {
				if (ts.isCallExpression(node)) {
					const [first] = node.arguments;
					if (first && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
						add(node, first, "dynamic", []);
					} else if (
						first &&
						node.arguments.length === 1 &&
						ts.isIdentifier(node.expression) &&
						node.expression.text === "require"
					) {
						add(node, first, "value", []);
					}
				} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
					// typeof import("x") / import("x").Name in a type position
					const qualifier = node.qualifier;
					const names = qualifier ? [leftmost(qualifier)] : ["*"];
					add(node, node.argument.literal, "type", names);
				}
				ts.forEachChild(node, visit);
			};
			visit(sf);
		}

		found.sort((a, b) => a.pos - b.pos);
		return found.map((f) => f.item);
	},
};

function leftmost(name: ts.EntityName): string {
	return ts.isIdentifier(name) ? name.text : leftmost(name.left);
}

/** `@import "x";` / `@import url(x);` in CSS. */
export const cssExtractor: Extractor = {
	id: "css@1",
	test: (path) => /\.(?:css|scss|less)$/.test(path),
	extract(_path, code) {
		const text = blankComments(code);
		const out: RawImport[] = [];
		const pattern =
			/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')/g;
		for (const match of text.matchAll(pattern)) {
			const specifier = match.slice(1).find((group) => group !== undefined);
			if (!specifier) continue;
			const line = countLines(text, match.index);
			out.push({ specifier, line, kind: "side-effect", names: [] });
		}
		return out;
	},
};

/** Replaces `/* … *\/` comments with spaces, keeping newlines, so offsets and lines stay valid. */
function blankComments(code: string): string {
	return code.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function countLines(text: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
	return line;
}

export const DEFAULT_EXTRACTORS: readonly Extractor[] = [typescriptExtractor, cssExtractor];

export function extractorFor(
	extractors: readonly Extractor[],
	path: string,
): Extractor | undefined {
	return extractors.find((e) => e.test(path));
}
