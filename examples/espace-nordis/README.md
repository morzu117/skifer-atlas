# Démonstration : l'espace Groupe Nordis (plans 0005 à 0012)

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

`examples/depot-nordis.sh` fait de ce dossier un dépôt nu « distant », que l'on rejoint ensuite. Le dépôt garde l'historique de Revenu net :

- v1 (Claire M., 15 janvier 2026) : chiffre d'affaires hors taxes ;
- v2 (Claire M., 9 mars) : déduction des avoirs ;
- v3 (Marc D., 2 juin) : points de variation déclarés ;
- v4 (Claire M., 12 octobre) : mois fiscal sur la date comptable.

Les trois premières versions sont dans [`../historique-nordis/`](../historique-nordis/). Chaque commit porte le tag `doc/revenu-net/v<n>`, et Commande le tag `doc/commande/v5`. Depuis la racine du dépôt Skifer Atlas :

```sh
DEMO=$(mktemp -d)
examples/depot-nordis.sh "$DEMO"            # $DEMO/travail et $DEMO/distant.git

cd core
export ATLAS_TOKEN=demo ATLAS_DATA_DIR="$DEMO/donnees"
ATLAS_ACCOUNT=julien.h uv run skifer-atlas-server &

H="Authorization: Bearer demo"; API=http://127.0.0.1:8765/api/workspaces
curl -H "$H" -H 'Content-Type: application/json' -d "{\"remote_url\":\"$DEMO/distant.git\"}" $API/join
curl -H "$H" "$API/groupe-nordis/catalog?q=ca%20net"
curl -H "$H" $API/groupe-nordis/documents/revenu-net/dependencies
curl -H "$H" $API/groupe-nordis/documents/revenu-net/sheet
curl -H "$H" "$API/groupe-nordis/documents/revenu-net/diff?base=3&other=4"
```

Ce qu'on doit voir :

- **Adhésion** : l'espace `groupe-nordis`, compte `julien.h`, rôle `referent` (référent d'espace dans `governance.yaml`), domaines finance, ventes, supply et marketing.
- **Recherche** : « ca net » trouve Revenu net par son synonyme « CA net ». Sans filtre, le catalogue liste les sept concepts et KPI ; Revenu net a trois variantes, `convergence: never_compared` tant qu'aucune comparaison chiffrée n'existe (plan 0009). Après une comparaison de nordis-de et nordis-fr, `divergences:1` : nordis-de, une surcharge, s'écarte. Un écart de nordis-es, from scratch, donnerait `candidates:1` (ADR 0015).
- **Dépendances de Revenu net** : Commande et Date de référence en références, Marge brute et Panier moyen en « référencé par », `impact: 2`.
- **Versions** : `…/documents/revenu-net/versions` liste les tags v1 à v4, `…/versions/3` rend le fichier tel qu'il était à ce tag.
- **Fiche** (plan 0012) : `…/sheet` donne la v4 validée le 2026-10-12, deux validateurs requis, trois déclinaisons et quatre versions. `…/layout` place n01 à n07 en couches, avec n03 et n04 en points de variation.
- **Diff de v3 à v4** : trois écarts. n04 (le mois fiscal passe sur la date comptable) est à examiner ; l'ajout de n06 et n07 est critique.
- **Implémentation** : `POST …/implementations/nordis-fr/databricks/extract` extrait le SQL de l'entité française et le compare au canonique.
- **Brouillon** : `…/draft` rend la v4 avec `version: 5`, base de « Proposer une modification ».
- **Éditeur** (plan 0013) : `…/editor/documents/revenu-net` ouvre la copie en v5 (`highest: 7`, le prochain nœud sera n08) ; `…/editor/check` la déclare « Schéma valide · Sans cycle · Compilable Databricks, Snowflake ». Retirer `nulls` de n02 donne une erreur sur n02 et bloque la soumission. Sur `revenu-net--nordis-fr`, remplacer n02, hors des points déclarés n03 et n04, donne un avertissement et une proposition de nature `undeclared` (validation canonique).

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

## Écran des propositions (plan 0014)

`examples/propositions-nordis.py` ouvre sur le dépôt les cinq propositions de la maquette 10.4, avec leurs revues et un commentaire. Chaque auteur et chaque validateur agit sous son compte, dans un dossier de données temporaire. À lancer avant de rejoindre l'espace, sur un dépôt neuf :

```sh
examples/depot-nordis.sh "$DEMO"
uv run --project core python examples/propositions-nordis.py "$DEMO/distant.git"
```

Ce qu'on doit voir dans Propositions, en `claire.m` (référente Finance) :

- **File** : « Mes domaines » par défaut, quatre propositions Finance :
  - nordis-de v4 et nordis-fr v3, « Hors points déclarés », 0 / 2 (canonique requis) ;
  - Revenu net v5, 1 / 2 ;
  - nordis-es v2, « From scratch », 1 / 2.

  « Tous les domaines » ajoute Taux de service v3, Supply, 1 / 1, prête à fusionner.
