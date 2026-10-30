# Plan 0007 — Compilation du graphe en SQL multi-dialecte

## Objectif
Tout graphe valide se compile de façon déterministe en SQL Databricks, Snowflake et DuckDB, contrôle de cardinalité compris ; le SQL DuckDB s'exécute sur des données de test et donne le résultat attendu.

## Périmètre
**Dedans** : graphe → AST SQLGlot (une CTE par nœud) → SQL par dialecte ; contrôles de cardinalité ; restriction au scope (période, périmètre, granularité) ; détection « non compilable pour ce dialecte » ; exécution locale DuckDB ; CLI `atlas compile` et `atlas run`.
**Dehors** : exécution distante (0008, 0018) ; comparaison des résultats (0009) ; génération de metric views, business rules et tests (mode construction, à planifier après cette série).

## Références
Brief 3.6, 8.3 (étapes 2 à 4) ; ADR 0004 ; guide 10.3 (« SQL compilé », « Compilable Databricks, Snowflake ») ; moteur `skifer/core/sql_compiler.py` (structure en CTE, `SqlCompilationError`) ; plans 0001, 0002.
Fichiers : `core/src/skifer_atlas/compile/{builder,dialects,cardinality,scope}.py`, `run/duckdb_local.py`.

## Spécification

### Construction
- Une CTE par nœud, nommée `n01`… dans l'ordre topologique ; la requête finale fait `SELECT * FROM <output>`.
- `source` : `SELECT <colonnes déclarées> FROM <table>`. `filter` : `WHERE <cond>`, et `nulls: keep` ajoute `OR <col> IS NULL` pour chaque colonne de la condition qui peut être nulle. `join` : jointure explicite, sans `USING`, pour que les colonnes restent déterministes. `union` : `UNION ALL`/`UNION` avec projection alignée. `deduplicate` : `QUALIFY ROW_NUMBER() OVER (PARTITION BY … ORDER BY …) = 1`, ou sous-requête pour DuckDB et les dialectes sans `QUALIFY`. `temporal` : fonctions propres au dialecte (`CONVERT_TIMEZONE`, `FROM_UTC_TIMESTAMP`, `timezone()` en DuckDB) ; `period` par jointure sur une table de calendrier générée depuis `calendars/<key>.yaml` (`VALUES`). `kpi_ref` : CTE du KPI référencé, compilée récursivement et préfixée (`r_<kpi>_n01`). `metric_op` : `aggregate_first` → expression sur les colonnes agrégées ; `rows_first` → expression ligne à ligne, puis agrégat.
- Jamais d'arrondi ; les types décimaux gardent leur précision.

### Contrôle de cardinalité (`check: required`)
Pour `N:1` (resp. `1:N`, `1:1`), une CTE de contrôle compte les clés dupliquées du côté qui doit être unique. La requête finale échoue si ce compte est positif : `RAISE_ERROR` en Databricks, division par zéro gardée en Snowflake et DuckDB, ou requête de contrôle séparée exécutée avant la requête principale, selon le dialecte (choix fixé par une table dans `cardinality.py`). Le message d'échec contient l'identifiant du nœud. En `bypass`, aucun contrôle, mais un commentaire SQL `-- atlas: cardinality bypass n04` reste dans la requête.

### Scope
`compile(graph, dialect, scope=None)` : la période filtre la colonne temporelle de référence du KPI ; le périmètre ajoute des filtres sur les attributs de concept ; la granularité remplace le `group_by` de l'agrégation de sortie par les dimensions du scope. Une dimension non disponible produit `scope_dimension_unavailable`.

### Déterminisme et dialectes
Même entrée, même SQL (testé par empreinte du SQL). Une fonction ou un type sans traduction fidèle dans un dialecte lève `NotCompilable(dialect, node_id, reason)`. `compilability(graph) -> {databricks: ok|reason, snowflake: …}` alimente la barre d'état de l'éditeur.

### Exécution locale
`atlas run <doc> --data <dossier de CSV/Parquet par table> [--scope …]` : charge les sources dans DuckDB en mémoire, exécute le SQL DuckDB et affiche le résultat. Ce chemin sert aux tests et aux valeurs de référence.

## Critères d'acceptation
1. La fixture « Revenu net » compile dans les trois dialectes ; le SQL DuckDB, exécuté sur le jeu de test, donne le résultat attendu commité.
2. Une fixture avec une jointure factures → clients déclarée `N:1` et une table clients contenant une clé en double échoue à l'exécution, avec un message qui cite le nœud de jointure ; en `bypass`, elle passe et le SQL contient le commentaire.
3. `nulls: keep` contre `nulls: drop` sur `pays <> 'FR'` : nombre de lignes différent, conforme à la sémantique attendue.
4. Ratio de sommes contre moyenne de ratios : résultats différents et attendus.
5. `period` avec un calendrier fiscal : les commandes du 30 septembre à 23 h UTC tombent dans le bon mois fiscal selon `Europe/Paris`.
6. Une compilation répétée donne le même SQL à l'octet près.
7. Une fonction non disponible en Snowflake rend `compilability.snowflake` non `ok`, avec le nœud et la raison.
8. Le SQL Databricks et le SQL Snowflake sont analysables par SQLGlot dans leur dialecte (test de re-parse).
9. Un graphe extrait au plan 0004, puis recompilé, donne sur DuckDB le même résultat que le SQL source traduit vers DuckDB (oracle de fidélité, corpus d'exemples).

## Tests
- Unitaires : un test par type de nœud et par dialecte (golden SQL).
- Intégration : exécution DuckDB sur jeux de données de test ; propriétés (hypothesis) sur l'ordre des filtres → même résultat.
- À la main : coller le SQL Databricks généré dans un éditeur SQL Databricks et l'exécuter.

## Dépendances
0001, 0002 (0004 pour le critère 9).

## Estimation
**L**. Incertitudes : écarts fins de sémantique temporelle entre dialectes ; mécanisme d'échec du contrôle de cardinalité en Snowflake.
