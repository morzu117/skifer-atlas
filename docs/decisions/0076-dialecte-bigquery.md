# ADR 0076 — Dialecte BigQuery de la compilation

Date : 2026-11-28 · Statut : **acceptée**

## Contexte

Le point 1 du plan 0037 ajoute GoogleSQL aux cibles de compilation, sans ajouter de
connecteur ni modifier les dialectes d'extraction ou de l'éditeur. SQLGlot ne traduit pas
fidèlement toutes les formes nécessaires et les colonnes sources n'ont pas de type physique
connu du compilateur.

## Décision

- La liste de compilation devient `databricks`, `snowflake`, `bigquery`, `duckdb` ; la CLI,
  `compilability` et le selftest utilisent cette liste.
- La garde de cardinalité utilise `ERROR(message)`.
- La division utilise `CAST(a AS FLOAT64) / NULLIF(b, 0)` ; la division entière et le
  modulo deviennent `DIV(a, NULLIF(b, 0))` et `MOD(a, NULLIF(b, 0))`.
- Le début de semaine est `CAST(DATE_TRUNC(d, WEEK(MONDAY)) AS DATE)` : la forme automatique constatée
  `TIMESTAMP_TRUNC(d, WEEK)` ne garantit pas le lundi.
- Le tri ordinaire explicite `ASC NULLS LAST` et `DESC NULLS FIRST`. Dans les fenêtres
  agrégées, SQLGlot retire ces mentions : pour un cadre `ROWS`, chaque clé est précédée de
  `colonne IS NULL` dans le même sens. Un cadre `RANGE` est refusé, car il ne permet pas
  toujours d'ajouter ces clés en conservant le sens du cadre.
- Les agrégats distincts en fenêtre temporelle sont refusés : BigQuery ne permet pas les
  formes ordonnées et cadrées nécessaires.
- `TRY_CAST` devient `SAFE_CAST`. `DECIMAL(p, s)` devient `NUMERIC` si au plus neuf chiffres
  sont fractionnaires et 29 entiers, `BIGNUMERIC` sinon ; au-delà de 38 chiffres entiers ou
  fractionnaires, la compilation est refusée. Les paramètres ne figurent pas dans le type
  de l'expression GoogleSQL : `ROUND(CAST(x AS NUMERIC), s)` (ou `SAFE_CAST` et
  `BIGNUMERIC` selon le cas) applique l'échelle. SQLGlot rendait notamment
  `SAFE_CAST(... AS NUMERIC(38, 10))` : cette forme n'est pas retenue.
- Le type mural `WALL_CLOCK` est rendu en `DATETIME`. Une source `timestamp` est lue par
  `DATETIME(colonne, 'fuseau')` : un `TIMESTAMP` est un instant UTC, ramené au fuseau
  déclaré sans dépendre de la session. Cette forme à deux arguments attend un instant : une
  colonne physique `DATETIME` ou texte ne correspond pas à cette signature et doit produire
  une erreur de type BigQuery, au lieu de rester inchangée. BigQuery n'a pas de `TYPEOF`
  permettant de choisir une branche, et un `CASE` type ses deux branches ; aucune expression
  sûre pour les trois types n'a été établie ici.
- Le selftest charge explicitement `sqlglot.dialects.bigquery` ; la spec PyInstaller collecte
  déjà les sous-modules SQLGlot.

## Résultat

Les tests contrôlent les formes, les refus et leur relecture GoogleSQL. Les divisions, la
semaine et la lecture d'un instant sont aussi traduites puis exécutées sur DuckDB. SQLGlot
traduit certaines conversions de fuseau complètes en casts dépendant de la session DuckDB :
le test d'instant porte sur la lecture de source isolée, pas sur cette traduction complète.

## Conséquences

Aucune requête n'a été exécutée sur BigQuery. Les signatures, les conversions de type, les
limites numériques, l'ordre des fenêtres et les résultats restent à vérifier sur le moteur
réel au point 4 du plan 0037. Les sources physiques `DATETIME` ou texte déclarées
`timestamp` ne sont pas prises en charge par cette lecture.

Le dépassement de la précision `p` de `DECIMAL(p, s)` n'est pas détecté en BigQuery,
contrairement aux autres moteurs qui échouent ou rendent NULL pour `TRY_CAST` ; ce point
reste à trancher à la recette réelle. Pour l'heure murale, une piste à éprouver sur le
moteur réel est `DATETIME(TIMESTAMP(CAST(colonne AS STRING), 'fuseau'), 'fuseau')`,
valide en principe pour une colonne `TIMESTAMP`, `DATETIME` ou texte. Le format exact du
texte et l'effet sur l'élagage des partitions sont à mesurer (même souci que #82 pour
Snowflake).
