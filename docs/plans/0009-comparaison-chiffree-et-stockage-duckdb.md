# Plan 0009 — Comparaison chiffrée et historique DuckDB

> **Décisions** (Q5 et Q11, 30 octobre 2026) : canonique rebranché sur les sources de la déclinaison ; scope = période + périmètre + granularité déclarés avec le KPI ; tolérance globale dans l'espace, surchargeable par KPI.

## Objectif
`atlas compare` (et l'API) exécute un KPI et ses déclinaisons sur un scope, avec les droits de l'utilisateur, rapatrie uniquement des agrégats, calcule par cellule l'écart, le pourcentage de validation et l'écart maximal, relie les écarts aux nœuds divergents, et enregistre le tout dans la base DuckDB de l'espace.

## Périmètre
**Dedans** : bloc `scope` du KPI ; orchestration par plateforme (compilation 0007, exécution 0008) ; mise au format commun ; jointure sur les dimensions ; tolérances ; lien vers le diff (0003) ; schéma `results` ; règle de conservation ; progression ; API et CLI.
**Dehors** : écran (0015) ; Snowflake (branché par 0018 sur la même interface) ; mode planifié ; aucune donnée de tableur (décision du brief).

## Références
Brief 8.1, 8.3, 8.4 ; guide 10.5 ; ADR 0004, 0005 ; plans 0003, 0007, 0008.
Fichiers : `core/src/skifer_atlas/compare/{scope,orchestrate,reconcile,store}.py`, `api/routes/comparisons.py`.

## Spécification

### Scope (ajout au schéma du KPI : `schema_version` 1, champ optionnel)
```yaml
scopes:
  - id: t3-2026-mois-pays
    period: {calendar_period: FY2026_Q3}      # ou {from: 2026-07-01, to: 2026-09-30}
    perimeter: ["entite:in:FR,DE,ES"]          # grammaire filtre, sur des attributs de concept
    granularity: [mois_fiscal, pays]
tolerance: {percent: 1.5}                      # optionnel ; défaut = governance.yaml tolerance.percent
```

### Exécution
1. On résout le canonique et chaque déclinaison choisie (0002), puis on les compile pour la plateforme de leur point d'accès, avec le scope (0007).
2. Avant exécution, on vérifie qu'un token valide existe pour chaque point d'accès ; sinon `needs_auth` est renvoyé avec la liste des points à authentifier.
3. Le canonique s'exécute sur le point d'accès désigné par la déclinaison comparée : il est évalué sur les mêmes données que la déclinaison. Ses nœuds `source` sont donc rebranchés sur les sources de la déclinaison : nœuds `source` surchargés en mode override ; sources rattachées au même concept, via `binding`, en mode from scratch. Un rebranchement impossible renvoie `canonical_not_rebindable` (analyse Q11).
4. Exécution en parallèle par plateforme, avec progression `{platform, entities, state, percent}`, annulable.
5. Format commun `(kpi_id, kpi_version, variant_id, dims…, value)`.

### Réconciliation
- Jointure externe complète sur les dimensions. Une cellule présente d'un seul côté est hors tolérance (`missing_left` / `missing_right`).
- `gap_pct = (variant − canonical) / |canonical| × 100` ; si `canonical = 0` : écart nul si `variant = 0`, sinon `gap_pct = null` et hors tolérance.
- `validation_pct` = cellules dans la tolérance / total des cellules ; `max_gap_pct` = max |gap_pct|.
- Chaque résultat porte les écarts structurels du diff (0003) entre canonique et déclinaison, et la liste des jointures en `bypass` (alerte 10.5).
- Lien vers le nœud divergent : premier écart `critical` du diff, ou `override_undeclared` à défaut. Ce n'est pas une preuve causale, et le libellé de l'UI le dit.

### Stockage (`atlas.duckdb`, schéma `results`)
`comparisons(id, started_at, finished_at, user_account, kpi_id, kpi_version, scope_json, tolerance_pct, status)`, `comparison_runs(comparison_id, variant_id, platform, access_point, sql_text, sql_sha256, started_at, finished_at, status, error)`, `cells(comparison_id, variant_id, dims_json, canonical_value, variant_value, gap_pct, within_tolerance)`, `summaries(comparison_id, variant_id, validation_pct, max_gap_pct, divergent_node, bypass_nodes)`.
Conservation : les tables d'extraction temporaires (`staging_*`) sont supprimées dès que les cellules sont écrites ; scope, SQL exécuté et résultats sont conservés sans limite (brief 8.4).

### API et CLI
`POST /api/workspaces/{ws}/comparisons` (`{kpi_id, variants[], scope_id | scope, tolerance?}`) → `{id}` ; `GET …/comparisons/{id}` (progression, puis résultats) ; `GET …/comparisons?kpi=&limit=` (historique) ; `GET …/comparisons/matrix?domain=` (dernière comparaison par KPI × déclinaison, pour la synthèse 10.5 et la colonne Convergence du catalogue). CLI `atlas compare <ws> <kpi> --variants … --scope …` ; avec `--duckdb-data`, tout tourne en local sur des jeux de test.

## Critères d'acceptation
1. Sur données de test DuckDB (canonique et déclinaison DE avec un filtre élargi), le résultat reproduit les valeurs de la maquette 10.5 : 94 % de validation, écart maximal 6,1 %, nœud divergent n02 (filtre statut).
2. Tolérance KPI 1,5 % contre globale 1 % : la valeur KPI s'applique.
3. Une cellule absente d'un côté est comptée hors tolérance.
4. Canonique à 0 : traitement conforme à la règle ci-dessus.
5. Une jointure en bypass dans une déclinaison apparaît dans `bypass_nodes` et dans l'alerte.
6. Sans token valide, la réponse est `needs_auth`, sans exécution partielle.
7. Après la comparaison, aucune table `staging_*` ne reste ; les SQL exécutés sont relisibles dans `comparison_runs`.
8. La base d'un espace ne contient aucune donnée d'un autre (deux espaces, deux fichiers ; test d'isolation).
9. Le nombre de lignes rapatriées par plateforme ne dépasse jamais le nombre de cellules du scope.
10. Annuler une comparaison en cours laisse un statut `cancelled` et aucune table temporaire.

## Tests
- Unitaires : réconciliation (table de cas), calcul des pourcentages, choix du nœud divergent.
- Intégration : comparaison entièrement locale (DuckDB pour toutes les « plateformes ») ; connecteurs simulés ; un test réel optionnel sur Databricks.
- À la main : une comparaison sur l'espace de démonstration via `curl`, puis consultation de `atlas.duckdb` avec la CLI duckdb.

## Dépendances
0003, 0007, 0008.

## Estimation
**L**. Incertitudes : correspondance des dimensions entre graphes from scratch (rattachement aux concepts) ; temps d'exécution réels sur les entrepôts clients.