- **nordis-de** :
  - le bandeau orange nomme n02 et le fuseau horaire, et suggère un point de variation : nordis-de et nordis-fr surchargent tous deux n02 ;
  - à droite, n02 est « modifié · Divergence critique » et n03 « surchargé · Normal » ;
  - sous le diff, la liste des trois écarts, puis la justification d'Anna K. et le commentaire de Claire M.
- **Boutons** : en `anna.k`, « Approuver » est grisé (l'auteure ne compte pas), et en `sami.b` aussi (Supply). Après les approbations de `claire.m` et `marc.d`, « Fusionner » remplace les boutons. La fusion pose `doc/revenu-net--nordis-de/v4`.

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

## Déclarer un point d'accès et s'y connecter (plan 0008)

L'espace ne déclare encore aucun point d'accès. Serveur lancé comme plus haut, avec en plus `ATLAS_VAULT=memory` pour ne rien écrire dans le trousseau de la machine :

```sh
AP='{"id":"dbx-fr","platform":"databricks","host":"https://adb-1234567890123456.7.azuredatabricks.net","warehouse_id":"abc123","schema":"gold.finance","entity":"nordis-fr","owner":"claire.m","freshness":"quotidienne, 6 h"}'
curl -H "$H" -H "$J" -d "{\"access_point\":$AP,\"justification\":\"Entrepôt France.\"}" $API/groupe-nordis/connections
curl -H "$H" -X POST $API/groupe-nordis/proposals/2/merge             # numéro rendu par la proposition
curl -H "$H" $API/groupe-nordis/connections
curl -H "$H" -X PUT -H "$J" -d '{"token":"dapi-factice"}' $API/groupe-nordis/connections/dbx-fr/token
curl -H "$H" -X POST $API/groupe-nordis/connections/dbx-fr/test
```

Ce qu'on doit voir :

- **Déclaration** : une proposition de nature `access_points`, branche `prop/access-point-dbx-fr-…`. `julien.h` est le seul référent d'espace : elle est prête sans revue, et sa fusion ajoute `access_points.yaml`, sans aucun secret, sur `main`. Une plateforme absente d'`allowed_platforms` (`bigquery`, par exemple) est refusée : `invalid_access_point`, diagnostic `platform_not_allowed`.
- **Connexions** : `dbx-fr` avec `my_access: never`, puis `connected` et `auth: pat` après le token personnel ; le token n'apparaît dans aucune réponse.
- **Test** : l'hôte de la démonstration n'existe pas, donc `{"ok": false, "error": {"code": "host_unreachable", …}}`. Avec un vrai hôte et `POST …/dbx-fr/authorize`, l'URL rendue ouvre la connexion Databricks dans le navigateur.

## Comparer les déclinaisons (plan 0009)

Revenu net déclare deux scopes : `fy2026-mois-entite` (février à septembre 2026, par mois fiscal et entité) et `fy2026-t4`. Sa tolérance est de 1,5 % ; celle de l'espace, dans `governance.yaml`, est de 1 %. Les données de test sont dans `core/tests/fixtures/compare/revenu-net/`, un dossier par entité. Depuis `core/` :

```sh
uv run atlas compare ../examples/espace-nordis revenu-net --variants nordis-de,nordis-fr --scope fy2026-mois-entite --duckdb-data tests/fixtures/compare/revenu-net
uv run atlas compare ../examples/espace-nordis revenu-net --variants nordis-de --scope fy2026-mois-entite --tolerance 1 --duckdb-data tests/fixtures/compare/revenu-net
uv run atlas compare ../examples/espace-nordis revenu-net --variants nordis-es --scope fy2026-t4 --duckdb-data tests/fixtures/compare/revenu-net
```

Ce qu'on doit voir :

- **Nordis DE** : 93,8 % de validation sur 16 cellules, écart maximal 6,10 % en septembre. Juillet à septembre reprennent la maquette 10.5 : +0,2 %, +1,43 %, +6,10 %. Le nœud divergent est n02, le filtre « Factures validées », surchargé hors des points de variation déclarés. La comparaison sort en 2.
- **Tolérance** : avec `--tolerance 1`, l'écart de 1,43 % d'août sort aussi de la tolérance, et la validation tombe à 87,5 %.
- **Nordis FR** : 100 % sur 8 cellules.
- **Nordis ES** : `canonical_not_rebindable`. Ses tables `from_scratch` n'ont pas les colonnes du canonique, qui ne peut donc pas s'exécuter sur ses données.

Depuis l'API, sur un espace rejoint comme plus haut mais sans la fusion du plan 0006 (Revenu net en v4), on relance le serveur avec `ATLAS_COMPARE_DATA="$PWD/tests/fixtures/compare/revenu-net"` :

```sh
curl -H "$H" -H "$J" -d '{"kpi_id":"revenu-net","variants":["nordis-de","nordis-fr"],"scope_id":"fy2026-mois-entite"}' $API/groupe-nordis/comparisons
curl -H "$H" $API/groupe-nordis/comparisons/1
curl -H "$H" "$API/groupe-nordis/comparisons/matrix?domain=finance"
curl -H "$H" "$API/groupe-nordis/catalog?q=revenu"
```

Ce qu'on doit voir :

- **Création** : 202, `{"id": 1, "status": "running", "alerts": [{"code": "undeclared_override", …}]}`.
- **Résultat** : `status: done`, les quatre requêtes exécutées (canonique et déclinaison pour chaque entité) avec leur SQL, puis les synthèses et les cellules.
- **Matrice et catalogue** : DE à 93,75 %, FR à 100 %, ES non comparée ; Revenu net passe en `convergence: divergences:1`.
- **Après la fusion du plan 0006** : Revenu net est en v5, mais ses déclinaisons portent encore sur la v4. La comparaison répond 409 `variant_outdated`.
- **Sans `ATLAS_COMPARE_DATA`** : la comparaison passe par les points d'accès. Sans point d'accès déclaré pour l'entité, la réponse est `no_access_point`. Sans accès dans le coffre, elle est 409 `needs_auth`, et rien n'est exécuté.

## Écran de comparaison (plan 0015)

Serveur lancé avec `ATLAS_COMPARE_DATA` comme plus haut, Revenu net en v4. Ce qu'on doit voir dans Comparaison :

- **Lancement** :
  - Revenu net (v4) est présélectionné ;
  - nordis-de et nordis-fr sont cochées. nordis-es est grisée, avec « Non comparable : Le canonique ne se rebranche pas sur les sources de « nordis-es » … » ;
  - scope `fy2026-mois-entite`, du 1er février au 30 septembre 2026, par Mois fiscal × Entité ;
  - « Tolérance : 1,5 % (globale 1 % · KPI 1,5 %) » ;
  - avant tout lancement, le bandeau orange « Surcharge hors des points déclarés » cite semantics.timezone et n02 sur nordis-de.
- **Après « Lancer la comparaison »** :
  - une barre Databricks · nordis-de, nordis-fr, puis « Relancer » ;
  - dans la matrice, Revenu net × nordis-de à 94 % / 6,1 % en orange, nordis-fr à 100 % / 0,0 % en vert, et nordis-es « — ».
- **Détail** :
  - « Nœud divergent : n02 · Factures validées » ;
  - Sept. 2026 · DE à +6,1 %, en rouge, avec « hors tolérance », sur fond orange pâle ;
  - la valeur exacte s'affiche au survol.

  Le lien ouvre la fiche de nordis-de sur « Écarts au canonique », avec n02 entouré dans les deux graphes.
- **Historique** : les trois dernières comparaisons, puis « Tout voir », filtrable par KPI, utilisateur et date.

## Écran Mes connexions (plan 0016)

`examples/points-acces-nordis.py` déclare sur le dépôt les trois points d'accès de la maquette 10.6. Julien H., seul référent d'espace, propose et fusionne seul chacun d'eux. Le script écrit dans un dossier de données temporaire et n'écrit aucun secret. dbx-fr pointe vers l'hôte donné : un vrai espace Databricks en https, ou le faux Databricks des tests.

```sh
examples/depot-nordis.sh "$DEMO"
uv run --project core python core/tests/connections/fake_databricks.py 8796 &
uv run --project core python examples/points-acces-nordis.py "$DEMO/distant.git" http://127.0.0.1:8796
```

Ce qu'on doit voir dans Mes connexions, en `anna.k` :

- **Tableau** :
  - Databricks · nordis-fr, `gold.finance`, Claire M., « Quotidienne · 06:10 », « Jamais connecté », bouton « Se connecter » ;
  - Snowflake · nordis-de (Anna K.) et nordis-es (Sofia R.), « Bientôt dans Atlas » jusqu'au plan 0018.
- **Se connecter** : la page d'autorisation s'ouvre dans le navigateur. Avec le faux Databricks, elle revient aussitôt sur « Connexion réussie ». La ligne passe à « Connecté · session OAuth », sans recharger. « Tester » donne « Connexion OK · n ms ». « Révoquer » ramène à « Jamais connecté ».
- **Nouveau point d'accès** :
  - Databricks, et Snowflake grisé « (bientôt) » ;
  - entité nordis-de, identifiant `dbx-de`.

  Avec l'hôte `http://127.0.0.1:8796` et le warehouse `abc123`, « S'authentifier avec OAuth » puis « Tester la connexion » réussissent. « Proposer le point d'accès » ouvre une proposition sur `access_points.yaml`.
- **Repli** : si l'OAuth échoue sur une ligne Databricks, le lien « Utiliser un token personnel » ouvre un champ masqué. Il n'apparaît jamais autrement.
