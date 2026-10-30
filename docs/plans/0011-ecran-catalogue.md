# Plan 0011 — Catalogue (10.1)

## Objectif
Le catalogue de l'espace courant liste les vrais concepts et KPI du dépôt, avec recherche (synonymes compris), filtres, aperçu latéral et accès à la création.

## Périmètre
**Dedans** : écran 10.1 branché sur `GET …/catalog` ; panneau d'aperçu ; filtres ; bouton « + Nouveau concept ou KPI » (contributeurs et plus), qui ouvre l'éditeur (0013) sur un document vide, le domaine étant choisi à la création.
**Dehors** : la fiche (0012) ; l'éditeur lui-même (0013).

## Références
Brief 10.1, 5.3 ; guide 3.4 (badges, convergence), 3.5, 5 (10.1) ; `screens/10.1-catalogue.html` ; plans 0005, 0010.

## Spécification
- Recherche à la frappe, temporisée de 200 ms, sur `q` ; filtres Domaine / Propriétaire / Statut / Type en selects 44 px, alimentés par les valeurs présentes dans l'index (`GET …/catalog/facets`, ajouté ici côté API).
- Tableau : Nom (lien vers la fiche), Type (badge KPI ou Concept), Domaine, Version (`v4`), Déclinaisons, Convergence (pastille + libellé : Convergé / n candidate(s) / n divergences / Jamais comparé).
- Aperçu (`max-width: 340px`, sous le tableau à moins de 900 px) : nom, domaine · version · propriétaire, description, points de variation, déclinaisons, référencé par, dernière comparaison, « Ouvrir la fiche ». Données : `GET …/documents/{id}/summary` (ajouté ici, agrégeant 0005, 0006 et 0009).
- Sélection d'une ligne au clavier (flèches, Entrée) ; ligne sélectionnée en fond pale.
- États : chargement (squelette de lignes), aucun résultat (« Aucun concept ou KPI ne correspond »), index en reconstruction.

## Critères d'acceptation
1. Sur l'espace de démonstration, le tableau liste les mêmes documents que l'index, avec version et nombre de déclinaisons exacts.
2. « CA net » trouve « Revenu net ».
3. Les filtres se combinent et l'URL garde leur état (retour arrière fonctionnel).
4. Cliquer une ligne ouvre l'aperçu avec les références et les points de variation du document.
5. Le bouton « + Nouveau » est absent pour un lecteur.
6. Sous 900 px de large, l'aperçu passe sous le tableau.
7. Convergence « Jamais comparé » tant qu'aucune comparaison n'existe ; mise à jour après une comparaison (0009).

## Tests
- Composants : tableau, filtres, aperçu (données simulées).
- Bout en bout : Playwright sur l'espace de démonstration.
- À la main : recherche avec accents, puis navigation au clavier.

## Dépendances
0010 (0009 pour la colonne Convergence complète).

## Estimation
**S**. Peu d'incertitude ; l'agrégation `summary` dépend de la disponibilité de 0006 et 0009 (champs vides tolérés).

## Mise en œuvre (30 octobre 2026)
- **API** (`core/`) :
  - `GET …/catalog/facets` : valeurs des filtres présentes dans l'index ; domaines et propriétaires avec leur libellé de gouvernance.
  - `GET …/documents/{id}/summary` (`index/summary.py`) : ligne d'index, libellés, points de variation avec le libellé de leur nœud, déclinaisons et leur mode, « référencé par », dernière comparaison.
  - `GET …/index` : `{fresh}`, sans reconstruire.
  - La convergence produit enfin `candidates:n`. Un écart sur une déclinaison from scratch la laisse candidate ; un écart sur une surcharge est une divergence, et les divergences priment.
- **Interface** (`app/src/`) :
  - `screens/Catalogue.tsx` : recherche temporisée, quatre filtres, tableau, squelette, états vides, aperçu, navigation au clavier ;
  - `router.ts` : paramètres dans l'adresse (`setParams`, `replace`), adresses de la fiche et de l'éditeur ;
  - `screens/WorkspaceShell.tsx` : branche le catalogue et les emplacements de la fiche (0012) et de l'éditeur (0013) ;
  - `format.ts` : convergence, statuts, pourcentage, ancienneté ;
  - tokens ajoutés : `--atlas-search-basis`, `--atlas-table-basis`, `--atlas-table-min-w`, `--atlas-preview-basis`, `--atlas-preview-w`.

  Les choix qui s'écartent du plan ou du guide, ou qu'ils ne fixaient pas, sont dans l'**ADR 0015** :
  - candidates et divergences ;
  - recherche et sélection qui remplacent l'entrée d'historique, filtres qui en ajoutent une ;
  - le focus sélectionne la ligne, Entrée ouvre la fiche ;
  - texte en `--atlas-ink` sur la ligne sélectionnée ;
  - concepts sans convergence ni déclinaisons (« — »).
- **Tests** :
  - `core/tests/repo/test_catalog_api.py` :
    - facettes et leurs libellés ;
    - aperçu de Revenu net et de Commande (critère 4) ;
    - état de l'index ;
    - 404 des nouvelles routes.
  - `core/tests/repo/test_index.py` : les sept cas de convergence (candidates, divergences, version antérieure).
  - `core/tests/repo/test_comparisons_api.py` : dernière comparaison dans l'aperçu après une comparaison.
  - Vitest, `npm test`, 48 tests. Nouveaux :
    - `Catalogue.test.tsx` (9 tests) : critères 1 à 5, clavier, squelette et reconstruction, états vides, erreur ;
    - `format.test.ts` : convergence, pourcentage, ancienneté et nouvelles routes.
  - Playwright, `npm run e2e`, `e2e/catalogue.spec.ts` (7 tests) sur l'espace de démonstration :
    - tableau identique à l'index (critère 1) ;
    - « CA net » (critère 2) ;
    - filtres, adresse et retour arrière (critère 3) ;
    - aperçu, clavier et retour de la fiche (critère 4) ;
    - lecteur sans « + Nouveau » (critère 5) ;
    - aperçu sous le tableau à 880 px (critère 6) ;
    - « Jamais comparé », puis « 1 divergence » et la dernière comparaison après une vraie comparaison locale (critère 7).

    `e2e/rendu.webkit.spec.ts` (WebKit, le moteur de Tauri sous macOS) : recherche et filtres à 44 px. La vérification sous Tauri avait montré des listes déroulantes à 22 px, corrigées par `components/Select.tsx`.

    axe-core passe sans exception, ligne sélectionnée comprise. `e2e/demo.ts` regroupe le dépôt de démonstration et le contrôle axe, partagés avec `accueil.spec.ts`.
- **Reste à faire** :
  - à la main sous Tauri : la recherche, les filtres, l'aperçu et le passage sous le tableau ont été vérifiés. Restent à faire la recherche avec accents et la navigation au clavier ;
  - la fiche (0012) et l'éditeur (0013), aujourd'hui des emplacements.
