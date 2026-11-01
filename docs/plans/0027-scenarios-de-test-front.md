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
- **Relecture par Codex** (1er novembre 2026). La PR #60 avait déjà été fusionnée quand Codex l'a relue, et ses points bloquants ont été corrigés à la suite :
  - `latest()`, `matrix()` et le résumé de l'index créaient encore le schéma `results` sans verrou. Ils passent désormais tous par `store.ensure_schema`. Le test de concurrence mêle maintenant l'historique et le dernier résultat ; il échoue sans le correctif.
  - Plusieurs titres annonçaient plus que leur test vérifiait :
    - `[S-0003-06]` vérifie maintenant la gravité « Divergence critique » ;
    - `[S-0002-03]` vérifie maintenant la colonne proche `date_facture` ;
    - `[S-0008-07]` et `[S-0016-06]` sont retirés des titres de `connexions.spec.ts`, et classés « testables » ;
    - la mention « critères 3 et 5 » est retirée du titre de `[S-0015-01]`.
  - Le catalogue décrit maintenant exactement S-0017-04, S-0001-10 et S-0013-11.
  - Le mécanisme `fixme` inutilisé de `validation.spec.ts` est supprimé.
- **Résultats** :
  - `npm run e2e` : 79 réussis, sans `fixme` ;
  - `npm test` : 155 réussis ;
  - `pytest` : 819 réussis. Les 8 tests ignorés demandent un compte réel ou le binaire sidecar.
  - ruff, tsc et build : OK.
- **Reste à faire** : réglé par le lot suivant.
  - S-0008-05 n'est pas un écart : le repli par token personnel est une exception assumée à la règle du guide 10.6 (analyse Q10, plan 0008, ADR 0020), confirmée le 1er novembre 2026.

### Lot des vérifications testables (1er novembre 2026)

Les 31 vérifications « testables » du catalogue ont maintenant chacune un scénario et un test front.
- **Nouvelles specs** :
  - `app/e2e/validation-testables.spec.ts` : champs requis des dix types de nœuds, variantes incomplètes, YAML réécrit puis stable, codes du validateur, colonnes en sortie, `period` sur un horodatage, changement de type par surcharge, cycle de `kpi_ref` (S-0001-02, -09, -14 ; S-0002-01, -02, -05, -07, -11) ;
  - `app/e2e/depot-testables.spec.ts` : résidus sans littéral SQL, document invalide au catalogue, divergence au sync, CODEOWNERS modifié à la main, tag refusé par le dépôt distant (S-0004-06, S-0005-05, S-0005-11, S-0006-11, S-0020-03) ;
  - `app/e2e/propositions-testables.spec.ts` : validations requises, approbations non habilitées, décompte remis à zéro, `stale_base`, seul habilité (S-0006-01, -02, -03, -05, -12) ;
  - `app/e2e/connexions-testables.spec.ts` : deux espaces, hôte injoignable, jeton expiré, repli par token personnel, plateforme retirée (S-0008-02, -03, -04, -05, -07 ; S-0016-06). Le faux Databricks reçoit une route de test, `/__test__/configure`, pour refuser l'OAuth ou le rafraîchissement ;
  - `app/e2e/comparaison-cellules.spec.ts` : cellule absente, canonique à 0 (S-0009-03, -04).
- **Tests ajoutés aux specs existantes** : S-0007-06 (`sql.spec.ts`), S-0022-05 (`comparaison-refus.spec.ts`), S-0025-04 (`github.spec.ts`).
- **Identifiants ajoutés à des titres existants** : S-0002-06 (`propositions.spec.ts`) ; S-0006-10, -11, -12 (`administration.spec.ts`). En Vitest : S-0015-04, S-0016-06, S-0008-05, S-0017-01 à 08, S-0020-03, S-0025-04. La section « Titres de tests à reprendre » du catalogue disparaît.
- **Défauts corrigés** :
  - **Propositions n'affichait pas la mention « Fusionnée sans revue : aucun autre compte habilité »** que rend l'API pour un seul habilité (S-0006-12). `merge_mode` rejoint `ProposalItem` (`app/src/api.ts`), et `app/src/screens/Proposals.tsx` affiche la mention. Tests : `[S-0006-12]` en e2e, deux tests Vitest dans `Proposals.test.tsx`.
  - **Un « Synchroniser » en échec n'affichait que la conduite à tenir**, pas la cause « Le dépôt local a divergé du dépôt distant » (S-0005-11). `app/src/screens/Administration.tsx` affiche « titre. texte », en `role="alert"`. Tests : `[S-0005-11]` en e2e et en Vitest.
- **Isolation des parcours** (`app/e2e/isolation.ts`). Son `afterEach`, déclaré dans le module, ne s'appliquait qu'au premier fichier qui l'importait. Il devient une fixture automatique : les fichiers importent `test` d'`isolation.ts`. Après chaque test, même en échec, la page est fermée, les espaces `scenario-*` sont retirés du registre de chaque serveur et leurs dossiers temporaires supprimés. `propositions.spec.ts` et `editor.spec.ts` travaillent désormais sur une copie par test. `sharedDemo` et `releaseSharedDemo` donnent un seul espace isolé aux 88 cas de `validation-testables.spec.ts` (7,8 min ramenées à 1,5 min).
- **Couverture**, sur 221 vérifications : 164 ont un test e2e, 5 n'ont qu'un test Vitest, 52 n'ont rien à l'écran, aucune n'est testable sans test front.
- **Résultats** : `npm run e2e` : 187 réussis en 7,9 min ; `npm test` : 158 réussis.
