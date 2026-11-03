# ADR 0024 — Tags des versions fusionnées hors d'Atlas

Date : 2026-10-31 · Statut : **acceptée** (mise en œuvre du plan 0020)

## Contexte

Une version de document est un tag `doc/<id>/v<n>` sur le commit de fusion (ADR 0007). Atlas le pose quand il fusionne une proposition (ADR 0009). Une pull request fusionnée directement sur GitHub n'en a pas : la version manque à l'historique de la fiche et aux comparaisons par version. L'ADR 0009 laissait ce rattrapage au `sync`.

## Décision

- **Rattrapage au `sync`, sur les seuls commits qu'il apporte.** Après une avance rapide de `avant` à `après`, `repo/versions.py:missing_tags` parcourt les commits de premier parent et ne lit que leurs fichiers documentaires modifiés. Chaque nouvelle version reçoit son tag sur le commit qui l'introduit, y compris si plusieurs versions arrivent dans un seul `sync`. Un fichier déplacé sans changement de version n'en crée pas. Le rattrapage ne parcourt pas tout l'historique : un dépôt importé avec des documents déjà versionnés, sans tags, n'est pas retagué en bloc.
- **Même calcul pour tous les membres.** Le tag est posé dans le clone puis poussé. Sans droit d'écriture (lecteur, règle de dépôt), il reste local. À chaque `sync`, même si le dépôt est déjà à jour, Atlas compare les tags `doc/*` locaux à ceux du distant et repousse les tags absents : ce poste ou le prochain membre qui peut pousser les publie.
- **Signalé, jamais silencieux.** Le `sync` rend `versions_tagged` (« Version fusionnée hors d'Atlas, taguée au sync : revenu-net--nordis-fr v3. »), et `tags_not_pushed` quand la poussée échoue. L'écran d'administration affiche désormais tous les avertissements du `sync`, et non plus le premier.
- Une fusion faite par Atlas tague avant de resynchroniser : le rattrapage ne la voit pas.

## Conséquences

- La fusion hors d'Atlas reste possible ; elle est seulement rattrapée. Les validations de ces fusions relèvent de la règle Code Owners côté GitHub (ADR 0005).
- Un document modifié sur GitHub sans changer de version ne crée pas de version : c'est la version déclarée qui compte, comme dans Atlas.
- Tests : `core/tests/repo/test_workspace_repo.py` (3 tests : fusion hors d'Atlas taguée et poussée, version déjà taguée, poussée refusée) ; `app/src/screens/Administration.test.tsx` (avertissements du `sync`).
