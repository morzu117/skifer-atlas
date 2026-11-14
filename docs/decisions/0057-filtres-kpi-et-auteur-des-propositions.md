# ADR 0057 — Filtres KPI et auteur des propositions

Date : 13 novembre 2026 · Statut : **acceptée**

## Contexte

Le brief demande cinq filtres dans la file des propositions ; le plan 0014 et la maquette ne retiennent que domaine, entité et statut.

## Décision

Ajouter les filtres KPI et Auteur aux trois filtres existants. Les choix se combinent et sont conservés dans l'adresse selon l'ADR 0018. Les options proviennent des propositions du statut chargé ; les auteurs sont affichés par leur nom connu, ou leur compte à défaut. Un KPI canonique et ses déclinaisons partagent le même filtre. Une proposition sans KPI ne correspond à aucun KPI sélectionné.

## Conséquences

Le brief prévaut sur le plan et la maquette pour ces filtres. Changer de filtre efface la sélection explicite de proposition ; le retour arrière et le rechargement restaurent les choix.
