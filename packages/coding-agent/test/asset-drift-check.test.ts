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

	test("excludes ::-qualified calls", () => {
		const content = "Guess with ImageReader::with_guessed_format() then decodePixels().";
		expect(extractSymbolRefs(content).map(r => r.symbol)).toEqual(["decodePixels"]);
	});

	test("ignores example lines and placeholder names", () => {
		const content = [
			"An old getAllFoo() may be replaced by a default.",
			"The id is server-generated (e.g. vLLM's make_tool_call_id()).",
			"Probes swallow lookup errors via isApiKeyAvailable().",
		].join("\n");
		expect(extractSymbolRefs(content).map(r => r.symbol)).toEqual(["isApiKeyAvailable"]);
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

	test("treats a symbol present in source as not drift", async () => {
		const dir = makeTmp();
		const bin = makeFakeCodegraph(dir, []);
		fs.writeFileSync(path.join(dir, "arch.md"), "Uses helperThing() in the pipeline.");
		fs.writeFileSync(path.join(dir, "impl.ts"), "export function helperThing() {}");

		const result = await runDriftCheck([path.join(dir, "arch.md")], { codegraphPath: bin, projectRoot: dir });
		expect(result.findings).toEqual([]);
	});

	test("does not count a match inside a test file as source", async () => {
		const dir = makeTmp();
		const bin = makeFakeCodegraph(dir, []);
		fs.mkdirSync(path.join(dir, "test"), { recursive: true });
		fs.writeFileSync(path.join(dir, "arch.md"), "Uses onlyInTests().");
		fs.writeFileSync(path.join(dir, "test", "fixture.test.ts"), "const x = 'onlyInTests()';");

		const result = await runDriftCheck([path.join(dir, "arch.md")], { codegraphPath: bin, projectRoot: dir });
		expect(result.findings.map(f => f.symbol)).toEqual(["onlyInTests"]);
	});

	test("reports every stale reference, not just the first", async () => {
		const dir = makeTmp();
		const bin = makeFakeCodegraph(dir, []);
		fs.writeFileSync(path.join(dir, "a.md"), "Uses deadFunc().");
		fs.writeFileSync(path.join(dir, "b.md"), "Also uses deadFunc().");

		const docs = [path.join(dir, "a.md"), path.join(dir, "b.md")];
		const result = await runDriftCheck(docs, { codegraphPath: bin, projectRoot: dir });
		expect(result.findings.map(f => f.doc)).toEqual(["a.md", "b.md"]);
	});

	test("expands a directory path to its .md files", async () => {
		const dir = makeTmp();
		const bin = makeFakeCodegraph(dir, ["liveFunc"]);
		const docsDir = path.join(dir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "arch.md"), "Uses deadFunc().");
		fs.writeFileSync(path.join(docsDir, "notes.txt"), "Uses txtOnlyDead().");

		const result = await runDriftCheck([docsDir], { codegraphPath: bin, projectRoot: dir });
		expect(result.errors).toEqual([]);
		expect(result.findings.map(f => f.symbol)).toEqual(["deadFunc"]);
	});
});
