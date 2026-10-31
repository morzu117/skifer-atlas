# Plan 0018 — Connecteur Snowflake

## Objectif
Un point d'accès Snowflake s'authentifie par le SSO de l'entreprise (navigateur externe) ou par paire de clés, et participe aux comparaisons chiffrées au même titre que Databricks, ce qui valide la comparaison entre deux dialectes.

## Périmètre
**Dedans** : implémentation `connectors/snowflake.py` de l'interface de 0008 ; SSO `externalbrowser` ; paire de clés (fichier de clé privée choisi, passphrase au coffre) ; test de connexion ; exécution agrégée bornée ; intégration dans 0009 ; ajustements de compilation Snowflake révélés par des exécutions réelles ; vérification du binaire figé.
**Dehors** : BigQuery, Fabric, Redshift (plus tard, brief 7.1).

## Références
Brief 7.1, 7.2, 8.3 ; analyse Q10, §5 risques 3 à 5 ; plans 0007, 0008, 0009, 0016.

## Spécification
- `snowflake-connector-python`, sans l'extra pandas. Résultats en lignes Python ou Arrow selon la taille (≤ `max_rows`).
- SSO : `authenticator="externalbrowser"`. Le connecteur ouvre le navigateur et écoute un port local ; le cache de jeton du connecteur (`client_store_temporary_credential`) est désactivé, et le jeton de session est rangé au coffre quand c'est possible. Sinon, la session ne vit qu'en mémoire et l'état affiché est « Connecté · session SSO ».
- Paire de clés : chemin du fichier conservé dans le registre local de l'utilisateur (pas dans le dépôt), passphrase au coffre ; la clé n'est jamais copiée.
- Compilation : on corrige les écarts trouvés par les tests d'exécution (fonctions temporelles, `QUALIFY`, contrôle de cardinalité, voir 0007).

## Critères d'acceptation
1. Le SSO réel sur un compte de test permet `test` puis une requête agrégée (test marqué `snowflake`, hors CI par défaut).
2. La paire de clés avec passphrase fonctionne ; la passphrase est au coffre et nulle part ailleurs.
3. Une comparaison Revenu net avec FR sur Databricks et DE sur Snowflake s'exécute et se réconcilie (0009).
4. Le contrôle de cardinalité échoue bien sur Snowflake avec une table dupliquée.
5. Le binaire figé s'authentifie et exécute ; sa taille est mesurée (seuil d'alerte : 200 Mo).
6. Aucun fichier de cache de jeton Snowflake n'est créé sur le poste.

## Tests
- Unitaires : construction des paramètres de connexion, machine d'états.
- Intégration : connecteur simulé à l'interface ; tests réels marqués.
- À la main : SSO via le fournisseur d'identité d'un client pilote.

## Dépendances
0008, 0009.

## Estimation
**M**. Incertitudes : SSO selon les fournisseurs d'identité clients ; poids des dépendances du connecteur dans le binaire.

## Mise en œuvre (31 octobre 2026)

Décisions : [ADR 0022](../decisions/0022-connecteur-snowflake.md).

- **Cœur** (`core/src/skifer_atlas/`) :
  - `connectors/snowflake.py` (nouveau) :
    - `connection_params` : jamais de cache disque, SSO `externalbrowser`, `SNOWFLAKE_JWT`, ou reprise par jetons de session ;
    - `load_private_key` : PEM ou DER, passphrase, erreurs par cause ;
    - `translate` : 390xxx en refus d'identifiants, garde-fou d'Atlas, hôte injoignable ;
    - `SnowflakeConnector` : `test` et `run_aggregate` asynchrone, borné (annulation, délai, `result_too_large`) ;
    - `SsoFlows` : connexion SSO dans un fil, expiration à 5 minutes ;
    - `logout`, sessions en mémoire `LIVE` ;
  - `connectors/logins.py` (nouveau) : registre local `logins.json` (identifiant, chemin de la clé) ;
  - `connectors/access_points.py` : `account`, `warehouse`, `role`, `auth`, champs propres à chaque plateforme, `snowflake_account()`, `auth_mode` ;
  - `vault/model.py` : types `sso` et `keypair` ;
  - `connections.py` :
    - Snowflake dans `SUPPORTED_PLATFORMS` ;
    - `authorize` et `authorize_draft` avec l'identifiant (SSO) ;
    - `store_key_pair` et `store_key_pair_draft` ;
    - jetons renouvelés rangés au coffre ;
    - révocation avec fermeture de session ;
    - `auth_mode`, `login`, `private_key_file` dans le résumé ;
  - `compare/reconcile.py` : `divergent_node` ignore une surcharge qui ne change que la plateforme ;
  - `api/routes/connections.py` : corps `{user}` sur `POST …/authorize`, `PUT …/key-pair`, `PUT …/access-point-draft/key-pair` ;
  - `api/app.py` : codes 422 `invalid_login`, `wrong_auth_mode`, `key_file_unreadable`, `invalid_key_file`, `passphrase_required`, `passphrase_unexpected`, `wrong_passphrase` ;
  - dépendance `snowflake-connector-python` (5.1), sans pandas.
