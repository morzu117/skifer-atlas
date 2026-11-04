# Plan 0032 — Créer une déclinaison depuis la fiche KPI

## Objectif

Une personne habilitée crée une déclinaison sans modifier le dépôt à la main. La fiche du KPI mène à un formulaire ; le brouillon local s'ouvre dans l'éditeur et la proposition suit ensuite la gouvernance existante.

## Périmètre

**Dedans** : choix d'une entité de l'espace sans déclinaison, mode surcharge ou `from_scratch`, propriétaire et justification ; brouillon v1 lié à la version courante du KPI ; reprise d'un brouillon local ; validations de l'API ; éditeur existant.

**Dehors** : création d'une entité dans l'espace, changement de mode d'une déclinaison déjà fusionnée, copie automatique du graphe canonique dans un graphe indépendant.

## Références

Brief §4 et §10.2–10.3 ; plans 0001, 0002, 0006, 0012 et 0013 ; manque relevé dans le registre des plans le 2 novembre 2026. Issue #130.

## Spécification

- Depuis l'onglet Déclinaisons d'un KPI, un contributeur ouvre « Créer une déclinaison ». Les lecteurs n'ont pas cette action.
- Le formulaire liste les entités de l'espace sans déclinaison dans le dépôt. Le serveur valide à nouveau l'entité et refuse également un brouillon local existant. Dans ce dernier cas, l'écran propose de le reprendre.
- `POST /api/workspaces/{ws}/editor/variants` écrit uniquement `.atlas/drafts/<kpi>--<entité>.json`. Le document contient `variant_of` à la version courante du canonique et une version initiale 1. Aucun fichier du dépôt ni branche Git n'est créé à cette étape.
- En mode surcharge, `overrides` commence vide et le canevas montre le canonique en lecture. En mode `from_scratch`, le graphe commence vide ; les concepts des sources du canonique sont proposés comme point de départ et restent modifiables dans le panneau Document. Le premier nœud ajouté devient la sortie.
- La validation bloque la soumission tant que le document ne respecte pas le schéma et les règles de graphe. La soumission utilise le flux de proposition du plan 0006.

## Critères d'acceptation

1. Depuis la fiche, créer une surcharge pour une entité libre ouvre un brouillon v1 sur le canonique courant ; l'API refuse une entité absente, une déclinaison existante ou un brouillon en doublon.
2. Depuis la même fiche, créer un graphe indépendant ouvre un canevas vide ; le premier nœud est `n01` et devient la sortie ; ses concepts se modifient dans le panneau Document.

## Tests

- API : `core/tests/repo/test_editor_api.py` couvre les deux modes, le lien à la version courante, les doublons et l'entité inconnue.
- Interface : `app/src/screens/{Fiche,Editor}.test.tsx` couvre l'accès par rôle, les deux modes et la navigation.
- Parcours : `app/e2e/editor.spec.ts` couvre le formulaire, les deux brouillons et le premier nœud dans un espace isolé.

## Dépendances

0012 et 0013, avec le flux de proposition du plan 0006.

## Estimation

**S**.
