# omp context & efficiency changes (2026-09-19)

What this fork changed about context handling and idle execution, why, and how to undo it.
Scope: the four axes chosen for the `omp-ctx-eff` work — context fidelity, context size,
idle execution, and the historical bugs found in the 2026-09-18 gap review
(`docs/omp-gaps-2026-09-18.md` in the analysis repo).

## Configuration first

These live in `~/.omp/agent/config.yml` and need an omp restart to take effect (there is no
hot reload; `compaction.experimentalContextManagement` additionally changes the *tool set*,
which prints "Restart to update available tools").

| Key | Value | Upstream default | Why |
|---|---|---|---|
| `compaction.thresholdTokens` | `200000` | `-1` (derive from window) | The model's window is 1M, so the derived threshold was 850000 and compaction **never fired** (measured peaks: 504,031 over 2 days, 633,656 over 7). Context grew without bound and every turn re-paid it. 200k = 1/5 of the window, keeps a large working set. Measured cost of a compaction: ~+851 tokens/turn, so roughly every 210 turns. |
| `tools.artifactHeadBytes` | `2.5` | `0` | `0` keeps only the tail, so a spilled source file loses its imports, types, and signatures — the hidden cost of the fidelity axis. `2.5` switches to middle elision (head + tail, same total inline budget), so retrieval cost is unchanged. |
| `compaction.experimentalContextManagement` | `true` | `false` | Turns on the built-in fidelity machinery: the `context-notes` / `new-context` rolling tools, and `history://current/full` — the original pre-compaction history stays readable from inside a new window. |
| `bash.expectedNonZeroExitAsWarning` | `true` | `false` (fork-gated) | A non-zero exit that *is* the command's normal negative answer (`grep` with no matches, `diff` differences, a false `test`, `sort -c`, `git diff --exit-code`) is reported as a warning instead of an error, with the exit code still visible. Prevents an inflated failure rate and a model reading "no match" as "broken command". |

## Source changes

Carried as upstream edits; each one is small and, where behavior changes, gated.

| File | Change |
|---|---|
| `src/tools/output-meta.ts` | An oversized `read` result that already carried its own artifact was skipped wholesale by the spill path, so `tools.artifactSpillThreshold` never applied to it — a 72KB URL body inlined 48,282 bytes despite a 10KB budget. `read` is now the one exception to that guard: its existing artifact pointer is reused (never re-saved) and the inline body is re-bounded to the head/tail budget. |
| `src/tools/bash-exit-semantics.ts` (new) | The exit-status classifier behind `bash.expectedNonZeroExitAsWarning`. Deliberately conservative: it declines on `&&` lists, redirections, interpreter wrappers, non-flat syntax, and any exit code outside the family's negative-answer set (so `grep` exit 2 stays an error). `find` is absent on purpose — matching nothing still exits 0, so a non-zero means something actually went wrong. |
| `src/tools/bash.ts` | Reads the flag (`=== true`, so the default is genuinely inert) and skips the error classification when the exit is expected. |
| `src/tools/hub/index.ts`, `src/tools/hub/types.ts` | `hub wait` marks the leg where the window expired with no event at all (`details.noEvent` + a one-line hint). The job-settled and message legs are byte-identical to before; only the bare timeout is now distinguishable from progress. |
| `src/prompts/system/system-prompt.md` | The vague `SHOULD parallelize independent calls` became an executable instruction: batch independent calls into one assistant turn, with examples and the cost (each extra turn re-pays the whole context). |
| `packages/agent/src/compaction/prompts/compaction-summary.md` | A compaction summary must keep each key decision **and its rationale** — quoting the original sentence verbatim when it was stated — and is forbidden from flattening a decision into a general statement. This is the prompt-side half of the fidelity axis: conclusions used to survive compaction while their reasons did not. |

## Verification

- `bun run check:types` clean in `packages/coding-agent` and `packages/agent`.
- Changed-surface tests: `tools.test.ts`, `tools/hub-wait.test.ts`, `bash-failure-result.test.ts`, `bash-executor.test.ts`, `system-prompt-inventory.test.ts` → 275 pass / 1 skip / 0 fail. `settings-manager.test.ts` (singleton bucket, run alone) → 134 pass.
- Binary rebuilt (`bun scripts/ci-release-build-binaries.ts --targets=darwin-arm64`, ~9s, no Rust change), installed to `~/bin/omp`, codesigned, `--version` → `omp/18.2.3`, `--smoke-test` → ok.
- Live session through that binary: `grep -n <no-match> /etc/hosts` → exit code `1` preserved and **not** flagged as an error.

## Known residuals and unaddressed items

- **Pre-existing, not from this work:** `packages/agent/test/anthropic-native-compaction.test.ts` fails 10 cases on this commit. Verified unrelated by reverting the compaction prompt to HEAD and re-running the same file (still 6 pass / 10 fail). Nobody should read a red `packages/agent` suite as a regression from these changes.
- **pi-shell parse failures are not fail-open.** The policy face (approval, deny patterns) is decided in TypeScript from the raw command text and never consumes the native parse; a parse failure surfaces as a hard error (exit 2) with no system-shell fallback. The real gap is coverage in the vendored `brush` tokenizer (here-doc is patched by pi-shell; a backtick inside double quotes is a self-admitted TODO upstream). Fixing it means editing `crates/vendor/brush-*/` and rebuilding the native addon — deliberately not done.
- **Advisory preempting `hub wait` is intended**, not a bug: only *unstarted* interruptible waits are skipped, an in-flight job-wait returns a normal snapshot, and the invariant is pinned by comments, `docs/advisor-watchdog.md`, and a regression test. The "hub failed 12/14 times" figure is a reporting artifact — those results carry `interrupt_skipped` / `executed:false` because they never ran.
- **Not attempted:** long-session splitting criteria (needs new design), and the items the work explicitly did not take on (`ask` timeouts, background-job saturation, the display-axis gaps).
