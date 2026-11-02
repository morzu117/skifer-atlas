# ADR 0036 — Colonnes d'horodatage avec fuseau des sources Snowflake

Date : 2026-11-02 · Statut : **acceptée** (mise en œuvre du plan 0031)

## Contexte

L'ADR 0034 lit les colonnes Databricks en heure murale de leur fuseau déclaré, mais laisse les colonnes Snowflake telles quelles, parce que le type par défaut d'une colonne Snowflake, `TIMESTAMP_NTZ`, est déjà une heure murale. Les colonnes `TIMESTAMP_LTZ` et `TIMESTAMP_TZ` sont pourtant courantes : tables chargées par un outil d'intégration, ou compte dont `TIMESTAMP_TYPE_MAPPING` vaut `TIMESTAMP_LTZ`. Lues telles quelles :
- un `TIMESTAMP_LTZ` est ramené à l'heure murale du fuseau de session par les casts en heure murale, en date, et par les comparaisons ;
- un `TIMESTAMP_TZ` garde l'heure murale de son propre décalage, qui n'est pas forcément le fuseau déclaré.

Le SQL doit se suffire (ADR 0025) : pas de paramètre de session, pas de nouveau champ dans le YAML.

## Décision

- **Snowflake lit chaque colonne `timestamp` d'une source en heure murale de son fuseau déclaré**, à la source, une seule fois, comme Databricks. `TYPEOF(CAST(c AS VARIANT))` choisit à l'exécution :
  - instant (`'TIMESTAMP_LTZ'` ou `'TIMESTAMP_TZ'`) : `CAST(CONVERT_TIMEZONE('<fuseau>', CAST(c AS TIMESTAMPTZ)) AS TIMESTAMPNTZ)`. Le passage en `TIMESTAMP_TZ` garde l'instant ; `CONVERT_TIMEZONE` à deux arguments le place dans le fuseau déclaré ; le cast final retire le décalage. Aucune étape ne lit le fuseau de session ;
  - sinon (`'TIMESTAMP_NTZ'`, texte) : `CAST(c AS TIMESTAMPNTZ)`, comme avant.
- **`TYPEOF` sur un `VARIANT`**, et non `SYSTEM$TYPEOF` : la traduction vers DuckDB, qui sert aux tests d'exécution, s'exécute (le `VARIANT` y prend la branche heure murale), alors que `SYSTEM$TYPEOF` n'y existe pas.
- **Cast explicite en `TIMESTAMPTZ`** dans la branche instant : les deux branches du `CASE` sont typées avant l'exécution, et la requête reste valide pour une colonne sans fuseau ou texte, sans dépendre d'une conversion implicite (même raison que le suivi #72 en Databricks).
- **`CONVERT_TIMEZONE` même en `UTC`** : contrairement à Databricks, où le passage par l'époque donne déjà l'heure UTC, un `TIMESTAMP_LTZ` doit être placé explicitement en UTC.
- Pas de requête de métadonnées, pour les raisons de l'ADR 0034 : le SQL du panneau reste celui des comparaisons.

## Conséquences

- Un instant n'a qu'une heure murale par fuseau : pas d'ambiguïté pendant l'heure doublée du passage à l'heure d'hiver.
- Le reste du graphe ne voit que des heures murales, en Snowflake comme en Databricks.
- Cette décision lève la limite Snowflake de l'ADR 0034.
- **Vérification.** Aucun test n'exécute le SQL sur un vrai compte Snowflake. La branche instant est exécutée en DuckDB, après traduction, sous trois fuseaux de session et pour un instant écrit avec un autre décalage ; le SQL Snowflake est relu par SQLGlot ; les chaînes rendues par `TYPEOF` (`TIMESTAMP_LTZ`, `TIMESTAMP_TZ`) viennent de la documentation de Snowflake.
- Tests : `core/tests/compile/test_ecarts.py` (section plan 0031) ; référence `core/tests/fixtures/compile/golden/ventes.snowflake.sql`.
