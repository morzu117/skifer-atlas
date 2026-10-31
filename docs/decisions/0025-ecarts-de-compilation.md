# ADR 0025 — Écarts de compilation entre moteurs

Date : 2026-10-31 · Statut : **acceptée** (mise en œuvre du plan 0021)

## Contexte

L'ADR 0010 laissait quatre écarts connus entre Databricks, Snowflake et DuckDB. Le plan 0021 en traite trois ; le quatrième, l'échec Snowflake vérifié sur un vrai compte, attend un compte (plan 0018).

- **Division.** Les expressions (`compute`, `metric_op`, conditions en `expr`) passent telles quelles à SQLGlot, qui garde `/`. Or :
  - Databricks (ANSI, défaut des entrepôts SQL) rend un `DOUBLE` pour `int / int` et un décimal pour `decimal / decimal`. Un diviseur nul fait échouer la requête ;
  - Snowflake rend un `NUMBER` à 6 décimales pour `int / int` (`1 / 3` = 0,333333). Un diviseur nul fait échouer la requête ;
  - DuckDB 2.0 rend toujours un `DOUBLE`, décimaux compris. `x / 0` rend `inf`, et `x % 0` échoue.
- **Début de semaine.** `DATE_TRUNC('WEEK', …)` commence au lundi en Databricks et en DuckDB, comme le suppose `calendar.aligned`. En Snowflake, il suit le paramètre de session `WEEK_START`.
- **Garde sur une sortie vide.** La requête finale ne rendait ses lignes que si `(SELECT failure FROM atlas_guard) IS NULL`. Un moteur qui sait la sortie vide peut ne jamais évaluer ce filtre : propagation des relations vides de Spark, élagage de Snowflake. L'anomalie passe alors inaperçue. DuckDB 2.0 l'évalue dans les cas essayés, mais rien ne le garantit.

## Décision

- **Une division se calcule en `DOUBLE`, et un diviseur nul rend `NULL`, dans les trois moteurs.**
  - Forme : `a / b` devient `CAST(a AS DOUBLE) / NULLIF(b, 0)` (`dialects.safe_division`, appliqué à toute expression compilée).
    - Le cast est omis si un opérande est déjà `double`.
    - `NULLIF` est omis si le diviseur est un littéral non nul, ou déjà un `NULLIF(…, 0)`, ce que les KPI de Nordis écrivent souvent.
    - Les divisions les plus profondes sont réécrites d'abord : `a / b / c` ne caste que `a`.
  - `DIV` et `%` gardent leur type : seul le diviseur passe par `NULLIF`.
  - Le type inféré d'une division devient `double`, au lieu de `decimal` (plan 0002). L'éditeur et la propagation montrent ainsi le type que rendent les moteurs.
  - **Pourquoi `DOUBLE`.** DuckDB n'a pas de division décimale exacte : il convertit en `DOUBLE`. Les règles d'échelle de Databricks et de Snowflake diffèrent, et un cast du quotient vers un décimal fixe arrondirait différemment selon le moteur, sur les cas d'égalité. Une division IEEE de deux `DOUBLE` donne le même résultat partout. C'est aussi la sémantique de Spark pour `int / int`, référence des expressions Skifer.
  - **Pourquoi `NULL` plutôt qu'une erreur `atlas:`.** Les gardes de l'ADR 0010 vérifient ce que l'auteur a déclaré dans le graphe (cardinalité, couverture du calendrier), sur une CTE entière. Un diviseur nul n'est pas une déclaration violée : c'est une donnée courante, comme un chiffre d'affaires nul sur un segment, et faire échouer tout le KPI pour une ligne serait pire que de la laisser vide.
    - Une erreur levée dans une expression dépendrait en outre de l'ordre d'évaluation de chaque moteur : une ligne écartée par un filtre poussé plus tôt échouerait ici, pas là. `NULL` est déterministe.
    - `NULL` suit ensuite la règle `nulls` déjà explicite des filtres. C'est aussi ce que donne Spark hors ANSI, et ce que les auteurs écrivent déjà avec `NULLIF`.
- **La semaine Snowflake ne dépend d'aucun paramètre de session.** En Snowflake, le découpage `period` à la semaine s'écrit `CAST(DATEADD(DAY, 1 - DAYOFWEEKISO(d), d) AS DATE)` (`dialects.week_start`). Le cast, superflu en Snowflake, garde le type `DATE` quand SQLGlot traduit ce SQL vers DuckDB, comme le fait le faux Snowflake des tests. `DAYOFWEEKISO` (lundi = 1) ne dépend ni de `WEEK_START` ni de `WEEK_OF_YEAR_POLICY`. Databricks et DuckDB gardent `DATE_TRUNC('WEEK', …)`.
  - Le connecteur Snowflake ne fixe pas `WEEK_START` à la session. Le SQL est montré, copié et exécuté par les utilisateurs hors d'Atlas : il doit se suffire. Un paramètre de session fixé par le connecteur masquerait aussi une régression dans les tests.
  - Aucune autre fonction de semaine n'est compilée : la liste blanche des expressions (plan 0002) n'en contient pas, et `WEEK_OF_YEAR_POLICY` ne touche que `WEEK`, `WEEKOFYEAR` et `YEAROFWEEK`.
- **La garde est lue par une branche indépendante de la sortie.** La requête finale devient une union :

  ```sql
  SELECT … FROM n09 WHERE (SELECT failure FROM atlas_guard) IS NULL
  UNION ALL
  SELECT NULL AS …, … FROM atlas_guard WHERE NOT atlas_guard.failure IS NULL
  ```

  - La garde a toujours une ligne : chaque contrôle est un agrégat sans `GROUP BY`. La seconde branche ne rend donc jamais de ligne, puisque la garde échoue avant de rendre un message. Mais aucun moteur ne peut l'écarter sans évaluer la garde, quelle que soit la sortie (`cardinality.guarded`).
  - La première branche garde son filtre : rien de la sortie n'est rendu sur anomalie, même par un moteur qui s'arrêterait après elle (`row_limit` de Databricks).
  - Les `NULL` de la seconde branche n'ont pas de type : ils prennent celui de la première branche, et les types de sortie ne changent pas.
  - `atlas_guard.failure` est qualifié : une colonne de sortie nommée `failure` ne le masque pas.

## Conséquences

- Les SQL de référence des tests changent délibérément :
  - `ventes.*.sql` : `CAST(montant AS DOUBLE) / 1.2` et `CAST(ca AS DOUBLE) / NULLIF(objectif, 0)` ;
  - `ventes.*.sql` et `revenu-net.*.sql` : seconde branche de la garde.
- Une division de montants rend un `DOUBLE`. Une somme de `DOUBLE` dépend de l'ordre d'agrégation de chaque moteur, à la dernière décimale près. La comparaison chiffrée (plan 0009) normalise les valeurs à 1e-9 : cela reste invisible.
- Une requête avec contrôles est une union, et non plus un `SELECT`. Les appelants exécutent le SQL tel quel ; aucun ne l'enveloppait.
- L'échec Snowflake (`CAST(message AS INT)`) et les trois règles ci-dessus ne sont vérifiés, en Databricks et en Snowflake, que par la forme du SQL et sa relecture par SQLGlot, d'après la documentation des moteurs. Le test réel sur un compte reste à faire (plan 0018).
- D'autres paramètres de session restent hors de ce plan : le fuseau de session de Databricks, et `TIMESTAMP_TYPE_MAPPING` en Snowflake, dont dépend `CAST(… AS TIMESTAMP)`.
