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

Basis: fork `main` @ `2026-09-19`, immediately after the 73-commit sync of that day
(merge `e6aee161c7`); upstream/main @ `78b753124d` (`18.2.6`). The merge base **is**
upstream's tip, so the fork is current.

| Metric | Value |
|---|---|
| Commits ahead of upstream | 10 |
| Commits behind upstream | 0 |
| Files changed vs upstream | 54 |
| Lines added / removed | +3377 / −74 |

The shape matters more than the size: 26 of the 54 are new files and the fork deletes 0
upstream files, only 74 lines upstream-wide. Divergence is already concentrated in additive,
isolatable code — this policy exists to keep it that way.

`git diff --shortstat upstream/main main` reproduces the last two rows; re-measure at the
start of every sync, because upstream's tip moves under you. A useful audit is to diff the
*file list* of the intended fork delta against the post-merge one:

```
git diff --name-only <merge-base> <pre-sync fork HEAD> | sort > intended
git diff --name-only upstream/main | sort > actual
comm -23 intended actual   # fork changes that no longer survive — every hit should be a rename
```
Every surviving "lost" entry after the 2026-09-19 sync was a rename (the same three fork
changes re-homed into `packages/tui`), not a dropped feature.

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

All live in `packages/coding-agent/src/config/settings-schema.ts`. That file is a hotspot
(266 upstream commits in three months), so the added block MUST stay self-contained and
additive so the merge tool has an easy time.

### 2b. Host-pushed display preference (settings that live in `pi-tui`)

`packages/tui` is a library and MUST NOT import `@oh-my-pi/pi-coding-agent` settings. When a
fork-gated behavior lives in a component upstream has moved into `pi-tui`, the host resolves
the setting and *pushes* the value into a mutable preference object the component reads.

- Seam: `packages/tui/src/chat/display-preferences.ts` —
  `chatTranscriptDisplayPreferences` / `setChatTranscriptDisplayPreferences`.
- Host side: an entry in `SETTING_HOOKS` in `packages/coding-agent/src/config/settings.ts`.
  `#fireAllHooks()` runs at init and on reload, so schema defaults are pushed even when the
  user never overrides the setting.
- The tui-side default MUST be the upstream value, so the library renders identically with no
  host attached; any fork default belongs in the schema, not in `pi-tui`.

Pattern to copy: `bash.lineDisplay` → read back at render time rather than cached at
construction, so a live `/settings` edit repaints.

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
| `packages/coding-agent/CHANGELOG.md` | +11 | 5593 | Medium — appends are cheap, but `bun run release` rewrites sections |
| `src/config/settings-schema.ts` | +34 | 266 | **High** — high churn, keep the block self-contained |
| `src/tools/bash.ts` | +26 / −1 | 76 | **High** — high churn; the fork's delta is one opt-in flag read plus one condition, keep it that way |
| `src/prompts/system/system-prompt.md` | +1 / −1 | 49 | Medium — a single in-place line, but the prompt is edited often |
| `src/tools/output-meta.ts` | +22 / −6 | 34 | Medium — the read exception is three lines plus comments |
| `packages/coding-agent/src/tools/hub/index.ts` | +35 / −3 | 12 | Low — the wait plumbing; `hub/types.ts` now carries **no** fork delta (pure re-export), do not re-add one |
| `packages/agent/src/compaction/prompts/compaction-summary.md` | +3 / −1 | 1 | Low |
| `src/modes/controllers/event-controller.ts` | +1 | 147 | Medium — one line, but the file moves constantly |
| `src/modes/controllers/command-controller.ts` | +6 / −1 | 76 | **High** — high churn and it deletes an upstream line |
| `src/cli-commands.ts` | +5 | 14 | Low |
| `src/cli/command-help.ts` | +4 | 13 | Low |
| `src/modes/controllers/streaming-reveal.ts` | +177 / −15 | 7 | Low now — upstream rarely touches it; high blast radius if it does |
| `src/discovery/index.ts` | +3 | 5 | Low — registration lines |
| `packages/tui/src/chat/bash-execution.ts` | +57 / −12 | 3 | Low — upstream refactored this file once already; port the gated deltas, never the file |
| `packages/tui/src/chat/display-preferences.ts` | +7 | 1 | Low — additive preference fields only |
| `packages/tui/src/tools/bash.ts` | +12 / −4 | 3 | Low — one optional flag on `BashToolDetails` plus one warning branch |
| `packages/tui/src/tools/hub.ts` | +7 | 4 | Low — one additive optional field (`noEvent`) |
| `packages/coding-agent/src/config/settings.ts` | +5 | 89 | **High** — churny hook map; the delta is one additive `SETTING_HOOKS` entry |

