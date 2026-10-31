# Plan 0016 — Connexions personnelles (10.6)

## Objectif
Chaque utilisateur voit les points d'accès de l'espace courant avec l'état de son propre accès, s'authentifie par le flux natif, teste et révoque ses tokens, sans jamais saisir ni voir un token.

## Périmètre
**Dedans** : écran 10.6 branché sur 0008 (puis 0018) ; panneau « Nouveau point d'accès » ; flux OAuth ouvert dans le navigateur système ; tester, révoquer, reconnecter.
**Dehors** : liste des plateformes autorisées (0017) ; plateformes autres que Databricks et Snowflake (affichées « bientôt » si autorisées).

## Références
Brief 7.1, 7.2, 10.6 ; guide 5 (10.6) ; `screens/10.6-connexions.html` ; plans 0008, 0018.

## Spécification
- Titre « Mes connexions », sous-titre sur les tokens locaux. Tableau : Plateforme (nom + entité · mode d'auth), Schéma (mono), Propriétaire, Fraîcheur, Mon accès (pastille + libellé : « Connecté · expire dans n j », « Connecté · session SSO », « Token expiré », « Jamais connecté »), actions (Tester / Révoquer ; Reconnecter ; Se connecter).
- Panneau 340 px : plateforme (limitée aux plateformes autorisées), hôte, schéma, entité, « S'authentifier avec OAuth » (primaire), « Tester la connexion ». La déclaration du point d'accès passe par une proposition si l'utilisateur n'est pas référent (0008) ; le panneau le dit.
- OAuth : l'UI reçoit `authorize_url` et l'ouvre par `tauri-plugin-opener`, puis interroge `…/status` jusqu'à `connected` ou expiration (5 min), avec un message.
- Pas de champ de saisie de token, sauf le repli Databricks par token personnel (décision Q10) : un lien « Utiliser un token personnel » apparaît seulement si l'OAuth échoue, et ouvre un champ masqué à usage unique, envoyé directement au coffre. Pour Snowflake par paire de clés, un sélecteur de fichier (Tauri `dialog`), et la passphrase envoyée une seule fois au coffre (analyse Q10).

## Critères d'acceptation
1. Le tableau reflète les points d'accès de l'espace courant et l'état du coffre de l'utilisateur.
2. « Se connecter » ouvre le navigateur ; après le rappel OAuth, l'état passe à « Connecté » sans rechargement.
3. « Révoquer » supprime l'entrée du coffre ; l'état passe à « Jamais connecté ».
4. Changer d'espace change la liste ; aucune connexion d'un autre espace n'apparaît.
5. Aucun élément du DOM ne contient de token (test Playwright qui cherche les valeurs du faux serveur OAuth).
6. Une plateforme non autorisée n'apparaît pas dans le panneau.

## Tests
- Composants : tableau et états.
- Bout en bout : faux serveur OAuth (repris de 0008) ; contrôle d'absence de secret dans le DOM et le stockage du webview.
- À la main : OAuth réel sur Databricks.

## Dépendances
0008, 0010.

## Estimation
**S**. Incertitude : ouverture du navigateur et retour à l'app selon l'OS.

## Mise en œuvre (31 octobre 2026)

- **Cœur** (`core/src/skifer_atlas/`) :
  - `connections.py` :
    - `platforms` : les plateformes autorisées par la gouvernance, avec leur libellé et `supported` ;
    - `owner_name` et `supported` sur chaque point d'accès de la liste ;
    - `draft_point` : un point d'accès en brouillon, validé comme une déclaration (`invalid_access_point`, `platform_not_allowed`, `access_point_exists`) ;
    - `draft_status`, `authorize_draft` et `check_draft` reprennent l'état, l'OAuth et le test des points déclarés, sur le brouillon ;
  - `api/routes/connections.py` : `GET …/connections/platforms` et `POST …/access-point-draft/{authorize,status,test}`, avec le corps `{"access_point": {…}}` ;
  - `api/app.py` : 409 pour `access_point_exists`.
- **Interface** (`app/src/`) :
  - `screens/Connections.tsx` :
    - le tableau des points d'accès, avec pour chacun mon accès et les actions selon l'état ;
    - l'OAuth ouvert dans le navigateur, puis la relecture de l'état chaque seconde, pendant 5 minutes au plus ;
    - le repli par token personnel après un échec de l'OAuth (Databricks) ;
    - le panneau « Nouveau point d'accès » : OAuth et test du brouillon, puis la proposition ;
  - `api.ts` : les types et les appels des connexions ;
  - `WorkspaceShell.tsx` branche l'écran ;
  - `styles.css` : section « Connexions » ;
  - `tokens.css` : deux tailles, copiées dans `docs/design/tokens.css` ;
  - `screens/Comparison.tsx` : le bandeau « Connexion requise » reconnaît un flux `failed` ou `expired`.
- **Démonstration** :
  - `examples/points-acces-nordis.py` déclare dbx-fr, snow-de et snow-es sur le dépôt de démonstration ;
  - `core/tests/connections/fake_databricks.py <port>` lance seul le faux Databricks.
- **Décisions** : ADR 0020. Les principales :
  - routes de brouillon, pour se connecter et tester avant de proposer ;
  - plateformes du panneau limitées aux plateformes autorisées ;
  - Snowflake « Bientôt dans Atlas » jusqu'au plan 0018 ;
  - repli par token personnel limité aux lignes Databricks déclarées ;
  - plugin `shell` plutôt que `tauri-plugin-opener` ;
  - paire de clés Snowflake reportée au plan 0018.
- **Tests** :
  - `core/tests/connections/test_connections_screen.py` (5 tests) :
    - plateformes autorisées, et après le retrait de Snowflake ;
    - propriétaire nommé et `supported` ;
    - brouillon : jamais connecté, test `not_connected`, OAuth sur le faux Databricks, connecté, test réussi. Le token est sous `nordis/dbx-de`, le dépôt est intact et aucun secret n'apparaît dans les réponses ;
    - validation du brouillon, `platform_not_supported` et 422 pour un champ en trop.
  - Vitest, `npm test`, 119 tests. Nouveau : `screens/Connections.test.tsx` (10 tests) :
    - libellés de mon accès, identifiant proposé et brouillon envoyé ;
    - tableau, états et actions, Snowflake « Bientôt dans Atlas », aucun champ de token (critères 1 et 6) ;
    - panneau limité aux plateformes autorisées, entité et identifiant par défaut (critère 6) ;
    - Se connecter, navigateur ouvert, relecture, puis « Connecté » sans recharger (critère 2) ;
    - Tester, puis Révoquer qui ramène à « Jamais connecté » (critère 3) ;
    - changement d'espace (critère 4) ;
    - échec de l'OAuth, puis repli : champ masqué, vidé, token absent de la page ;
    - brouillon : corps des appels, puis proposition et lien ;
    - lecteur sans panneau.
  - Playwright, `npm run e2e`, `e2e/connexions.spec.ts` (2 tests). Le faux Databricks tourne sur le port 8796, et `demoRemote()` déclare les points d'accès de démonstration :
    - liste, Se connecter (OAuth dans une fenêtre du navigateur), « Connecté · session OAuth », Tester, Révoquer, puis « Jamais connecté » ;
    - brouillon dbx-de : OAuth, test, proposition, puis le lien vers elle.

    À chaque étape, ni `at-secret` ni `rt-secret` dans le DOM, `localStorage` ou `sessionStorage` (critère 5), et axe-core passe. `propositions.spec.ts` ne compte plus les propositions fusionnées : celles des points d'accès s'y ajoutent.
- **Reste à faire** :
  - l'OAuth réel sur Databricks, à la main ;
  - l'ouverture du navigateur et le retour sous Tauri, à la main ;
  - Snowflake et la paire de clés (plan 0018).
