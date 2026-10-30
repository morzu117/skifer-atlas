# Plan 0012 — Fiche KPI (10.2)

> La maquette 10.2 est marquée « à retravailler, en attente de retour ». Ce plan livre le contenu et les données de chaque onglet avec les composants du guide ; la mise en page de l'onglet Définition est provisoire et ne bloque pas.

## Objectif
La fiche d'un KPI ou d'un concept affiche son graphe canonique en lecture (points de variation mis en évidence), ses déclinaisons, ses versions avec diff, ses dépendances tous domaines, ses implémentations et ses dernières comparaisons, à partir des données réelles du dépôt.

## Périmètre
**Dedans** : en-tête (nom, badges, version et date de validation, propriétaire · validateurs requis · synonymes) ; six onglets ; composant « graphe en lecture » (React Flow, nœuds-cartes 150 px) réutilisé par 0014 ; disposition automatique déterministe ; actions « Lancer une comparaison » (vers 0015, KPI présélectionné) et « Proposer une modification » (vers 0013, sur une nouvelle version).
**Dehors** : édition (0013) ; détail d'une proposition (0014).

## Références
Brief 3.1, 3.2, 4, 10.2 ; guide 3.4, 3.8, 4 (nœud en lecture), 5 (10.2), 7 ; `screens/10.2-fiche-kpi.html` ; plans 0003, 0005, 0009.

