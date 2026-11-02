# Plan 0031 — Colonnes d'horodatage avec fuseau des sources Snowflake

## Objectif
Une colonne `timestamp` d'une source Snowflake se lit en heure murale de son fuseau déclaré, quel que soit son type physique : `TIMESTAMP_NTZ`, `TIMESTAMP_LTZ` ou `TIMESTAMP_TZ`. Le résultat ne dépend pas du paramètre de session `TIMEZONE`.

## Constat
Le plan 0030 lit les colonnes Databricks en heure murale, mais laisse les colonnes Snowflake telles quelles (ADR 0034) : le type de colonne par défaut de Snowflake, `TIMESTAMP_NTZ`, est déjà une heure murale. Les autres types sont pourtant courants, par exemple dans les tables chargées par un outil d'intégration, ou dans un compte où `TIMESTAMP_TYPE_MAPPING` vaut `TIMESTAMP_LTZ` :
- **`TIMESTAMP_LTZ`** est un instant. Ses conversions vers une heure murale (`CAST(… AS TIMESTAMP_NTZ)`, `CAST(… AS DATE)`) passent par le fuseau de session.
- **`TIMESTAMP_TZ`** est un instant avec son décalage. `CAST(… AS TIMESTAMP_NTZ)` garde l'heure murale de ce décalage, qui n'est pas forcément le fuseau déclaré.

## Périmètre
**Dedans** : lecture des colonnes `timestamp` des sources, en Snowflake ; panneau SQL, SQL exécuté par les comparaisons, en-tête du SQL.
**Dehors** : tout nouveau champ dans le YAML ; requête de métadonnées ; paramètre de session fixé par le connecteur (ADR 0025).

## Spécification
- **Colonne Snowflake lue en heure murale.** Une source Snowflake lit chaque colonne `timestamp` ainsi :
  ```sql
  CASE WHEN TYPEOF(CAST(c AS VARIANT)) IN ('TIMESTAMP_LTZ', 'TIMESTAMP_TZ')
    THEN CAST(CONVERT_TIMEZONE('<fuseau>', CAST(c AS TIMESTAMPTZ)) AS TIMESTAMPNTZ)
    ELSE CAST(c AS TIMESTAMPNTZ)
  END AS c
  ```
  - `TYPEOF` d'un `VARIANT` donne le type de la valeur à l'exécution, sans requête de métadonnées, comme `TYPEOF` en Databricks (plan 0030).
  - Un instant passe en `TIMESTAMP_TZ` (même instant), puis dans le fuseau déclaré, puis perd son décalage : l'heure murale du fuseau déclaré. Aucune étape ne lit le fuseau de session, et aucune ambiguïté au passage à l'heure d'hiver : un instant n'a qu'une heure murale par fuseau.
  - Une colonne `TIMESTAMP_NTZ` reste telle quelle.
  - Les deux branches sont typées avant l'exécution : le cast explicite en `TIMESTAMPTZ` garde la branche instant valide pour une colonne `TIMESTAMP_NTZ` ou texte (même raison que le suivi #72 en Databricks).
- Le fuseau `UTC` garde `CONVERT_TIMEZONE` : un `TIMESTAMP_LTZ` doit passer à l'heure UTC.
- Le reste du graphe ne change pas : il ne voit que des heures murales.

## Critères d'acceptation
1. Le SQL Snowflake d'une source à colonne `timestamp` lit cette colonne par `TYPEOF` et `CONVERT_TIMEZONE`, et se relit dans son dialecte.
2. La branche instant, traduite vers DuckDB, rend l'heure murale du fuseau déclaré quel que soit le fuseau de session, y compris pendant l'heure doublée du passage à l'heure d'hiver.
3. Les trois dialectes, traduits vers DuckDB, rendent toujours les mêmes jours locaux, session hors UTC ; aucun SQL Snowflake ne contient `AS TIMESTAMP)` (plan 0030, critère 2).
4. Le panneau SQL de l'éditeur montre, en Snowflake, la lecture en heure murale d'une colonne `timestamp`.

## Tests
`core/tests/compile/test_ecarts.py` (critères 1 à 3) ; références `core/tests/fixtures/compile/golden/*.snowflake.sql` ; test front du panneau SQL (critère 4).

## Dépendances
0018, 0030.

## Estimation
**S**.

## Mise en œuvre (2 novembre 2026)

- `core/src/skifer_atlas/compile/dialects.py` : `wall_clock` lit aussi une colonne `timestamp` de source en Snowflake, par le `CASE` de la spécification. `builder.py` ne change pas : il appelait déjà `wall_clock` pour chaque colonne `timestamp` de source.
- Choix (ADR 0036) : `TYPEOF` sur un `VARIANT` plutôt que `SYSTEM$TYPEOF`, pour que la traduction vers DuckDB s'exécute ; cast explicite en `TIMESTAMPTZ` dans la branche instant ; `CONVERT_TIMEZONE` gardé en `UTC` ; pas de requête de métadonnées.
- Référence modifiée délibérément : `core/tests/fixtures/compile/golden/ventes.snowflake.sql` (`passee_le` et `horodatage`, en `UTC`). Les autres références Snowflake n'ont pas de colonne `timestamp` en source.
- Limite : aucun test sur un vrai compte Snowflake. En DuckDB, le `VARIANT` prend la branche heure murale ; la branche instant y est exécutée seule, après traduction, sous trois fuseaux de session et pour un instant écrit avec un autre décalage. Les chaînes `TIMESTAMP_LTZ` et `TIMESTAMP_TZ` viennent de la documentation de Snowflake.
- Test front `app/e2e/fuseau-de-session.spec.ts` (S-0031-01, 04), écrit par un agent Claude ; S-0031-02 et 03 n'ont pas d'écran.
- Vérifications : core 849 réussis ; `npm test` 163 réussis ; `npm run e2e` 192 réussis ; spec `fuseau-de-session` réussie deux fois sur deux.
