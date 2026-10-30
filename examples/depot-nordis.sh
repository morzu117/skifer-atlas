#!/usr/bin/env bash
# Dépôt de démonstration Groupe Nordis, avec l'historique de Revenu net (v1 à v4).
#
#   examples/depot-nordis.sh <dossier>
#
# Crée <dossier>/travail (copie de travail) et <dossier>/distant.git (dépôt nu à
# rejoindre). Chaque version de Revenu net a son commit, daté et signé par son auteur,
# et son tag doc/revenu-net/v<n> ; Commande porte le tag doc/commande/v5.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
dest=${1:?usage : depot-nordis.sh <dossier>}
work="$dest/travail"
mkdir -p "$dest"
cp -R "$here/espace-nordis" "$work"
cd "$work"

commit() { # auteur, date, message
  git add -A
  GIT_AUTHOR_DATE="$2T09:00:00+02:00" GIT_COMMITTER_DATE="$2T09:00:00+02:00" \
    git -c user.name="$1" -c user.email=demo@exemple.invalid -c commit.gpgsign=false \
    commit -qm "$3"
}

git init -q -b main
for n in 1 2 3; do
  cp "$here/historique-nordis/revenu-net.v$n.yaml" kpis/revenu-net.yaml
  case $n in
    1) commit "Claire M." 2026-01-15 "Espace Groupe Nordis ; Revenu net v1 : chiffre d'affaires hors taxes" ;;
    2) commit "Claire M." 2026-03-09 "Revenu net v2 : déduction des avoirs" ;;
    3) commit "Marc D." 2026-06-02 "Revenu net v3 : points de variation déclarés (taxes, mois fiscal)" ;;
  esac
  git tag "doc/revenu-net/v$n"
done
cp "$here/espace-nordis/kpis/revenu-net.yaml" kpis/revenu-net.yaml
commit "Claire M." 2026-10-12 "Revenu net v4 : mois fiscal sur la date comptable"
git tag doc/revenu-net/v4
git tag doc/commande/v5
git clone -q --bare . "$dest/distant.git"
