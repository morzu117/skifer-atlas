# Plan 0029 — Sources communes d'une comparaison

## Objectif
Qu'on voie, avant de lancer une comparaison puis dans son résultat, quelles sources du canonique une déclinaison from scratch garde telles quelles : la comparaison ne vérifie rien sur ces sources-là, lues de la même table des deux côtés.

## Constat
Le plan 0022 (ADR 0026) rebranche le canonique sur les sources d'une déclinaison from scratch par les `binding` de ses colonnes. Une source du canonique sans équivalent dans la déclinaison reste commune : pour Nordis ES, `n06 · Jours comptables (gold.finance.dim_date)`, lue sur Snowflake. `Rebound.common` la connaissait, mais ni l'aperçu, ni le résultat, ni la CLI ne la montraient. Le reste à faire du plan 0022 le notait.

## Périmètre
**Dedans** : plan de comparaison, aperçu avant lancement, synthèse enregistrée dans `results.summaries`, sortie texte de `atlas compare`, écran Comparaison.
**Dehors** : matrice et historique (une ligne par comparaison, sans détail des sources), choix d'une autre table pour une source commune.

## Spécification
- `VariantPlan.common` : pour chaque source commune, le nœud, son libellé, sa table et la plateforme de la déclinaison où elle est lue.
- Alerte d'aperçu `common_source` (une par déclinaison), avec les nœuds et le message « nordis-es : n06 · Jours comptables (gold.finance.dim_date) n'a pas d'équivalent dans la déclinaison ; la table du canonique est lue sur snowflake, des deux côtés. »
- Chaque résultat porte `common_sources` (liste vide sans source commune), enregistré dans la colonne `common_json` de `results.summaries`.
- Une base créée avant ce plan reçoit la colonne à l'ouverture (`ADD COLUMN IF NOT EXISTS`). Ses anciennes synthèses donnent une liste vide.
- CLI, sortie texte : ligne « sources communes : n06 · Jours comptables (gold.finance.dim_date) » sous le résultat de la déclinaison.
- App : bandeau d'information « Source commune » dans le panneau de lancement ; dans le détail d'un résultat, « Sources communes, lues sur snowflake des deux côtés : … ».

## Critères d'acceptation
1. Nordis ES cochée, le panneau de lancement annonce la source commune n06 avant tout lancement, en information et non en avertissement.
2. Une fois la comparaison de Nordis ES terminée, son détail liste n06 avec sa table et la plateforme où elle est lue.
3. Une base créée avant ce plan s'ouvre sans erreur ; ses anciennes comparaisons n'ont aucune source commune, les nouvelles gardent les leurs.
4. `atlas compare … --variants nordis-es` nomme la source commune dans sa sortie texte.

## Tests
`core/tests/compare/test_compare.py` (critères 1 à 4 côté core) ; `core/tests/repo/test_comparisons_api.py::test_from_scratch_es_compares_through_the_api` (aperçu et synthèse par l'API) ; `app/src/screens/Comparison.test.tsx` (bandeau et détail) ; `app/e2e/sources-communes.spec.ts` (critères 1 et 2).

## Dépendances
0009, 0015, 0022.

## Estimation
**S**.

## Mise en œuvre (2 novembre 2026)

- `core/src/skifer_atlas/compare/orchestrate.py` : `VariantPlan.common`, alerte `common_source`, `common_label` (libellé partagé avec la CLI), `common_sources` dans la synthèse.
- `core/src/skifer_atlas/compare/store.py` : colonne `common_json` en dernière position de `results.summaries`, ajoutée par `ADD COLUMN IF NOT EXISTS` aux bases existantes (ADR 0033).
- `core/src/skifer_atlas/cli.py` : ligne « sources communes » dans la sortie texte.
- `app/src/screens/Comparison.tsx` : titres des bandeaux par code (`ALERT_TITLES`), « Source commune » en ton info ; ligne des sources communes dans le détail. `common_sources` est facultatif côté app : une réponse qui ne le porte pas affiche le détail sans cette ligne (relevé par le test e2e, une réponse simulée de `comparaison-cellules.spec.ts` ne le portait pas et vidait l'écran).
- Scénarios S-0029-01 et S-0029-02 au catalogue (`docs/tests/scenarios.md`), test écrit par un agent Claude ; S-0029-03 et S-0029-04 n'ont pas d'écran.
- Vérifications : core 833 réussis (8 ignorés, binaire du sidecar absent) ; `npm test` 162 réussis ; `npm run e2e` 191 réussis, 0 échec, 0 instable ; spec `sources-communes` réussie quatre fois sur quatre.
