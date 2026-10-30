# Plan 0010 — Coque applicative, accueil des espaces et sélecteur (10.0)

## Objectif
L'application de bureau s'ouvre sur la liste réelle des espaces de l'utilisateur ; on peut en créer un ou en rejoindre un par l'URL de son dépôt ; un clic ouvre l'espace dans la coque (barre latérale, sélecteur d'espace, navigation), avec les états de chargement et d'erreur du serveur local.

## Périmètre
**Dedans** : coque (barre latérale 232 px, sélecteur, navigation selon le rôle) ; routage ; accueil 10.0 branché sur l'API (0005) ; formulaires « Créer un espace » et « Rejoindre un espace » ; états vide, chargement, serveur injoignable ; polices embarquées ; outillage de test front (Vitest + Testing Library, Playwright contre l'app Vite et un serveur Python de test).
**Dehors** : contenu des autres écrans (0011 et suivants) ; invitation d'utilisateurs (0017).

## Références
Brief 5.3, 10.0 ; guide 1, 2, 3.1 à 3.4, 5 (10.0), 6, 7 (formulaires et états non maquettés) ; `docs/design/screens/10.0-accueil-espaces.html` ; `app/src/{App.tsx,api.ts,styles.css,tokens.css}` ; plan 0005.

## Spécification
- **Routage** par hash (`#/`, `#/w/:ws/catalogue`, `#/w/:ws/propositions`, …), sans serveur. L'espace courant vient de l'URL. Toute vue sous `/w/:ws` charge l'espace ; un `ws` inconnu ramène à l'accueil avec un message.
- **Coque** : conforme au guide 3.1. « Administration » n'est visible que pour le rôle `referent` dans l'espace courant. Le compteur orange de « Propositions » vient de `GET …/proposals?status=open&for_me=1` quand 0006 est livré ; d'ici là, il est masqué.
- **Accueil** : grille `auto-fill minmax(280px)` de cartes (initiales, badge de rôle, nom, secteur · n entités · n domaines, compteurs KPI / concepts / propositions en attente, en orange si > 0). `GET /api/workspaces` est enrichi par 0005 de `counts {kpi, concept, open_proposals}`. Carte vide pointillée s'il n'y a aucun espace. Note fixe sur le coffre local.
- **Créer un espace** (non maquetté) : panneau latéral 340 px. Champs : nom (requis), identifiant (dérivé, modifiable, motif de l'API), secteur, entités (liste), dépôt distant (optionnel, rattachable plus tard). Bouton « + Créer l'espace ». Le créateur devient référent (analyse Q12).
- **Rejoindre un espace** : URL du dépôt, puis « Cloner et ouvrir ». Progression, puis erreurs `git_missing` et `sync_conflict` traduites.
- **États** : démarrage (« Démarrage du serveur local… »), serveur injoignable (bandeau critique, bouton « Réessayer »), erreur d'API (bandeau avec le message et l'action). Toute requête passe par `api.ts`, qui ajoute le token.
- **Règles** : couleurs et tailles uniquement par tokens ; Inter et JetBrains Mono embarquées (`app/src/assets/fonts`, `@font-face`) ; actions en `<button>` ou `<a href>` ; fenêtre minimale 960 × 640 (`tauri.conf.json`).

