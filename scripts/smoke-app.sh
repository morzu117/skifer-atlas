#!/usr/bin/env bash
# Test de fumée de l'app release sous macOS (plan 0019, critère 3).
#
#   scripts/smoke-app.sh "app/src-tauri/target/release/bundle/macos/Skifer Atlas.app"
#
# 1. L'app démarre et vérifie son serveur en moins de 10 s (SMOKE_LIMIT_SECONDS). Le départ
#    du chronomètre est le lancement, l'arrivée la ligne « [atlas] serveur vérifié, port N »
#    que l'app écrit sur sa sortie (capturée dans /tmp/atlas-smoke-app.log) une fois la preuve
#    du serveur acceptée (HMAC du token, ADR 0041). Un serveur qui répond sans connaître le
#    token ne la produit jamais : l'app échoue, et le script aussi. /health exige le token,
#    que seule l'app connaît : le script vérifie qu'il est refusé sans token (401).
# 2. Fermeture normale (Cmd-Q, par AppleScript) : aucun processus serveur ne reste.
# 3. App tuée net (kill -9) : le serveur s'arrête seul (ATLAS_PARENT_PID, lifeline.py).
set -euo pipefail
APP="${1:?usage : smoke-app.sh <chemin du .app>}"
APP="$(cd "$(dirname "$APP")" && pwd)/$(basename "$APP")"
EXE="$APP/Contents/MacOS/skifer-atlas"
SERVER="$APP/Contents/MacOS/skifer-atlas-server"
# Plan 0019, critère 3 : 10 s. Le runner macOS Intel de la CI, plus lent que la machine
# de référence, passe une limite plus large (SMOKE_LIMIT_SECONDS, ADR 0023).
LIMIT_SECONDS="${SMOKE_LIMIT_SECONDS:-10}"
[ -x "$EXE" ] && [ -x "$SERVER" ] || { echo "Exécutable ou sidecar absent de $APP" >&2; exit 1; }

servers() { pgrep -f "$SERVER" || true; }

# Vrai si /alive répond 200 avec une preuve de 64 caractères hexadécimaux.
alive() {
  curl -fsS "http://127.0.0.1:$1/alive?nonce=00112233445566778899aabbccddeeff" 2> /dev/null \
    | grep -Eq '"proof" *: *"[0-9a-f]{64}"'
}

# Port annoncé par l'app une fois la preuve du serveur acceptée (lib.rs, ready_message).
verified_port() {
  sed -n 's/^\[atlas\] serveur vérifié, port \([0-9][0-9]*\)$/\1/p' /tmp/atlas-smoke-app.log | tail -n 1
}

# Démarre l'app et attend qu'elle ait vérifié son serveur ; pose APP_PID et ELAPSED.
# « Prête » veut dire : la coque a validé la preuve (HMAC du token), pas seulement que
# quelque chose répond sur le port.
start() {
  local started port
  [ -z "$(servers)" ] || { echo "Un serveur tourne déjà : $(servers)" >&2; exit 1; }
  started=$(date +%s)
  "$EXE" > /tmp/atlas-smoke-app.log 2>&1 &
  APP_PID=$!
  while :; do
    port="$(verified_port)"
    [ -z "$port" ] || break
    if ! kill -0 "$APP_PID" 2> /dev/null; then
      echo "L'app s'est fermée avant de vérifier son serveur." >&2; cat /tmp/atlas-smoke-app.log >&2; exit 1
    fi
    if (( $(date +%s) - started > 60 )); then
      echo "L'app n'a pas vérifié son serveur en 60 s." >&2; cat /tmp/atlas-smoke-app.log >&2; exit 1
    fi
    sleep 0.2
  done
  ELAPSED=$(( $(date +%s) - started ))
  # Contrôles après coup : le serveur vérifié est bien celui du sidecar, et protégé.
  alive "$port" || { echo "/alive ne rend pas de preuve sur le port $port." >&2; kill -9 "$APP_PID"; exit 1; }
  [ -n "$(servers)" ] || { echo "Aucun processus sidecar derrière le port $port." >&2; kill -9 "$APP_PID"; exit 1; }
  local status
  status="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/health" || true)"
  [ "$status" = 401 ] || { echo "/health sans token : $status au lieu de 401." >&2; kill -9 "$APP_PID"; exit 1; }
  echo "Démarrage : ${ELAPSED} s (port $port, serveur vérifié par l'app, /health refusé sans token)" >&2
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
