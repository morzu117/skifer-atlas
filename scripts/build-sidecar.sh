#!/usr/bin/env bash
# Empaquette le cœur Python en binaire autonome et le dépose là où Tauri l'attend.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
NAME="skifer-atlas-server-${TRIPLE}"
cd "$ROOT/core"
uv sync --group build
uv run pyinstaller --noconfirm --onefile --name "$NAME" \
  --collect-all duckdb --collect-all sqlglot \
  --collect-submodules keyring.backends --copy-metadata keyring \
  --collect-all snowflake.connector --copy-metadata snowflake-connector-python \
  --hidden-import skifer_atlas.server \
  sidecar.py
mkdir -p "$ROOT/app/src-tauri/binaries"
cp "dist/$NAME" "$ROOT/app/src-tauri/binaries/$NAME"
SIZE="$(wc -c < "dist/$NAME")"
echo "Sidecar prêt : app/src-tauri/binaries/$NAME ($((SIZE / 1024 / 1024)) Mo)"
# Seuil d'alerte du plan 0018 : au-delà, revoir ce qui est embarqué.
if [ "$SIZE" -gt $((200 * 1024 * 1024)) ]; then
  echo "Attention : le binaire dépasse 200 Mo." >&2
fi
