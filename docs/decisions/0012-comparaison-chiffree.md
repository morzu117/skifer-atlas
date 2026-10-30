# ADR 0012 — Comparaison chiffrée : scope, rebranchement et résultats

Date : 2026-10-30 · Statut : **acceptée** (mise en œuvre du plan 0009)

## Contexte

Le plan 0009 fixe le principe : le canonique est rebranché sur les sources de la déclinaison, le scope et la tolérance sont déclarés avec le KPI, et les résultats vont dans le schéma `results` de la base de l'espace. Plusieurs points restaient ouverts, ou ont été tranchés autrement pendant la mise en œuvre :

- la forme exacte du scope et l'ordre de priorité des tolérances ;
- la correspondance des colonnes quand on rebranche le canonique ;
- les tables d'extraction temporaires ;
- les colonnes à ajouter aux tables du plan ;
- les statuts d'une comparaison ;
- le choix du point d'accès et du nœud divergent ;
- une déclinaison qui porte sur une ancienne version du canonique ;
- la colonne Convergence du catalogue.

## Décision

- **Scope et tolérance, dans le YAML du KPI** (`schema_version` 1, champs optionnels).
  - `scopes: [{id, period, perimeter?, granularity?}]`.
    - `period` vaut `{calendar_period}` ou `{from, to}`, jamais les deux. La fin ne précède pas le début.
    - `perimeter` suit la grammaire des filtres. `granularity` liste au moins une dimension.
    - Deux scopes ne partagent pas le même `id`.
  - `tolerance: {percent}`, entre 0 et 100.
  - `governance.yaml` peut déclarer `tolerance: {percent}` pour tout l'espace.
  - Ordre de priorité : la requête (`tolerance`), puis le KPI, puis la gouvernance, puis **1 %** par défaut.
  - Une requête désigne un scope déclaré (`scope_id`) ou en donne un (`scope`). Sans l'un ni l'autre : `scope_required`. Un scope sans granularité reprend celle du KPI.
- **Rebranchement du canonique.**
  - En mode `override`, les nœuds `source` surchargés par la déclinaison remplacent ceux du canonique.
  - En mode `from_scratch`, chaque source du canonique prend la source de la déclinaison rattachée au même concept. Les colonnes se retrouvent par leur attribut `binding`, sinon par leur nom, et doivent avoir le même type.
  - Une colonne au nom physique différent passe par le compilateur, qui la renomme à la lecture (`SELECT physique AS canonique`). Le reste du graphe ne change pas.
  - Sinon : `canonical_not_rebindable`, avec les colonnes introuvables.
  - Le document rebranché passe `check_document` avant d'être compilé.
- **Tout est préparé avant la première requête.** Résolution, rebranchement, compilation, diff et choix des points d'accès se font pour toutes les déclinaisons. Une seule erreur arrête tout, avant toute exécution et tout enregistrement. Il en va de même pour `needs_auth`, qui liste chaque point d'accès sans accès utilisable (`not_connected`, `access_expired`).
- **Pas de tables `staging_*`.** Le `QueryResult` d'une plateforme reste en mémoire le temps de la réconciliation. Seules les cellules sont écrites. Les critères 7 et 10 sont donc tenus par construction.
- **Exécution.**
  - Une file par plateforme, et les plateformes en parallèle.
  - Pour chaque déclinaison, le canonique rebranché s'exécute d'abord, puis la déclinaison, sur le même point d'accès. Si le canonique échoue, l'exécution de la déclinaison est marquée `skipped`.
  - La progression est `{platform, entities, state, percent}`.
  - `POST …/comparisons/{id}/cancel` arme l'annulation : la requête en cours est interrompue (`cancel` Databricks, `interrupt` DuckDB) et les suivantes ne partent pas.
- **Statuts.**
  - `running`, puis :
    - `done` si tout a été exécuté ;
    - `partial` si au moins une déclinaison a un résultat et une autre a échoué ;
    - `failed` si aucune n'en a ;
    - `cancelled` après une annulation.
  - Une comparaison restée `running` sans tâche en mémoire (processus arrêté pendant l'exécution) se lit `interrupted`.
  - Le résultat entier s'écrit en une transaction : une comparaison n'est jamais à moitié enregistrée.
- **Colonnes ajoutées aux tables du plan.**
  - `comparisons` : `error`, `schema_version`.
  - `comparison_runs` : `side` (`canonical` ou `variant`), `row_count`.
  - `cells` : `missing` (`canonical` ou `variant`, le côté absent), plutôt que `missing_left` et `missing_right`.
  - `summaries` : `entity`, `variant_version`, `platform`, `access_point`, `cell_count`, `divergent_json` (le nœud et son écart) et `differences_json` (les écarts structurels du diff).
  - Les numéros de comparaison se suivent dans chaque espace.
- **Nœud divergent.** Les écarts portant sur un nœud passent avant ceux de la sémantique, qui s'appellent `semantics.<champ>`. Dans chaque groupe, un écart `critical` passe avant `override_undeclared`. Les alertes sont `cardinality_bypass` et `undeclared_override`.
- **Point d'accès.**
  - Il se choisit par l'entité de la déclinaison et la plateforme de ses sources.
  - La requête peut l'imposer : `access_points: {entité: point}`.
  - Erreurs possibles : `no_access_point`, `ambiguous_access_point`, `access_point_mismatch`, `mixed_platforms` (sources sur plusieurs plateformes), `platform_not_supported` (Databricks seul pour l'instant).
- **Déclinaison périmée.** Une déclinaison dont `variant_of.version` n'est pas la version courante du canonique est refusée : `variant_outdated`, en 409. On ne compare pas un écart dû à un retard de version.
- **Convergence au catalogue.**
  - `divergences:n` : n déclinaisons, comparées à la version courante du KPI, ont une validation sous 100 %.
  - `converged` : toutes ont été comparées sans écart, ou le KPI n'a pas de déclinaison.
  - `never_compared` sinon.
  - La matrice (`GET …/comparisons/matrix`) marque `stale` un résultat obtenu sur une version antérieure du KPI.
- **Exécution locale.** `ATLAS_COMPARE_DATA=<dossier>` pour le serveur, ou `--duckdb-data` pour la CLI, fait tout tourner dans DuckDB, sans point d'accès ni coffre. Chaque table se lit dans `<dossier>/<entité>/<table>.csv`, sinon dans `<dossier>/<table>.csv`. C'est réservé aux tests et aux démonstrations.

## Conséquences

- Le schéma `results` partage `atlas.duckdb` avec l'index, qui ne supprime que son schéma `"index"` à la reconstruction. Les résultats survivent donc à une reconstruction de l'index.
- Une déclinaison `from_scratch` sans colonnes correspondantes ne se compare pas. Nordis ES en est un exemple : il faudra des `binding` ou une source commune.
- Les résultats rapatriés ne sont bornés que par `MAX_ROWS` (`result_too_large`). Un scope trop fin échoue plutôt que de remplir la mémoire.
- Le résultat dépend de l'arithmétique de chaque moteur. DuckDB laisse un bruit de virgule flottante (3960980.0000000005) qui ne pèse pas sur les écarts.
- L'écran de comparaison (plan 0015) et Snowflake (plan 0018) se branchent sur ces routes et sur la même interface d'exécution.
