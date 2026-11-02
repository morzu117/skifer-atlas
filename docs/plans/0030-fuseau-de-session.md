# Plan 0030 — Horodatages indépendants de la session

## Objectif
Le SQL compilé lit les horodatages de la même façon quels que soient les paramètres de session du compte : fuseau de session de Databricks, `TIMESTAMP_TYPE_MAPPING` de Snowflake. Une commande passée à 23 h 30 garde son jour local, quel que soit le réglage de l'entrepôt.

## Constat
Le plan 0021 a laissé deux paramètres de session hors de son périmètre (ADR 0025) :
- **Snowflake.** `CAST(… AS TIMESTAMP)` suit `TIMESTAMP_TYPE_MAPPING`. Par défaut, c'est `TIMESTAMP_NTZ` (heure murale, sans fuseau). Un compte réglé sur `TIMESTAMP_LTZ` change le sens des casts et de `CONVERT_TIMEZONE` à trois arguments.
- **Databricks.** `TIMESTAMP` y est un instant (`TIMESTAMP_LTZ`), le type par défaut des colonnes. `CONVERT_TIMEZONE`, `CAST(… AS DATE)` et la comparaison à un littéral le ramènent d'abord à l'heure murale du fuseau de session. Un littéral `CAST('2026-01-01 10:00' AS TIMESTAMP)` est lu dans ce même fuseau.

Le YAML déclare, pour chaque colonne `timestamp` d'une source, son fuseau d'origine (ADR 0010) : c'est le fuseau de son heure murale. Le compilateur raisonne donc en heure murale (`TIMESTAMP_NTZ`) d'un bout à l'autre.

