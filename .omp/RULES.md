# Fork divergence rules

This repo is a fork of `can1357/oh-my-pi` (push target `alasong`; `upstream` is read-only,
fetch-only). Every change MUST treat upstream-sync conflict cost as a first-class constraint:
the smaller and more concentrated the divergence surface, the cheaper the next merge.
Full policy, conflict-hotspot inventory, and sync SOP: `docs/local/fork-divergence.md`.

## Where a change goes — prefer the highest applicable level

1. **New isolated file or module** — preferred. New modules, commands, and tests conflict with
   nothing upstream. Example: `packages/coding-agent/src/asset-anchors/`.
2. **Setting-gated edit** — when an upstream file MUST change, wrap the new behavior in a
   setting whose default preserves upstream behavior. Patterns: `bash.cdFollowsShell`,
   `bash.lineDisplay`.
3. **Optional injection** — when upstream code must call fork logic, make the dependency an
   optional parameter or optional field. NEVER change an upstream function signature.
   Pattern: `StreamingRevealController.getLineDisplay`.
4. **Inline edit** — last resort; the diff MUST stay surgical — additive lines touching the
   fewest existing lines possible.

## Hard rules

- NEVER restructure, rename, move, or reorder upstream code.
- NEVER run a formatter over a touched upstream file; NEVER reorder its imports or
  reformat untouched regions — a whole-file formatter pass is a prohibited change.
- NEVER scatter fork logic into upstream hot files (inventory in `docs/local/fork-divergence.md`).
- NEVER delete upstream tests or weaken their assertions to make a fork change pass.
- NEVER edit a released `CHANGELOG` section; new entries go under `## [Unreleased]` only.
- Fork-only documentation MUST be a new file; NEVER rewrite upstream doc prose in place.

## Sync

- `git fetch upstream`, branch `backup/pre-sync-<date>`, then `git merge upstream/main`.
- Resolve a conflict by keeping upstream's structure and re-applying the fork's gated delta.
  NEVER resolve by taking a fork-side whole-file copy — that silently reverts upstream work.
- After merging, run the incremental tests covering every conflicted file.
- Push only to `alasong`: `git push alasong main`.
