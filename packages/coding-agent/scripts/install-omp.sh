#!/usr/bin/env bash
#
# Build omp and install the binary to ~/bin, re-signing ad hoc so macOS 26's
# taskgated does not reject it at exec ("Code Signature Invalid" / `zsh: killed`).
#
# Bun single-file binaries on recent macOS intermittently ship with a signature
# taskgated rejects even though `codesign --verify` passes. Forcing an ad-hoc
# re-sign after copy makes the install deterministic; `--smoke-test` then proves
# the native-addon path loads (the failure mode CI's macos-sign.sh guards against).
#
# Usage: bash scripts/install-omp.sh [--build] [--smoke]
#   --build  run `bun run build` first (default: reuse existing dist/omp)
#   --smoke  also run `omp --smoke-test` to exercise native addon loading
set -euo pipefail

cd "$(dirname "$0")/.."
PKG_DIR="$(pwd)"
DIST="$PKG_DIR/dist/omp"
DEST="${OMP_INSTALL_DEST:-$HOME/bin/omp}"

if [[ "${1:-}" == "--build" || "${2:-}" == "--build" ]]; then
  bun run build
fi

if [[ ! -f "$DIST" ]]; then
  echo "error: $DIST not found — build first (or pass --build)" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp -f "$DIST" "$DEST"
chmod +x "$DEST"

# Force a fresh ad-hoc signature so taskgated accepts it at exec.
codesign --force --sign - "$DEST"
codesign --verify --strict "$DEST"

echo "installed: $DEST ($(ls -lh "$DEST" | awk '{print $5}'))"
"$DEST" --version

if [[ "${1:-}" == "--smoke" || "${2:-}" == "--smoke" ]]; then
  "$DEST" --smoke-test
fi

echo "OK — run \`omp\` (signature valid, exec accepted)"
