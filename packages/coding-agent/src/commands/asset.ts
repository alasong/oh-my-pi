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
import { installGitHooks, uninstallGitHooks } from "../asset-anchors/git-hooks";
import { loadAssetManifest } from "../asset-anchors/index";
import { assetHelp as commandHelp } from "../cli/command-help";

export default class Asset extends Command {
	static description = commandHelp.description;

	static args = {
		action: Args.string({
			description: 'Action: "install-hooks" or "uninstall-hooks"',
			required: true,
		}),
	};

	static flags = {
		"dry-run": Flags.boolean({ description: "Show what would be written without writing" }),
	};

	async run(): Promise<void> {
		const { action } = this.args;
		const { "dry-run": dryRun } = this.flags;
		const projectRoot = getProjectDir();

		if (action === "install-hooks") {
			const manifest = await loadAssetManifest(projectRoot);
			const guardCommands = manifest.assets.filter(a => a.guard?.trigger === "pre-write").map(a => a.guard!.command);

			if (dryRun) {
				console.log(`Would install ${guardCommands.length} pre-write guard(s):`);
				for (const cmd of guardCommands) console.log(`  - ${cmd}`);
				console.log("Would write: pre-commit, post-commit");
				return;
			}

			const written = installGitHooks(projectRoot, guardCommands);
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

		console.error(`Unknown action: ${action} (expected install-hooks | uninstall-hooks)`);
		process.exit(1);
	}
}
