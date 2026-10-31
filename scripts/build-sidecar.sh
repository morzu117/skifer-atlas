#!/usr/bin/env bash
# Empaquette le cœur Python en binaire autonome et le dépose là où Tauri l'attend
# (plan 0019). Les options de PyInstaller sont dans core/skifer-atlas-server.spec.
# macOS, Windows (Git Bash) et Linux ; le binaire est construit pour la machine courante.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
NAME="skifer-atlas-server-${TRIPLE}"
EXT=""
case "$TRIPLE" in *windows*) EXT=".exe" ;; esac
cd "$ROOT/core"
uv sync --group build
ATLAS_SIDECAR_NAME="$NAME" uv run pyinstaller --noconfirm --clean skifer-atlas-server.spec
mkdir -p "$ROOT/app/src-tauri/binaries"
cp "dist/$NAME$EXT" "$ROOT/app/src-tauri/binaries/$NAME$EXT"
SIZE="$(wc -c < "dist/$NAME$EXT" | tr -d ' ')"
echo "Sidecar prêt : app/src-tauri/binaries/$NAME$EXT ($((SIZE / 1024 / 1024)) Mo)"
# Seuil d'alerte du plan 0018 : au-delà, revoir ce qui est embarqué. Le seuil bloquant
# porte sur l'installateur (scripts/size-report.py, 250 Mo).
if [ "$SIZE" -gt $((200 * 1024 * 1024)) ]; then
  echo "Attention : le binaire dépasse 200 Mo." >&2
fi
