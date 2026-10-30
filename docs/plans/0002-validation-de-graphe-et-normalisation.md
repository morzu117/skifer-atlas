# Plan 0002 — Validation de graphe, résolution des variantes et normalisation

## Objectif
Un document valide au sens du schéma est aussi vérifié comme graphe (DAG, ports, colonnes, sémantique figée), une variante par surcharge se résout en graphe complet, et tout graphe a une forme normalisée et une empreinte stable : deux graphes qui ne diffèrent que par l'ordre de leurs filtres ont la même empreinte.

## Périmètre
**Dedans** : contrôles structurels ; propagation des colonnes nœud par nœud ; liste blanche des fonctions déterministes ; résolution d'une variante sur son canonique, avec classement de chaque surcharge (point déclaré ou non) ; normalisation 8.2.1 ; empreinte ; CLI `atlas check`, `atlas resolve`, `atlas normalize`, `atlas fingerprint`.
**Dehors** : diff et classification des écarts (0003) ; résolution des `kpi_ref` à travers un dépôt (0005 fournit le résolveur ; ici une table de documents est passée en paramètre) ; compilation SQL (0007).

## Références
Brief 3.3, 3.5 (« les branches ne se rejoignent que par une jointure ou une union »), 3.6, 4.1, 8.2.1 ; guide 10.3 (panneau bas « Schéma valide · Sans cycle · Compilable », onglet Colonnes en sortie) ; plan 0001.
Fichiers : `core/src/skifer_atlas/model/{graph,columns,functions,resolve,normalize,fingerprint}.py`.

## Spécification

