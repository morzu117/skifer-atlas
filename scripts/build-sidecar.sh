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
SYNC=(uv sync --group build)
# cryptography n'a plus de wheel macOS x86_64 : uv la compile. Liée dynamiquement à
# l'OpenSSL de Homebrew, elle heurterait le libssl du Python embarqué (même nom, autre
# version) ; on la lie en statique, et on ignore une compilation dynamique en cache.
if [ "$TRIPLE" = "x86_64-apple-darwin" ] && [ -z "${OPENSSL_DIR:-}" ] && command -v brew > /dev/null; then
  export OPENSSL_DIR="$(brew --prefix openssl@3)" OPENSSL_STATIC=1
  SYNC+=(--reinstall-package cryptography --refresh-package cryptography)
fi
"${SYNC[@]}"
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
