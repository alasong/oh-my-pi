/**
 * Asset manifest parsing and validation.
 *
 * Reads the declarative `omp.assets.json` at the project root and validates it.
 * The manifest is the source of truth. Adding a new asset dimension is adding a
 * manifest entry, not writing code.
 */
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";

import type { Asset, AssetManifest, AssetType } from "./types";

/** Default manifest filename at the project root. */
export const ASSET_MANIFEST_FILE = "omp.assets.json";

/** Valid asset type names, used to reject unknown types at parse time. */
const VALID_TYPES: Record<string, true> = {
	code: true,
	archDoc: true,
	test: true,
	archGuard: true,
	qualityGuard: true,
	memory: true,
	context: true,
};

const VALID_REFRESH_POLICIES: Record<string, true> = {
	watch: true,
	scheduled: true,
	"event-driven": true,
};

const VALID_TRIGGERS: Record<string, true> = {
	"pre-write": true,
	"post-write": true,
};

export type { Asset, AssetManifest, AssetType, RefreshPolicy } from "./types";
export { ASSET_MANIFEST_FILE as ASSET_MANIFEST_FILENAME };

/** Locate the manifest path relative to a project root. */
export function assetManifestPath(projectRoot: string): string {
	return path.join(projectRoot, ASSET_MANIFEST_FILE);
}

/**
 * Load and validate the asset manifest. Returns an empty manifest when the
 * file does not exist (no assets declared); throws on malformed content.
 */
export async function loadAssetManifest(projectRoot: string): Promise<AssetManifest> {
	const manifestPath = assetManifestPath(projectRoot);
	let content: string;
	try {
		content = await Bun.file(manifestPath).text();
	} catch (error) {
		if (isEnoent(error)) return { schemaVersion: 1, assets: [] };
		throw error;
	}

	const parsed = JSON.parse(content) as unknown;
	const manifest = validateManifest(parsed, manifestPath);
	return manifest;
}

/** Validate a parsed manifest, throwing on structural or enum violations. */
export function validateManifest(parsed: unknown, source: string): AssetManifest {
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error(`Invalid asset manifest at ${source}: expected an object`);
	}
	const record = parsed as Record<string, unknown>;

	const schemaVersion = record.schemaVersion;
	if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
		throw new Error(`Invalid asset manifest at ${source}: schemaVersion must be a positive integer`);
	}
	if (!Array.isArray(record.assets)) {
		throw new Error(`Invalid asset manifest at ${source}: assets must be an array`);
	}

	const assets = record.assets.map((entry, index) => validateAsset(entry, index, source));
	return { schemaVersion, assets };
}

function validateAsset(entry: unknown, index: number, source: string): Asset {
	if (typeof entry !== "object" || entry === null) {
		throw new Error(`Invalid asset manifest at ${source}: asset[${index}] must be an object`);
	}
	const a = entry as Record<string, unknown>;

	if (typeof a.id !== "string" || a.id.length === 0) {
		throw new Error(`Invalid asset manifest at ${source}: asset[${index}] id must be a non-empty string`);
	}
	if (typeof a.type !== "string" || !VALID_TYPES[a.type]) {
		throw new Error(
			`Invalid asset manifest at ${source}: asset[${index}] type must be one of ${Object.keys(VALID_TYPES).join(", ")}`,
		);
	}
	if (typeof a.path !== "string" || a.path.length === 0) {
		throw new Error(`Invalid asset manifest at ${source}: asset[${index}] path must be a non-empty string`);
	}

	const asset: Asset = { id: a.id, type: a.type as AssetType, path: a.path };

	if (a.version !== undefined) {
		if (typeof a.version !== "string") {
			throw new Error(`Invalid asset manifest at ${source}: asset[${index}].version must be a string`);
		}
		asset.version = a.version;
	}
	if (a.anchor !== undefined) {
		if (typeof a.anchor !== "string") {
			throw new Error(`Invalid asset manifest at ${source}: asset[${index}].anchor must be a string`);
		}
		asset.anchor = a.anchor;
	}
	if (a.refreshPolicy !== undefined) {
		if (typeof a.refreshPolicy !== "string" || !VALID_REFRESH_POLICIES[a.refreshPolicy]) {
			throw new Error(
				`Invalid asset manifest at ${source}: asset[${index}].refreshPolicy must be one of ${Object.keys(VALID_REFRESH_POLICIES).join(", ")}`,
			);
		}
		asset.refreshPolicy = a.refreshPolicy as Asset["refreshPolicy"];
	}
	if (a.guard !== undefined) {
		if (typeof a.guard !== "object" || a.guard === null) {
			throw new Error(`Invalid asset manifest at ${source}: asset[${index}].guard must be an object`);
		}
		const g = a.guard as Record<string, unknown>;
		if (typeof g.command !== "string" || g.command.length === 0) {
			throw new Error(
				`Invalid asset manifest at ${source}: asset[${index}].guard.command must be a non-empty string`,
			);
		}
		if (typeof g.trigger !== "string" || !VALID_TRIGGERS[g.trigger]) {
			throw new Error(
				`Invalid asset manifest at ${source}: asset[${index}].guard.trigger must be one of ${Object.keys(VALID_TRIGGERS).join(", ")}`,
			);
		}
		asset.guard = { command: g.command, trigger: g.trigger as "pre-write" | "post-write" };
	}

	return asset;
}