### Contrôles structurels (code d'erreur entre parenthèses)
- Tout `input` référence un nœud existant (`unknown_input`) ; aucun cycle (`cycle`, avec la liste des nœuds du cycle) ; `output` existe et tout nœud y mène (`orphan_node`, avertissement).
- Seuls `join` et `union` ont plusieurs entrées ; un nœud ne peut être l'entrée de plusieurs nœuds que si ces branches se rejoignent plus bas par une jointure ou une union, ou si un seul chemin mène à `output` (`branch_not_merged`).
- `metric_op` n'accepte qu'une entrée agrégée (sortie d'`aggregate`, `kpi_ref`, ou jointure entre entrées agrégées) (`metric_op_on_rows`). `aggregate` n'accepte pas d'entrée déjà agrégée sans `group_by` compatible (`reaggregation`, avertissement).
- Un KPI a pour sortie un nœud agrégé (`kpi_output_not_aggregated`) ; un concept, un nœud non agrégé.
- `kpi_ref` : le KPI et la version existent dans la table de documents fournie (`unknown_kpi_ref`) ; pas de cycle de références entre KPI (`kpi_ref_cycle`).

### Propagation des colonnes
Chaque nœud calcule son schéma de sortie `[(nom, type)]` à partir de ses entrées : `source` → colonnes déclarées ; `filter` et `deduplicate` → inchangé ; `join` → gauche + droite, une collision de noms hors clés égales étant une erreur (`ambiguous_column`) ; `union` → `columns` ; `compute` → entrée + `column` (le type est inféré par SQLGlot, ou déclaré) ; `aggregate` → `group_by` + cibles ; `temporal` → entrée + `target` ; `kpi_ref` → colonnes de sortie du KPI référencé ; `metric_op` → entrée + métriques.
Toute colonne citée (condition, clés, expr, group_by, measures, order_by) doit exister en entrée (`unknown_column`, avec suggestions par distance d'édition). L'API `columns_at(doc, node_id)` alimente l'onglet Colonnes et les listes de clés de jointure de l'éditeur.

### Expressions
Analysées par SQLGlot en dialecte neutre. Liste blanche des fonctions dans `functions.py` : arithmétique, `COALESCE`, `NULLIF`, `CASE`, `CAST`, `UPPER`/`LOWER`/`TRIM`, `SUBSTRING`, `ABS`, comparaisons. Interdites : `NOW`, `CURRENT_*`, `RAND*`, `UUID`, `ROUND`/`FLOOR`/`CEIL`, fonctions de fenêtre et d'agrégat dans `compute` (`forbidden_function`). Les sous-requêtes sont interdites (`subquery_in_expr`).

### Sémantique figée
- `temporal.operation: period` sans `semantics.calendar` au niveau du KPI : erreur (`missing_calendar`).
- Une colonne temporelle utilisée par `period` doit venir d'une `to_date` ou d'une `convert_timezone` explicite, ou d'une colonne `date` de source ; partir directement d'un `timestamp` est une erreur (`implicit_timezone_conversion`). C'est le cas « commande de fin de journée » du brief.
- Une jointure en `check: bypass` produit une information `cardinality_bypass`, toujours remontée.

### Résolution d'une variante (`resolve(variant, canonical) -> ResolvedGraph`)
- `override` : copie du graphe canonique où chaque nœud surchargé est remplacé par `replace` (même `id`, même `type`, sinon `override_type_change`). Les surcharges `semantics.*` remplacent l'attribut. Chaque surcharge est classée `declared` si sa cible figure dans `variation_points` du canonique, `undeclared` sinon. Le graphe résolu repasse tous les contrôles ci-dessus.
- `from_scratch` : le graphe de la variante tel quel, plus le contrôle que chaque concept listé dans `concepts` est bien rattaché par au moins une source (`unbound_concept`).
- `ResolvedGraph` porte `overrides: [{node, classification, justification}]` pour le diff (0003) et la proposition (0006).

### Normalisation (8.2.1, version simple)
1. On découpe le graphe en segments délimités par les opérations structurantes (`join`, `union`, `deduplicate`, `aggregate`, `temporal`, `kpi_ref`, `metric_op`, `source`). Les `compute` sont conservés à leur place.
2. Dans un segment, une suite de `filter` consécutifs sur un même flux (chaîne linéaire sans autre consommateur) est remplacée par un seul nœud logique `filter_set`, avec ses conditions triées dans l'ordre canonique : tri lexicographique de la forme canonique `col:op:val|nulls`, les expressions SQL étant normalisées par SQLGlot (`sql(normalize=True, pretty=False)`).
3. Les `id` et les `label`/`note` ne font pas partie de la forme normalisée. Les nœuds sont renumérotés dans l'ordre topologique, avec départage par (type, forme canonique du contenu).
4. Tout le reste est conservé tel quel.

### Empreinte
`fingerprint(graph) = "sha256:atlas1:" + sha256(JSON canonique de la forme normalisée)` (clés triées, séparateurs compacts, UTF-8). Le préfixe versionné permet de changer la normalisation sans confusion.

### CLI
`atlas check <doc> [--with <doc>…]` (erreurs, avertissements et infos ; code de sortie 1 s'il y a une erreur), `atlas resolve <variant> <canonical> [--out]`, `atlas normalize <doc>` (YAML de la forme normalisée), `atlas fingerprint <doc>…`. `--with` fournit les documents référencés par `kpi_ref`.

## Critères d'acceptation
1. Chaque code d'erreur ci-dessus est produit par au moins une fixture, avec le bon `node_id`.
2. `columns_at` renvoie, pour chaque nœud de la fixture « Revenu net », la liste attendue (table de vérité dans le test).
3. Une clé de jointure inconnue est refusée et suggère la colonne la plus proche.
4. `NOW()` ou `ROUND(x, 2)` dans un `compute` sont refusés.
5. Un `period` appliqué directement à une colonne `timestamp` est refusé ; avec un `to_date` explicite en amont, il passe.
6. La résolution de la surcharge DE remplace n03 (déduction des taxes), garde l'`id`, et classe n03 `declared` ; une surcharge de n02 (filtre statut, non déclaré) est classée `undeclared`.
7. Une surcharge qui change le type d'un nœud est refusée.
8. Deux graphes identiques sauf l'ordre de trois filtres consécutifs ont la même empreinte ; si l'on déplace un filtre de l'autre côté d'une jointure, l'empreinte change.
9. Renommer des `id` ou des libellés ne change pas l'empreinte.
10. L'empreinte est identique entre deux exécutions et sous deux `PYTHONHASHSEED` différents.
11. Un cycle de `kpi_ref` entre deux KPI est détecté.

## Tests
- Unitaires par module ; test de propriété (hypothesis) : permuter des filtres consécutifs conserve l'empreinte, et toute modification d'un champ hors libellé la change.
- Intégration : CLI sur le corpus, sous-processus lancés avec `PYTHONHASHSEED` différents.
- À la main : `atlas check` sur la fixture DE avec une surcharge non déclarée ; lire le message.

## Dépendances
0001.

## Estimation
**M**. Incertitudes : inférence de types des expressions par SQLGlot ; règle exacte de « même flux » pour les filtres quand une branche est consommée deux fois.

## Mise en œuvre (30 octobre 2026)
- Modules : `graph.py` (contrôles structurels, `Library` des KPI connus), `columns.py` (propagation, `columns_at`), `functions.py` (liste blanche, inférence de types), `check.py` (`check_document`), `resolve.py`, `normalize.py`, `fingerprint.py`. Le dialecte neutre de SQLGlot sert aussi à la validation de schéma du plan 0001.
- `Issue` porte désormais une gravité : `severity` vaut `error`, `warning` ou `info`. Les contrôles structurels et de colonnes ne s'appliquent qu'à un document déjà valide au sens du plan 0001 ; les colonnes ne sont propagées que si le graphe est un DAG sans entrée inconnue.
- Codes ajoutés à la spécification : `concept_output_aggregated` (sortie agrégée d'un concept), `undeclared_override` (avertissement porté par chaque surcharge hors points de variation), `unknown_override_target`, `variant_of_mismatch`, `missing_canonical` (CLI : variante contrôlée sans son canonique dans `--with`).
- `branch_not_merged` : seuls `join` et `union` ayant plusieurs entrées, deux branches ne peuvent se rejoindre que par eux. La règle signale donc un nœud dont une branche mène à `output` et une autre non ; la branche morte reçoit en plus `orphan_node`.
- `reaggregation` n'est pas signalée quand le `group_by` est inclus dans celui de l'agrégation amont (regroupement plus grossier du même flux) ; il l'est toujours derrière un `kpi_ref`, dont on ne connaît pas le grain.
- Colonne « datée » : colonne `date` de source, ou cible d'un `to_date` / `convert_timezone`. Une union garde ce caractère si toutes ses sources l'ont.
- Liste blanche : on ajoute `IF` et `TRY_CAST`, équivalents de `CASE` et `CAST`. Les fonctions imbriquées dans une fenêtre ne sont signalées qu'une fois, par la fenêtre.
- Inférence de types : `integer` < `decimal` < `double` ; une division rend `decimal`, ou `double` si un opérande l'est. Type inconnu (`None`) dès qu'un opérande l'est ; le type déclaré (`column_type`) l'emporte.
- Normalisation `atlas1` :
  - tout filtre devient un `filter_set`, même isolé ; une suite s'arrête au premier filtre consommé par plusieurs nœuds ;
  - sortent de la forme : `id`, `label`, `note`, `owner`, `bypass_reason` ; les nœuds qui ne mènent pas à `output` sont ignorés ;
  - le calendrier du KPI est recopié dans chaque `period`, car changer de calendrier change le résultat ;
  - le départage de l'ordre topologique ajoute une signature de Merkle (type, contenu, signatures des entrées) au couple (type, contenu), pour départager sans ambiguïté deux nœuds de même contenu mais d'amonts différents.
- Clés libres (`binding` d'une source, `from` d'une colonne d'union) : triées à la lecture, pour que l'écriture canonique ne dépende pas de l'ordre de saisie.
- Fixture `revenu-net--nordis-es.yaml` corrigée : la source espagnole est un `timestamp` ; elle passe désormais par un `to_date` explicite avant le découpage en mois, et rattache le concept `facture` par un `binding`. Les contrôles du plan l'avaient refusée (`implicit_timezone_conversion`, `unbound_concept`).
