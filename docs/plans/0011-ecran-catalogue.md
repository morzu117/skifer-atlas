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
