# Plan 0020 — Tags des versions fusionnées hors d'Atlas

## Objectif
Une pull request fusionnée directement sur GitHub, sans passer par Atlas, laisse aujourd'hui sa version sans tag `doc/<id>/v<n>` : la fiche ne la voit pas dans l'historique des versions. Le `sync` doit rattraper ces fusions (reste à faire du plan 0006, ADR 0009).

## Périmètre
**Dedans** : détection, au `sync`, des versions arrivées sans tag ; tag posé localement puis poussé ; avertissement dans le résultat du `sync` et à l'écran d'administration.
**Dehors** : retaguer un historique ancien déjà présent avant le `sync` ; vérifier les validations d'une fusion faite hors d'Atlas (la règle Code Owners de l'ADR 0005 s'en charge côté GitHub).

## Spécification
- Après une avance rapide, pour chaque document modifié entre l'ancien et le nouveau commit : si `data_product.version` a changé et que le tag `doc/<id>/v<n>` n'existe pas, il est posé sur le premier commit de la branche principale (premier parent) qui porte cette version. C'est le commit de fusion, comme pour une fusion faite par Atlas.
- Un document modifié sans changement de version ne reçoit rien. Une version déjà taguée (fusion par Atlas) non plus.
- Les tags sont poussés. Sans droit d'écriture, ils restent sur le poste ; chaque membre calcule les mêmes, et le prochain qui peut pousser les publie.
- Le `sync` rend `versions_tagged` (et `tags_not_pushed` si la poussée échoue) dans `warnings`. L'écran d'administration affiche tous les avertissements.

## Critères d'acceptation
1. Après une fusion faite sur l'hébergeur, le `sync` pose le tag de la nouvelle version sur le commit de fusion, et le tag arrive sur le dépôt distant.
2. Une version déjà taguée, ou un commit sans changement de version, ne produit ni tag ni avertissement.
3. Une poussée refusée laisse le tag local et le signale.
4. L'écran d'administration affiche chaque avertissement du `sync`.

## Tests
`core/tests/repo/test_workspace_repo.py` ; `app/src/screens/Administration.test.tsx`.

## Dépendances
0005, 0006, 0017.

## Estimation
**S**.

## Mise en œuvre (31 octobre 2026)

Décisions : [ADR 0024](../decisions/0024-tags-au-sync.md).

- **Cœur** :
  - `repo/versions.py` : `version_at` (version d'un document à une révision) et `missing_tags` ;
  - `repo/sync.py` : `_catch_up_tags` après une avance rapide, avertissements `versions_tagged` et `tags_not_pushed`.
- **App** : `screens/Administration.tsx` affiche tous les avertissements du `sync`.
- **Tests** :
  - `core/tests/repo/test_workspace_repo.py` (3 tests) : fusion `--no-ff` faite hors d'Atlas, taguée sur le commit de fusion et poussée sur le dépôt nu ; version déjà taguée ; poussée refusée par un hook `pre-receive` ;
  - `app/src/screens/Administration.test.tsx` : les deux avertissements à la suite, en ton d'alerte.
- **Critères** : 1 à 4 couverts par ces tests.
- **Reste à faire** : la vérification contre un vrai dépôt GitHub, avec une fusion faite dans l'interface de GitHub.
