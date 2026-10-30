# skifer-atlas (core)

Cœur Python du module Skifer Atlas et API locale servie en sidecar de l'application de bureau. Voir le README à la racine du dépôt.

## CLI `atlas`

```sh
uv run atlas validate tests/fixtures/documents/*.yaml          # 0 si tout est valide, 1 sinon
uv run atlas validate --format json fichier.yaml               # erreurs {path, node_id, code, message}
uv run atlas schema --out schemas/atlas-document.v1.schema.json
```

Le modèle des documents (dix types de nœuds, concept, KPI, déclinaison) est dans `src/skifer_atlas/model/` ; spécification : `docs/plans/0001-*.md`. Exemples dans `tests/fixtures/documents/`, contre-exemples dans `tests/fixtures/documents-invalid/`.
