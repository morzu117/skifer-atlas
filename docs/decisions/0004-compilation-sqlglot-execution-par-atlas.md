# ADR 0004 — Atlas compile le graphe en AST SQLGlot et exécute lui-même en push-down

Date : 2026-10-30 · Statut : **acceptée** (arbitrage du 30 octobre 2026, voir `docs/analysis.md` §6)

## Contexte

Le brief (8.3) dit que le moteur Skifer compile et exécute. Or le moteur est limité à Spark/Databricks (son Plan 26) et son `compile_select` produit une chaîne SQL Spark sans notion de dialecte. La comparaison doit tourner dès le départ sur Databricks et Snowflake, avec les droits de l'utilisateur, depuis le poste.

## Décision

- Atlas compile chaque graphe en un AST SQLGlot (une CTE par nœud, nommée d'après l'identifiant stable), puis génère le SQL du dialecte cible : `databricks`, `snowflake` et `duckdb`, ce dernier pour les tests et l'exécution locale.
- L'exécution en push-down se fait par les connecteurs d'Atlas (`databricks-sql-connector`, `snowflake-connector-python`), avec les identifiants du coffre personnel.
- Le compilateur est une fonction pure et déterministe : même graphe et même dialecte donnent un SQL identique à l'octet près.

## Conséquences

- C'est un second compilateur à côté de `compile_select`. Il pourra remonter dans le moteur avec le modèle (ADR 0003).
- Les fonctions sans équivalent dans un dialecte font échouer la compilation pour ce dialecte (« non compilable Snowflake »), sans approximation.
