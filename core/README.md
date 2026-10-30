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
```

`--with` fournit les KPI référencés par `kpi_ref` et le canonique d'une variante. `check` sort en 1 s'il reste une erreur ; avertissements et infos n'empêchent rien.

Le modèle des documents (dix types de nœuds, concept, KPI, déclinaison) est dans `src/skifer_atlas/model/` ; spécification : `docs/plans/0001-*.md` (modèle), `docs/plans/0002-*.md` (contrôles, résolution, empreinte), `docs/plans/0003-*.md` (diff, dans `src/skifer_atlas/diff/`) et `docs/plans/0004-*.md` (extraction, dans `src/skifer_atlas/extract/` ; brouillons : ADR 0006). Exemples dans `tests/fixtures/documents/`, contre-exemples dans `tests/fixtures/documents-invalid/`.

`atlas extract` écrit un brouillon par requête (`SELECT`, `CREATE … AS SELECT`, `INSERT … SELECT`) d'un script `.sql` ou d'un notebook `.py`/`.ipynb`. Un brouillon marque `TODO` ce que le SQL ne dit pas et liste ses résidus dans `extraction.residues` ; s'il en reste un bloquant, il est en `status: needs_curation`. Démonstration : `examples/extraction/`.

## API locale

Le serveur n'écoute que sur `127.0.0.1` et refuse de démarrer sans token de session : dans l'application, Tauri choisit le port et génère le token (`ATLAS_PORT`, `ATLAS_TOKEN`). Les données (registre des espaces, clones, index `atlas.duckdb`) sont dans le dossier de données de l'utilisateur, ou dans `ATLAS_DATA_DIR` s'il est défini.

```sh
export ATLAS_TOKEN=$(openssl rand -hex 16)
ATLAS_PORT=8765 uv run skifer-atlas-server
ATLAS_DEV_NO_TOKEN=1 uv run skifer-atlas-server   # mode dev seul : interface dans un navigateur, sans Tauri
```

Routes du plan 0005, toutes avec l'en-tête `Authorization: Bearer <token>` :

```sh
H="Authorization: Bearer $ATLAS_TOKEN"; API=http://127.0.0.1:8765/api/workspaces
curl -H "$H" $API                                                     # espaces du registre local
curl -H "$H" -H 'Content-Type: application/json' -d '{"id":"acme","name":"Acme","sector":"Industrie","entities":["acme-fr"]}' $API
curl -H "$H" -H 'Content-Type: application/json' -d '{"remote_url":"/chemin/vers/depot.git"}' $API/join
curl -H "$H" -X POST $API/acme/sync                                   # fetch + avance rapide, 409 sync_conflict si divergence
curl -H "$H" "$API/acme/catalog?q=ca%20net&domain=finance&kind=kpi"   # aussi owner=, status=
curl -H "$H" $API/acme/documents/revenu-net                           # ligne d'index, diagnostics, YAML
curl -H "$H" $API/acme/documents/revenu-net/versions                  # tags doc/<id>/v<n>
curl -H "$H" $API/acme/documents/revenu-net/versions/3                # contenu exact au tag
curl -H "$H" $API/acme/documents/revenu-net/dependencies              # references, referenced_by, impact
```

Une erreur métier répond `{"detail": {"code", "message"}}` (`workspace_exists`, `sync_conflict`, `credentials_in_url`, `git_missing`…). Le dépôt d'un espace (`src/skifer_atlas/repo/`) et son index (`src/skifer_atlas/index/`) suivent `docs/plans/0005-*.md` et l'ADR 0007. Démonstration : `examples/espace-nordis/`.
