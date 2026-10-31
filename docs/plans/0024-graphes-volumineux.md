# Plan 0024 — Graphes volumineux dans l'éditeur

## Objectif
L'éditeur reste fluide au-delà de 50 nœuds, le volume que le plan 0013 a validé côté serveur sans mesurer le rendu (reste à faire du plan 0013).

## Périmètre
**Dedans** : rendu du canevas de l'éditeur et du graphe en lecture ; mesure sur un graphe de 200 nœuds.
**Dehors** : la validation côté serveur (déjà mesurée par le plan 0013) ; la disposition automatique ; un mode « vue d'ensemble » sans cartes.

## Spécification
- Une carte ne se redessine que si son nœud, ses marques (variation, surcharge, problème, sortie, arête en cours) ou sa sélection changent. Un déplacement ne redessine que la carte déplacée.
- Un document recopié à l'identique (chaque modification recopie le document) ne redessine rien.
- Au-delà de 50 nœuds, seules les cartes de la zone visible sont dessinées. En dessous, tout reste dessiné.
- Le graphe en lecture (fiche, diff, comparaison) applique la même mémoïsation.

## Critères d'acceptation
1. Déplacer un nœud d'un graphe de 50 nœuds ne redessine que sa carte.
2. Une modification ne redessine que le nœud modifié ; un changement de sélection, les deux cartes concernées.
3. Sur 200 nœuds, le DOM ne contient que les cartes visibles.
4. Sur 200 nœuds, ouverture, sélection et déplacement à la souris aboutissent ; les temps sont notés.

## Tests
`app/src/editor/Canvas.test.tsx` ; `app/e2e/graphe-volumineux.spec.ts`.

## Dépendances
0013.

## Estimation
**S**.

## Mise en œuvre (31 octobre 2026)

Décisions : [ADR 0028](../decisions/0028-graphe-volumineux.md).

- **App** :
  - `stable.ts` : `useStable` garde l'objet d'un nœud ou d'une arête React Flow tant que son contenu, comparé en JSON, ne change pas ;
  - `editor/Canvas.tsx` :
    - `Card` mémoïsée ;
    - nœuds et arêtes stables ;
    - `nodeColor` de la mini-carte hors du rendu ;
    - `onlyRenderVisibleElements` au-delà de `LARGE_GRAPH` (50) ;
  - `components/GraphView.tsx` : `Card` mémoïsée, nœuds et arêtes stables.
- **Tests** :
  - Vitest, `editor/Canvas.test.tsx` (5 tests). `summary`, appelée une fois par rendu de carte, sert de compteur :
    - déplacement (critère 1) ;
    - copie identique ;
    - sélection ;
    - modification d'un nœud (critère 2) ;
    - cartes dessinées sur 200 nœuds (critère 3).

    Sans `useStable` ni `onlyRenderVisibleElements`, les cinq tests échouent.
  - Playwright, `e2e/graphe-volumineux.spec.ts` : un brouillon de 200 nœuds (source, 198 calculs, une agrégation, comme le graphe du plan 0013) est posé par l'API puis ouvert dans l'éditeur (critères 3 et 4).
- **Mesure** (Chromium headless, MacBook de développement, trois passages) :
  - 12 cartes dessinées sur 200 ;
  - ouverture jusqu'à la première carte : 845 à 874 ms, dont le chargement de la page et la validation ;
  - sélection d'une carte jusqu'au panneau Propriétés : 14 à 26 ms ;
  - déplacement à la souris en 12 pas, jusqu'à la nouvelle position : 207 à 218 ms, dont les pas simulés de Playwright.

  Sans l'optimisation, les 200 cartes étaient dans le DOM.
- **Critères** : 1 à 4 couverts par ces tests.
- **Reste à faire** :
  - vérification à la main sous Tauri (WebKit), avec un graphe réel de cette taille ;
  - le seuil de 50 est à revoir si une session d'édition montre une gêne.
