# Project asset anchors

A unified framework for treating every project asset — code graph, architecture
docs, tests, architecture guards, quality guards, memory, context — as a
declarative anchor that can be injected into context, guarded, and kept fresh.

## Motivation

omp's asset dimensions were siloed: `codegraph` (code graph), `hindsight`
(memory), TTSR (pre-write security), `compress` (context), `docs-index`
(documentation). Each had its own mechanism, injection path, and freshness
model. There was no unified abstraction, so adding a new asset dimension meant
writing new mechanism code instead of declaring an asset.

This framework converges them onto one **declarative asset manifest** that
drives injection, guarding, and freshness for every dimension.

## Core concepts

### Asset

Every project asset is a uniform record:

```
Asset = {
  type,          // code | archDoc | test | archGuard | qualityGuard | memory | context
  path,          // asset location
  version,       // content version (hash)
  anchor,        // freshness anchor (commit / timestamp)
  refreshPolicy, // watch | scheduled | event-driven
  guard          // guarding check (command + trigger point)
}
```

- `code` — symbol/call-graph knowledge (codegraph index).
- `archDoc` — architecture design docs (conventions, invariants).
- `test` — test cases and affected-surface mapping.
- `archGuard` — architecture invariant checks (module boundaries, dependency
  direction). Triggered pre-write.
- `qualityGuard` — style/verification checks. Triggered post-write.
- `memory` — historical knowledge (hindsight).
- `context` — compressed context / injected files.

### Code is the anchor center

Every other dimension guards *around* the code: tests map to affected code via
the call graph, architecture docs check consistency against code, quality
guards validate code. The code asset is the reference anchor.

### Declarative manifest

A single `omp.assets.json` at the project root declares all assets. Injection,
guarding, and freshness all derive from the manifest. **Adding a new dimension
is adding a manifest entry, not writing code.**

```
project root: omp.assets.json
  ├─ injection: context-file capability injects per asset type
  ├─ guarding:  hook capability mounts pre/post guards per asset
  └─ freshness: per-asset refreshPolicy + anchor
```

## Three layers

### Injection

Assets enter the model's context per type, reusing omp's existing mechanisms:

| Asset type | Injection path |
| ---------- | -------------- |
| `code`     | MCP (`codegraph_explore`) |
| `archDoc`  | `context-file` capability |
| `memory`   | `hindsight` recall |
| `context`  | `compress` output |

`context-file` provides the layered model (`level` + `priority` shadowing) that
asset injection slots into.

### Guarding

Asset guards run at lifecycle points, reusing the `hook` capability
(pre/post tool execution shell hooks):

| Guard | Trigger |
| ----- | ------- |
| `archGuard` | pre-write (review before changing) |
| `qualityGuard` | post-write (validate after change) |

Each asset declares `guard` (the check command and its trigger point); the
framework mounts them onto the corresponding hooks.

### Freshness

Per-asset `refreshPolicy`, following the codegraph pattern (verified by
measurement):

| Policy | Asset | Mechanism |
| ------ | ----- | --------- |
| `watch` | `code` | codegraph `serve --watch` auto-sync (~1s) |
| `scheduled` | `archDoc` | periodic re-read of `docs-index` |
| `event-driven` | `memory` | hindsight retain/reflect |

Each asset carries an `anchor` (commit or content hash). Staleness is judged by
comparing the anchor against current state; a stale asset triggers its
refresh.

## Lifecycle

1. **Discover** — scan the manifest at startup; discover each asset from its
   source (codegraph init, docs-index, test scan).
2. **Register** — assets enter a unified registry keyed by type + id.
3. **Refresh** — per `refreshPolicy` + `anchor` staleness check.
4. **Guard** — hooks fire the asset's guard at its trigger point.
5. **Propagate** — asset changes cascade downstream (code change →
   recompute affected tests → fire quality guard), following dependency
   direction with a trigger threshold to avoid cascade storms.

## Adding a new asset dimension

1. Add a manifest entry to `omp.assets.json`.
2. Point it at the existing source (or a new source provider).
3. Declare its `guard` and `refreshPolicy`.

No framework code changes required. This is the framework's core contract.

## Relationship to existing mechanisms

- **codegraph** — the `code` asset's source (already mounted via MCP).
- **hindsight** — the `memory` asset's backend.
- **TTSR** — the security pre-write guard.
- **`compress`** — the `context` asset's producer.
- **`context-file` / `hook` capabilities** — the injection and guarding seams.
