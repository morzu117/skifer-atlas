# skifer-atlas (core)

Cœur Python du module Skifer Atlas et API locale servie en sidecar de l'application de bureau. Voir le README à la racine du dépôt.

## CLI `atlas`

```sh
uv run atlas validate tests/fixtures/documents/*.yaml          # 0 si tout est valide, 1 sinon
uv run atlas validate --format json fichier.yaml               # erreurs {path, node_id, code, message}
uv run atlas schema --out schemas/atlas-document.v1.schema.json

uv run atlas check tests/fixtures/documents/revenu-net.yaml   # graphe, colonnes, sémantique figée
uv run atlas check --with revenu-net.yaml revenu-net--nordis-de.yaml   # une variante se contrôle résolue
uv run atlas resolve revenu-net--nordis-de.yaml revenu-net.yaml --out resolu.yaml
uv run atlas normalize revenu-net.yaml                         # forme normalisée atlas1
uv run atlas fingerprint revenu-net.yaml                       # sha256:atlas1:…
uv run atlas diff revenu-net.yaml revenu-net--nordis-de.yaml   # 0 identiques, 2 écarts, 3 écart critique
uv run atlas diff a.yaml b.yaml --format json                  # rapport conforme à schemas/diff-report.v1.schema.json
uv run atlas extract script.sql --dialect databricks --out brouillons   # 0 tout traduit, 2 résidus à revoir, 3 à reprendre
uv run atlas extract notebook.py --dialect snowflake --format json      # brouillons sur stdout, rapport sur stderr

uv run atlas compile ../examples/espace-nordis/kpis/revenu-net.yaml --dialect snowflake   # SQL d'un dialecte
uv run atlas compile revenu-net.yaml --period FY2026_Q1 --perimeter entite:in:FR --by entite
uv run atlas compile revenu-net.yaml --compilability          # statut JSON par dialecte ; 2 si un dialecte est exclu
uv run atlas run ../examples/espace-nordis/kpis/revenu-net.yaml --data tests/fixtures/compile/revenu-net   # CSV
uv run atlas compare ../examples/espace-nordis revenu-net --variants nordis-de,nordis-fr --scope fy2026-mois-entite --duckdb-data tests/fixtures/compare/revenu-net   # 0 dans la tolérance, 2 écarts
uv run atlas compare groupe-nordis revenu-net --variants nordis-de --period FY2026_Q4 --by mois_fiscal,entite --format json   # espace du registre, sur ses points d'accès
```

`--with` fournit les KPI référencés par `kpi_ref` et le canonique d'une variante. `check` sort en 1 s'il reste une erreur ; avertissements et infos n'empêchent rien.

Le modèle des documents (dix types de nœuds, concept, KPI, déclinaison) est dans `src/skifer_atlas/model/` ; spécification : `docs/plans/0001-*.md` (modèle), `docs/plans/0002-*.md` (contrôles, résolution, empreinte), `docs/plans/0003-*.md` (diff, dans `src/skifer_atlas/diff/`) et `docs/plans/0004-*.md` (extraction, dans `src/skifer_atlas/extract/` ; brouillons : ADR 0006). Exemples dans `tests/fixtures/documents/`, contre-exemples dans `tests/fixtures/documents-invalid/`.

`atlas extract` écrit un brouillon par requête (`SELECT`, `CREATE … AS SELECT`, `INSERT … SELECT`) d'un script `.sql` ou d'un notebook `.py`/`.ipynb`. Un brouillon marque `TODO` ce que le SQL ne dit pas et liste ses résidus dans `extraction.residues` ; s'il en reste un bloquant, il est en `status: needs_curation`. Démonstration : `examples/extraction/`.

`atlas compile` produit le SQL Databricks, Snowflake ou DuckDB d'un document : une CTE par nœud, et des contrôles de cardinalité qui font échouer la requête en citant le nœud. Les calendriers fiscaux sont lus dans le dossier `calendars/` de l'espace, ou dans celui que désigne `--calendars`. `atlas run` charge chaque source depuis `<dossier>/<table>.csv` (ou `.parquet`) dans une base DuckDB en mémoire, puis exécute le SQL DuckDB. Spécification : `docs/plans/0007-*.md`, choix de forme : ADR 0010.

