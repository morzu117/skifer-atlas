# Démonstration : l'espace Groupe Nordis (plan 0005)

Le dépôt d'un espace Atlas, tel qu'on le clone : sept documents canoniques et trois variantes, sur le modèle des maquettes.

```
atlas.yaml, governance.yaml        identité de l'espace, domaines
calendars/fiscal-nordis.yaml       calendrier fiscal (format du moteur Skifer)
concepts/                          Commande, Date de référence, Client actif
kpis/                              Revenu net, Marge brute, Panier moyen, Taux de service
variants/revenu-net/               nordis-fr et nordis-de (surcharges), nordis-es (from_scratch)
implementations/revenu-net/…       le SQL de l'entité française, lu tel quel
```

Revenu net s'appuie sur les concepts Commande et Date de référence ; Marge brute et Panier moyen le réutilisent par `kpi_ref`. Chaque document passe `atlas check` (une variante avec `--with kpis/revenu-net.yaml`).

## Rejoindre l'espace depuis l'API

On fait de ce dossier un dépôt nu « distant », puis on le rejoint. Depuis la racine du dépôt Skifer Atlas :

```sh
DEMO=$(mktemp -d)
cp -R examples/espace-nordis "$DEMO/travail" && cd "$DEMO/travail"
git init -q -b main && git add -A && git commit -qm "Espace Groupe Nordis"
git tag doc/revenu-net/v4 && git tag doc/commande/v5
git clone -q --bare . "$DEMO/distant.git" && cd -

cd core
export ATLAS_TOKEN=demo ATLAS_DATA_DIR="$DEMO/donnees"
uv run skifer-atlas-server &

H="Authorization: Bearer demo"; API=http://127.0.0.1:8765/api/workspaces
curl -H "$H" -H 'Content-Type: application/json' -d "{\"remote_url\":\"$DEMO/distant.git\"}" $API/join
curl -H "$H" "$API/groupe-nordis/catalog?q=ca%20net"
curl -H "$H" $API/groupe-nordis/documents/revenu-net/dependencies
```

Ce qu'on doit voir :

- **Adhésion** : l'espace `groupe-nordis`, rôle `lecteur`, domaines finance, ventes, supply et marketing.
- **Recherche** : « ca net » trouve Revenu net par son synonyme « CA net ». Sans filtre, le catalogue liste les sept concepts et KPI ; Revenu net a trois variantes, `convergence: never_compared` tant qu'aucune comparaison chiffrée n'existe (plan 0009).
- **Dépendances de Revenu net** : Commande et Date de référence en références, Marge brute et Panier moyen en « référencé par », `impact: 2`.
- **Versions** : `…/documents/revenu-net/versions` liste le tag v4, `…/versions/4` rend le fichier tel qu'il était à ce tag.
