# ADR 0033 — Sources communes d'une comparaison

Date : 2026-11-02 · Statut : **acceptée** (mise en œuvre du plan 0029)

## Contexte

En from scratch (ADR 0026), une source du canonique sans équivalent dans la déclinaison reste commune : le canonique la lit sur la plateforme de la déclinaison, et la déclinaison la lit aussi. Ce que cette source produit ne peut donc pas diverger, et la comparaison ne le vérifie pas. Jusqu'ici, seul `Rebound.common` le savait.

## Décision

- **Annoncer, pas avertir.** L'aperçu porte une alerte `common_source` par déclinaison concernée. L'écran l'affiche en bandeau d'information (« Source commune »), pas en avertissement : une source commune est un choix de modélisation, pas un défaut, et elle n'empêche pas de lancer.
- **Garder avec le résultat.** Chaque synthèse enregistre ses sources communes (nœud, libellé, table, plateforme) dans `results.summaries.common_json`. Le détail d'une comparaison ancienne montre ce qui valait au moment de l'exécution, même si le canonique a changé depuis.
- **Migrer sur place.** La colonne s'ajoute en fin de table par `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, joué à chaque ouverture comme le reste du DDL. Une synthèse antérieure garde `NULL`, lu comme une liste vide : on ne sait pas, après coup, quelles sources étaient communes, et on ne l'invente pas.
- **Même libellé partout.** « n06 · Jours comptables (gold.finance.dim_date) » dans l'alerte, la CLI (`common_label`) et l'écran.

## Conséquences

- Sans source commune (overrides, from scratch entièrement rebranchée), rien ne change à l'écran ; la liste est vide.
- Les colonnes de `results.summaries` restent dans l'ordre de l'`INSERT` : une nouvelle colonne s'ajoute toujours en dernier.
- Tests : `core/tests/compare/test_compare.py::test_common_sources_are_announced_then_kept_with_the_result`, `::test_a_base_from_before_plan_0029_is_migrated`, `::test_cli_compare_lists_common_sources` ; `core/tests/repo/test_comparisons_api.py::test_from_scratch_es_compares_through_the_api` ; `app/src/screens/Comparison.test.tsx` ; `app/e2e/sources-communes.spec.ts`.
