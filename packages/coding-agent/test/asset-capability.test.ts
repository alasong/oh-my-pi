import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { loadCapability } from "../src/capability/index";
import "../src/discovery/index";

const tmpDirs: string[] = [];

function makeProject(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-capability-"));
	tmpDirs.push(dir);
	return dir;
}

function writeManifest(root: string, manifest: unknown): void {
	fs.writeFileSync(path.join(root, "omp.assets.json"), JSON.stringify(manifest));
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("asset capability", () => {
	test("loadCapability('assets') loads assets from the manifest", async () => {
		const root = makeProject();
		writeManifest(root, {
			schemaVersion: 1,
			assets: [
				{ id: "code-graph", type: "code", path: ".codegraph", refreshPolicy: "watch" },
				{ id: "architecture-docs", type: "archDoc", path: "docs", refreshPolicy: "scheduled" },
			],
		});

		const result = await loadCapability("assets", {
			cwd: root,
			home: os.homedir(),
			repoRoot: null,
		});
		expect(result.items).toHaveLength(2);
		const codeAsset = result.items.find(a => a.id === "code-graph");
		expect(codeAsset).toBeDefined();
		expect(codeAsset.type).toBe("code");
		expect(codeAsset.absolutePath).toBe(path.join(root, ".codegraph"));
		expect(codeAsset._source.level).toBe("project");
	});

	test("returns empty items with a warning when the manifest is malformed", async () => {
		const root = makeProject();
		writeManifest(root, { schemaVersion: 1, assets: "broken" });

		const result = await loadCapability("assets", {
			cwd: root,
			home: os.homedir(),
			repoRoot: null,
		});
		expect(result.items).toHaveLength(0);
		expect(result.warnings?.join(" ")).toContain("omp.assets.json");
	});

	test("returns empty items when no manifest exists", async () => {
		const root = makeProject();
		const result = await loadCapability("assets", {
			cwd: root,
			home: os.homedir(),
			repoRoot: null,
		});
		expect(result.items).toHaveLength(0);
	});
});