`atlas compare` exécute le canonique, rebranché sur les sources de chaque déclinaison, puis la déclinaison, sur le scope choisi. Il compare ensuite les deux, cellule par cellule. Avec `--duckdb-data`, tout tourne dans DuckDB : chaque table se lit dans `<dossier>/<entité>/<table>.csv`. Sinon, chaque déclinaison passe par le point d'accès de son entité, avec les identifiants de l'utilisateur. Les résultats vont dans `atlas.duckdb`, schéma `results` (dans un fichier temporaire pour un dossier, sauf `--db`). Spécification : `docs/plans/0009-*.md`, choix : ADR 0012.

## API locale

Le serveur n'écoute que sur `127.0.0.1` et refuse de démarrer sans token de session : dans l'application, Tauri choisit le port et génère le token (`ATLAS_PORT`, `ATLAS_TOKEN`). Les données (registre des espaces, clones, index `atlas.duckdb`) sont dans le dossier de données de l'utilisateur, ou dans `ATLAS_DATA_DIR` s'il est défini.

```sh
export ATLAS_TOKEN=$(openssl rand -hex 16)
ATLAS_PORT=8765 uv run skifer-atlas-server
ATLAS_DEV_NO_TOKEN=1 uv run skifer-atlas-server   # mode dev seul : interface dans un navigateur, sans Tauri
```

Routes des plans 0005 et 0006, toutes avec l'en-tête `Authorization: Bearer <token>` :

```sh
H="Authorization: Bearer $ATLAS_TOKEN"; API=http://127.0.0.1:8765/api/workspaces
curl -H "$H" $API                                                     # espaces du registre local, avec counts {kpi, concept, open_proposals}
curl -H "$H" -H 'Content-Type: application/json' -d '{"id":"acme","name":"Acme","sector":"Industrie","entities":["acme-fr"]}' $API
curl -H "$H" -H 'Content-Type: application/json' -d '{"remote_url":"/chemin/vers/depot.git"}' $API/join
curl -H "$H" -X POST $API/acme/sync                                   # fetch + avance rapide, 409 sync_conflict si divergence
curl -H "$H" "$API/acme/catalog?q=ca%20net&domain=finance&kind=kpi"   # aussi owner=, status=
curl -H "$H" $API/acme/catalog/facets                                 # valeurs des filtres, avec libellés (plan 0011)
curl -H "$H" $API/acme/index                                          # {fresh} : false si la prochaine lecture reconstruit
curl -H "$H" $API/acme/documents/revenu-net/summary                   # aperçu : variation, déclinaisons, référencé par, dernière comparaison
curl -H "$H" $API/acme/documents/revenu-net                           # ligne d'index, diagnostics, YAML
curl -H "$H" $API/acme/documents/revenu-net/versions                  # tags doc/<id>/v<n>
curl -H "$H" $API/acme/documents/revenu-net/versions/3                # contenu exact au tag
curl -H "$H" $API/acme/documents/revenu-net/dependencies              # references, referenced_by, impact
curl -H "$H" $API/acme/documents/revenu-net/sheet                     # fiche (plan 0012) : aperçu, validation, sémantique, déclinaisons, implémentations, scopes
curl -H "$H" "$API/acme/documents/revenu-net/layout?version=3"         # graphe disposé (couche, rang) et texte des cartes ; sans version : la courante
curl -H "$H" "$API/acme/documents/revenu-net/diff?base=3&other=4"      # écarts entre deux versions (plan 0003)
curl -H "$H" -X POST $API/acme/documents/revenu-net/implementations/acme-fr/databricks/extract  # SQL extrait et diff au canonique
curl -H "$H" $API/acme/documents/revenu-net/draft                     # YAML courant, version incrémentée
```

Éditeur de graphe (plan 0013). Le document circule en JSON, le YAML n'est rendu que par le serveur, dans l'ordre canonique ; brouillons et positions sont dans le dossier de l'espace (`.atlas/drafts/`, `.atlas/layout/`), hors dépôt :

