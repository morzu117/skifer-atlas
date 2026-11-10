# ADR 0048 — Concepts présents et brouillons locaux

Date : 10 novembre 2026

## Décision

Un concept rattaché absent du dépôt est une erreur `unknown_concept`. Un fichier de concept présent mais invalide reste connu par son identifiant de chemin : son invalidité est signalée sur le concept et ne rend pas le KPI introuvable. `Library(complete_concepts=True)` garantit que tous les identifiants de concepts présents sont fournis, y compris les documents invalides, via `concept_ids` ; une bibliothèque partielle ne peut pas conclure à une absence.

Les brouillons de création de concepts et KPI restent visibles dans « Mes brouillons », même si leur identifiant existe maintenant dans le dépôt ou si leur fichier est illisible. Un brouillon illisible peut être abandonné mais pas repris. Les brouillons de déclinaison restent hors de cette liste.

## Limites acceptées

Certains cadres de fenêtre mal formés restent tolérés par sqlglot, par exemple `ROWS BETWEEN 1 FOLLOWING AND 1 PRECEDING`. Une course théorique subsiste entre un PUT de brouillon encore en vol et son abandon.

Un document comportant environ 400 niveaux d’imbrication, collé en YAML ou envoyé par l’API, peut encore provoquer une `RecursionError` dans check, preview ou parse.
