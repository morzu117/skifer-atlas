# ADR 0072 — Recette Databricks réelle automatisée

Date : 2026-11-26 · Statut : **acceptée**

## Contexte

Le SQL Databricks du plan 0007 doit être exécuté sur un warehouse réel (#15, #112).
La Free Edition dispose d'un warehouse serverless et d'un quota limité.

## Décision

La sonde `core/tests/test_databricks_real.py`, marquée `databricks` et hors CI, compare les
résultats réels aux fixtures DuckDB et aux résultats attendus. Les données sont minuscules.
Elle utilise les variables d'environnement de la sonde de connexion existante et accepte un
jeton OAuth court obtenu par `databricks auth token --profile <profil>` ; aucun jeton n'est écrit.

Chaque session crée un schéma aléatoire dans le catalogue configurable `atlas_recette` par
défaut, puis le supprime avec `CASCADE`, même en cas d'échec. Le catalogue est conservé.
Les sources sont chargées avec les types déduits du chargement DuckDB existant, en une requête
par table. Les seuls identifiants de tables sources de l'AST SQLGlot compilé sont réécrits vers
`<catalogue>.<schéma>.<nom aplati>` : les points du nom d'origine
sont remplacés par `__`. Les fixtures qui réutilisent un nom de table sont rechargées par scénario.

## Conséquences

La recette nécessite des droits de création de catalogue, schéma et tables, et un jeton valide
pendant toute la session. Le nettoyage dépend de la disponibilité du service et de ces droits.
L'exécution réelle se lance par une personne disposant d'un workspace ; l'écran de
comparaison sous Tauri reste une recette manuelle (#31).

Premier passage, 26 novembre 2026, Free Edition, warehouse serverless : 26 tests sur 27 réussis
en 88 s, nettoyage du schéma vérifié. Le seul échec, `test_jeton_invalide`, a révélé un défaut :
Databricks refuse un jeton en 403 « Invalid access token », et non en 401 (#223, ADR 0073).
