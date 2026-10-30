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
