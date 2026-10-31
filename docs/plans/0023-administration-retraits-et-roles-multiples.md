# Plan 0023 — Administration : retraits et rôles multiples

## Objectif
L'écran d'administration (plan 0017) ne sait ni retirer un membre ou un domaine, ni modifier un membre qui a plusieurs rôles : il faut encore éditer `governance.yaml` à la main (ADR 0021). Le référent de l'espace doit pouvoir tout faire depuis l'écran.

## Périmètre
**Dedans** : retirer un membre ; retirer un domaine ; rôles multiples à l'invitation et à la modification ; garde-fous côté écran et côté serveur.
**Dehors** : déplacer les documents d'un domaine à un autre (une proposition sur les documents eux-mêmes) ; retirer l'accès au dépôt sur l'hébergeur.

## Références
ADR 0021 ; `core/src/skifer_atlas/admin.py`, `app/src/screens/Administration.tsx` ; maquette `docs/design/screens/10.7-administration.html`.

## Spécification
- **Retirer un membre** : bouton « Retirer de l'espace » dans le formulaire du membre. Son compte disparaît aussi des référents et validateurs des domaines. Le dernier référent de l'espace ne se retire pas : bouton grisé, avec la raison. Se retirer soi-même est possible, avec un avertissement.
- **Retirer un domaine** : bouton « Retirer le domaine » dans le formulaire du domaine, grisé tant que des documents y sont rattachés (nombre affiché). Les rôles limités à ce seul domaine disparaissent : un rôle ne s'élargit jamais à tout l'espace. Un membre sans rôle restant devient lecteur. Le serveur refuse aussi (422 `domain_in_use`) un domaine retiré qui porte encore des documents.
- **Rôles multiples** : le formulaire du membre liste ses rôles, chacun avec ses domaines ; « + Ajouter un rôle », « Retirer le rôle n ». Un rôle ne figure qu'une fois.
- Tout reste une modification locale jusqu'à « Enregistrer », qui ouvre la proposition « Gouvernance » comme aujourd'hui ; la justification rédigée dit « … retiré. ».

## Critères d'acceptation
1. Un membre retiré disparaît de `governance.yaml`, membres et domaines compris.
2. Le dernier référent de l'espace ne peut pas être retiré.
3. Un domaine sans document se retire, sans élargir aucun rôle ; un domaine qui porte des documents ne se retire pas, ni à l'écran ni par l'API.
4. Un membre peut recevoir et garder plusieurs rôles depuis l'écran.

## Tests
`core/tests/repo/test_admin.py` ; `app/src/screens/Administration.test.tsx`.

## Dépendances
0017.

## Estimation
**S**.

## Mise en œuvre (31 octobre 2026)

Décisions : [ADR 0027](../decisions/0027-administration-retraits.md).

- **Cœur** (`admin.py`) :
  - `document_counts` dans l'état de l'écran (concepts, KPI, déclinaisons par domaine) ;
  - `_check_removed_domains` : 422 `domain_in_use` avant toute proposition ;
  - justification sans double point après un nom abrégé (« Claire M. »).
- **App** (`screens/Administration.tsx`) :
  - `withoutMember` et `withoutDomain` ;
  - boutons « Retirer de l'espace » et « Retirer le domaine » (style `btn-danger`), avec leur raison ;
  - formulaire de membre à plusieurs rôles (`.admin-role`).
- **Tests** :
  - `core/tests/repo/test_admin.py` (2 tests) : retraits et rôles multiples fusionnés, avec la justification ; domaine Supply chain refusé (`domain_in_use`) ;
  - `app/src/screens/Administration.test.tsx` (4 tests) : règles de retrait ; dernier référent ; domaine avec et sans documents ; deux rôles, avec le doublon refusé.
- **Critères** : 1 à 4 couverts par ces tests.
- **Reste à faire** : relire les libellés avec un référent (comme pour le plan 0017).
