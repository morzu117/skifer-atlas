# Plan 0027 — Scénarios de test front

## Objectif
Donner à chaque vérification du projet un scénario de test clair et un test front, pour ne plus dépendre de vérifications à la main.

## Périmètre
**Dedans** :
- catalogue des scénarios ;
- tests Playwright et Vitest manquants ;
- faux GitHub pour l'e2e ;
- correction des défauts révélés par les nouveaux tests.

**Dehors** : comptes réels (Databricks, Snowflake, GitHub), fenêtre native Tauri, CI de release, revues produit.

## Spécification
- Le catalogue `docs/tests/scenarios.md` reprend les critères d'acceptation des plans 0001 à 0026 et les vérifications à la main du « Reste à faire ». Format et identifiants : ADR 0031.
- Les titres des tests commencent par les identifiants qu'ils couvrent.
- Les specs qui modifient un dépôt travaillent sur une copie isolée de la démonstration (`app/e2e/isolation.ts`), sur un serveur dédié.

## Critères d'acceptation
1. Chaque vérification apparaît une fois dans le catalogue : comme scénario relié à un test existant, ou dans une des deux sections « Sans test front », avec sa raison.
2. Chaque identifiant cité dans le catalogue existe dans un titre de test, ou dans une table de cas.
3. `npm run e2e` passe en entier, Chromium puis WebKit, sans `fixme`.
4. Les défauts révélés sont corrigés, chacun avec un test qui échoue sans sa correction.

## Tests
- Depuis `app/` : `npm run e2e`, `npm test`, `npx tsc --noEmit -p .`, `npm run build`.
- Depuis `core/` : `uv run ruff check .`, `uv run pytest`.

## Dépendances
0010–0026.

## Estimation
**M**.

## Mise en œuvre (1er novembre 2026)

- **Répartition du travail.**
  - Codex a écrit l'inventaire et les tests. Il n'a pas pu les lancer : son bac à sable bloque les navigateurs. Il s'est arrêté sur sa limite d'utilisation avant le catalogue.
  - Les specs ont été mises au point ici, en navigateur : 10 échecs au premier passage, tous dans les tests (libellés réels, sélecteurs ambigus, course entre l'aperçu et le retour OAuth), sauf un défaut applicatif.
  - Le catalogue a été rédigé scénario par scénario, à partir des tests.
- **Couverture**, sur 221 vérifications :
  - 133 ont un test e2e ;
  - 5 n'ont qu'un test Vitest ;
  - 52 n'ont rien à l'écran ;
  - 31 sont testables mais sans test front. Elles sont listées dans le catalogue et forment le prochain lot.
- **Nouveaux scénarios e2e** :
  - éditeur : clés de jointure, annuler/rétablir sur 20 opérations, 50 nœuds, YAML avec ancres ;
  - validation : type inconnu, version de schéma, champs obligatoires, fonctions interdites, fuseau, identifiant dupliqué, colonne proche ;
  - diff classé ;
  - SQL par dialecte et gardes ;
  - comparaison : sans token, OAuth puis reprise du lancement ; déclinaison ES refusée, puis acceptée ;
  - Mes connexions par espace ;
  - administration : accès refusé, diff limité à la gouvernance, renommage, retraits, plusieurs rôles ;
  - fusion faite hors Atlas puis « Synchroniser » ;
  - hors ligne ;
  - connexion GitHub par le device flow contre `core/tests/connections/fake_github.py` : code, refus, expiration, coffre par espace, déconnexion.
- **Défauts corrigés** :
  - **L'éditeur plantait (page blanche) sur un nœud de type inconnu.** `summary()` n'avait pas de cas par défaut. La carte affiche maintenant le type, avec « type inconnu ». Tests : `app/src/editor/summary.test.ts`, et `[S-0001-04]` en e2e.
  - **`GET …/comparisons` répondait 500 de temps en temps à l'ouverture de l'écran Comparaison.** Les premières lectures simultanées créaient chacune le schéma `results` (« Catalog write-write conflict »). Le DDL passe désormais sous le verrou du stockage. Test : `test_concurrent_reads_of_the_history`, qui échoue sans le correctif.
- **Résultats** :
  - `npm run e2e` : 79 réussis, sans `fixme` ;
  - `npm test` : 155 réussis ;
  - `pytest` : 819 réussis. Les 8 tests ignorés demandent un compte réel ou le binaire sidecar.
  - ruff, tsc et build : OK.
- **Reste à faire** :
  - les 31 vérifications testables sans test front (lot suivant, confié à Codex) ;
  - trancher S-0008-05, le repli par token personnel contre la règle « jamais de champ de token » ;
  - deux titres de `connexions.spec.ts` portent `[S-0008-07]` et `[S-0016-06]` sans les vérifier : ils sont comptés comme testables dans le catalogue.
