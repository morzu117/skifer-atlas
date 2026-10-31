# ADR 0010 — Forme du SQL compilé, contrôles et calendriers

Date : 2026-10-30 · Statut : **acceptée** (mise en œuvre du plan 0007)

## Contexte

L'ADR 0004 fixe le principe : un AST SQLGlot, une CTE par nœud, une fonction pure. Le plan 0007 laissait ouverts plusieurs points, ou les tranchait autrement que ne l'a montré la mise en œuvre :

- la forme de la requête finale et des colonnes ;
- le mécanisme d'échec du contrôle de cardinalité, surtout en Snowflake ;
- la sémantique exacte de `nulls`, de `deduplicate` et des opérateurs de filtre ;
- le découpage en périodes avec un calendrier fiscal, et l'attribution d'une date à son jour local ;
- la portée du scope (période, périmètre, granularité) ;
- ce qui rend un document « non compilable », en général ou pour un dialecte.

## Décision

- **Une CTE par nœud utile, colonnes explicites.**
  - Seuls les ancêtres de `output` sont compilés, dans l'ordre topologique, chacun dans une CTE nommée d'après son identifiant.
  - Chaque CTE liste ses colonnes dans l'ordre que leur donne la propagation (plan 0002), y compris la requête finale : pas de `SELECT *`, que le plan prévoyait. Le résultat ne dépend donc pas de l'ordre des colonnes des tables.
  - Un `compute` remplace une colonne existante à sa place. Une jointure lit ses colonnes en `l.` et `r.` ; une clé de même nom des deux côtés n'apparaît qu'une fois, et passe par `COALESCE` en jointure `right` ou `full`. `left_semi` et `left_anti` deviennent `[NOT] EXISTS` dans les trois dialectes.
  - Un `kpi_ref` est compilé une seule fois par couple (KPI, version), avec ses CTE préfixées `r_<kpi>_v<n>_`. Ses contrôles rejoignent ceux du KPI. Le scope ne s'applique pas au KPI référencé.
  - Un en-tête commente le KPI et le dialecte : `-- atlas: revenu-net v4, databricks`. Il est suivi d'une ligne `-- atlas: cardinality bypass n04` par jointure contournée.
- **Les contrôles échouent dans la requête elle-même.**
  - Chaque contrôle est une CTE qui compte ses anomalies (`problems`). Une garde `atlas_guard` les regroupe, et la requête finale ne rend ses lignes que si `(SELECT failure FROM atlas_guard) IS NULL`.
  - Sur anomalie, la garde appelle `RAISE_ERROR(message)` en Databricks, `error(message)` en DuckDB et `CAST(message AS INT)` en Snowflake. Snowflake n'a pas de fonction d'erreur en SQL ; un cast de texte en nombre échoue en citant le texte, ce qu'une division par zéro ne fait pas.
  - Le message cite le nœud et le nombre d'anomalies : `atlas: cardinalité N:1 non respectée en n07, clés en double à droite : 3`.
  - N:1 contrôle l'unicité des clés à droite, 1:N à gauche, 1:1 des deux côtés. Les clés nulles ne comptent pas, puisqu'elles ne joignent rien. Une jointure croisée contrôle que le côté « 1 » n'a qu'une ligne.
  - Une requête de contrôle séparée, exécutée avant, aurait demandé deux allers-retours, et la requête principale serait restée fausse si on la copiait seule dans un éditeur SQL.
- **Filtres.**
  - Un littéral prend le type de sa colonne : nombre, booléen, `CAST('…' AS DATE)` ou `CAST('…' AS TIMESTAMP)`, sinon chaîne. Une valeur qui n'est pas du type de la colonne est une erreur de compilation (`invalid_value`).
  - `nulls: keep` ajoute `OR <col> IS NULL` pour chaque colonne de la condition ; `drop` laisse la condition telle quelle, et SQL écarte les lignes indéterminées.
  - `contains`, `starts_with` et `ends_with` échappent `%`, `_` et `\` avec `ESCAPE '\'`. `like` passe le motif tel quel.
  - `between` devient `>=` et `<=` ; `not_between` devient `<` ou `>`.
