/**
 * One-command project bootstrap for the asset anchors framework.
 *
 * `omp asset init` runs the full three-step setup on a new project:
 *   1. `codegraph init` — build the code graph index (skipped if present).
 *   2. Write a default `omp.assets.json` (never overwrites an existing one).
 *   3. Install the git guard hooks.
 *
 * Idempotent: re-running is a safe no-op on already-set-up projects.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { installGitHooks } from "./git-hooks";
import { ASSET_MANIFEST_FILENAME, assetManifestPath, loadAssetManifest } from "./index";

/** Default manifest written to a fresh project. */
export const DEFAULT_MANIFEST: string = `{
	"schemaVersion": 1,
	"assets": [
		{
			"id": "code-graph",
			"type": "code",
			"path": ".codegraph",
			"refreshPolicy": "watch",
			"guard": {
				"command": "test -f .codegraph/codegraph.db",
				"trigger": "pre-write"
			}
		},
		{
			"id": "architecture-docs",
			"type": "archDoc",
			"path": "docs",
			"guard": {
				"command": "test -f docs/ARCHITECTURE.md",
				"trigger": "pre-write"
			}
		}
	]
}
`;

/** Outcome of a full init run. */
export interface InitResult {
	/** Whether the code graph index was built (false = already present). */
	indexBuilt: boolean;
	/** Whether a default manifest was written (false = already existed). */
	manifestWritten: boolean;
	/** Whether guard hooks were installed. */
	hooksInstalled: string[];
	/** Guard commands collected from the (existing or default) manifest. */
	guardCommands: string[];
	/** Warnings (e.g. missing guard). */
	warnings: string[];
}

/**
 * Run the full three-step init. Returns the outcome. Throws when a required
 * step fails (e.g. codegraph unavailable).
 */
export async function runAssetInit(
	projectRoot: string,
	options: { codegraphPath?: string; includeDriftCheck?: boolean } = {},
): Promise<InitResult> {
	const warnings: string[] = [];
	const codegraphPath = options.codegraphPath ?? "codegraph";

	// Step 1: build the code graph index (idempotent — skip if present).
	const indexExists = fs.existsSync(path.join(projectRoot, ".codegraph", "codegraph.db"));
	let indexBuilt = false;
	if (!indexExists) {
		let exit: number;
		try {
			const proc = Bun.spawn([codegraphPath, "init"], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
			exit = await proc.exited;
		} catch {
			throw new Error(
				`codegraph init failed — could not run "${codegraphPath}". Install it with: npm i -g @colbymchenry/codegraph`,
			);
		}
		if (exit !== 0) {
			throw new Error(`codegraph init failed (exit ${exit}). Install it with: npm i -g @colbymchenry/codegraph`);
		}
		indexBuilt = true;
	}

	// Step 2: write the default manifest (never overwrite an existing one).
	const manifestPath = assetManifestPath(projectRoot);
	let manifestWritten = false;
	if (!fs.existsSync(manifestPath)) {
		fs.writeFileSync(manifestPath, DEFAULT_MANIFEST);
		manifestWritten = true;
	} else {
		warnings.push(`${ASSET_MANIFEST_FILENAME} already exists — left unchanged`);
	}

	// Step 3: install guard hooks from the manifest.
	const manifest = await loadAssetManifest(projectRoot);
	const guardCommands = manifest.assets.filter(a => a.guard?.trigger === "pre-write").map(a => a.guard!.command);
	const hooksInstalled = installGitHooks(projectRoot, guardCommands, {
		includeDriftCheck: options.includeDriftCheck,
	});

	return { indexBuilt, manifestWritten, hooksInstalled, guardCommands, warnings };
}
