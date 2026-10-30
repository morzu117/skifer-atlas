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
