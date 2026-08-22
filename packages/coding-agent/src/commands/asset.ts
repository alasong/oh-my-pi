/**
 * `omp asset install-hooks` — install asset guard git hooks.
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
import { assetHelp as commandHelp } from "../cli/command-help";

export default class Asset extends Command {
	static description = commandHelp.description;

	static args = {
		action: Args.string({
			description: 'Action: "install-hooks", "uninstall-hooks", or "check-drift"',
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
		const { action } = this.args;
		const { "dry-run": dryRun, "with-drift-check": withDriftCheck, "warn-only": warnOnly } = this.flags;
		const projectRoot = getProjectDir();

		if (action === "install-hooks") {
			const manifest = await loadAssetManifest(projectRoot);
			const guardCommands = manifest.assets.filter(a => a.guard?.trigger === "pre-write").map(a => a.guard!.command);

			if (dryRun) {
				console.log(`Would install ${guardCommands.length} pre-write guard(s):`);
				for (const cmd of guardCommands) console.log(`  - ${cmd}`);
				console.log(`Would write: pre-commit, post-commit${withDriftCheck ? " (with drift check)" : ""}`);
				return;
			}

			const written = installGitHooks(projectRoot, guardCommands, { includeDriftCheck: withDriftCheck });
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
