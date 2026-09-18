/**
 * `omp asset` — manage project asset anchors.
 *
 * Actions:
 *   init           one-command bootstrap (index + manifest + hooks)
 *   install-hooks  install git guard hooks from omp.assets.json
 *   uninstall-hooks  remove hooks this tool wrote
 *   check-drift    detect archDoc references to vanished code symbols
 *
 * Reads the project's `omp.assets.json`, collects the declared guards
 * (`guard.trigger = "pre-write"`), and writes `.git/hooks/pre-commit`
 * (architecture/quality checks) plus `post-commit` (codegraph incremental
 * refresh). Idempotent; `--uninstall` removes only hooks this tool wrote.
 */

import { getProjectDir } from "@oh-my-pi/pi-utils";
import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { runDriftCheck } from "../asset-anchors/drift-check";
import { installGitHooks, uninstallGitHooks } from "../asset-anchors/git-hooks";
import { loadAssetManifest } from "../asset-anchors/index";
import { runAssetInit } from "../asset-anchors/init";
import { assetHelp as commandHelp } from "../cli/command-help";

export default class Asset extends Command {
	static description = commandHelp.description;

	static args = {
		action: Args.string({
			description: 'Action: "init", "install-hooks", "uninstall-hooks", or "check-drift"',
			required: true,
		}),
	};

	static flags = {
		"dry-run": Flags.boolean({ description: "Show what would be written without writing" }),
		"with-drift-check": Flags.boolean({
			description: "Also run `omp asset check-drift` in pre-commit",
		}),
		"warn-only": Flags.boolean({
			description: "check-drift: report findings without failing (exit 0)",
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Asset);
		const { action } = args;
		const { "dry-run": dryRun, "with-drift-check": withDriftCheck, "warn-only": warnOnly } = flags;
		const projectRoot = getProjectDir();

		if (action === "init") {
			if (dryRun) {
				console.log("Would: build code graph index, write omp.assets.json (if absent), install guard hooks");
				return;
			}
			const result = await runAssetInit(projectRoot, { includeDriftCheck: withDriftCheck });
			for (const w of result.warnings) console.warn(`  ⚠ ${w}`);
			console.log(result.indexBuilt ? "✓ Built code graph index" : "  Code graph index already present (skipped)");
			console.log(
				result.manifestWritten ? "✓ Wrote omp.assets.json" : "  omp.assets.json already exists (left unchanged)",
			);
			console.log(
				result.hooksInstalled.length > 0
					? `✓ Installed guard hooks: ${result.hooksInstalled.join(", ")}`
					: "  Guard hooks already installed",
			);
			return;
		}

		if (action === "install-hooks") {
			const manifest = await loadAssetManifest(projectRoot);
			const guardCommands = manifest.assets.filter(a => a.guard?.trigger === "pre-write").map(a => a.guard!.command);
			const driftPaths = manifest.assets.filter(a => a.type === "archDoc").map(a => a.path);

			if (dryRun) {
				console.log(`Would install ${guardCommands.length} pre-write guard(s):`);
				for (const cmd of guardCommands) console.log(`  - ${cmd}`);
				console.log(`Would write: pre-commit, post-commit${withDriftCheck ? " (with drift check)" : ""}`);
				return;
			}

			const written = installGitHooks(projectRoot, guardCommands, { includeDriftCheck: withDriftCheck, driftPaths });
			console.log(
				written.length > 0
					? `Installed asset guard hooks: ${written.join(", ")}`
					: "Asset guard hooks already installed (idempotent no-op)",
			);
			if (guardCommands.length === 0) {
				console.log("No pre-write guards declared in omp.assets.json");
			}
			return;
		}

		if (action === "uninstall-hooks") {
			const removed = dryRun ? ["pre-commit", "post-commit"] : uninstallGitHooks(projectRoot);
			console.log(
				removed.length > 0 ? `Removed asset guard hooks: ${removed.join(", ")}` : "No asset guard hooks to remove",
			);
			return;
		}

		if (action === "check-drift") {
			const manifest = await loadAssetManifest(projectRoot);
			const archDocs = manifest.assets.filter(a => a.type === "archDoc");
			if (archDocs.length === 0) {
				console.log("No archDoc assets declared in omp.assets.json");
				return;
			}

			const docPaths = archDocs.map(a => `${projectRoot}/${a.path}`);
			const { findings, errors } = await runDriftCheck(docPaths, {
				codegraphPath: "codegraph",
				projectRoot,
			});

			for (const e of errors) console.warn(`  ⚠ could not read: ${e}`);
			if (findings.length === 0) {
				console.log("No drift: all referenced symbols exist in the code graph");
				return;
			}
			for (const f of findings) {
				console.log(`  ✗ ${f.doc}:${f.line} references missing symbol \`${f.symbol}\``);
			}
			if (warnOnly) {
				console.log(
					`\n${findings.length} drift finding(s) — docs reference symbols that may no longer exist (warning only).`,
				);
				return;
			}
			console.log(`\n${findings.length} drift finding(s) — docs reference symbols that no longer exist.`);
			process.exit(1);
		}

		console.error(`Unknown action: ${action} (expected install-hooks | uninstall-hooks | check-drift)`);
		process.exit(1);
	}
}
