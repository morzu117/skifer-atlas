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

## Mise en œuvre (30 octobre 2026)
- **Paquet** `core/src/skifer_atlas/extract/` :
  - `parse.py` découpe via `skifer.analyzer.frontends` (`.sql`, notebooks `.py` et `.ipynb`), puis analyse chaque instruction avec `sqlglot.parse_one(dialect=…)`. `parser.parse_script` du moteur n'est pas réutilisé : il lève une seule erreur pour tout le script, alors qu'ici une instruction illisible devient un résidu `parse_error` sans bloquer les autres ;
  - `translate.py` passe de l'AST aux nœuds ;
  - `draft.py` assemble et contrôle le brouillon ;
  - `oracle.py` porte l'oracle de fidélité ;
  - `residues.py` définit les codes et messages des résidus.
  
  Les brouillons (statut, `TODO`, bloc `extraction`) sont décidés dans l'**ADR 0006**.
- **Traduction**, en écart ou en précision par rapport au tableau :
  - les colonnes d'une source sont celles que le SQL cite, dans l'ordre du texte. L'ordre de l'AST varie d'un dialecte à l'autre, et l'empreinte en dépend ;
  - une table sans schéma devient `TODO.<table>` (résidu `unqualified_table`) ;
  - une même table lue deux fois n'est qu'une source ;
  - Atlas ne projette pas : un flux garde toutes ses colonnes. La liste du `SELECT` ne sert qu'à aligner les branches d'une union, par position. Une colonne refusée garde sa place mais ne passe pas l'union ;
  - jointures : clés tirées de `ON a = b` (dans les deux sens) et de `USING`. Un prédicat de `ON` d'une autre forme devient un `filter` après une jointure interne ; sur une jointure externe, il est bloquant ;
  - `WHERE` : chaque conjonction devient un filtre, en grammaire `col:op:val` quand c'est possible, sinon `{expr}`. Le filtre porte une `note` qui justifie `nulls`. L'info `nulls_inferred` est dans le rapport, pas dans le document ;
  - dédoublonnage : `QUALIFY ROW_NUMBER() … = 1`, ou une colonne `ROW_NUMBER()` filtrée par `= 1` plus haut. Le `deduplicate` se place là où `ROW_NUMBER` est calculé, ce qui est équivalent puisque le rang est calculé avant le filtre ;
  - un calcul qui remplace une colonne existante passe après les autres, qui lisent encore la valeur d'origine, comme en SQL ;
  - expressions de date reconnues au premier niveau d'une colonne du `SELECT` :
    - `DATE_TRUNC` donne `period` ;
    - `TO_DATE`, `CAST(… AS DATE)` et `::DATE` donnent `to_date`, avec un fuseau `TODO` ;
    - `FROM_UTC_TIMESTAMP` et `CONVERT_TIMEZONE` donnent `convert_timezone`, avec une note sur le fuseau d'origine.
    
    Une conversion imbriquée (`TO_DATE(FROM_UTC_TIMESTAMP(…))`) reste un calcul refusé : il faut une étape par CTE ;
  - regroupement :
    - `GROUP BY` par nom, par position ou par alias ;
    - une expression regroupée est calculée avant l'agrégation ;
    - un agrégat dont l'argument n'est pas une colonne reçoit un calcul `<mesure>__arg` (`AVG(a/b)`) ;
    - une expression sur des agrégats donne des mesures `<nom>__<k>` et un `metric_op` (`SUM(a)/SUM(b)`) ;
    - deux agrégats identiques partagent une mesure, et `HAVING` les réutilise ;
  - résidus non prévus par le tableau :
    - bloquants : `SELECT *`, `LIMIT`, `DISTINCT`, `EXCEPT`/`INTERSECT`, `LATERAL`, `PIVOT`, sous-requête dans une expression, fonction hors liste blanche (nommée seulement si SQLGlot la connaît), `invalid_draft` (le brouillon échoue au contrôle du modèle) ;
    - non bloquants : `unqualified_table`, `ambiguous_column_origin`, `unnamed_expression` (nom `col_<n>`), `ignored_clause` (`ORDER BY` sans `LIMIT`) ;
    - au niveau du fichier, sans brouillon : `unsupported_statement` (`UPDATE`, `MERGE`…) et `notebook_cell_unreadable`.
