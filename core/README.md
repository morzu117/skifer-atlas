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
```

`--with` fournit les KPI référencés par `kpi_ref` et le canonique d'une variante. `check` sort en 1 s'il reste une erreur ; avertissements et infos n'empêchent rien.

Le modèle des documents (dix types de nœuds, concept, KPI, déclinaison) est dans `src/skifer_atlas/model/` ; spécification : `docs/plans/0001-*.md` (modèle) et `docs/plans/0002-*.md` (contrôles, résolution, empreinte). Exemples dans `tests/fixtures/documents/`, contre-exemples dans `tests/fixtures/documents-invalid/`.
