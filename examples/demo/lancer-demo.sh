#!/usr/bin/env bash
# Démonstration d'Atlas sur un poste de développement : l'espace Groupe Nordis, ses
# propositions et ses points d'accès dans un dossier à part, puis l'app (Tauri, mode dev).
#
#   examples/demo/lancer-demo.sh [dossier]      # défaut : ~/atlas-demo
#
# DEMO_COMPTE choisit le compte (julien.h par défaut, référent de l'espace) ; DEMO_SANS_APP=1
# s'arrête après la préparation, sans ouvrir l'app (test de fumée). Le dossier est
# recréé à chaque lancement : la démo repart toujours du même état. Les données réelles
# d'Atlas, le trousseau et les plateformes ne sont pas touchés : comparaisons sur les
# données de test (ATLAS_COMPARE_DATA), coffre en mémoire (ATLAS_VAULT=memory).
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
demo=${1:-$HOME/atlas-demo}
account=${DEMO_COMPTE:-julien.h}
marker="$demo/.atlas-demo"
echo "· Démo dans $demo (compte $account)"

if [[ -e "$demo" && ! -e "$marker" && -n "$(ls -A "$demo")" ]]; then
  echo "$demo existe et n'est pas un dossier de démo : choisir un autre dossier." >&2
  exit 1
fi
if [[ -z "${DEMO_SANS_APP:-}" ]] && lsof -nP -iTCP:1420 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Le port 1420 (Vite) est pris : fermer l'autre app ou les tests e2e." >&2
  exit 1
fi

rm -rf "$demo"
mkdir -p "$demo"
touch "$marker"

echo "· Dépôt Groupe Nordis, historique de Revenu net (v1 à v4)"
"$root/examples/depot-nordis.sh" "$demo" >/dev/null
echo "· Cinq propositions ouvertes, trois points d'accès"
uv run --quiet --project "$root/core" python "$root/examples/propositions-nordis.py" \
  "$demo/distant.git" >/dev/null
uv run --quiet --project "$root/core" python "$root/examples/points-acces-nordis.py" \
  "$demo/distant.git" https://adb-1234567890123456.7.azuredatabricks.net >/dev/null

export ATLAS_DATA_DIR="$demo/donnees" ATLAS_ACCOUNT="$account" ATLAS_VAULT=memory
export ATLAS_COMPARE_DATA="$root/core/tests/fixtures/compare/revenu-net"

echo "· Espace rejoint en $account"
# Serveur éphémère, avec son token comme sous Tauri, le temps de rejoindre l'espace.
port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
token=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')
ATLAS_PORT=$port ATLAS_TOKEN=$token ATLAS_LOG_LEVEL=warning \
  uv run --quiet --project "$root/core" skifer-atlas-server &
server=$!
stop_server() { # `uv run` et le serveur Python, son enfant
  pkill -TERM -P "$server" 2>/dev/null || true
  kill "$server" 2>/dev/null || true
  wait "$server" 2>/dev/null || true
}
trap stop_server EXIT
ready=
for _ in $(seq 100); do
  curl -sf "http://127.0.0.1:$port/health" >/dev/null && ready=1 && break
  sleep 0.2
done
if [[ -z "$ready" ]]; then
  echo "Le serveur n'a pas démarré en 20 s (port $port)." >&2
  exit 1
fi
if ! joined=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' -d "{\"remote_url\":\"$demo/distant.git\"}" \
    "http://127.0.0.1:$port/api/workspaces/join") || [[ "${joined##*$'\n'}" != 2?? ]]; then
  echo "L'espace n'a pas pu être rejoint : ${joined%$'\n'*}" >&2
  exit 1
fi
stop_server
trap - EXIT

if [[ -n "${DEMO_SANS_APP:-}" ]]; then
  echo "· Préparation terminée dans $demo"
  exit 0
fi

echo "· Lancement de l'app (fermer la fenêtre pour arrêter)"
cd "$root/app"
exec npm run tauri dev
