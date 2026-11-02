# ADR 0034 — Horodatages indépendants de la session

Date : 2026-11-02 · Statut : **acceptée** (mise en œuvre du plan 0030)

## Contexte

Le SQL compilé doit se suffire : il est montré, copié et exécuté hors d'Atlas, et le connecteur ne fixe aucun paramètre de session (ADR 0025). Deux paramètres restaient pourtant capables de changer le résultat :
- en Snowflake, `TIMESTAMP_TYPE_MAPPING` décide du sens de `CAST(… AS TIMESTAMP)` ;
- en Databricks, `TIMESTAMP` est un instant, le type par défaut des colonnes. Les conversions, les dates et les comparaisons le ramènent à l'heure murale du fuseau de session.

Le YAML déclare le fuseau d'origine de chaque colonne `timestamp` (ADR 0010). Il ne dit pas si la colonne physique est un instant ou une heure murale, et on n'invente pas de champ.

## Décision

- **Le compilateur raisonne en heure murale.** Tout cast d'horodatage s'écrit avec le type sans fuseau : `TIMESTAMP_NTZ` en Databricks, `TIMESTAMPNTZ` en Snowflake, `TIMESTAMP` en DuckDB.
- **Databricks lit chaque colonne `timestamp` d'une source en heure murale de son fuseau déclaré**, à la source, une seule fois. `TYPEOF` choisit à l'exécution :
  - instant (`'timestamp'`) : microsecondes depuis l'époque (`UNIX_MICROS(CAST(c AS TIMESTAMP))`), ajoutées à `1970-01-01 00:00:00` sans fuseau, ce qui donne l'heure UTC, puis `CONVERT_TIMEZONE('UTC', '<fuseau>', …)`. Les deux branches sont typées avant l'exécution : le cast explicite, sans effet sur un instant, garde la requête valide pour une colonne sans fuseau ou texte ;
  - heure murale (`'timestamp_ntz'`) : la colonne telle quelle.
- **Pas de requête de métadonnées.** Lire le type physique dans `information_schema` aurait demandé une connexion avant de compiler, et fait différer le SQL du panneau de celui des comparaisons. `TYPEOF` donne le même résultat dans un SQL qui se suffit.
- **Pas d'aller-retour par l'heure de la session.** `CONVERT_TIMEZONE(current_timezone(), …)` aurait aussi été indépendant de la session, sauf pendant l'heure doublée du passage à l'heure d'hiver, où deux instants ont la même heure murale. Le passage par l'époque n'a pas cette ambiguïté.

## Conséquences

- Le reste du graphe ne voit que des heures murales : conversions de fuseau, `to_date`, découpage en périodes et comparaisons à un littéral ne dépendent plus de la session.
- Une colonne Databricks déclarée `UTC` et stockée comme instant est lue sans `CONVERT_TIMEZONE`.
- **Limite.** Les colonnes `TIMESTAMP_LTZ` ou `TIMESTAMP_TZ` d'une source Snowflake restent lues telles quelles. Le type par défaut d'une colonne Snowflake est `TIMESTAMP_NTZ`. Levée par le plan 0031 (ADR 0036).
- **Vérification.** Aucun test n'exécute le SQL sur un vrai Databricks. La branche instant est exécutée en DuckDB, après traduction, sous trois fuseaux de session ; le SQL Databricks est relu par SQLGlot.
- Tests : `core/tests/compile/test_ecarts.py` (section plan 0030) ; référence `core/tests/fixtures/compile/golden/ventes.databricks.sql`.