- **Limite connue** : le modèle refuse deux colonnes de même nom après une jointure (`ambiguous_column`, plan 0002). Un SQL qui cite `o.id` et `c.id` de part et d'autre d'une jointure sur `c.id = o.client_id` donne donc `invalid_draft`. Il faudra un moyen de renommer à la source, à calibrer sur de vrais scripts.
- **Correction du plan 0002** : SQLGlot 30 fait hériter `AND`, `OR` et `XOR` de `exp.Func`. La liste blanche les refusait donc dans `compute` et `filter.expr`. `functions.is_function` les exclut, et un test le couvre.
- **Brouillon** :
  - identifiant : le nom du fichier, plus `-<n>` s'il contient plusieurs requêtes ;
  - libellé : la table créée, sinon le nom du fichier ;
  - `kind: kpi` si la sortie est agrégée au sens du plan 0002 (union de flux agrégés comprise), sinon `concept` avec `entity: TODO`.
  
  Le brouillon est contrôlé comme un document curé (`validate_data` puis `check_document`). Toute erreur autre que `todo` devient un résidu bloquant `invalid_draft`, dont le détail donne le code et le nœud. Dans le corpus, cela arrive par exemple avec un `DATE_TRUNC` dans un concept (`missing_calendar`).
- **Oracle** : il compare des traits relus dans l'AST source, indépendamment de la traduction :
  - les tables lues, hors CTE ;
  - le nombre de prédicats (`WHERE`, `QUALIFY`, `ON` hors clés), face au nombre de filtres et de dédoublonnages ;
  - les paires de clés de jointure ;
  - le nombre de colonnes de regroupement ;
  - les fonctions d'agrégat, chaque agrégat distinct comptant une fois par `SELECT`.
  
  Le rapport donne `verified`, `differs` (avec la liste des traits en cause) ou `skipped` (résidu bloquant).
- **CLI** :
  - les fichiers sont traités dans l'ordre donné. Sans `--out`, les brouillons vont sur la sortie standard, séparés par `---`, et le rapport sur la sortie d'erreur ;
  - deux brouillons de même identifiant donnent le code 1 ;
  - le rapport JSON est une liste `{file, residues, statements: [{id, line, kind, status, roundtrip, residues, infos}]}`.
- **Critère 1** :
  - 01, 02, 03, 04 et 06 donnent un brouillon `draft`, fidélité `verified` ;
  - 05 (CTE partagée et `UNION ALL`) aussi ;
  - 07 est `needs_curation` à cause de sa sous-requête scalaire ;
  - 08 est `needs_curation`, avec `window_function` (LAG) et la sous-requête scalaire. Son `UNION ALL` devient le nœud de sortie, et son `ROW_NUMBER` un `deduplicate`.
  
  Brouillons et rapport « golden » sont dans `core/tests/fixtures/extract/` ; les régénérer avec `ATLAS_UPDATE_GOLDEN=1`.
- **Critère 5, écart** : l'empreinte inclut la plateforme et la table de chaque source (plan 0002). Le même KPI extrait de Databricks et de Snowflake ne peut donc pas avoir la même empreinte tant que les sources diffèrent. Le test vérifie deux choses :
  - avant alignement, le diff des deux brouillons complétés ne montre que `platform` et `table` sur la source ;
  - une fois la source alignée, comme le ferait un curateur qui rattache les deux implémentations à la même table, les empreintes sont égales.
  
  Les deux scripts n'utilisent pas les mêmes fonctions de date : `FROM_UTC_TIMESTAMP` et `TO_DATE` d'un côté, `CONVERT_TIMEZONE` et `::DATE` de l'autre.
- **Banc d'essai**, sur un MacBook (Apple Silicon), contrôle des brouillons compris :
  - un script de 2 016 lignes (42 copies de `08_kpi_monthly.sql`) s'extrait en **0,09 s** ;
  - 2 760 lignes de brouillons valides (120 copies de `04_…`) en 0,16 s.
  
  La cible est < 2 s ; le test échoue au-delà.
- **Démonstration** : `examples/extraction/` (voir son README). Le diff des deux marges donne un `compute` `to_verify` (formule) ; celui du Revenu net Databricks/Snowflake donne un `filter` `critical`.
- **À la main** : l'extraction d'un vrai script de production anonymisé reste à faire.
