# Démonstration : l'espace Groupe Nordis (plans 0005, 0006 et 0007)

Le dépôt d'un espace Atlas, tel qu'on le clone : sept documents canoniques et trois variantes, sur le modèle des maquettes.

```
atlas.yaml, governance.yaml        identité de l'espace ; domaines, membres et rôles
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
ATLAS_ACCOUNT=julien.h uv run skifer-atlas-server &

H="Authorization: Bearer demo"; API=http://127.0.0.1:8765/api/workspaces
curl -H "$H" -H 'Content-Type: application/json' -d "{\"remote_url\":\"$DEMO/distant.git\"}" $API/join
curl -H "$H" "$API/groupe-nordis/catalog?q=ca%20net"
curl -H "$H" $API/groupe-nordis/documents/revenu-net/dependencies
```

Ce qu'on doit voir :

- **Adhésion** : l'espace `groupe-nordis`, compte `julien.h`, rôle `referent` (référent d'espace dans `governance.yaml`), domaines finance, ventes, supply et marketing.
- **Recherche** : « ca net » trouve Revenu net par son synonyme « CA net ». Sans filtre, le catalogue liste les sept concepts et KPI ; Revenu net a trois variantes, `convergence: never_compared` tant qu'aucune comparaison chiffrée n'existe (plan 0009).
- **Dépendances de Revenu net** : Commande et Date de référence en références, Marge brute et Panier moyen en « référencé par », `impact: 2`.
- **Versions** : `…/documents/revenu-net/versions` liste le tag v4, `…/versions/4` rend le fichier tel qu'il était à ce tag.

## Proposer, valider, fusionner (plan 0006)

Le dépôt nu sert d'hébergeur (`LocalHost`) : les propositions sont des fichiers JSON dans `distant.git/atlas/proposals/`. L'identité est `ATLAS_ACCOUNT` ; pour valider sous un autre compte, on relance le serveur avec un autre `ATLAS_ACCOUNT`.

```sh
J='Content-Type: application/json'
DOC=$(python3 -c 'import json; t=open("../examples/espace-nordis/kpis/revenu-net.yaml").read().replace("net des avoirs","net des avoirs et remises"); print(json.dumps({"document_yaml":t,"justification":"Remises incluses.","base_version":4}))')
curl -H "$H" -H "$J" -d "$DOC" $API/groupe-nordis/proposals                       # en julien.h
curl -H "$H" -H "$J" -d '{"event":"approve"}' $API/groupe-nordis/proposals/1/reviews  # en marc.d, puis en claire.m
curl -H "$H" -X POST $API/groupe-nordis/proposals/1/merge
```

Ce qu'on doit voir :

- **Proposition** : branche `prop/revenu-net-canonical-1`, version 5, `approvals: {obtained: 0, required: 2}` (Finance exige deux validations canoniques).
- **Décompte** : l'approbation de `anna.k` (contributrice) ou de `sami.b` (Supply) ne compte pas ; celles de `marc.d` et `claire.m` mettent `ready_to_merge` à `true`.
- **Fusion** : le tag `doc/revenu-net/v5` est posé, le commit porte `Atlas-Review: approved by claire.m, marc.d`, et la fiche de Revenu net passe en v5.
- **Gouvernance** : `GET $API/groupe-nordis/governance` signale que Marketing n'a pas de référent. `julien.h` est le seul référent d'espace : sa proposition de gouvernance est prête sans revue (`merge_mode: no_other_eligible`, ADR 0008).

## Compiler et exécuter (plan 0007)

Depuis `core/` :

```sh
uv run atlas compile ../examples/espace-nordis/kpis/revenu-net.yaml --dialect databricks
uv run atlas compile ../examples/espace-nordis/kpis/revenu-net.yaml --dialect duckdb --period FY2026_Q1 --by entite
uv run atlas run ../examples/espace-nordis/kpis/revenu-net.yaml --data tests/fixtures/compile/revenu-net
```

Ce qu'on doit voir :

- **SQL** : une CTE par nœud (`n01` à `n07`), la CTE `cal_fiscal_nordis` tirée de `calendars/fiscal-nordis.yaml`, puis deux contrôles :
  - `chk_n07_right` vérifie que la date comptable est unique par jour ;
  - `chk_n04_calendar` vérifie que chaque date tombe dans le calendrier.
- **Exécution** : le revenu net par mois et par entité. La facture du 31 octobre compte en novembre, mois de sa date comptable.
