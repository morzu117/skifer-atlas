#!/usr/bin/env bash
# Dépôt de démonstration Groupe Nordis, avec l'historique de Revenu net (v1 à v4).
#
#   examples/depot-nordis.sh <dossier>
#
# Relais de examples/depot-nordis.py, seule source de l'historique (ADR 0059) : le même
# dépôt se construit ainsi sous Windows, sans Bash.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
exec python3 "$here/depot-nordis.py" "${1:?usage : depot-nordis.sh <dossier>}"
