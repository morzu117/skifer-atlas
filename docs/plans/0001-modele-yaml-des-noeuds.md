# Plan 0001 — Modèle des dix nœuds et YAML versionné

> **Décisions du 30 octobre 2026** (analyse §6) : graphe dans un bloc `graph:` du document Skifer (ADR 0002) ; concept = entité sémantique, avec graphe optionnel ; surcharge = remplacement d'un nœud entier. Pas de table de paramètres (taxes ou autres) : la déduction des taxes est un nœud de calcul déclaré point de variation.

## Objectif
Un fichier YAML de concept, de KPI ou de variante se charge en modèle typé, se réécrit à l'identique et se valide contre un JSON Schema publié ; tout ce qui sort du vocabulaire fermé est rejeté avec un message qui nomme le nœud et le champ.

## Périmètre
**Dedans** : modèles pydantic des trois sortes de documents et des dix nœuds ; chargement et écriture YAML déterministes ; JSON Schema généré et versionné ; validation de schéma (forme, types, valeurs fermées) ; CLI `atlas validate` et `atlas schema`.
**Dehors** : règles de graphe (cycles, ports, colonnes disponibles), normalisation et résolution des surcharges (plan 0002) ; diff (0003) ; compilation (0007) ; toute API HTTP ou UI.

## Références
Brief 3.3 à 3.6, 4.1, 4.2, 9 ; guide de style 10.3, tableau des champs obligatoires ; ADR 0002, 0003 ; moteur `skifer/core/op_catalog.py` (`FILTER_OPERATORS`, `COLUMN_OPS`, `AGGREGATE_FUNCTIONS`), `skifer/core/schema_loader.py` (bloc `data_product`), `docs/yaml_spec.md` (calendriers).
Fichiers créés : `core/src/skifer_atlas/model/{__init__,document,nodes,variants,io,jsonschema}.py`, `core/src/skifer_atlas/cli.py`, `core/schemas/atlas-document.v1.schema.json`, `core/tests/model/`, `core/tests/fixtures/documents/`.

## Spécification

### Format d'un document

```yaml
schema_version: 1                 # entier, requis ; seule valeur acceptée : 1
kind: kpi                         # concept | kpi | variant
data_product:                     # bloc du moteur Skifer, réutilisé
  id: revenu-net                  # requis ; ^[a-z0-9][a-z0-9-]{1,63}$ ; unique dans l'espace ; n'inclut PAS le domaine
  version: 4                      # entier >= 1 (le moteur attend du semver : écart signalé, ADR 0003)
  owner: claire.m                 # requis
  domain: finance                 # requis pour concept et kpi
  description: "Chiffre d'affaires facturé, taxes déduites, net des avoirs."
label: Revenu net                 # requis
synonyms: [CA net, net revenue]   # optionnel
semantics:                        # requis pour kind: kpi
  calendar: {key: fiscal-nordis, version: "2026.1"}   # ou {key: civil}
  timezone: Europe/Paris          # nom IANA, validé par zoneinfo
  currency: EUR                   # optionnel, ISO 4217
variation_points: [n03, n04]      # optionnel ; identifiants de nœuds du document, ou attributs `semantics.calendar`, `semantics.timezone`, `semantics.currency`
graph:
  nodes: [...]                    # au moins un nœud
  output: n05                     # requis ; un seul nœud de sortie
```

Pour `kind: concept` : `semantics` est absent ; on déclare `entity: {key: [client_id], attributes: [{name, type}]}` ; `graph` est optionnel et, s'il est présent, sa sortie ne doit pas être agrégée (vérifié au plan 0002).