```sh
J='Content-Type: application/json'; ED=$API/acme/editor
curl -H "$H" $ED/documents/revenu-net                                 # copie en v5, brouillon et positions, vocabulaire fermé, calendriers, domaines
curl -H "$H" -H "$J" -d '{"document":{…},"node_id":"n03"}' $ED/check  # problèmes, état (schéma, cycle, compilable), colonnes par nœud, SQL du nœud, YAML
curl -H "$H" -H "$J" -d '{"text":"label: [ouvert"}' $ED/parse          # YAML → document, ou le problème et sa ligne
curl -H "$H" -H "$J" -d '{"kind":"kpi","id":"marge-nette","label":"Marge nette","domain":"finance","owner":"claire.m"}' $ED/documents  # 409 document_exists si l'id est pris
curl -H "$H" -X PUT -H "$J" -d '{"document":{…},"positions":{},"highest":7,"base_version":4}' $ED/documents/revenu-net/draft
curl -H "$H" -X DELETE $ED/documents/revenu-net/draft
curl -H "$H" -H "$J" -d '{"document":{…}}' $ED/preview                 # nature de la proposition, validations requises, diff à la version courante
```

Propositions et gouvernance (plan 0006). `document_yaml` est le document entier ; `base_version` est la version courante du document, `null` pour un nouveau :

```sh
J='Content-Type: application/json'
curl -H "$H" -H "$J" -d '{"document_yaml":"…","justification":"Remises incluses.","base_version":4}' $API/acme/proposals
curl -H "$H" "$API/acme/proposals?domain=finance&status=open"         # aussi kpi=, author=, entity= ; status=merged|closed|all
curl -H "$H" "$API/acme/proposals?for_me=true"                        # celles qui attendent ma revue (awaiting_me)
curl -H "$H" $API/acme/proposals/1                                    # justification, diff, revues, commentaires, YAML
curl -H "$H" -H "$J" -d '{"body":"Et les avoirs ?"}' $API/acme/proposals/1/comments
curl -H "$H" -H "$J" -d '{"event":"approve"}' $API/acme/proposals/1/reviews   # ou request_changes
curl -H "$H" -X POST $API/acme/proposals/1/merge                      # 409 not_ready tant que le décompte n'y est pas
curl -H "$H" $API/acme/governance                                     # gouvernance, diagnostics, rôle, single_referent
curl -H "$H" -H "$J" -d '{"governance":{…},"justification":"…"}' $API/acme/governance
curl -H "$H" -H "$J" -d '{"remote_url":"/chemin/vers/depot.git"}' $API/acme/remote
```

L'hébergeur se déduit de l'adresse du dépôt : GitHub (`https://github.com/…` ou SSH), ou un dépôt nu local (`LocalHost`, pour les tests et les démonstrations). Variables d'environnement, en attendant le coffre (plan 0008) :

- `ATLAS_GITHUB_TOKEN` : le jeton GitHub. Git le reçoit par un assistant d'identification, jamais dans l'URL ni dans `.git/config` (ADR 0009) ;
- `ATLAS_GITHUB_API_URL` : l'API de GitHub Enterprise, ou un faux serveur ;
- `ATLAS_ACCOUNT` : l'identité de l'utilisateur avec un dépôt local. À défaut, c'est le nom Git de l'utilisateur.

Les compteurs de la liste des espaces se calculent sans réseau : l'index du clone, et les propositions ouvertes qui attendent la revue de l'utilisateur d'après le dernier fetch (`awaiting_me` : un autre auteur, un compte habilité, pas encore d'avis sur le dernier commit). Un compteur indisponible vaut `null`.

Une erreur métier répond `{"detail": {"code", "message"}}`, plus `issues` quand il y a des diagnostics (`workspace_exists`, `sync_conflict`, `credentials_in_url`, `stale_base`, `not_ready`, `invalid_document`, `branch_protected`, `git_missing`…). Le dépôt d'un espace (`src/skifer_atlas/repo/`) et son index (`src/skifer_atlas/index/`) suivent `docs/plans/0005-*.md` et l'ADR 0007 ; la gouvernance, les hébergeurs et les propositions (`governance/`, `githost/`, `proposals/`) suivent `docs/plans/0006-*.md` et les ADR 0008 et 0009. Le test réel contre GitHub ne tourne qu'avec `ATLAS_GITHUB_TEST_REPO=owner/repo` et `ATLAS_GITHUB_TOKEN` : `uv run pytest -m github`. Démonstration : `examples/espace-nordis/`.

