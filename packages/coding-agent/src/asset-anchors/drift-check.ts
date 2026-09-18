/**
 * Description drift check.
 *
 * Scans `archDoc` assets for code symbols referenced in function-call style
 * (`identifier()`), verifies each still exists in the codegraph index, and
 * reports missing ones. A symbol that vanished from the code while its docs
 * still reference it is drift — the docs describe something that no longer
 * exists. Alignment rule: `archDoc` follows `code`; a drifted doc must be
 * updated, and this check surfaces exactly that.
 *
 * An `archDoc` asset path may be a single document or a directory (the
 * framework's default is `docs`); directories are expanded to their `.md`
 * files recursively before scanning.
 *
 * A symbol the graph reports missing is confirmed against the working tree:
 * the index can miss symbols surfaced through generated declaration files, and
 * only a symbol absent from the code entirely counts as drift.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { GrepOutputMode, grep } from "@oh-my-pi/pi-natives";

/**
 * Matches `identifier()` references (function-call style) in doc text.
 * Excludes method calls (`obj.method()`), qualified calls (`pkg.func()`,
 * `Type::method()`), and library calls — only bare top-level symbol
 * references are drift-checkable against the code graph.
 */
const SYMBOL_REF_RE = /(?<![.\w:])([A-Za-z_][A-Za-z0-9_]*)\s*\(\)/g;

/**
 * Lines that introduce an illustrative or foreign example (`e.g. vLLM's
 * foo()`), where a call-shaped name is not a reference to live code.
 */
const EXAMPLE_LINE_RE = /(?:^|[^A-Za-z])(?:e\.g\.|i\.e\.|for example|for instance|such as)|例如|比如|譬如/i;

/**
 * Documentation placeholder names (`getAllFoo`, bare `foo`). These appear in
 * prose examples and never name real symbols.
 */
const PLACEHOLDER_SYMBOL_RE = /^(?:foo|bar|baz|qux)$|(?:^|[a-z0-9])(?:Foo|Bar|Baz|Qux)(?:[A-Z0-9]|$)/;

/**
 * Test and fixture paths. The working-tree fallback looks for implementation
 * only: a name that survives solely inside a test or a fixture string does not
 * mean the symbol still exists.
 */
const TEST_PATH_RE = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Codegraph's response when a symbol does not exist. */
const NO_RESULTS = "No results found";

/**
 * Each existence check spawns a `codegraph` subprocess, which dominates the
 * runtime on large doc sets; run them with bounded concurrency.
 */
const SYMBOL_QUERY_CONCURRENCY = 16;

/** A single drift finding. */
export interface DriftFinding {
	/** Document path (relative to project root) that references the symbol. */
	doc: string;
	/** The missing symbol name. */
	symbol: string;
	/** Line number in the doc where the reference appears. */
	line: number;
}

/** A completed drift check. */
export interface DriftCheckResult {
	/** One entry per stale reference, in document order. */
	findings: DriftFinding[];
	/** Documents that could not be read (path issues), excluded from findings. */
	errors: string[];
}

/**
 * Extract `identifier()` symbol references from doc content with their line
 * numbers.
 */
