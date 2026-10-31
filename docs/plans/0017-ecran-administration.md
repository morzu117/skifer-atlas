# Plan 0017 — Administration de l'espace (10.7)

## Objectif
Le référent paramètre l'espace (domaines, validateurs requis, utilisateurs et rôles, dépôt Git, plateformes autorisées) depuis l'application ; chaque enregistrement crée une proposition de modification de `governance.yaml`, et aucun token n'apparaît nulle part.

## Périmètre
**Dedans** : écran 10.7 ; formulaires de domaine et d'invitation (non maquettés) ; enregistrement via proposition (0006) ; affichage du dépôt et de la dernière synchronisation, avec « Synchroniser ».
**Dehors** : gestion des comptes sur l'hébergeur (l'invitation ajoute le compte à `governance.yaml` ; l'accès au dépôt se donne sur l'hébergeur, l'écran le rappelle).

## Références
Brief 5, 10.7 ; guide 5 (10.7), 7 ; `screens/10.7-administration.html` ; ADR 0005 ; plan 0006.

## Spécification
- Accès réservé au rôle `referent` (route et API : 403 sinon).
- Sections en grille de 2 colonnes : Domaines métier (liste, « + Domaine », alerte orange si un domaine n'a pas de référent) ; Validateurs requis (canonique et déclinaisons, min 1, surcharges par domaine, rappel « une surcharge hors des points déclarés exige toujours le nombre canonique ») ; Utilisateurs et rôles (tableau Nom / Entité / Rôle / Domaines, « + Inviter ») ; Dépôt Git (URL en mono, branche principale, dernière synchronisation, « Synchroniser ») ; Plateformes autorisées (cases avec le mode d'auth).
- « Enregistrer les paramètres » calcule le nouveau `governance.yaml` (et `allowed_platforms`), le valide, puis crée une proposition « Gouvernance » (1 référent requis, 0006). Bouton libellé « Enregistrer et créer la proposition », conformément au guide 3.2. « Annuler » restaure l'état lu.
- Renommer un domaine change son `label`, jamais son `id` (aucun fichier déplacé).
- Référent seul (ADR 0008) :
  - tant que la branche principale ne compte qu'un référent, un bandeau permanent indique que ses modifications de gouvernance sont fusionnées sans revue. Le bouton devient « Enregistrer et fusionner », avec la même mention sur la proposition créée ;
  - le rappel « Require review from Code Owners » n'apparaît qu'à partir de deux référents.

## Critères d'acceptation
1. Un non-référent n'accède ni à l'écran ni à l'API (403).
2. Ajouter un domaine sans référent affiche l'alerte.
3. Un nombre de validateurs à 0 est refusé (min 1).
4. Enregistrer crée une proposition dont le diff ne porte que sur `governance.yaml` et le `CODEOWNERS` régénéré (ADR 0009).
5. Renommer un domaine ne modifie que son libellé.
6. Aucun champ ni texte de token sur l'écran.
7. « Synchroniser » met à jour la date et réindexe.
8. Avec un seul référent, le bandeau est affiché, l'enregistrement fusionne directement avec la mention, et le bandeau disparaît après l'ajout d'un deuxième référent.

## Tests
- Composants : formulaires et validations.
- Bout en bout : modification de la gouvernance via `LocalHost`, approbation, fusion, puis effet sur le décompte des validations (0006).
- À la main : relecture des libellés avec un référent.

## Dépendances
0006, 0010.

## Estimation
**M**. Le cas du référent seul est tranché par l'ADR 0008 (fusion sans revue tracée, tant qu'aucun autre compte n'est habilité) ; ce choix est à revoir à l'usage.

## Mise en œuvre (31 octobre 2026)