- **Dédoublonnage déterministe.** `QUALIFY ROW_NUMBER() OVER (PARTITION BY clés ORDER BY …) = 1` dans les trois dialectes. L'ordre déclaré est complété par toutes les autres colonnes en ordre croissant, pour départager les ex aequo. Les nulls sont rangés explicitement : en dernier en croissant, en premier en décroissant.
- **Agrégats.** `stddev` et `variance` sont ceux de l'échantillon, écrits explicitement. `having` filtre une sous-requête autour de l'agrégat.
- **Fuseaux et jour local.**
  - Le fuseau de chaque colonne suit le graphe. Il vient du `timezone` de la source, du `to` d'un `convert_timezone` ou du `timezone` d'un `to_date`.
  - `to_date` sur un horodatage le convertit vers le fuseau demandé avant d'en prendre la date. Une date ne change pas de fuseau : une date de `Europe/Paris` ramenée à un autre fuseau est une erreur.
  - Un fuseau `TODO`, ou une colonne sans fuseau connu, est une erreur de compilation.
- **Calendriers.**
  - Les fichiers sont lus dans `calendars/<key>.yaml` : `{key, version, periods: [{name, start, end}]}`, bornes incluses, sans chevauchement. Le grain du calendrier se déduit de la durée de ses périodes.
  - `period` au grain du calendrier : jointure sur une CTE `VALUES` des périodes, et la colonne cible vaut le début de la période.
  - À un grain plus fin : troncature civile, si chaque période est alignée sur ce grain.
  - À un grain plus large, ou mal aligné : erreur `calendar_grain_unsupported`.
  - Avec un calendrier fiscal, une CTE de contrôle fait échouer la requête si une date tombe hors du calendrier, au lieu de la laisser sans période.
  - Le calendrier `civil` n'a pas de fichier.
  - Une version de calendrier différente de celle du KPI est une erreur (`calendar_version_mismatch`) : un KPI figé ne change pas de calendrier en silence.
- **Scope.**
  - La période filtre la date découpée par l'unique nœud `period` qui mène à la sortie. Elle s'écrit soit en bornes `AAAA-MM-JJ..AAAA-MM-JJ`, soit par le nom d'une période du calendrier.
  - Le périmètre filtre chaque source rattachée, par `binding`, à l'attribut de concept nommé.
  - La granularité remplace le `group_by` de l'agrégation de sortie. Elle ne remonte qu'à travers `filter`, `compute`, `temporal`, `deduplicate` et `metric_op`. Une dimension est une colonne en entrée de cette agrégation, ou un attribut de concept rattaché à l'une d'elles.
- **Deux sortes d'échec.**
  - `CompileError`, avec des diagnostics : le document ne se compile dans aucun dialecte. C'est le cas d'un graphe en erreur, d'un `TODO` (cardinalité, fuseau, calendrier), d'un calendrier introuvable ou d'un scope impossible.
  - `NotCompilable(dialect, node_id, reason)` : le document ne se compile pas dans ce dialecte. `compilability` donne le statut des trois dialectes.
  - Exclusions actuelles :
    - `TRY_CAST` d'autre chose qu'une chaîne en Snowflake, que SQLGlot rendrait en `CAST` ;
    - `DECIMAL` sans précision, partout, parce que chaque moteur applique sa propre échelle ;
    - `count_distinct` et `sum_distinct` en fenêtre ordonnée, en Databricks et en Snowflake.
- **Exécution locale.**
  - `atlas run` charge chaque source depuis `<données>/<table>.csv` ou `.parquet`, dans une base DuckDB en mémoire, avec les types déclarés. Les tables à trois parties ont chacune un catalogue attaché.
  - Les CSV sont lus en texte puis convertis. La session est en UTC.

## Conséquences

- Les écarts suivants restent connus et ne sont pas encore traités :
  - la division (décimale contre flottante, division par zéro) ne se comporte pas pareil d'un moteur à l'autre ;
  - le début de semaine de Snowflake dépend du paramètre `WEEK_START` ;
  - le mécanisme d'échec Snowflake n'est vérifié que par re-parse, sans exécution réelle ;
  - un moteur peut ne pas évaluer la garde quand la sortie est vide, et alors une anomalie passe inaperçue sur un résultat vide.
- La division, `WEEK_START` et la garde sur une sortie vide sont traités par l'[ADR 0025](0025-ecarts-de-compilation.md) (plan 0021) ; seul le mécanisme d'échec Snowflake reste à vérifier.
- Les plans 0008 et 0018 exécuteront ce SQL sur Databricks et Snowflake. Le message des contrôles, qui commence par `atlas:`, permet d'y reconnaître un échec de contrôle parmi les erreurs du moteur.
- Le plan 0009 comparera les résultats sur la base des valeurs normalisées par les tests de l'oracle (critère 9).
