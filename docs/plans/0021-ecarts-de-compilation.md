# Plan 0021 — Écarts de compilation entre moteurs

## Objectif
Le SQL compilé donne le même résultat, ou le même échec, sur Databricks, Snowflake et DuckDB, là où l'ADR 0010 laissait trois écarts connus : la division, le début de semaine de Snowflake et la garde sur une sortie vide.

## Périmètre
**Dedans** : division, division entière et modulo dans les expressions (`compute`, `metric_op`, conditions en `expr` de `filter` et `having`) ; découpage `period` à la semaine en Snowflake ; garde des contrôles évaluée quelle que soit la sortie ; type inféré d'une division (plan 0002) ; tests DuckDB exécutés, SQL Databricks et Snowflake relus par SQLGlot.
**Dehors** : le mécanisme d'échec Snowflake vérifié sur un vrai compte (quatrième écart de l'ADR 0010, il faut un compte, voir 0018) ; les autres paramètres de session (fuseau de session, `TIMESTAMP_TYPE_MAPPING`) ; tout nouveau format : le YAML Skifer ne change pas.

## Références
ADR 0004, 0010 (« Conséquences »), 0022 ; plans 0002 (inférence de types), 0007, 0018.
Fichiers : `core/src/skifer_atlas/compile/{builder,dialects,cardinality}.py`, `core/src/skifer_atlas/model/functions.py`, `core/tests/compile/`.

## Spécification

### Division
- Constat :
  - Databricks (ANSI, défaut des entrepôts SQL) : `int / int` rend un `DOUBLE`, `decimal / decimal` un décimal à l'échelle calculée ; un diviseur nul fait échouer la requête ;
  - Snowflake : `int / int` rend un `NUMBER` à 6 décimales (`1 / 3` = 0,333333) ; un diviseur nul fait échouer la requête ;
  - DuckDB : toute division rend un `DOUBLE`, décimaux compris ; un diviseur nul rend `inf` ; un modulo par zéro échoue.
- Règle : une division se calcule en `DOUBLE` dans les trois moteurs, et un diviseur nul rend `NULL`.
  - `a / b` devient `CAST(a AS DOUBLE) / NULLIF(b, 0)`. Le cast est omis si un opérande est déjà `double`, `NULLIF` si le diviseur est un littéral non nul ou déjà un `NULLIF(…, 0)`.
  - `DIV` et `%` gardent leur type ; seul le diviseur passe par `NULLIF`.
  - Le type inféré d'une division devient `double` (plan 0002 disait `decimal`).

### Début de semaine
- `DATE_TRUNC('WEEK', …)` dépend en Snowflake du paramètre de session `WEEK_START` ; Databricks et DuckDB commencent toujours au lundi, comme `calendar.aligned`.
- En Snowflake, le découpage à la semaine s'écrit `CAST(DATEADD(DAY, 1 - DAYOFWEEKISO(d), d) AS DATE)`. `DAYOFWEEKISO` ne dépend ni de `WEEK_START` ni de `WEEK_OF_YEAR_POLICY`. Les deux autres dialectes gardent `DATE_TRUNC`.
- Le connecteur ne fixe pas de paramètre de session : le SQL affiché et copié doit se suffire.

### Garde sur une sortie vide
- Aujourd'hui, la requête finale filtre ses lignes par `(SELECT failure FROM atlas_guard) IS NULL`. Sur une sortie vide, un moteur peut ne jamais évaluer ce filtre.
- La requête finale ajoute une branche `UNION ALL` qui lit la garde seule : `SELECT NULL AS … FROM atlas_guard WHERE NOT atlas_guard.failure IS NULL`. Elle ne rend jamais de ligne, mais le moteur doit évaluer la garde pour le savoir, quelle que soit la sortie.
- La première branche garde son filtre : la sortie n'est jamais rendue sur anomalie, même par un moteur qui s'arrêterait après la première branche.

## Critères d'acceptation
1. Une division par zéro rend `NULL` en DuckDB, au lieu de `inf` ; une division entière ou un modulo par zéro rend `NULL` au lieu d'échouer.
2. Une division d'entiers rend le même `DOUBLE` dans les trois dialectes : le SQL Databricks et Snowflake porte `CAST(… AS DOUBLE) / NULLIF(…, 0)` et se relit dans son dialecte.
3. `NULLIF(x, 0)` écrit par l'auteur n'est pas doublé, un littéral non nul n'est pas enveloppé, et un opérande `double` n'est pas recasté.
4. Le type inféré d'une division d'entiers ou de décimaux est `double`.
5. Le découpage à la semaine en Snowflake ne contient pas `DATE_TRUNC('WEEK'` ; traduit en DuckDB par SQLGlot, il rend le même lundi que `DATE_TRUNC('WEEK', …)` sur plus d'un an de dates.
6. La requête finale lit la garde dans une branche indépendante de la sortie, dans les trois dialectes ; en DuckDB, une anomalie de cardinalité fait échouer une requête dont la sortie est vide, et une requête sans anomalie rend ses lignes, et elles seules.
7. Les tests existants restent verts ; les SQL de référence modifiés le sont délibérément.

