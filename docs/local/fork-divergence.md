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

Basis: fork working tree @ `2026-09-19` (6 commits ahead of the previous basis),
upstream/main @ 59 commits ahead of the fork's tip, merge base `a2d83061c5`.

| Metric | Value |
|---|---|
| Commits ahead of upstream | 6 |
| Commits behind upstream | 59 |
| Files changed vs merge base | 47 |
| Lines added / removed | +2974 / −80 |

The shape matters more than the size: 23 of the 47 are new files, and the fork has deleted
only 80 lines upstream-wide. Divergence is already concentrated in additive, isolatable
code — this policy exists to keep it that way.

Re-measured 2026-09-19, counting the uncommitted context/efficiency work of that day.
Upstream has since moved 59 commits ahead, so the merge base is now older than the fork's
tip: expect these numbers to move again at the next sync.

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
- `bash.expectedNonZeroExitAsWarning` — classifies a command's normal negative exit
  (`grep` no match, `diff` differences, …) as a warning instead of an error (default off:
  upstream error-only classification).
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
| `src/config/settings-schema.ts` | +44 | 266 | **High** — high churn, keep the block self-contained |
| `src/tools/bash.ts` | +38 / −5 | 76 | **High** — high churn; the fork's delta is one opt-in flag read plus one condition, keep it that way |
| `src/prompts/system/system-prompt.md` | +1 / −1 | 49 | Medium — a single in-place line, but the prompt is edited often |
| `src/tools/output-meta.ts` | +22 / −6 | 34 | Medium — the read exception is three lines plus comments |
| `src/tools/hub/types.ts` | +7 | 17 | Low — one additive optional field |
| `src/tools/hub/index.ts` | +28 / −2 | 12 | Low |
| `packages/agent/src/compaction/prompts/compaction-summary.md` | +3 / −1 | 1 | Low |
| `src/modes/controllers/event-controller.ts` | +1 | 147 | Medium — one line, but the file moves constantly |
| `src/modes/controllers/command-controller.ts` | +6 / −1 | 76 | **High** — high churn and it deletes an upstream line |
| `src/cli-commands.ts` | +5 | 14 | Low |
| `src/cli/command-help.ts` | +4 | 13 | Low |
| `src/modes/controllers/streaming-reveal.ts` | +177 / −15 | 7 | Low now — upstream rarely touches it; high blast radius if it does |
| `src/discovery/index.ts` | +3 | 5 | Low — registration lines |
| `src/modes/components/bash-execution.ts` | +58 / −12 | 4 | Low now — see above |

Rule of thumb: **volatility × fork delta** is the carrying cost. `settings-schema.ts` and
`command-controller.ts` are where a careless change hurts most.

### Measured sync conflict set (2026-09-19)

`git merge-tree --write-tree --name-only <tree> upstream/main` — actual conflicts, not estimates:

| Tree | Conflicting files |
|---|---|
| `main` as committed | `packages/tui/src/chat/bash-execution.ts` |
| working tree (`git stash create`) | that, plus `src/tools/bash.ts`, `src/tools/hub/index.ts`, `src/tools/hub/types.ts` |

Every other touched file auto-merges, `settings-schema.ts` (+44) included.

`bash-execution.ts` is the one substantive conflict and it is a **rename conflict**: upstream
`0d6dbd32fc` moved it out of this package to `packages/tui/src/chat/`. Port the fork's delta onto
upstream's file; never keep the fork's copy. Per-commit worth and the drop candidates are in
`docs/local/fork-commit-audit.md`.

## Zero-conflict inventory (new files)

Carried at no merge cost — new files, or new files inside upstream directories:

- `src/tools/bash-exit-semantics.ts` (the exit-status classifier the `bash.expectedNonZeroExitAsWarning` flag reads)
- `src/asset-anchors/` (`index.ts`, `drift-check.ts`, `git-hooks.ts`, `init.ts`, `types.ts`)
- `src/capability/asset.ts`, `src/commands/asset.ts`, `src/discovery/asset-manifest.ts`
- `packages/coding-agent/scripts/install-omp.sh`
- `omp.assets.json`, `.omp/mcp.json`
- `docs/local/project-asset-anchors.md`, `docs/local/fork-divergence.md` (this file),
  `docs/local/context-efficiency.md`, `docs/local/fork-commit-audit.md`
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