### Champs communs à tout nœud
`id` (requis, `^n[0-9]{2,4}$`, unique dans le document), `type` (requis, l'une des dix valeurs ci-dessous), `label` (optionnel), `note` (optionnel, « pourquoi ce nœud »), `inputs` (selon le type). Une clé inconnue est une erreur (`extra="forbid"`).

### Les dix types
Les identifiants de type sont en anglais ; le libellé français vient de l'UI.

| `type` | `inputs` | Champs requis | Champs optionnels | Valeurs fermées |
|---|---|---|---|---|
| `source` | aucun | `platform`, `table` (FQN), `owner`, `columns[]` {`name`, `type`} | `concept` + `binding` {colonne: attribut}, pour chaque colonne `date`/`timestamp` : `timezone` et `format` (requis dans ce cas) | `platform` ∈ {databricks, snowflake, bigquery, fabric, redshift, duckdb} ; `type` ∈ {string, integer, decimal, double, boolean, date, timestamp} |
| `filter` | `[n]` | `condition`, `nulls` | — | `condition` dans la grammaire Skifer `col:op[:val]` (opérateur ∈ `FILTER_OPERATORS`, sauf `sql`) ou `{expr: "<SQL>"}` ; `nulls` ∈ {keep, drop} |
| `join` | `{left: n, right: n}` | `how`, `keys` [[gauche, droite], …] (≥ 1 sauf `cross`), `cardinality`, `check` | `bypass_reason` (requis si `check: bypass`) | `how` ∈ {inner, left, right, full, cross, left_anti, left_semi} ; `cardinality` ∈ {"1:1", "N:1", "1:N"} ; `check` ∈ {required, bypass} |
| `union` | `[n, n, …]` (≥ 2, l'ordre compte) | `mode`, `columns` [{name, from: {nXX: col}}] | — | `mode` ∈ {all, distinct} |
| `compute` | `[n]` | `column`, `expr` | `type` | `expr` en SQL ; `round` interdit (arrondi à la restitution) |
| `deduplicate` | `[n]` | `keys[]`, `keep` {`order_by`: [[col, asc\|desc], …]} | — | — |
| `aggregate` | `[n]` | `group_by[]` (peut être vide = total), `measures` [[source, cible, fonction]] | `having[]` (grammaire filtre) | fonction ∈ `AGGREGATE_FUNCTIONS` ; `first`/`last` interdits (non déterministes) |
| `temporal` | `[n]` | `operation`, `column`, `target` | selon `operation` | `operation` ∈ {convert_timezone (`to`), to_date (`timezone`), period (`grain` ∈ {day, week, month, quarter, year}, utilise `semantics.calendar`), window (`frame`, `order_by`)} |
| `kpi_ref` | aucun | `kpi` (id), `version` (entier) | `columns[]` exposées | — |
| `metric_op` | `[n]` | `metrics` [{name, expr}], `order` | `aggregate` (requis si `order: rows_first`) | `order` ∈ {aggregate_first, rows_first} |

`expr` est validé ici seulement comme SQL analysable par SQLGlot. La liste blanche de fonctions et les colonnes disponibles relèvent du plan 0002.

### Variantes

```yaml
schema_version: 1
kind: variant
data_product: {id: revenu-net--nordis-de, version: 1, owner: anna.k}
variant_of: {id: revenu-net, version: 4}   # requis
entity: nordis-de                           # requis
mode: override                              # override | from_scratch
justification: "…"                          # requis, non vide
overrides:                                  # requis et non vide si mode: override ; interdit sinon
  - node: n03                               # identifiant d'un nœud du canonique, ou attribut semantics.*
    justification: "TVA allemande à 19 %"   # requis
    replace: {id: n03, type: compute, inputs: [n02], column: montant_ht,
              expr: "montant_ttc / 1.19 - avoirs"}   # nœud complet, même id et même type ; `value:` pour semantics.*
graph: {...}                                # requis si from_scratch ; interdit sinon
concepts: [commande, date-de-reference]     # requis si from_scratch (rattachement)
```

La cohérence avec le canonique (nœud existant, point déclaré ou non) est vérifiée au plan 0002, qui charge les deux documents.

### Sérialisation
- `load_document(path | str) -> Document` ; `dump_document(doc) -> str`.
- Écriture déterministe : ordre des clés fixe (celui des tableaux ci-dessus), listes dans l'ordre déclaré, UTF-8, indentation 2, fin de ligne LF, pas d'alias YAML. `dump(load(x)) == x` pour tout fichier déjà canonique ; un fichier non canonique est réécrit en forme canonique au premier passage, puis stable.
- Les ancres, alias et balises YAML (`!!python/...`) sont refusés : chargement via `yaml.safe_load` et vérification qu'aucun alias n'est utilisé.

### Erreurs
Chaque erreur est `{path, node_id | null, code, message}` ; `path` en notation JSON pointer (`/graph/nodes/3/nulls`). Messages en français. Codes stables, en anglais : `unknown_key`, `missing_field`, `invalid_value`, `unknown_node_type`, `duplicate_node_id`, `unknown_schema_version`, `forbidden_function`.

### CLI
- `atlas validate <fichier>… [--format text|json]` : code de sortie 0 si valide, 1 sinon. Le JSON liste les erreurs ci-dessus.
- `atlas schema [--out fichier]` : écrit le JSON Schema v1. Le fichier `core/schemas/atlas-document.v1.schema.json` est commité et un test vérifie qu'il est à jour.
- Point d'entrée `[project.scripts] atlas = "skifer_atlas.cli:main"`, en argparse (pas de dépendance CLI dynamique, pour PyInstaller).

### Dépendance au moteur
`skifer` est ajouté à `core/pyproject.toml` (chemin `../../skifer` en dev via `[tool.uv.sources]`, sans extra). On importe `FILTER_OPERATORS`, `COLUMN_OPS`, `AGGREGATE_FUNCTIONS` et `resolve_filter_operator`, en acceptant aussi les alias du moteur (`eq`, `=`…), toujours réécrits sous leur forme canonique. Un test vérifie que l'import ne charge pas `pyspark`.

## Critères d'acceptation
1. Les trois fixtures de référence (canonique « Revenu net » : n01 source, n02 filtre statut, n03 calcul « déduction des taxes » (point de variation), n04 temporel mois fiscal (point de variation), n05 agrégation ; surcharge Nordis DE ; from scratch Nordis ES) et un concept « Commande » se valident sans erreur.
2. Pour chacun des dix types, une fixture minimale valide se charge, et le retrait de chaque champ requis produit `missing_field` avec le bon `path` et le bon `node_id`.
3. Une clé inconnue à n'importe quel niveau produit `unknown_key`.
4. `type: pivot` produit `unknown_node_type` ; `schema_version: 2` produit `unknown_schema_version`.
5. Un filtre sans `nulls` est refusé ; une jointure sans `cardinality` ou avec `check: bypass` sans `bypass_reason` est refusée.
6. `round` dans un `compute`, `first` ou `last` dans un `aggregate` sont refusés (`forbidden_function`).
7. Une colonne `timestamp` de source sans `timezone` est refusée.
8. Deux nœuds de même `id` produisent `duplicate_node_id`.
9. `dump(load(f)) == f` pour toutes les fixtures canoniques ; pour une fixture aux clés désordonnées, la seconde réécriture est identique à la première.
10. Un fichier avec ancre ou alias YAML est refusé.
11. Le JSON Schema commité correspond au modèle, et valide les mêmes fixtures que pydantic (même verdict sur tout le corpus).
12. `atlas validate` renvoie 0 ou 1 selon le cas, et sa sortie `--format json` respecte le format d'erreur.
13. `import skifer_atlas.model` ne charge ni `pyspark` ni `fastapi`.
14. Les variantes : `override` sans `overrides`, ou `from_scratch` sans `justification` ou sans `concepts`, sont refusés.

## Tests
- Unitaires : `core/tests/model/test_nodes.py` (paramétré sur les dix types et leurs champs requis), `test_document.py`, `test_variants.py`, `test_io.py` (round-trip, déterminisme, alias refusés), `test_jsonschema.py` (même verdict entre pydantic et JSON Schema sur tout le corpus, schéma à jour).
- Intégration : `test_cli.py` qui exécute `atlas validate` en sous-processus sur le corpus et compare les codes de sortie.
- À la main : `uv run atlas validate core/tests/fixtures/documents/*.yaml` ; lire les messages d'erreur sur trois fichiers volontairement faux.

## Dépendances
Aucune.

## Estimation
**M**. Incertitudes : l'arbitrage Q1 à Q3 ; l'écart entre `version` entier et le semver de `data_product` dans le moteur ; la stabilité des catalogues d'opérateurs importés depuis `skifer`.