- **Cœur** (`core/src/skifer_atlas/`) :
  - `admin.py` (nouveau) :
    - `admin_state` : gouvernance, empreinte, domaines sans référent, référents d'espace, KPI par domaine, plateformes et modes d'authentification, dépôt ;
    - `save_governance` : proposition « Gouvernance », fusionnée aussitôt si aucun autre compte n'est habilité (ADR 0008) ;
    - `describe_changes` : la justification en phrases ;
    - accès réservé aux référents d'espace (`forbidden`) ;
  - `proposals/create.py` : `create_governance_proposal` refuse une base périmée (`stale_base`, avec `base_digest`) et une gouvernance inchangée (`no_change`) ;
  - `workspaces.py` et `repo/sync.py` : `Workspace.synced_at`, posé au clonage et à chaque synchronisation ;
  - `api/routes/governance.py` : `GET …/admin` et `POST …/admin/governance` ;
  - `api/routes/workspaces.py` :
    - `space_referent` dans la liste des espaces ;
    - `POST …/sync` réindexe et rend `reindexed` et `synced_at` ;
  - `api/app.py` : 422 pour `no_change`.
- **Interface** (`app/src/`) :
  - `screens/Administration.tsx` : les cinq sections de la maquette, les formulaires de domaine et d'invitation, le bandeau du référent seul, l'enregistrement et la synchronisation ;
  - `api.ts` : les types et les appels ;
  - `WorkspaceShell.tsx` :
    - Administration pour les seuls référents d'espace (`space_referent`) ;
    - fin de l'écran d'attente des plans à venir ;
  - `styles.css` : section « Administration » ;
  - `tokens.css` : `--atlas-admin-col-min`, copié dans `docs/design/tokens.css`.
- **Décisions** : ADR 0021. Les principales :
  - écran réservé aux référents d'espace ;
  - modification sur une copie locale, puis un seul enregistrement ;
  - `base_digest` contre l'écrasement ;
  - justification rédigée par le serveur ;
  - URL du dépôt en lecture seule ;
  - membre à un seul rôle modifiable à l'écran ;
  - pas de retrait de membre ni de domaine.
- **Tests** :
  - `core/tests/repo/test_admin.py` (7 tests) :
    - 403 pour un référent de domaine, un contributeur ou un inconnu (critère 1) ;
    - ce que l'écran affiche, sans aucune clé de jeton (critère 6) ;
    - référent seul : domaine Data sans référent, renommage de Supply chain, canonique à 3. La proposition est fusionnée, avec la mention et le trailer, et son diff ne porte que sur `governance.yaml` et `CODEOWNERS`. L'identifiant `supply` est inchangé, puis viennent `stale_base` et `no_change` (critères 2, 4, 5 et 8) ;
    - validateurs à 0 refusés, sur l'espace comme sur un domaine (critère 3) ;
    - avec un deuxième référent, l'enregistrement attend une revue (critère 8) ;
    - synchronisation : date mise à jour, réindexation, puis plus rien à reconstruire (critère 7) ;
    - jeton de session exigé.
  - Vitest, `npm test`, 132 tests. Nouveau : `screens/Administration.test.tsx` (12 tests) :
    - règles de rôle ;
    - sections, bandeau, aucun champ de token (critères 6 et 8) ;
    - nouveau domaine sans référent, puis fusion (critère 2) ;
    - identifiant de domaine déjà pris ;
    - 0 validateur refusé (critère 3) ;
    - renommage par le libellé seul (critère 5) ;
    - invitation ;
    - plateformes ;
    - Synchroniser (critère 7) ;
    - deux référents (critère 8) ;
    - base périmée ;
    - 403 (critère 1).

    Dans `App.test.tsx`, un nouveau test vérifie qu'un référent de domaine ne voit pas Administration.
  - Playwright, `npm run e2e`, `e2e/administration.spec.ts` (3 tests), sur le serveur de `julien.h` (port 8795) et son propre dépôt de démonstration :
    - référent seul : 0 refusé, domaine Data, fusion ;
    - Claire M. passe référent d'espace : le bandeau disparaît, le rappel Code Owners s'affiche et la proposition suivante attend une revue ;
    - Synchroniser.

    axe-core passe à chaque étape.
- **Reste à faire** :
  - relire les libellés avec un référent ;
  - l'enregistrement réel sur GitHub, avec la règle Code Owners ;
  - retirer un membre ou un domaine, et les membres aux rôles multiples.