Connexions aux plateformes (plan 0008). Les points d'accès, sans secret, sont dans `access_points.yaml` à la racine du dépôt de l'espace ; les identifiants de l'utilisateur sont dans le trousseau de l'OS, service `skifer-atlas`, compte `<espace>/<point d'accès>`. Aucune route ne renvoie de jeton :

```sh
curl -H "$H" $API/acme/connections                                    # points d'accès, my_access: connected|expired|never
curl -H "$H" -H "$J" -d '{"access_point":{"id":"dbx-fr","platform":"databricks","host":"https://adb-….azuredatabricks.net","warehouse_id":"…","schema":"gold.finance","owner":"claire.m"},"justification":"…"}' $API/acme/connections   # proposition
curl -H "$H" -X POST $API/acme/connections/dbx-fr/authorize           # {authorize_url} à ouvrir dans le navigateur
curl -H "$H" $API/acme/connections/dbx-fr/status                      # état, flux OAuth en cours ; rafraîchit au besoin
curl -H "$H" -X PUT -H "$J" -d '{"token":"dapi…"}' $API/acme/connections/dbx-fr/token   # repli : token personnel
curl -H "$H" -X POST $API/acme/connections/dbx-fr/test                # {ok, latency_ms, error}
curl -H "$H" -X DELETE $API/acme/connections/dbx-fr/token             # retire du coffre, révoque côté Databricks
```

L'OAuth utilise par défaut le client `databricks-cli`, dont la redirection est `http://localhost:8020` : le port doit être libre pendant la connexion (`oauth_port_busy` sinon). `oauth_client_id` et `oauth_redirect_port` se règlent par point d'accès. Sans trousseau utilisable, la réponse est `vault_unavailable` : Atlas ne range rien ailleurs. `ATLAS_VAULT=memory` remplace le trousseau par un coffre en mémoire du processus, pour les tests et les démonstrations. Le test réel contre un SQL warehouse ne tourne qu'avec `ATLAS_DATABRICKS_HOST`, `ATLAS_DATABRICKS_WAREHOUSE` et `ATLAS_DATABRICKS_TOKEN` : `uv run pytest -m databricks`. Voir `docs/plans/0008-*.md` et l'ADR 0011.

Comparaisons chiffrées (plan 0009). Tout est préparé avant la première requête : un accès manquant répond 409 `needs_auth` avec la liste des points d'accès, sans rien exécuter. `ATLAS_COMPARE_DATA=<dossier>` fait tourner les comparaisons du serveur en local dans DuckDB, sans point d'accès ni coffre, pour les tests et les démonstrations :

```sh
curl -H "$H" -H "$J" -d '{"kpi_id":"revenu-net","variants":["nordis-de","nordis-fr"],"scope_id":"fy2026-mois-entite"}' $API/acme/comparisons   # 202 {id, status, alerts}
curl -H "$H" -H "$J" -d '{"kpi_id":"revenu-net","variants":["nordis-de"],"scope":{"period":{"calendar_period":"FY2026_Q4"},"granularity":["entite"]},"tolerance":2}' $API/acme/comparisons
curl -H "$H" $API/acme/comparisons/1                                  # progression, puis exécutions, synthèses, cellules
curl -H "$H" -X POST $API/acme/comparisons/1/cancel                   # 409 not_running si elle est terminée
curl -H "$H" "$API/acme/comparisons?kpi=revenu-net&limit=20"          # historique, sans les cellules
curl -H "$H" "$API/acme/comparisons/matrix?domain=finance"            # dernier résultat par KPI × déclinaison
```

Tolérance : celle de la requête, sinon celle du KPI, sinon `tolerance.percent` de `governance.yaml`, sinon 1 %. Statuts : `running`, `done`, `partial`, `failed`, `cancelled`, et `interrupted` pour une comparaison restée en cours après l'arrêt du serveur. La colonne Convergence du catalogue en découle : `never_compared`, `converged`, `divergences:n` (écart sur une surcharge) ou `candidates:n` (écart sur une déclinaison from scratch seulement, ADR 0015).
