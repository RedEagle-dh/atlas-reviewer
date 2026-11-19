import { describe, expect, test } from "bun:test";
import { createMatcher } from "./glob";

const matchGlob = (glob: string, path: string) => createMatcher([glob])(path);

describe("one glob", () => {
	test("`*` stays inside one segment", () => {
		expect(matchGlob("*.md", "README.md")).toBe(true);
		expect(matchGlob("*.md", "docs/README.md")).toBe(false);
		expect(matchGlob("src/*.ts", "src/a.ts")).toBe(true);
		expect(matchGlob("src/*.ts", "src/x/a.ts")).toBe(false);
	});

	test("a leading `**/` matches zero or more directories", () => {
		expect(matchGlob("**/*.test.*", "a.test.ts")).toBe(true);
		expect(matchGlob("**/*.test.*", "apps/api/src/a.test.ts")).toBe(true);
		expect(matchGlob("**/drizzle/**", "drizzle/0001.sql")).toBe(true);
		expect(matchGlob("**/drizzle/**", "packages/db/drizzle/meta/_journal.json")).toBe(true);
		expect(matchGlob("**/drizzle/**", "packages/db/drizzle.config.ts")).toBe(false);
	});

	test("a middle `**` matches zero or more directories", () => {
		expect(matchGlob("a/**/b.ts", "a/b.ts")).toBe(true);
		expect(matchGlob("a/**/b.ts", "a/x/y/b.ts")).toBe(true);
		expect(matchGlob("a/**/b.ts", "ab.ts")).toBe(false);
	});

	test("a trailing `/**` matches everything below, but not the directory name itself", () => {
		expect(matchGlob("docs/**", "docs/a.md")).toBe(true);
		expect(matchGlob("docs/**", "docs/x/y/a.md")).toBe(true);
		expect(matchGlob("docs/**", "docs")).toBe(false);
		expect(matchGlob("docs/**", "documents/a.md")).toBe(false);
	});

	test("`**` inside a segment acts like `*`", () => {
		expect(matchGlob("a**.ts", "abc.ts")).toBe(true);
		expect(matchGlob("a**.ts", "a/b.ts")).toBe(false);
	});

	test("`?` matches exactly one character other than `/`", () => {
		expect(matchGlob("file?.ts", "file1.ts")).toBe(true);
		expect(matchGlob("file?.ts", "file.ts")).toBe(false);
		expect(matchGlob("a?b", "a/b")).toBe(false);
	});

	test("braces match one alternative; alternatives may hold globs and nest", () => {
		expect(matchGlob("**/*.{png,jpg}", "img/a.jpg")).toBe(true);
		expect(matchGlob("**/*.{png,jpg}", "img/a.gif")).toBe(false);
		expect(matchGlob("{src,lib}/**/*.ts", "lib/x/a.ts")).toBe(true);
		expect(matchGlob("a.{t{s,sx},js}", "a.tsx")).toBe(true);
		expect(matchGlob("a.{t{s,sx},js}", "a.js")).toBe(true);
		expect(matchGlob("a.{t{s,sx},js}", "a.t")).toBe(false);
		expect(matchGlob("{**/x,y}/z", "a/b/x/z")).toBe(true);
	});

	test("an unterminated brace is a literal", () => {
		expect(matchGlob("a{b", "a{b")).toBe(true);
		expect(matchGlob("a{b", "ab")).toBe(false);
	});

	test("regular-expression characters are literal", () => {
		expect(matchGlob("a+b(c).ts", "a+b(c).ts")).toBe(true);
		expect(matchGlob("a.ts", "abts")).toBe(false);
		expect(matchGlob("[x].ts", "[x].ts")).toBe(true);
		expect(matchGlob("$x^.ts", "$x^.ts")).toBe(true);
	});

	test("a backslash escapes the next character", () => {
		expect(matchGlob("a\\*.ts", "a*.ts")).toBe(true);
		expect(matchGlob("a\\*.ts", "ab.ts")).toBe(false);
	});

	test("a dot is ordinary: `*` matches dotfiles", () => {
		expect(matchGlob("**/.*", ".gitignore")).toBe(true);
		expect(matchGlob("**/.*", "apps/api/.env.example")).toBe(true);
		expect(matchGlob("**/*", ".env")).toBe(true);
	});

	test("a leading `./` of the pattern is ignored; matching is anchored", () => {
		expect(matchGlob("./src/a.ts", "src/a.ts")).toBe(true);
		expect(matchGlob("src/a.ts", "x/src/a.ts")).toBe(false);
		expect(matchGlob("src", "src/a.ts")).toBe(false);
	});

	test("paths with spaces and non-ASCII characters", () => {
		expect(matchGlob("**/*.ts", "my dir/ümlaut file.ts")).toBe(true);
		expect(matchGlob("my dir/*", "my dir/a b")).toBe(true);
	});
});

describe("createMatcher", () => {
	test("true when any glob matches; false for an empty list", () => {
		const match = createMatcher(["**/*.md", "docs/**"]);
		expect(match("a/b.md")).toBe(true);
		expect(match("docs/x.txt")).toBe(true);
		expect(match("src/x.ts")).toBe(false);
		expect(createMatcher([])("anything")).toBe(false);
	});
});
