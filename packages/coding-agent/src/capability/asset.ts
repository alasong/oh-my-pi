/**
 * Asset Anchors Capability
 *
 * Declarative project assets (code graph, architecture docs, tests, guards,
 * memory, context) discovered from `omp.assets.json`. Injection, guarding, and
 * freshness all derive from the manifest; see
 * `docs/project-asset-anchors.md` for the framework design.
 */

import type { Asset } from "../asset-anchors/types";
import { defineCapability } from ".";
import type { SourceMeta } from "./types";

/** An asset anchor item loaded from the manifest. */
export interface AssetItem extends Asset {
	/** Absolute path resolved against the project root. */
	absolutePath: string;
	/** Source metadata. */
	_source: SourceMeta;
}

export const assetCapability = defineCapability<AssetItem>({
	id: "assets",
	displayName: "Asset Anchors",
	description: "Declarative project assets (code/archDoc/test/guards/memory/context) from omp.assets.json",
	key: asset => `${asset.type}:${asset.id}`,
	toExtensionId: asset => `asset:${asset.type}:${asset.id}`,
	validate: (asset: AssetItem) => {
		if (!asset.id) return "Missing id";
		if (!asset.type) return "Missing type";
		if (!asset.path) return "Missing path";
		return undefined;
	},
});
