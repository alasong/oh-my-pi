/**
 * Project asset anchor types.
 *
 * A unified record for every project asset (code graph, architecture docs,
 * tests, guards, memory, context). Injection, guarding, and freshness all
 * derive from a declarative `omp.assets.json` manifest. See
 * `docs/local/project-asset-anchors.md` for the framework design.
 */

/** Asset kinds the framework understands. */
export type AssetType = "code" | "archDoc" | "test" | "archGuard" | "qualityGuard" | "memory" | "context";

/** How an asset's freshness is maintained. */
export type RefreshPolicy = "watch" | "scheduled" | "event-driven";

/** Guard check: a command to run plus its lifecycle trigger point. */
export interface AssetGuard {
	/** Shell command that validates the asset. */
	command: string;
	/** Lifecycle point at which the guard fires. */
	trigger: "pre-write" | "post-write";
}

/** A single declared project asset. */
export interface Asset {
	/** Stable identifier within the project. */
	id: string;
	/** Asset kind. */
	type: AssetType;
	/** Location of the asset (file, dir, or index path). */
	path: string;
	/** Optional content version (hash). */
	version?: string;
	/** Freshness anchor (commit hash or timestamp). */
	anchor?: string;
	/** How freshness is maintained. */
	refreshPolicy?: RefreshPolicy;
	/** Guard check mounted onto the pre/post write hooks. */
	guard?: AssetGuard;
}

/** Declarative manifest at the project root. */
export interface AssetManifest {
	/** Manifest schema version. */
	schemaVersion: number;
	/** Declared assets. */
	assets: Asset[];
}
