import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ASSET_MANIFEST_FILENAME, loadAssetManifest } from "../src/asset-anchors/index";

const tmpDirs: string[] = [];

function makeProjectRoot(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-anchors-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

const SAMPLE_MANIFEST = {
	schemaVersion: 1,
	assets: [
		{
			id: "code-graph",
			type: "code",
			path: ".codegraph",
			refreshPolicy: "watch",
			guard: { command: "codegraph explore probe -p .", trigger: "pre-write" },
		},
		{
			id: "architecture-docs",
			type: "archDoc",
			path: "docs",
			refreshPolicy: "scheduled",
		},
	],
};

describe("loadAssetManifest", () => {
	test("parses a valid manifest and keeps declared assets", async () => {
		const root = makeProjectRoot();
		fs.writeFileSync(path.join(root, ASSET_MANIFEST_FILENAME), JSON.stringify(SAMPLE_MANIFEST));

		const manifest = await loadAssetManifest(root);
		expect(manifest.schemaVersion).toBe(1);
		expect(manifest.assets).toHaveLength(2);
		expect(manifest.assets[0]).toMatchObject({ id: "code-graph", type: "code", path: ".codegraph" });
		expect(manifest.assets[0].guard).toEqual({ command: "codegraph explore probe -p .", trigger: "pre-write" });
		expect(manifest.assets[1]).toMatchObject({
			id: "architecture-docs",
			type: "archDoc",
			refreshPolicy: "scheduled",
		});
	});

	test("returns an empty manifest when the file is absent", async () => {
		const root = makeProjectRoot();
		const manifest = await loadAssetManifest(root);
		expect(manifest).toEqual({ schemaVersion: 1, assets: [] });
	});

	test("rejects an unknown asset type", async () => {
		const root = makeProjectRoot();
		fs.writeFileSync(
			path.join(root, ASSET_MANIFEST_FILENAME),
			JSON.stringify({ schemaVersion: 1, assets: [{ id: "x", type: "notAType", path: "y" }] }),
		);
		await expect(loadAssetManifest(root)).rejects.toThrow(/type must be one of/);
	});

	test("rejects a missing id", async () => {
		const root = makeProjectRoot();
		fs.writeFileSync(
			path.join(root, ASSET_MANIFEST_FILENAME),
			JSON.stringify({ schemaVersion: 1, assets: [{ type: "code", path: "y" }] }),
		);
		await expect(loadAssetManifest(root)).rejects.toThrow(/id must be a non-empty string/);
	});

	test("rejects a non-array assets field", async () => {
		const root = makeProjectRoot();
		fs.writeFileSync(path.join(root, ASSET_MANIFEST_FILENAME), JSON.stringify({ schemaVersion: 1, assets: "oops" }));
		await expect(loadAssetManifest(root)).rejects.toThrow(/assets must be an array/);
	});

	test("rejects an invalid guard trigger", async () => {
		const root = makeProjectRoot();
		fs.writeFileSync(
			path.join(root, ASSET_MANIFEST_FILENAME),
			JSON.stringify({
				schemaVersion: 1,
				assets: [{ id: "x", type: "archGuard", path: "y", guard: { command: "echo", trigger: "mid-write" } }],
			}),
		);
		await expect(loadAssetManifest(root)).rejects.toThrow(/guard\.trigger must be one of/);
	});
});