Rule of thumb: **volatility × fork delta** is the carrying cost. `settings-schema.ts` and
`command-controller.ts` are where a careless change hurts most.

### Measured sync conflict set

The 2026-09-19 sync of 73 upstream commits (merge `e6aee161c7`) hit exactly four conflicts,
all of them the fork re-homing code upstream had moved into `packages/tui`:

| Conflicting file | Resolution |
|---|---|
| `packages/coding-agent/src/tools/hub/types.ts` | upstream (a pure re-export now); the `noEvent` field went to `packages/tui/src/tools/hub.ts` |
| `packages/coding-agent/src/tools/hub/index.ts` | upstream + re-applied `NO_EVENT_HINT` / `markNoEventResult` / the `windowExpired` flag |
| `packages/coding-agent/src/tools/bash.ts` | upstream + re-applied the `expectedNonZeroExit` classification; the renderer delta moved to `packages/tui/src/tools/bash.ts` |
| `packages/tui/src/chat/bash-execution.ts` | upstream + ported `lineDisplay` through the preference seam (level 2b) |

Everything else auto-merged, `settings-schema.ts` included.

This is the shape to expect while upstream keeps migrating renderers into `pi-tui`: the
conflicts are **rename conflicts**, and the fix is to port the fork's delta onto upstream's
file — never to keep the fork's copy, never to re-add the delta at the old path. Per-commit
worth and drop candidates are in `docs/local/fork-commit-audit.md`.

Three things bit on this sync and are worth checking first next time:

1. A fork test importing a moved module (here `@oh-my-pi/pi-coding-agent/modes/components/…`)
   only fails at `check:types`, never at merge time — move the test with the component.
2. A moved component loses its settings access. The delta is not "delete the settings read"
   but "route it through the host-pushed preference seam" (level 2b), and the host-side hook
   then needs its own test (`test/bash-display-preferences.test.ts`).
3. A host-pushed preference is **process-wide mutable state**, and `packages/tui` is run at
   `--parallel=4`. A tui-side test that flips one therefore races every sibling test that
   constructs the component (measured: `bash-execution-sixel.test.ts` failed with the mutating
   file in the same parallel batch and passed serially, 1/435). Mutating fork tests belong in
   the coding-agent native bucket (`--parallel=1`), not in the tui package.

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
- `test/bash-display-preferences.test.ts` (host-side: setting → preference → rendered preview)
- `packages/coding-agent/test/bash-execution-line-display.test.ts` — tests a `pi-tui`
  component from the host package on purpose: it flips the process-wide
  `chatTranscriptDisplayPreferences.lineDisplay`, and `packages/tui` is run at `--parallel=4`,
  so from there it raced every sibling bash test. The coding-agent native bucket runs at
  `--parallel=1`, which is where a global-state test belongs. The rest of the fork's
  bash-execution suite stayed in `packages/tui`.

Prefer extending this list over growing the hotspot table.

## Fork remote history was rewritten once (2026-09-18)

`alasong/main` was rewritten on another machine: the same five fork commits re-titled in
English with new SHAs, and the fork's `bash.collapsedPreviewLines` feature removed
(`PREVIEW_LINES` back to 20, the collapse test deleted). Local `main` still carried the
pre-rewrite commits, so the two histories shared no tip and `git push` was rejected
(non-fast-forward).

Resolution (2026-09-19): **do not force-push over the rewrite.** Rebase the local work onto
the rewritten tip instead — replay only what the remote lacks (`git cherry-pick` the audit doc
and the 6-item commit), re-run the upstream merge on that base, then push fast-forward. The
`bash.collapsedPreviewLines` removal was accepted rather than re-applied: the rewrite
implemented `fork-commit-audit.md`'s own verdict, and re-porting it would have re-created the
divergence the rewrite removed.

Diagnose a repeat the same way:

```
git fetch alasong
git rev-list --left-right --count main...alasong/main   # "ahead  behind"
git log --oneline main..alasong/main                    # what the rewrite changed
git diff <old-local-tip> alasong/main --stat            # the content delta, if any
```

A non-zero "behind" with no shared tip means the push cannot fast-forward.

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