## Critères d'acceptation
1. Avec deux espaces au registre, l'accueil affiche deux cartes conformes à la maquette (nom, rôle, compteurs).
2. Sans espace, la carte vide s'affiche.
3. Créer un espace l'ajoute à la grille et ouvre son catalogue ; un identifiant déjà pris affiche l'erreur 409 sous le champ.
4. Rejoindre un dépôt local de démonstration clone et ouvre l'espace.
5. Serveur arrêté : bandeau « serveur injoignable », puis « Réessayer » fonctionne après redémarrage.
6. Le sélecteur d'espace affiche l'espace courant et ramène à l'accueil.
7. « Administration » est absente pour un rôle non référent.
8. Aucune couleur ou taille en dur hors `tokens.css` (test qui cherche `#[0-9a-f]{3,6}` et `px` hors tokens dans `app/src`, avec une liste d'exceptions explicite).
9. Aucune requête vers Google Fonts (polices locales vérifiées en Playwright, réseau coupé).
10. Navigation complète au clavier ; boutons icône avec `aria-label` (axe-core sans violation sérieuse).

## Tests
- Composants : Vitest + Testing Library (cartes, états, formulaires).
- Bout en bout : Playwright contre `vite` et un serveur Python lancé sur un dossier de données temporaire.
- À la main : `npm run tauri dev`, puis création, ouverture et bascule entre deux espaces.

## Dépendances
0005.

## Estimation
**M**. Incertitudes : forme définitive du formulaire de création (non maquetté) ; mise en place de Playwright avec le serveur Python.

## Mise en œuvre (30 octobre 2026)
- **API** (`core/`) :
  - `GET /api/workspaces` ajoute `counts {kpi, concept, open_proposals}`, calculés sans réseau côté Git (index du clone, dernier fetch) ; un compteur indisponible vaut `null`.
  - Chaque proposition ouverte porte `awaiting_me` ; `GET …/proposals?for_me=true` ne rend que celles qui attendent ma revue.
  - `open_context(fetch=False)` lit la gouvernance du dernier fetch.
- **Interface** (`app/src/`) :
  - `router.ts` : routage par hash ;
  - `api.ts` : le token, les erreurs typées (`ApiError`, `UnreachableError`) et l'adresse `VITE_ATLAS_API` hors Tauri ;
  - `server.ts` : démarrage, serveur injoignable, « Réessayer » ;
  - `messages.ts` : codes d'erreur traduits (`git_missing`, `sync_conflict`, `clone_failed`…) ;
  - `screens/Home.tsx` : accueil 10.0 ;
  - `screens/CreateWorkspace.tsx`, `screens/JoinWorkspace.tsx` : panneaux latéraux ;
  - `screens/WorkspaceShell.tsx` : coque, sélecteur, navigation selon le rôle, compteur des propositions, emplacements des écrans 0011 à 0017 ;
  - `components/` : `Banner`, `Brand`, `Drawer`, `Field`, `Icon`.
  - Polices dans `assets/fonts/`, `@font-face` dans `fonts.css`.
  - `styles.css` n'utilise que des tokens.

  Les choix qui s'écartent du plan ou du guide, ou qu'ils ne fixaient pas, sont dans l'**ADR 0013** :
  - compteurs et `awaiting_me` ;
  - « + Créer un espace » toujours visible, et « Rejoindre un espace » à côté ;
  - focus au titre à chaque vue ;
  - tokens ajoutés, valeurs arrondies à la base de 4 px ;
  - écart de contraste du guide, à arbitrer.
- **Tests** :
  - `core/tests/repo/test_proposals.py` : `awaiting_me`, `for_me` et les compteurs (2 tests).
  - Vitest et Testing Library, `npm test`, 32 tests :
    - `Home.test.tsx` : critères 1 à 4, erreurs d'API et de clonage traduites, Échap ;
    - `App.test.tsx` : critères 5 à 7, démarrage, espace inconnu ;
    - `tokens.test.ts` : critère 8, plus l'identité des deux `tokens.css` et l'absence de Google Fonts ;
    - `format.test.ts` : initiales, pluriels, identifiant dérivé, routes.
  - Playwright, `npm run e2e`, 5 tests contre Vite et un vrai serveur Python sur un dossier temporaire :
    - registre vide ;
    - polices locales avec le réseau coupé (critère 9) ;
    - création, puis 409 ;
    - adhésion au dépôt de démonstration en contributrice, sans Administration ;
    - deux cartes ;
    - navigation au clavier et axe-core sur l'accueil, la coque et le panneau (critère 10) ;
    - bandeau du serveur injoignable puis « Réessayer » (critère 5), simulé en coupant les requêtes vers le serveur.
- **Reste à faire** :
  - arbitrer l'écart de contraste du guide (`--atlas-warn` et `--atlas-mid`, ADR 0013) ;
  - vérifier à la main sous Tauri : `npm run tauri dev`, création, ouverture, bascule entre deux espaces ;
  - invitation d'utilisateurs (plan 0017).