## Tests
- `core/tests/compile/test_ecarts.py` : un test par critère, exécution DuckDB et re-parse SQLGlot.
- `core/tests/model/test_columns.py` : type inféré des divisions.
- SQL de référence (`fixtures/compile/golden/`) régénérés par `ATLAS_UPDATE_GOLDEN=1`, relus.

## Dépendances
0007, 0018.

## Estimation
**S**. Incertitude : sans compte réel, le comportement de Databricks et de Snowflake n'est vérifié que par le SQL produit, d'après leur documentation.

## Mise en œuvre (31 octobre 2026)

Décisions : [ADR 0025](../decisions/0025-ecarts-de-compilation.md). L'ADR 0010 renvoie vers elle pour les trois écarts traités.

- **Cœur** (`core/src/skifer_atlas/`) :
  - `compile/dialects.py` :
    - `safe_division` : `a / b` devient `CAST(a AS DOUBLE) / NULLIF(b, 0)`, en partant des divisions les plus profondes. Le cast est omis si un opérande est `double`, `NULLIF` si le diviseur est un littéral non nul ou déjà un `NULLIF(…, 0)`. `DIV` et `%` : diviseur seul ;
    - `week_start` : `CAST(DATEADD(DAY, 1 - DAYOFWEEKISO(d), d) AS DATE)` en Snowflake, `DATE_TRUNC('WEEK', …)` ailleurs ;
  - `compile/builder.py` : `safe_division` sur toute expression compilée (`compute`, `metric_op`, conditions en `expr`) ; `week_start` pour `period` à la semaine ; requête finale gardée par `cardinality.guarded` ;
  - `compile/cardinality.py` : `guarded`, qui ajoute la branche `UNION ALL` lisant la garde seule (`WHERE NOT atlas_guard.failure IS NULL`) ;
  - `model/functions.py` : une division d'opérandes numériques est inférée `double`.
- **SQL de référence** régénérés et relus (`core/tests/fixtures/compile/golden/`) :
  - `ventes.{databricks,snowflake,duckdb}.sql` : deux divisions réécrites et la seconde branche de la garde ;
  - `revenu-net.{databricks,snowflake,duckdb}.sql` : seconde branche de la garde seulement, sans division dans le canonique.
- **Tests** :
  - `core/tests/compile/test_ecarts.py` (24 tests) :
    - diviseur nul → NULL en DuckDB pour `/`, `DIV` et `%`, au lieu de `inf` et d'une erreur (critère 1) ;
    - `CAST(a AS DOUBLE) / NULLIF(b, 0)` dans les trois dialectes, relu par SQLGlot ; `DIV` et `%` gardent leur type (critère 2) ;
    - ni `NULLIF` doublé, ni littéral enveloppé, ni `double` recasté ; division d'un filtre et d'un `metric_op` réécrite (critère 3) ;
    - type inféré `double` (critère 4) ;
    - semaine au lundi en DuckDB ; SQL Snowflake sans `DATE_TRUNC('WEEK'`, traduit en DuckDB, aux mêmes semaines ; formule identique à `DATE_TRUNC('WEEK', …)` sur 410 jours (critère 5) ;
    - union et branche de garde dans les trois dialectes ; en DuckDB, anomalie sur une sortie vide en échec, branche de garde seule en échec sans lire la sortie, lignes rendues sans ligne parasite sans anomalie (critère 6) ;
  - `core/tests/model/test_columns.py` : `taux` et `taux_net` passent de `decimal` à `double` ;
  - `core/tests/compile/test_compile.py` : la relecture admet une union (`exp.Query`).
- **Documentation** : `core/README.md`, paragraphe de `atlas compile`.
- **Reste à faire** :
  - vérifier les trois règles et l'échec `CAST(message AS INT)` sur de vrais comptes Databricks et Snowflake (plan 0018, critère 1) ;
  - les autres paramètres de session : fuseau de session de Databricks, `TIMESTAMP_TYPE_MAPPING` en Snowflake pour `CAST(… AS TIMESTAMP)` ;
  - DuckDB évaluait déjà la garde sur une sortie vide dans les cas essayés : le critère 6 ne s'y observe que par la branche de garde exécutée seule.
