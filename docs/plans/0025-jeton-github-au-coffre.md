# Plan 0025 — Jeton GitHub au coffre

## Objectif
Le jeton GitHub d'un espace s'obtient dans Atlas et se range au coffre local, par espace, au lieu de `ATLAS_GITHUB_TOKEN` (reste à faire du plan 0006, ADR 0009). Un dépôt privé se rejoint sans configuration préalable.

## Périmètre
**Dedans** : device flow d'OAuth ; jeton au coffre par espace ; ligne « Dépôt de l'espace » dans Mes connexions ; connexion depuis « Rejoindre un espace » pour un dépôt privé ; client OAuth fourni par la build.
**Dehors** : rafraîchissement des jetons à durée limitée ; révocation du jeton chez GitHub (lien vers les réglages du compte) ; GitLab et autres hébergeurs.

## Spécification
- « Se connecter à GitHub » affiche un code et un bouton « Ouvrir GitHub ». L'écran relit l'état au rythme demandé par GitHub, jusqu'à la connexion, un refus ou l'expiration du code.
- Le jeton va au coffre de l'espace (`<espace>/@github`). L'API ne rend jamais de jeton, seulement des états et le compte GitHub.
- Chaque espace lit son propre jeton ; `ATLAS_GITHUB_TOKEN` reste un repli pour les tests et l'intégration continue.
- Rejoindre un dépôt `https://github.com/…` dont le clonage échoue propose la connexion. Le flux, lancé sans espace, est remis à l'adhésion, qui range le jeton sous l'identifiant de l'espace.
- « Déconnecter » retire le jeton du coffre.
- Sans client OAuth configuré, l'écran le dit, sans bouton.

## Critères d'acceptation
1. Un code s'affiche, GitHub s'ouvre, et aucun champ ne reçoit de jeton.
2. Une fois l'autorisation donnée, le jeton est au coffre de l'espace et l'API ne le rend jamais.
3. Le jeton d'un espace ne sert qu'à cet espace.
4. Un dépôt privé se rejoint après une connexion faite depuis « Rejoindre un espace ».
5. Un refus et une expiration s'affichent et permettent de recommencer.
6. « Déconnecter » retire le jeton du coffre.

## Tests
`core/tests/repo/test_github_device.py` ; `app/src/screens/GitHub.test.tsx`.

## Dépendances
0006, 0008, 0016.

## Estimation
**M**.

## Mise en œuvre (31 octobre 2026)

Décisions : [ADR 0029](../decisions/0029-jeton-github-device-flow.md).

- **Cœur** :
  - `githost/device.py` : device flow (`start`, `poll` au rythme de GitHub, `pending` et `release` pour l'adhésion) et accès au coffre (`stored`, `store`, `forget`) ;
  - `vault/` : entrée `<espace>/@github`, genre `github`, compte GitHub (`account`) à afficher ;
  - `githost/github.py` : `github_token(espace)` lit le coffre, puis le repli `ATLAS_GITHUB_TOKEN` ;
  - `githost/__init__.py`, `repo/sync.py`, `proposals/common.py`, `admin.py` : l'espace passe jusqu'au jeton ;
  - `join_workspace(remote_url, github_flow)` ; `refresh_account` relit compte et rôle après une connexion ;
  - `api/routes/github.py` : `GET`/`DELETE /api/workspaces/{ws}/github`, `POST /api/github/device`, `POST /api/github/device/{flow}` ; codes `github_not_configured` (422) et `device_flow_failed` (502).
- **App** :
  - `components/GitHubConnect.tsx` : code, « Ouvrir GitHub », « Copier le code », relecture, refus et expiration ;
  - `screens/Connections.tsx` : section « Dépôt de l'espace » en tête, pour un dépôt GitHub ;
  - `screens/JoinWorkspace.tsx` : connexion proposée après un échec de clonage d'une adresse GitHub en HTTPS, puis nouvelle adhésion avec le flux ;
  - `src-tauri/src/lib.rs` : `ATLAS_GITHUB_CLIENT_ID` fixé à la compilation, transmis au serveur.
- **Tests** :
  - pytest, `tests/repo/test_github_device.py` (8 tests, faux GitHub) :
    - jeton au coffre et jamais rendu (critères 1 et 2) ;
    - portée par espace et repli (critère 3) ;
    - adhésion avec le flux (critère 4), et flux gardé après un échec ;
    - refus, expiration, client absent (critère 5) ;
    - rythme des relectures ;
    - déconnexion (critère 6) ;
    - compte relu à la connexion ;
  - Vitest, `screens/GitHub.test.tsx` (6 tests) : critères 1, 2, 4, 5 et 6 à l'écran ; section absente hors GitHub.
- **Critères** : 1 à 6 couverts par ces tests.
- **Reste à faire** :
  - créer le client OAuth d'Atlas sur GitHub, activer son device flow, puis poser `ATLAS_GITHUB_CLIENT_ID` dans la build de release ;
  - vérification réelle sur GitHub, avec un dépôt privé ;
  - pas de test de bout en bout : la démonstration n'utilise que des dépôts locaux.
