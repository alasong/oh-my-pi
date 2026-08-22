/**
 * Asset Manifest Provider
 *
 * Loads declarative project assets from `omp.assets.json` into the asset
 * anchors capability. Each asset becomes an AssetItem with its path resolved
 * against the project root.
 */
import * as path from "node:path";
import { loadAssetManifest } from "../asset-anchors/index";
import type { AssetManifest } from "../asset-anchors/types";
import { registerProvider } from "../capability";
import { type AssetItem, assetCapability } from "../capability/asset";
import type { LoadContext, LoadResult } from "../capability/types";
import { createSourceMeta } from "./helpers";

const PROVIDER_ID = "asset-manifest";
const DISPLAY_NAME = "Asset Manifest";
const DESCRIPTION = "Load project assets from omp.assets.json";

/**
 * Load assets declared in the project's `omp.assets.json`. Returns an empty
 * item list (with a warning) when the manifest is missing or malformed.
 */
export async function loadAssetManifestItems(ctx: LoadContext): Promise<LoadResult<AssetItem>> {
	const root = ctx.repoRoot ?? ctx.cwd;
	const warnings: string[] = [];

	let manifest: AssetManifest;
	try {
		manifest = await loadAssetManifest(root);
	} catch (error) {
		warnings.push(`Failed to load omp.assets.json: ${error instanceof Error ? error.message : String(error)}`);
		return { items: [], warnings };
	}

	const items = manifest.assets.map(asset => {
		const absolutePath = path.resolve(root, asset.path);
		return {
			...asset,
			absolutePath,
			_source: createSourceMeta(PROVIDER_ID, absolutePath, "project"),
		};
	});

	return { items, warnings };
}

registerProvider(assetCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: DESCRIPTION,
	priority: 50,
	load: loadAssetManifestItems,
});
