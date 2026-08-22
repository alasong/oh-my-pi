/**
 * Description drift check.
 *
 * Scans `archDoc` assets for code symbols referenced in function-call style
 * (`identifier()`), verifies each still exists in the codegraph index, and
 * reports missing ones. A symbol that vanished from the code while its docs
 * still reference it is drift — the docs describe something that no longer
 * exists. Alignment rule: `archDoc` follows `code`; a drifted doc must be
 * updated, and this check surfaces exactly that.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Matches `identifier()` references (function-call style) in doc text.
 * Excludes method calls (`obj.method()`), namespace-qualified calls
 * (`pkg.func()`), and library calls — only bare top-level symbol references
 * are drift-checkable against the code graph.
 */
const SYMBOL_REF_RE = /(?<![.\w])([A-Za-z_][A-Za-z0-9_]*)\s*\(\)/g;

/** Codegraph's response when a symbol does not exist. */
const NO_RESULTS = "No results found";

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
	/** Missing symbols, grouped by doc. */
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
		for (const m of line.matchAll(SYMBOL_REF_RE)) {
			refs.push({ symbol: m[1], line: i + 1 });
		}
	}
	return refs;
}

/** Filter to unique symbols across all docs. */
export function uniqueSymbols(refs: Array<{ symbol: string; line: number }>): string[] {
	return [...new Set(refs.map(r => r.symbol))];
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
	return !stdout.includes(NO_RESULTS);
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
	for (const doc of docPaths) {
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

	// Check each unique symbol once (dedupe across docs).
	const seen = new Set<string>();
	for (const ref of allRefs) {
		if (seen.has(ref.symbol)) continue;
		seen.add(ref.symbol);
		const exists = await symbolExists(options.codegraphPath, options.projectRoot, ref.symbol);
		if (exists === false) {
			findings.push({ doc: ref.doc, symbol: ref.symbol, line: ref.line });
		}
	}

	return { findings, errors };
}
