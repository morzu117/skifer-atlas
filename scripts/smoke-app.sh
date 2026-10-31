#!/usr/bin/env bash
# Test de fumée de l'app release sous macOS (plan 0019, critère 3).
#
#   scripts/smoke-app.sh "app/src-tauri/target/release/bundle/macos/Skifer Atlas.app"
#
# 1. L'app démarre et son serveur répond sur /health en moins de 10 s.
# 2. Fermeture normale (Cmd-Q, par AppleScript) : aucun processus serveur ne reste.
# 3. App tuée net (kill -9) : le serveur s'arrête seul (ATLAS_PARENT_PID, lifeline.py).
set -euo pipefail
APP="${1:?usage : smoke-app.sh <chemin du .app>}"
APP="$(cd "$(dirname "$APP")" && pwd)/$(basename "$APP")"
EXE="$APP/Contents/MacOS/skifer-atlas"
SERVER="$APP/Contents/MacOS/skifer-atlas-server"
LIMIT_SECONDS=10
[ -x "$EXE" ] && [ -x "$SERVER" ] || { echo "Exécutable ou sidecar absent de $APP" >&2; exit 1; }

servers() { pgrep -f "$SERVER" || true; }

# Port du serveur : celui qu'écoute un processus du sidecar.
server_port() {
  local pids
  pids="$(servers | paste -sd, -)"
  [ -n "$pids" ] || return 1
  lsof -nP -a -iTCP -sTCP:LISTEN -p "$pids" 2>/dev/null | awk 'NR > 1 { sub(/.*:/, "", $9); print $9; exit }'
}

# Démarre l'app et attend /health ; pose APP_PID et ELAPSED.
start() {
  local started port
  [ -z "$(servers)" ] || { echo "Un serveur tourne déjà : $(servers)" >&2; exit 1; }
  started=$(date +%s)
  "$EXE" > /tmp/atlas-smoke-app.log 2>&1 &
  APP_PID=$!
  while :; do
    port="$(server_port || true)"
    if [ -n "$port" ] && curl -fsS "http://127.0.0.1:$port/health" > /dev/null 2>&1; then
      break
    fi
    if (( $(date +%s) - started > 60 )); then
      echo "Le serveur n'a pas répondu en 60 s." >&2; cat /tmp/atlas-smoke-app.log >&2; exit 1
    fi
    sleep 0.2
  done
  ELAPSED=$(( $(date +%s) - started ))
  echo "Démarrage : ${ELAPSED} s (port $port, $(curl -fsS "http://127.0.0.1:$port/health"))" >&2
}

# Attend qu'il ne reste aucun processus serveur.
expect_no_server() {
  local what="$1" deadline=$(( $(date +%s) + 10 ))
  while [ -n "$(servers)" ]; do
    if (( $(date +%s) > deadline )); then
      echo "ÉCHEC ($what) : serveur orphelin : $(servers)" >&2
      pkill -9 -f "$SERVER" || true
      exit 1
    fi
    sleep 0.2
  done
  echo "OK ($what) : aucun processus serveur." >&2
}

# 1 et 2 : démarrage, puis fermeture normale.
start
if (( ELAPSED > LIMIT_SECONDS )); then
  echo "ÉCHEC : démarrage en ${ELAPSED} s (limite ${LIMIT_SECONDS} s)." >&2; kill -9 "$APP_PID"; exit 1
fi
osascript -e 'tell application id "io.skifer.atlas" to quit' > /dev/null 2>&1 \
  || kill -TERM "$APP_PID"
for _ in $(seq 50); do kill -0 "$APP_PID" 2> /dev/null || break; sleep 0.2; done
kill -0 "$APP_PID" 2> /dev/null && { echo "L'app ne s'est pas fermée." >&2; kill -9 "$APP_PID"; exit 1; }
expect_no_server "fermeture normale"

# 3 : app tuée sans fermeture propre.
start
kill -9 "$APP_PID"
wait "$APP_PID" 2> /dev/null || true
expect_no_server "app tuée"
echo "Test de fumée de l'app : OK"
