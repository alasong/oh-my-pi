# Fork divergence policy

This repository is a fork of [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi).
It carries product-facing changes that upstream does not have. Every upstream sync is a
merge of a fast-moving tree (13,676 upstream commits in the three months to 2026-09-09),
so the cost of carrying each change is proportional to **how much of the upstream tree it
touches and how volatile that tree is**. This document is the policy that keeps that cost
low, plus the measurements behind it.

The normative summary is `/.omp/RULES.md`, which is a sticky always-apply rule: omp
re-injects it near every turn, so it applies automatically to any session in this repo
(including RPD-driven work) without being requested.

## Measured divergence surface

Basis: fork `main` @ `4c150c8da1`, upstream/main @ `2e6b5b79a0` (2026-09-09), merge base
`2e6b5b79a0`.

| Metric | Value |
|---|---|
| Commits ahead of upstream | 26 |
| Commits behind upstream | 0 |
| Files changed vs merge base | 35 |
| Lines added / removed | +2295 / −47 |

The shape matters more than the size: 30 of the 35 are new files, and the fork has deleted
only 47 lines upstream-wide. Divergence is already concentrated in additive, isolatable
code — this policy exists to keep it that way.

## The placement ladder

When implementing anything in this fork, choose the highest level that works.

### 1. New isolated file or module (preferred)

A new module, command, capability, or test conflicts with nothing. This is how the fork's
largest feature is carried: the entire project-asset-anchor framework lives in
`packages/coding-agent/src/asset-anchors/` plus a handful of one-line registrations.

A new capability reaches the rest of the system through **registration points** — a line in
`cli-commands.ts`, an entry in `discovery/index.ts`, a `capability/*.ts` module. Those are
the cheapest possible upstream edits: one or two additive lines each, no existing-line
modification, at filenames with low upstream churn.

### 2. Setting-gated edit

When an upstream file genuinely must change behavior, wrap the change in a setting whose
default preserves upstream behavior exactly. Then an upstream refactor of that file only
has to reconcile a small, self-contained block.

Existing patterns to copy:

- `bash.cdFollowsShell` — gates `!cd` migrating the omp project directory (default off:
  upstream behavior).
- `bash.lineDisplay` — selects line-based streaming output (default off: upstream behavior).

Both live in `packages/coding-agent/src/config/settings-schema.ts`. That file is a hotspot
(232 upstream commits in three months), so the added block MUST stay self-contained and
additive so the merge tool has an easy time.

### 3. Optional injection

When upstream code must call fork logic, add the dependency as an **optional** parameter or
field rather than changing an upstream signature. An optional member accepts the default and
leaves upstream call sites compiling and behaving identically.

Pattern: `StreamingRevealController.getLineDisplay` — optional on the controller, so upstream
construction paths that do not supply it keep working, and the fork's path supplies it.

A signature change, by contrast, forces every upstream call site to be touched by the fork —
guaranteed conflict, and a fork-side rewrite of code upstream may be actively editing.

### 4. Inline edit (last resort)

Sometimes a one-line change is genuinely the right call. It MUST still be surgical:

- Additive only, touching the fewest existing lines.
- No reformatting, no import reordering, no comment reflow in the surrounding region.
- Never a whole-file formatter pass over an upstream file.

## Conflict hotspot inventory

Upstream churn measured with
`git rev-list --count --since=2026-06-01 upstream/main -- <file>`; fork delta measured
against the merge base. Volatility rank is what makes a file risky — a single added line in
a file upstream rewrites weekly is more expensive than 170 lines in a file upstream ignores.

| File | Fork Δ | Upstream commits (3 mo) | Risk |
|---|---|---|---|
| `packages/coding-agent/CHANGELOG.md` | +20 | 5593 | Medium — appends are cheap, but `bun run release` rewrites sections |
| `src/config/settings-schema.ts` | +22 | 232 | **High** — high churn, keep the block self-contained |
| `src/modes/controllers/event-controller.ts` | +1 | 147 | Medium — one line, but the file moves constantly |
| `src/modes/controllers/command-controller.ts` | +6 / −1 | 76 | **High** — high churn and it deletes an upstream line |
| `src/cli-commands.ts` | +5 | 14 | Low |
| `src/cli/command-help.ts` | +4 | 13 | Low |
| `src/modes/controllers/streaming-reveal.ts` | +177 / −15 | 7 | Low now — upstream rarely touches it; high blast radius if it does |
| `src/discovery/index.ts` | +3 | 5 | Low — registration lines |
| `src/modes/components/bash-execution.ts` | +58 / −12 | 4 | Low now — see above |

Rule of thumb: **volatility × fork delta** is the carrying cost. `settings-schema.ts` and
`command-controller.ts` are where a careless change hurts most.

## Zero-conflict inventory (new files)

Carried at no merge cost — new files, or new files inside upstream directories:

- `src/asset-anchors/` (`index.ts`, `drift-check.ts`, `git-hooks.ts`, `init.ts`, `types.ts`)
- `src/capability/asset.ts`, `src/commands/asset.ts`, `src/discovery/asset-manifest.ts`
- `packages/coding-agent/scripts/install-omp.sh`
- `omp.assets.json`, `.omp/mcp.json`
- `docs/local/project-asset-anchors.md`, `docs/local/fork-divergence.md` (this file)
- `test/asset-anchors.test.ts`, `test/asset-capability.test.ts`,
  `test/asset-drift-check.test.ts`, `test/asset-git-hooks.test.ts`, `test/asset-init.test.ts`

Prefer extending this list over growing the hotspot table.

## Sync SOP

1. `git fetch upstream`.
2. Branch a backup: `git branch backup/pre-sync-$(date +%F)`.
3. `git merge upstream/main`.
4. Resolve conflicts file by file:
   - Keep **upstream's** structure, refactors, renames, and formatting.
   - Re-apply the **fork's gated delta** onto the new upstream shape — usually the setting
     block, the registration line, or the optional injection point.
   - NEVER resolve with `--ours` / a fork-side whole-file copy. That silently reverts
     upstream work and re-introduces it as a fresh divergence at the next sync.
5. Re-derive the hotspot table above; upstream volatility moves.
6. Run the incremental tests covering every conflicted file (per the testing policy in
   `AGENTS.md` — do not run the whole suite).
7. If the native addon version sentinel changed, rebuild before shipping a binary.
8. Push to the fork remote only: `git push alasong main`.

## Review checklist

Before committing a fork change, confirm:

- [ ] Could this be a new file instead of an edit to an upstream file?
- [ ] If an upstream file changed: is the new behavior behind a setting whose default is the
      upstream behavior?
- [ ] Did any upstream function signature change? (If yes: make the dependency optional.)
- [ ] Is the diff free of incidental reformatting, import reordering, and comment reflow?
- [ ] Are `CHANGELOG` edits confined to `## [Unreleased]`?
- [ ] Is fork-only prose in a new file rather than an in-place upstream doc rewrite?
- [ ] Does the hotspot table need updating, or a new file added to the zero-conflict list?
