#!/usr/bin/env bash
# Test de fumée macOS d'un bundle release ou debug :
#   scripts/smoke-app.sh "app/src-tauri/target/release/bundle/macos/Skifer Atlas.app"
#   scripts/smoke-app.sh "app/src-tauri/target/debug/bundle/macos/Skifer Atlas.app"
# Le mode est déduit du chemin du bundle (ou fixé par SMOKE_APP_MODE=debug|release).
# Debug utilise uv et le chemin core/ du checkout présent lors de la compilation.
# ATLAS_DATA_DIR et ATLAS_VAULT sont respectés s'ils sont fournis ; sinon un dossier
# temporaire et le coffre mémoire sont utilisés. Ne jamais fournir le vrai dossier.
# Cmd-Q exige une session graphique et l'autorisation Accessibilité de System Events.
# SMOKE_LIMIT_SECONDS ajuste la limite de démarrage (10 s par défaut).
set -euo pipefail
APP="${1:?usage : smoke-app.sh <chemin du .app>}"
APP="$(cd "$(dirname "$APP")" && pwd)/$(basename "$APP")"
EXE="$APP/Contents/MacOS/skifer-atlas"
SERVER="$APP/Contents/MacOS/skifer-atlas-server"
MODE="${SMOKE_APP_MODE:-}"
if [ -z "$MODE" ]; then
  case "$APP" in
    */target/debug/bundle/macos/*) MODE=debug ;;
    */target/release/bundle/macos/*) MODE=release ;;
    *) echo "Mode indéterminé : définir SMOKE_APP_MODE=debug ou release." >&2; exit 1 ;;
  esac
fi
case "$MODE" in debug|release) ;; *) echo "SMOKE_APP_MODE doit valoir debug ou release." >&2; exit 1 ;; esac
[ -x "$EXE" ] || { echo "Exécutable absent de $APP" >&2; exit 1; }
if [ "$MODE" = release ] && [ ! -x "$SERVER" ]; then echo "Sidecar absent de $APP" >&2; exit 1; fi
if [ "$MODE" = debug ] && ! command -v uv > /dev/null; then echo "uv est requis pour le bundle debug." >&2; exit 1; fi
LIMIT_SECONDS="${SMOKE_LIMIT_SECONDS:-10}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/atlas-smoke.XXXXXXXX")"
LOG="$TMP_DIR/app.log"
APP_PID=""
SERVER_PIDS=""
export ATLAS_DATA_DIR="${ATLAS_DATA_DIR:-$TMP_DIR/data}"
export ATLAS_VAULT="${ATLAS_VAULT:-memory}"
# Même une variable héritée ne doit pas désigner le dossier de données macOS par défaut.
python3 - "$ATLAS_DATA_DIR" <<'PYDATA' || { echo "ATLAS_DATA_DIR désigne les données réelles par défaut." >&2; rm -rf "$TMP_DIR"; exit 1; }
import os
import sys
from pathlib import Path

data = Path(os.path.realpath(os.path.expanduser(sys.argv[1])))
real = Path(os.path.realpath(os.path.expanduser("~/Library/Application Support/skifer-atlas")))
sys.exit(1 if data == real or real in data.parents else 0)
PYDATA
cleanup() {
  local pid
  if [ -n "$APP_PID" ]; then kill -9 "$APP_PID" 2>/dev/null || true; fi
  for pid in $SERVER_PIDS; do kill -9 "$pid" 2>/dev/null || true; done
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT
fail() {
  echo "ÉCHEC : $1" >&2
  if [ -f "$LOG" ]; then echo 'Journal de l’application :' >&2; cat "$LOG" >&2; fi
  exit 1
}
# Éviter qu'un Apple Event ou une frappe ne vise une autre instance Atlas.
[ -z "$(pgrep -x skifer-atlas || true)" ] || fail "une autre instance de Skifer Atlas est déjà ouverte."

alive() {
  curl -fsS "http://127.0.0.1:$1/alive?nonce=00112233445566778899aabbccddeeff" 2>/dev/null \
    | grep -Eq '"proof" *: *"[0-9a-f]{64}"'
}
verified_port() {
  sed -n 's/^\[atlas\] serveur vérifié, port \([0-9][0-9]*\)$/\1/p' "$LOG" | tail -n 1
}
# Identifie le processus écoutant le port vérifié et ses parents jusqu'à l'app.
# Conserve toute la chaîne : en debug uv et Python sont deux processus distincts.
record_server() {
  local pid parent chain=""
  pid="$(lsof -nP -t -iTCP:"$1" -sTCP:LISTEN | head -n 1 || true)"
  [ -n "$pid" ] || fail "aucun serveur n'écoute sur le port $1."
  while [ "$pid" != "$APP_PID" ]; do
    case "$pid" in ''|0|1|*[!0-9]*) fail "le serveur du port $1 n'est pas un descendant de l'application." ;; esac
    chain="$chain $pid"
    parent="$(ps -o ppid= -p "$pid" | tr -d '[:space:]')"
    pid="$parent"
  done
  SERVER_PIDS="$chain"
}
start() {
  local started port status
  SERVER_PIDS=""
  started=$(date +%s)
  "$EXE" > "$LOG" 2>&1 &
  APP_PID=$!
  while :; do
    port="$(verified_port)"
    [ -z "$port" ] || break
    kill -0 "$APP_PID" 2>/dev/null || fail "l'app s'est fermée avant de vérifier son serveur."
    (( $(date +%s) - started <= 60 )) || fail "l'app n'a pas vérifié son serveur en 60 s."
    sleep 0.2
  done
  ELAPSED=$(( $(date +%s) - started ))
  alive "$port" || fail "/alive ne rend pas de preuve sur le port $port."
  record_server "$port"
  status="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/health" || true)"
  [ "$status" = 401 ] || fail "/health sans token : $status au lieu de 401."
  echo "Démarrage ($MODE) : ${ELAPSED} s (port $port, serveur vérifié, /health refusé sans token)." >&2
  (( ELAPSED <= LIMIT_SECONDS )) || fail "démarrage en ${ELAPSED} s (limite ${LIMIT_SECONDS} s)."
  # La preuve précède l'affichage de la fenêtre ; attendre son existence avant la frappe.
  osascript - "$APP_PID" <<'APPLESCRIPT' >/dev/null || fail "fenêtre native inaccessible (autorisation Accessibilité de System Events ?)."
on run argv
  set appPid to item 1 of argv as integer
  tell application "System Events"
    repeat 100 times
      if exists (first application process whose unix id is appPid) then
        tell (first application process whose unix id is appPid)
          if (count of windows) > 0 then return
        end tell
      end if
      delay 0.1
    end repeat
  end tell
  error "fenêtre non apparue en 10 s"
end run
APPLESCRIPT
}
expect_no_server() {
  local what="$1" pid still deadline=$(( $(date +%s) + 10 ))
  while :; do
    still=""
    for pid in $SERVER_PIDS; do
      if kill -0 "$pid" 2>/dev/null; then still="$still $pid"; fi
    done
    [ -n "$still" ] || break
    (( $(date +%s) <= deadline )) || fail "$what : processus serveur orphelin(s) :$still."
    sleep 0.2
  done
  SERVER_PIDS=""
  echo "OK ($what) : aucun processus serveur." >&2
}
check_quit_log() {
  local what="$1"
  # Comparaison exacte et unique des étapes, sans imposer l'absence d'autres logs.
  local actual expected
  actual="$(grep -E '^\[atlas\] (quitter intercepté|fermeture demandée|fenêtre détruite|sortie confirmée|sortie refusée \(délai\))$' "$LOG" || true)"
  expected="$(printf '%s\n' '[atlas] quitter intercepté' '[atlas] fermeture demandée' '[atlas] fenêtre détruite' '[atlas] sortie confirmée')"
  [ "$actual" = "$expected" ] || fail "$what : étapes de fermeture absentes, répétées ou dans le désordre."
}
quit_app() {
  local what="$1" method="$2"
  # Le délai inclut l'exécution d'AppleScript. Aucun signal de secours ne peut
  # transformer une commande native défaillante en succès.
  python3 - "$APP_PID" "$method" <<'PY' || fail "$what : AppleScript a échoué ou l'app n'a pas quitté en moins de 4 s."
import os
import subprocess
import sys
import time

pid, method = int(sys.argv[1]), sys.argv[2]
if method == "cmdq":
    script = '''tell application "System Events" to keystroke "q" using command down'''
    command = ["osascript", "-"]
else:
    script = 'tell application id "io.skifer.atlas" to quit'
    command = ["osascript", "-"]
if method == "cmdq":
    # L'utilisateur tape Cmd-Q dans l'app déjà au premier plan. Sur les runners Intel,
    # démarrer System Events et activer l'app prennent plusieurs secondes : c'est fait avant
    # la mesure, pour que les 4 s restent celles de l'app.
    activate = '''on run argv
  set appPid to item 1 of argv as integer
  tell application "System Events"
    set appProcess to first application process whose unix id is appPid
    set frontmost of appProcess to true
    repeat 100 times
      if frontmost of appProcess then return "ok"
      delay 0.1
    end repeat
  end tell
  return "pas au premier plan"
end run'''
    ready = subprocess.run(["osascript", "-", str(pid)], input=activate, text=True,
                           capture_output=True, timeout=60, check=False)
    if ready.returncode or ready.stdout.strip() != "ok":
        print(f"Fermeture {method} : l'app n'a pas pu passer au premier plan "
              f"({(ready.stderr or ready.stdout).strip()})", file=sys.stderr)
        sys.exit(1)
started = time.monotonic()
try:
    result = subprocess.run(command, input=script, text=True, capture_output=True, timeout=4)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "AppleScript a échoué")
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        # Le shell parent peut ne récupérer son enfant qu'après ce processus Python.
        state = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)],
                               capture_output=True, text=True).stdout.strip()
        if not state or state.startswith("Z"):
            break
        if time.monotonic() - started >= 4:
            raise TimeoutError("l'application ne s'est pas terminée à temps")
        time.sleep(0.05)
    elapsed = time.monotonic() - started
    if elapsed >= 4:
        raise TimeoutError("l'application a dépassé 4 s")
    print(f"Fermeture {method} : {elapsed:.2f} s", file=sys.stderr)
except (subprocess.TimeoutExpired, OSError, RuntimeError, TimeoutError) as error:
    print(f"Fermeture {method} : {error}", file=sys.stderr)
    sys.exit(1)
PY
  wait "$APP_PID" || fail "$what : l'app s'est terminée en erreur."
  APP_PID=""
  check_quit_log "$what"
  expect_no_server "$what"
}

start
quit_app "Cmd-Q" cmdq
start
quit_app "Apple Event Quitter" appleevent
start
kill -9 "$APP_PID"
wait "$APP_PID" 2>/dev/null || true
APP_PID=""
expect_no_server "app tuée"
echo "Test de fumée de l'app : OK"
