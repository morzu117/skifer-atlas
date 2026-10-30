# Démonstration : extraction puis diff (plan 0004)

Deux paires de scripts SQL qui calculent chacune « la même chose » autrement :

| Fichiers | Dialecte | Ce qui diffère |
|---|---|---|
| `marge_v1.sql`, `marge_v2.sql` | Databricks | la formule de la marge : `amount - cost` contre `amount * (1 - margin_rate)` |
| `revenu_net_databricks.sql`, `revenu_net_snowflake.sql` | Databricks, Snowflake | les fonctions de date, et le filtre sur le statut |

Les deux scripts de marge sont adaptés du corpus du moteur Skifer
(`examples/24_project_analyzer/legacy_sql/06_…` et `07_…`).

Depuis ce dossier, avec la CLI du cœur (`core/`) :

```sh
atlas() { uv run --project ../../core atlas "$@"; }

atlas extract marge_v1.sql marge_v2.sql revenu_net_databricks.sql --dialect databricks --out brouillons
atlas extract revenu_net_snowflake.sql --dialect snowflake --out brouillons

atlas diff brouillons/marge-v1.yaml brouillons/marge-v2.yaml --relation free
atlas diff brouillons/revenu-net-databricks.yaml brouillons/revenu-net-snowflake.yaml --relation free
```

Ce qu'on doit voir :

- **Extraction.** Quatre brouillons `status: draft`, fidélité `verified`. Leurs valeurs inconnues du SQL valent `TODO` : propriétaire, domaine, calendrier, fuseau, types des colonnes, cardinalité. `atlas validate brouillons/*.yaml` les liste en avertissements. Les jointures des marges donnent le résidu non bloquant `cardinality_unknown`, d'où le code de sortie 2.
- **Marges** (code de sortie 2) : le calcul de la marge est `à vérifier`, car SQLGlot ne démontre pas l'équivalence des deux formules. La source des produits est aussi `à vérifier`, puisqu'elle ne lit pas les mêmes colonnes.
- **Revenu net** (code de sortie 3) :
  - le filtre est `critique` : `statut:equals:validée` contre `statut:in:validée,émise` ;
  - la source est `à vérifier` (plateforme et table).
  
  Les conversions de date (`FROM_UTC_TIMESTAMP` contre `CONVERT_TIMEZONE`, `DATE_TRUNC`) donnent les mêmes nœuds `temporal` : elles n'apparaissent pas dans le diff.