export function extractSymbolRefs(content: string): Array<{ symbol: string; line: number }> {
	const refs: Array<{ symbol: string; line: number }> = [];
	const lines = content.split("\n");
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Track code-fence state; symbols inside ``` blocks are illustrative,
		// not references to live symbols.
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		if (EXAMPLE_LINE_RE.test(line)) continue;
		for (const m of line.matchAll(SYMBOL_REF_RE)) {
			const symbol = m[1];
			if (PLACEHOLDER_SYMBOL_RE.test(symbol)) continue;
			refs.push({ symbol, line: i + 1 });
		}
	}
	return refs;
}

/** Filter to unique symbols across all docs. */
export function uniqueSymbols(refs: Array<{ symbol: string; line: number }>): string[] {
	return [...new Set(refs.map(r => r.symbol))];
}

/**
 * Expand doc paths into a flat list of files. A file passes through; a
 * directory contributes its `.md` files recursively. Paths that cannot be
 * stat'd are passed through so the read loop reports them as errors.
 */
export function collectDocFiles(paths: string[]): string[] {
	const files: string[] = [];
	for (const p of paths) {
		let stat: fs.Stats;
		try {
			stat = fs.statSync(p);
		} catch {
			files.push(p);
			continue;
		}
		if (!stat.isDirectory()) {
			files.push(p);
			continue;
		}
		for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
			const child = path.join(p, entry.name);
			if (entry.isDirectory()) files.push(...collectDocFiles([child]));
			else if (entry.isFile() && entry.name.endsWith(".md")) files.push(child);
		}
	}
	return files;
}

/**
 * Check whether a symbol exists in the codegraph index. Returns `true` when
 * the symbol resolves, `false` when codegraph reports no results. Returns
 * `null` when codegraph is unavailable or the query fails (treated as
 * inconclusive, not drift).
 */
export async function symbolExists(
	codegraphPath: string,
	projectRoot: string,
	symbol: string,
): Promise<boolean | null> {
	const proc = Bun.spawn([codegraphPath, "query", symbol, "-p", projectRoot], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(proc.stdout).text();
	const exit = await proc.exited;
	if (exit !== 0) return null; // query error — inconclusive
	if (!stdout.includes(NO_RESULTS)) return true;
	// The graph can miss symbols that live in generated declaration files
	// (e.g. `Shell` methods surfaced through `index.d.ts`); confirm against the
	// working tree before reporting drift.
	return sourceMentionsSymbol(projectRoot, symbol);
}

/**
 * Whether the working tree mentions `symbol` outside of documentation. Used
 * when the code graph has no entry: a symbol present in source is not drift,
 * even if the index missed it.
 */
async function sourceMentionsSymbol(projectRoot: string, symbol: string): Promise<boolean> {
	try {
		const result = await grep({
			pattern: `\\b${symbol}\\b`,
			path: projectRoot,
			mode: GrepOutputMode.FilesWithMatches,
			maxCount: 100,
			timeoutMs: 10_000,
		});
		return result.matches.some(match => !match.path.endsWith(".md") && !TEST_PATH_RE.test(match.path));
	} catch {
		return false;
	}
}

/**
 * Run the drift check over a set of doc paths. Returns findings for symbols
 * referenced in docs but missing from the codegraph index.
 */
export async function runDriftCheck(
	docPaths: string[],
	options: { codegraphPath: string; projectRoot: string },
): Promise<DriftCheckResult> {
	const findings: DriftFinding[] = [];
	const errors: string[] = [];

	// Collect all symbol refs from readable docs.
	const allRefs: Array<{ symbol: string; line: number; doc: string }> = [];
	for (const doc of collectDocFiles(docPaths)) {
		let content: string;
		try {
			content = fs.readFileSync(doc, "utf-8");
		} catch {
			errors.push(doc);
			continue;
		}
		const rel = path.relative(options.projectRoot, doc);
		for (const ref of extractSymbolRefs(content)) {
			allRefs.push({ ...ref, doc: rel });
		}
	}

	// Check each unique symbol once. Every query spawns a `codegraph`
	// subprocess, so fan them out through a bounded worker pool instead of
	// awaiting one at a time.
	const unique = [...new Set(allRefs.map(r => r.symbol))];
	const missing = new Set<string>();
	let cursor = 0;
	await Promise.all(
		Array.from({ length: Math.min(SYMBOL_QUERY_CONCURRENCY, unique.length) }, async () => {
			while (cursor < unique.length) {
				const symbol = unique[cursor++];
				if ((await symbolExists(options.codegraphPath, options.projectRoot, symbol)) === false) {
					missing.add(symbol);
				}
			}
		}),
	);

	// Report every stale reference: hiding repeats of a missing symbol would
	// leave later occurrences unfixed.
	for (const ref of allRefs) {
		if (!missing.has(ref.symbol)) continue;
		findings.push({ doc: ref.doc, symbol: ref.symbol, line: ref.line });
	}

	return { findings, errors };
}
