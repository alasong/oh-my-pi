import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { DEFAULT_MANIFEST, runAssetInit } from "../src/asset-anchors/init";

const tmpDirs: string[] = [];

function makeRepo(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-init-"));
	tmpDirs.push(dir);
	fs.mkdirSync(path.join(dir, ".git"));
	fs.mkdirSync(path.join(dir, ".git", "hooks"), { recursive: true });
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

/** A fake `codegraph` that just creates the index db and exits 0. */
function makeFakeCodegraph(projectRoot: string): string {
	const bin = path.join(projectRoot, "fake-codegraph");
	const script = `#!/bin/sh
mkdir -p .codegraph
touch .codegraph/codegraph.db
exit 0
`;
	fs.writeFileSync(bin, script, { mode: 0o755 });
	return bin;
}

describe("runAssetInit", () => {
	test("builds index, writes manifest, installs hooks on a fresh project", async () => {
		const dir = makeRepo();
		const cg = makeFakeCodegraph(dir);

		const result = await runAssetInit(dir, { codegraphPath: cg });
		expect(result.indexBuilt).toBe(true);
		expect(result.manifestWritten).toBe(true);
		expect(result.hooksInstalled).toEqual(["pre-commit", "post-commit"]);
		expect(fs.existsSync(path.join(dir, "omp.assets.json"))).toBe(true);
		expect(fs.existsSync(path.join(dir, ".git", "hooks", "pre-commit"))).toBe(true);
	});

	test("does not overwrite an existing manifest", async () => {
		const dir = makeRepo();
		const cg = makeFakeCodegraph(dir);
		fs.writeFileSync(path.join(dir, "omp.assets.json"), '{"schemaVersion":1,"assets":[]}');

		const result = await runAssetInit(dir, { codegraphPath: cg });
		expect(result.manifestWritten).toBe(false);
		expect(result.warnings.some(w => w.includes("already exists"))).toBe(true);
		expect(fs.readFileSync(path.join(dir, "omp.assets.json"), "utf-8")).toBe('{"schemaVersion":1,"assets":[]}');
	});

	test("is idempotent — re-running skips index and hooks", async () => {
		const dir = makeRepo();
		const cg = makeFakeCodegraph(dir);
		await runAssetInit(dir, { codegraphPath: cg });

		const second = await runAssetInit(dir, { codegraphPath: cg });
		expect(second.indexBuilt).toBe(false);
		expect(second.manifestWritten).toBe(false);
		expect(second.hooksInstalled).toEqual([]);
	});

	test("collects guard commands from the written manifest", async () => {
		const dir = makeRepo();
		const cg = makeFakeCodegraph(dir);
		const result = await runAssetInit(dir, { codegraphPath: cg });
		expect(result.guardCommands.length).toBeGreaterThan(0);
		expect(result.guardCommands[0]).toContain(".codegraph");
	});

	test("throws when codegraph is unavailable", async () => {
		const dir = makeRepo();
		await expect(runAssetInit(dir, { codegraphPath: "/nonexistent/codegraph" })).rejects.toThrow(
			/codegraph init failed/,
		);
	});
});

describe("DEFAULT_MANIFEST", () => {
	test("is valid JSON with schemaVersion and assets", () => {
		const parsed = JSON.parse(DEFAULT_MANIFEST);
		expect(parsed.schemaVersion).toBe(1);
		expect(Array.isArray(parsed.assets)).toBe(true);
		expect(parsed.assets.length).toBeGreaterThan(0);
	});
});
