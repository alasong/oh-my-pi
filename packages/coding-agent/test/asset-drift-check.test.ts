import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { extractSymbolRefs, runDriftCheck, symbolExists, uniqueSymbols } from "../src/asset-anchors/drift-check";

const tmpDirs: string[] = [];

function makeTmp(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drift-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * A fake `codegraph` binary: exits 0 and prints "Search Results" when the
 * queried symbol is in the allowlist, else "No results found".
 */
function makeFakeCodegraph(projectRoot: string, existing: string[]): string {
	const script = `#!/bin/sh
case "$2" in
  ${existing.map(s => `"${s}") echo "Search Results for ${s}"; exit 0 ;;`).join("\n  ")}
  *) echo "No results found"; exit 0 ;;
esac
`;
	const bin = path.join(projectRoot, "fake-codegraph");
	fs.writeFileSync(bin, script, { mode: 0o755 });
	return bin;
}

describe("extractSymbolRefs", () => {
	test("extracts function-call style references with line numbers", () => {
		const content = "Call executeBash() here.\nAnother line with runInteractiveBashPty() too.";
		const refs = extractSymbolRefs(content);
		expect(refs).toEqual([
			{ symbol: "executeBash", line: 1 },
			{ symbol: "runInteractiveBashPty", line: 2 },
		]);
	});

	test("ignores code fences", () => {
		const content = "```\nnotARealRef()\n```\nrealRef()";
		const refs = extractSymbolRefs(content);
		expect(refs.map(r => r.symbol)).toEqual(["realRef"]);
	});

	test("does not match config keys without parens", () => {
		const content = "Use `bash.patterns` and `cwd`.";
		expect(extractSymbolRefs(content)).toEqual([]);
	});

	test("excludes method calls and namespace-qualified calls", () => {
		const content = "Call desktop.focusedWindow() and pyplot.get_fignums() and bareFunc().";
		const refs = extractSymbolRefs(content);
		expect(refs.map(r => r.symbol)).toEqual(["bareFunc"]);
	});
});

describe("uniqueSymbols", () => {
	test("dedupes symbols across refs", () => {
		expect(
			uniqueSymbols([
				{ symbol: "a", line: 1 },
				{ symbol: "b", line: 2 },
				{ symbol: "a", line: 3 },
			]),
		).toEqual(["a", "b"]);
	});
});

describe("symbolExists", () => {
	test("returns true when codegraph finds the symbol", async () => {
		const dir = makeTmp();
		const bin = makeFakeCodegraph(dir, ["executeBash"]);
		expect(await symbolExists(bin, dir, "executeBash")).toBe(true);
	});

	test("returns false when codegraph reports no results", async () => {
		const dir = makeTmp();
		const bin = makeFakeCodegraph(dir, ["executeBash"]);
		expect(await symbolExists(bin, dir, "goneSymbol")).toBe(false);
	});
});

describe("runDriftCheck", () => {
	test("reports symbols referenced in docs but missing from the graph", async () => {
		const dir = makeTmp();
		const bin = makeFakeCodegraph(dir, ["liveFunc"]);
		fs.writeFileSync(path.join(dir, "arch.md"), "Uses liveFunc() and deadFunc().");

		const result = await runDriftCheck([path.join(dir, "arch.md")], { codegraphPath: bin, projectRoot: dir });
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]).toMatchObject({ symbol: "deadFunc", doc: "arch.md", line: 1 });
		expect(result.errors).toEqual([]);
	});

	test("returns no findings when all referenced symbols exist", async () => {
		const dir = makeTmp();
		const bin = makeFakeCodegraph(dir, ["liveFunc"]);
		fs.writeFileSync(path.join(dir, "arch.md"), "Uses liveFunc() only.");

		const result = await runDriftCheck([path.join(dir, "arch.md")], { codegraphPath: bin, projectRoot: dir });
		expect(result.findings).toHaveLength(0);
	});

	test("collects unreadable docs into errors", async () => {
		const dir = makeTmp();
		const bin = makeFakeCodegraph(dir, []);
		const result = await runDriftCheck([path.join(dir, "missing.md")], { codegraphPath: bin, projectRoot: dir });
		expect(result.errors).toContain(path.join(dir, "missing.md"));
	});
});
