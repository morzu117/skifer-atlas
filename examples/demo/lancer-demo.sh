#!/usr/bin/env bash
# Démonstration d'Atlas sur un poste de développement : l'espace Groupe Nordis, ses
# propositions et ses points d'accès dans un dossier à part, puis l'app (Tauri, mode dev).
#
#   examples/demo/lancer-demo.sh [dossier]      # défaut : ~/atlas-demo
#
# DEMO_COMPTE choisit le compte (julien.h par défaut, référent de l'espace). Le dossier est
# recréé à chaque lancement : la démo repart toujours du même état. Les données réelles
# d'Atlas, le trousseau et les plateformes ne sont pas touchés : comparaisons sur les
# données de test (ATLAS_COMPARE_DATA), coffre en mémoire (ATLAS_VAULT=memory).
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
demo=${1:-$HOME/atlas-demo}
account=${DEMO_COMPTE:-julien.h}
marker="$demo/.atlas-demo"

if [[ -e "$demo" && ! -e "$marker" && -n "$(ls -A "$demo")" ]]; then
  echo "$demo existe et n'est pas un dossier de démo : choisir un autre dossier." >&2
  exit 1
fi
if lsof -iTCP:1420 -sTCP:LISTEN >/dev/null 2>&1; then
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
trap 'kill $server 2>/dev/null || true' EXIT
for _ in $(seq 100); do
  curl -sf "http://127.0.0.1:$port/health" >/dev/null && break
  sleep 0.2
done
curl -sf -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d "{\"remote_url\":\"$demo/distant.git\"}" \
  "http://127.0.0.1:$port/api/workspaces/join" >/dev/null
kill $server
wait $server 2>/dev/null || true
trap - EXIT

echo "· Lancement de l'app (fermer la fenêtre pour arrêter)"
cd "$root/app"
exec npm run tauri dev