## Périmètre
**Dedans** : casts et littéraux d'horodatage des trois dialectes ; lecture des colonnes `timestamp` des sources Databricks ; panneau SQL, SQL exécuté par les comparaisons, en-tête du SQL.
**Dehors** : colonnes `TIMESTAMP_LTZ` ou `TIMESTAMP_TZ` des sources Snowflake (le type par défaut d'une colonne Snowflake est `TIMESTAMP_NTZ`) ; tout nouveau champ dans le YAML ; paramètre de session fixé par le connecteur (ADR 0025 : le SQL affiché et copié doit se suffire).

## Spécification
- **Type explicite.** Tout cast vers un horodatage s'écrit `TIMESTAMP_NTZ` en Databricks, `TIMESTAMPNTZ` en Snowflake, `TIMESTAMP` en DuckDB (déjà sans fuseau) : littéraux, conversion vers le même fuseau, `NULL` typé d'une union.
- **Colonne Databricks lue en heure murale.** Une source Databricks lit chaque colonne `timestamp` en heure murale de son fuseau déclaré, quel que soit son type physique, sans requête de métadonnées :
  ```sql
  CASE WHEN TYPEOF(c) = 'timestamp'
    THEN CONVERT_TIMEZONE('UTC', '<fuseau>', DATE_ADD(MICROSECOND, UNIX_MICROS(CAST(c AS TIMESTAMP)), CAST('1970-01-01 00:00:00' AS TIMESTAMP_NTZ)))
    ELSE CAST(c AS TIMESTAMP_NTZ)
  END AS c
  ```
  - Un instant (`TIMESTAMP`) passe par son nombre de microsecondes depuis l'époque, qui ne dépend pas de la session, puis par l'heure UTC, puis par le fuseau déclaré. Pas d'aller-retour par l'heure murale de la session : aucune ambiguïté au passage à l'heure d'hiver.
  - Une colonne `TIMESTAMP_NTZ` est déjà l'heure murale du fuseau déclaré : elle reste telle quelle.
  - Avec le fuseau `UTC`, la branche instant s'arrête à l'heure UTC.
- Le reste du graphe ne change pas : il ne voit que des heures murales.

## Critères d'acceptation
1. Le SQL Databricks d'une source à colonne `timestamp` lit cette colonne par `TYPEOF`, `UNIX_MICROS` et `CONVERT_TIMEZONE`, et se relit dans son dialecte.
2. Aucun SQL Databricks ou Snowflake ne contient plus `AS TIMESTAMP)` : littéraux, conversions et `NULL` typés portent le type sans fuseau. Seule exception, `UNIX_MICROS(CAST(c AS TIMESTAMP))` dans la branche instant : le cast d'un instant vers lui-même, sans effet de session (suivi de #71).
3. La lecture d'un instant, traduite vers DuckDB, rend l'heure murale du fuseau déclaré quel que soit le fuseau de session, y compris pendant l'heure doublée du passage à l'heure d'hiver ; et les trois dialectes, traduits vers DuckDB, rendent toujours les mêmes jours locaux, session hors UTC.
4. Le panneau SQL de l'éditeur montre, en Databricks, la lecture en heure murale d'une colonne `timestamp`.

## Tests
`core/tests/compile/test_ecarts.py` (critères 1 à 3) ; références `core/tests/fixtures/compile/golden/*.sql` ; test front du panneau SQL (critère 4).

## Dépendances
0007, 0010, 0021.

## Estimation
**S**.

## Mise en œuvre (2 novembre 2026)

- `core/src/skifer_atlas/compile/dialects.py` : `WALL_CLOCK` (type sans fuseau) et `wall_clock`, lecture d'une colonne `timestamp` de source en Databricks. `builder.py` : `_source` lit les colonnes `timestamp` par `wall_clock` ; littéraux, conversion vers le même fuseau et `NULL` typé d'une union portent `WALL_CLOCK`.
- Choix (ADR 0034) : pas de requête de métadonnées. `TYPEOF` distingue à l'exécution un instant d'une heure murale, si bien que le SQL du panneau est celui des comparaisons. Un instant passe par l'époque, et non par l'heure de la session, pour éviter l'ambiguïté de l'heure doublée.
- Référence modifiée délibérément : `core/tests/fixtures/compile/golden/ventes.databricks.sql` (deux sources, colonnes en `UTC`). Les autres références n'ont pas de colonne `timestamp` en source ni de cast d'horodatage.
- Limite : DuckDB ne reproduit pas la session de Databricks. La branche instant y est exécutée seule, après traduction, sous trois fuseaux de session. Le test des trois dialectes traduits garde contre une régression ; il ne prouve pas à lui seul l'indépendance en Databricks. Aucun test sur un vrai entrepôt.
- Reste à faire : colonnes `TIMESTAMP_LTZ` ou `TIMESTAMP_TZ` d'une source Snowflake.
- Test front `app/e2e/fuseau-de-session.spec.ts` (S-0030-01, 02, 04), écrit par un agent Claude ; S-0030-03 n'a pas d'écran.
- Vérifications : core 838 réussis, 8 ignorés (binaire du sidecar absent), plus `test_validation_of_50_nodes_under_150_ms`, en échec sous une charge machine de 25 à 40 mais réussi seul trois fois sur trois (la validation ne compile pas de SQL) ; `npm test` 163 réussis ; `npm run e2e` 191 réussis et un échec sans lien avec le plan, S-0006-12 (`git fetch` concurrent sur un même clone), réussi ensuite trois fois sur trois ; spec `fuseau-de-session` réussie quatre fois sur quatre.

### Suivi de la relecture (#72, 2 novembre 2026)

- Les deux branches du `CASE` sont typées avant l'exécution, quelle que soit la valeur de `TYPEOF`. `UNIX_MICROS` reçoit donc un cast explicite, `UNIX_MICROS(CAST(c AS TIMESTAMP))` : la requête reste valide pour une colonne `TIMESTAMP_NTZ` ou texte, sans s'en remettre à une conversion implicite, et le cast ne change rien à un instant. Le critère 2 admet cette seule exception.
- Toujours pas de vérification sur un vrai entrepôt Databricks.
- Suivi #76 : les tests retirent cette exception pour toute colonne (`UNIX_MICROS\(CAST\(\w+ AS TIMESTAMP\)\)`), et `test_no_reference_sql_casts_to_a_session_timestamp` vérifie le critère 2 sur les références Databricks et Snowflake (`horodatage` dans `ventes.databricks.sql`).
