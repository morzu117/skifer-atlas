# Plan 0004 — Mode extraction : SQL existant vers graphe canonique

## Objectif
`atlas extract` transforme une requête SQL Databricks ou Snowflake existante en document Atlas valide, en signalant explicitement tout ce qu'il ne sait pas traduire ; deux implémentations d'un même KPI extraites puis passées à `atlas diff` montrent leurs divergences.

## Périmètre
**Dedans** : analyse SQLGlot (dialectes `databricks`, `snowflake`) ; traduction de l'AST en nœuds (CTE et sous-requêtes dans `FROM` comprises, `UNION`, `ROW_NUMBER() = 1` en dédoublonnage, conversions de date et de fuseau en `temporal`) ; résidus nommés ; brouillon de document avec champs à compléter ; CLI ; démonstration bout en bout avec `diff`.
**Dehors** : DAX et Power Query (reportés, brief 12) ; lecture de `system.query.history` (pourra réutiliser `skifer.analyzer.history` plus tard) ; écriture dans un dépôt (0005, 0006) ; aucun LLM.

## Références
Brief 6, 6.1 ; ADR 0003 ; moteur `skifer/analyzer/{frontends,parser,mapper,fingerprint}.py`, `docs/project_analyzer.md`, corpus `examples/24_project_analyzer/legacy_sql/` ; plans 0001 à 0003.
Fichiers : `core/src/skifer_atlas/extract/{parse,translate,residues,draft}.py`.

## Spécification

### Réutilisation du moteur
On réutilise `skifer.analyzer.frontends` (découpage des scripts, extraction depuis des notebooks `.py`/`.ipynb`) et `skifer.analyzer.parser.parse_script(path, dialect=…)`. La traduction est propre à Atlas, parce que le mapper du moteur vise le gabarit pipeline et rejette CTE et `UNION`, alors qu'Atlas les traduit en nœuds.

### Traduction (AST → nœuds, parcours de l'intérieur vers l'extérieur)
| Construit SQL | Nœud(s) |
|---|---|
| table de `FROM`/`JOIN` | `source` (platform déduite du dialecte, `table` = FQN, `columns` = colonnes citées, types `unknown` à compléter) |
| `WHERE` (chaque conjonction de haut niveau) | un `filter` par conjonction. `nulls` est déduit : `col <> v` ou `col NOT IN (…)` → `drop` (le SQL exclut les nulls), `col IS NULL OR …` → `keep`. Toujours accompagné d'une info `nulls_inferred` |
| `JOIN … ON a = b` | `join` (`how` traduit, `keys`) ; `cardinality` inconnue → résidu non bloquant `cardinality_unknown`, `check: required` par défaut |
| `UNION [ALL]` | `union` |
| expression de `SELECT` hors colonne simple | `compute` |
| `QUALIFY`/sous-requête `ROW_NUMBER() OVER (PARTITION BY k ORDER BY o) = 1` | `deduplicate` |
| `GROUP BY` + agrégats | `aggregate` ; `HAVING` → `having` |
| `CONVERT_TIMEZONE`, `FROM_UTC_TIMESTAMP`, `TO_DATE`, `DATE_TRUNC` | `temporal` |
| expression sur des agrégats (`SUM(a)/SUM(b)`) | `aggregate` puis `metric_op` (`aggregate_first`) ; `AVG(a/b)` → `compute` puis `aggregate` |
| CTE | les nœuds de la CTE, partagés par chaque référence |
| fonction de fenêtre autre que dédoublonnage, `ROUND`, `NOW`, `LATERAL`, `PIVOT` | résidu bloquant (`window_function`, `rounding_in_definition`, `non_deterministic`, `unsupported_construct`) |

Les `id` sont attribués dans l'ordre topologique (`n01`…), de façon déterministe.

### Résidus
`{code, message, blocking, sql_excerpt_hash}` : jamais de valeur de données ni de nom de table dans le message (même règle que le moteur), pour qu'un rapport se colle dans un ticket. S'il y a un résidu bloquant, le brouillon est produit mais marqué `status: needs_curation`, et `atlas validate` le refuse tant que les résidus ne sont pas levés.

### Brouillon
Document `kind: kpi` (ou `concept` si la sortie n'est pas agrégée) ; `data_product.id` dérivé du nom de fichier ; `owner`, `domain`, `semantics`, `timezone` et `format` des colonnes temporelles sont laissés à `TODO`. La validation (0001, 0002) liste alors précisément ce qui reste à compléter. Un bloc `extraction: {source_file, dialect, sql_sha256, residues}` garde la trace de l'origine. Il est autorisé par le schéma pour `status: draft` uniquement.

### Oracle de fidélité
Pour chaque extraction sans résidu bloquant, on recompile le graphe (plan 0007 quand il sera disponible ; d'ici là, comparaison structurelle des AST SQLGlot normalisés : tables, prédicats, clés, group by, agrégats) et on compare au SQL source. `roundtrip: verified | differs | skipped`.

### CLI
`atlas extract <fichier.sql|.py|.ipynb>… --dialect databricks|snowflake [--out dossier] [--format text|json]`. Sortie : un brouillon YAML par instruction `SELECT` / `CREATE … AS SELECT`, plus un rapport. Code de sortie : 0 si tout est traduit, 2 s'il reste des résidus non bloquants, 3 s'il y a au moins un `needs_curation`.

### Démonstration
`examples/extraction/` : deux scripts « marge » du corpus moteur (`06_gold_margin_v1.sql`, `07_gold_margin_v2.sql`), recopiés et adaptés, plus une paire Databricks/Snowflake du KPI « Revenu net ». `atlas extract` puis `atlas diff --relation free` doit faire ressortir l'écart de formule (`to_verify`) et l'écart de filtre (`critical`).

## Critères d'acceptation
1. Les huit scripts du corpus moteur s'extraient : ceux que le moteur marque `verified` donnent un brouillon sans résidu bloquant ; `08_kpi_monthly.sql` donne `window_function` (LAG) en résidu bloquant, et son `UNION ALL` est traduit en nœud `union`.
2. Un `WHERE pays <> 'FR'` produit un `filter` en `nulls: drop` avec l'info `nulls_inferred`.
3. `QUALIFY ROW_NUMBER() … = 1` devient un `deduplicate` avec `keep.order_by`.
4. `SUM(a)/SUM(b)` devient `aggregate` puis `metric_op` ; `AVG(a/b)` devient `compute` puis `aggregate` ; leur diff est `critical`.
5. Le même KPI écrit en Databricks et en Snowflake (fonctions de date différentes) donne la même empreinte après complétion des `TODO`.
6. Aucun message de résidu ne contient de littéral issu du SQL (test sur un corpus semé de valeurs sentinelles).
7. Extractions déterministes : même entrée, même YAML à l'octet près.
8. La démonstration `examples/extraction/` produit les écarts annoncés.

## Tests
- Unitaires : un test par ligne du tableau de traduction, dans les deux dialectes.
- Intégration : corpus moteur (copié dans `core/tests/fixtures/sql/`), rapports « golden » ; enchaînement `extract` puis `diff`.
- Banc d'essai : temps d'extraction d'un script de 2 000 lignes (cible < 2 s), noté dans le rapport de plan.
- À la main : extraire un vrai script de production anonymisé et relire le brouillon.

## Dépendances
0001, 0002, 0003.

## Estimation
**L**. Incertitudes : variété du SQL réel (macros, paramètres `${}`, dialectes mêlés) ; déduction des types sans accès au catalogue ; frontière entre résidu bloquant et non bloquant à calibrer sur de vrais scripts.