- **Binaire figé** : `scripts/build-sidecar.sh` embarque le connecteur et affiche la taille, avec une alerte au-delà de 200 Mo. Mesure : 53,9 Mo sous macOS arm64, contre 39 Mo avant.
- **App** (`app/`) :
  - `screens/Connections.tsx` :
    - libellés SSO et paire de clés, « Connecté · session SSO », « Clé refusée » ;
    - formulaire de connexion Snowflake dans la ligne : identifiant ; pour une paire de clés, chemin de la clé avec « Choisir… » sous Tauri, et passphrase masquée vidée après l'envoi ;
    - panneau « Nouveau point d'accès » : compte, entrepôt, rôle, authentification ;
    - le SSO n'a pas d'URL à ouvrir ;
  - `screens/Comparison.tsx` : même chose pour « Connexion requise » ;
  - `api.ts` : `auth_mode`, `login`, `private_key_file`, `keyPair`, `keyPairDraft`, identifiant sur `authorize` ;
  - `external.ts` : `pickFile` ;
  - Tauri : `tauri-plugin-dialog`, permission `dialog:allow-open`.
- **Démonstration** :
  - `core/tests/connections/fake_snowflake.py`, lancé seul : SSO pour tout identifiant, clé de démonstration `svc_es` ;
  - `examples/points-acces-nordis.py` : snow-de en SSO et snow-es par paire de clés, sur l'hôte Snowflake donné.
- **Tests** :
  - `core/tests/connections/test_snowflake.py` (14 tests) :
    - champs par plateforme ;
    - paramètres sans cache ;
    - lecture de clé ;
    - traduction d'erreurs ;
    - paire de clés avec passphrase au coffre seulement, dans aucun fichier ni journal (critère 2) ;
    - clé vérifiée avant tout enregistrement ;
    - clé refusée ;
    - SSO : session au coffre et aucun fichier de cache sous un `HOME` isolé (critère 6), expiration puis révocation, refus du fournisseur, repli en mémoire ;
    - brouillons ;
    - exécution bornée ;
    - test réel marqué `snowflake` (critère 1, hors CI).
  - `core/tests/repo/test_snowflake_compare.py` (2 tests) :
    - Revenu net avec FR sur Databricks et DE sur Snowflake via le vrai connecteur : DE à 94 % (piste n02), FR à 100 % (critère 3) ;
    - jours comptables en double : la requête Snowflake échoue avec « atlas: cardinalité N:1 non respectée en n07 », FR aboutit (critère 4).
  - `core/tests/test_sidecar.py`, marqué `sidecar` : le binaire figé se connecte par paire de clés puis en SSO et exécute, sans écrire sous `HOME`. Sa taille est vérifiée (critère 5).
  - `core/tests/compare/test_compare.py` : piste d'écart sans déplacement de plateforme.
  - Vitest, `npm test`, 135 tests. `screens/Connections.test.tsx` passe de 10 à 13 tests :
    - libellés ;
    - SSO ;
    - paire de clés, avec un échec de passphrase puis le champ vidé ;
    - nouveau point Snowflake.
  - Playwright, `e2e/connexions.spec.ts` : SSO sur snow-de, paire de clés sur snow-es, tester, révoquer, contre le faux Snowflake (port 8794). axe-core passe.
- **Reste à faire** :
  - le test réel sur un compte Snowflake (critère 1), et le SSO avec le fournisseur d'identité d'un client pilote ;
  - les ajustements de compilation qu'ils révéleraient ;
  - le binaire figé sous Windows et Linux.