## Spécification
- **Disposition du graphe** : calculée côté serveur (`GET …/documents/{id}/layout`), par couches de l'ordre topologique et position stable dans la couche par identifiant, pour être identique d'un poste à l'autre et réutilisable dans le diff.
- **Définition** : graphe en lecture, légende, carte « Sémantique déclarée » (calendrier, fuseau, devise, arrondi « À la restitution », avec la mention « (variation) » quand c'est un point déclaré), carte Déclinaisons (nom + badge de mode), carte Dépendances (références / référencé par, « Une nouvelle version touchera n KPI » en orange).
- **Déclinaisons** : tableau Entité, Mode (badge), Surcharges (n, dont n hors points déclarés), Justification, Candidate à la convergence.
- **Versions** : tableau Version, Date, Auteur, Message ; sélection de deux versions, puis diff (rendu des écarts de 0003 en liste, et graphe en lecture avec nœuds surlignés selon la grammaire du guide 4).
- **Dépendances** : deux listes avec domaine de chaque élément ; lien vers chaque fiche.
- **Implémentations** : fichiers `implementations/<kpi>/<entité>/<plateforme>.sql`, affichés en JetBrains Mono, avec un bouton « Extraire et comparer au canonique » qui appelle 0004 puis 0003 et affiche le résultat du diff.
- **Scope et comparaisons** : scopes déclarés, tolérance, trois dernières comparaisons (0009).

## Critères d'acceptation
1. La fiche « Revenu net » de démonstration affiche n01 à n05 avec les points de variation en bordure pointillée orange.
2. Les compteurs des onglets (Déclinaisons 3, Versions 4) correspondent au dépôt.
3. Le diff entre v3 et v4 affiche les écarts de 0003, classés et colorés.
4. L'onglet Implémentations extrait un SQL et affiche son diff au canonique.
5. « Proposer une modification » ouvre l'éditeur sur une copie de la version courante, `version` incrémentée en brouillon.
6. Deux chargements donnent la même disposition (positions identiques).
7. Une fiche de concept masque les onglets non pertinents (Scope et comparaisons).

## Tests
- Composants : en-tête, onglets, graphe en lecture (instantané du rendu des nœuds).
- Bout en bout : parcours catalogue → fiche → versions → diff.
- À la main : relecture avec le produit, puisque la maquette est à retravailler.

## Dépendances
0011, 0003, 0004 (onglet Implémentations), 0009 (dernier onglet).

## Estimation
**M**. Incertitudes : retour attendu sur la maquette ; lisibilité des grands graphes (au-delà d'une trentaine de nœuds) en lecture.

## Mise en œuvre (30 octobre 2026)

- **Cœur** (`core/src/skifer_atlas/`) :
  - `model/layout.py` : disposition du graphe (couche = plus long chemin depuis une entrée, rang par identifiant) et texte des cartes, conditions comprises ;
  - `sheet.py` :
    - la fiche : aperçu du plan 0011, date de validation, validateurs requis, sémantique, déclinaisons, dépendances avec domaine, implémentations, scopes, tolérances ;
    - la disposition d'une version ;
    - le diff de deux versions ;
    - l'extraction d'une implémentation et son diff au canonique ;
    - le brouillon de la version suivante ;
  - `api/routes/sheet.py` : `GET …/documents/{id}/sheet`, `/layout?version=`, `/diff?base=&other=`, `/draft` et `POST …/implementations/{entité}/{plateforme}/extract`, derrière le token de session ;
  - `index/search.py` : les dépendances portent le domaine de chaque document.
- **Interface** (`app/src/`) :
  - `screens/Fiche.tsx` :
    - en-tête, six onglets dans l'adresse (`?tab=`), compteurs ;
    - Définition, Déclinaisons ;
    - Versions, avec le diff dans l'adresse (`&base=&other=`) ;
    - Dépendances, Implémentations, Scope et comparaisons ;
  - `components/GraphView.tsx` : graphe en lecture (React Flow), réutilisable par le diff d'une proposition (0014) ;
  - `components/DiffList.tsx` : écarts du plan 0003, classés et colorés, et leur synthèse ;
  - `screens/Editor.tsx` : en attendant le plan 0013, `editeur?from=<id>` affiche le brouillon de la nouvelle version ;
  - `router.ts`, `api.ts`, `format.ts` (dates longues, tolérance) ;
  - token ajouté : `--atlas-node-read-w` (150 px).
- **Démonstration** :
  - `examples/depot-nordis.sh` construit le dépôt de l'espace avec l'historique de Revenu net : quatre commits datés, tags `doc/revenu-net/v1` à `v4` ;
  - les versions 1 à 3 sont dans `examples/historique-nordis/`.

  Les choix que le plan ne fixait pas, ou dont on s'écarte, sont dans l'**ADR 0016** :
  - algorithme de disposition ;
  - graphe sans zoom qui défile ;
  - famille en pastille, pour le contraste ;
  - deux graphes du diff superposés ;
  - extraction comparée au canonique en relation `free` ;
  - brouillon par réécriture de la seule ligne `version` ;
  - impact compté en documents ;
  - candidate = from scratch.
- **Tests** :
  - `core/tests/repo/test_sheet_api.py`, sur le dépôt de `depot-nordis.sh` :
    - en-tête et compteurs (critère 2) ;
    - n01 à n07 et points de variation n03 et n04 (critère 1) ;
    - disposition identique à deux appels (critère 6) ;
    - diff de v3 à v4 : n04 à examiner, n06 et n07 critiques (critère 3) ;
    - extraction et diff (critère 4) ;
    - brouillon qui ne diffère que par la ligne `version` (critère 5) ;
    - fiche de concept ;
    - 404.
  - `core/tests/model/test_layout.py` : disposition indépendante de l'ordre du YAML, cartes par famille, texte des conditions.
  - Vitest, `npm test`, 61 tests. Nouveaux :
    - `Fiche.test.tsx` (9 tests) : en-tête, onglets et compteurs, instantané des cartes du graphe, positions, déclinaisons, diff de versions, concept, document introuvable, brouillon ;
    - `format.test.ts` : routes, dates, tolérance.
  - Playwright, `npm run e2e`, `e2e/fiche.spec.ts` (7 tests) :
    - catalogue → fiche, avec en-tête, compteurs, graphe et bordures pointillées orange (critères 1 et 2) ;
    - disposition identique après rechargement (critère 6) ;
    - versions → diff de v3 à v4, classé et coloré, graphes surlignés (critère 3) ;
    - extraction (critère 4) ;
    - déclinaisons, dépendances et scope ;
    - brouillon en v5 (critère 5) ;
    - concept à trois onglets (critère 7).

    `e2e/rendu.webkit.spec.ts` vérifie aussi, sous WebKit, les cartes de 150 px, la bordure pointillée et les listes De / À à 44 px. axe-core passe sans exception sur chaque onglet.
- **Reste à faire** :
  - relecture avec le produit, la maquette étant à retravailler ;
  - vérification à la main sous Tauri ;
  - l'éditeur (0013) partira du brouillon de `GET …/draft`.
