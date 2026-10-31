# ADR 0022 — Connecteur Snowflake

Date : 2026-10-31 · Statut : **acceptée** (mise en œuvre du plan 0018)

## Contexte

Le plan 0018 ajoute Snowflake à côté de Databricks. Ses points d'accès s'authentifient :
- par le SSO de l'entreprise, dans le navigateur ;
- ou par paire de clés.

Ils participent aux comparaisons chiffrées (0009), ce qui valide la comparaison entre deux dialectes. Les règles de 0008 tiennent toujours :
- aucun jeton dans le dépôt ni sur un serveur ;
- un coffre par utilisateur ;
- un sidecar qui n'écoute que sur 127.0.0.1.

Points à trancher :
- la version du connecteur ;
- qui ouvre le navigateur du SSO ;
- où vivent les jetons de session et le chemin de la clé ;
- ce que `access_points.yaml` déclare ;
- l'exécution bornée ;
- la vérification sans compte réel.

## Décision

- **`snowflake-connector-python` 5.x, sans l'extra pandas.** Le cœur Rust du connecteur fait le réseau, l'authentification et la décompression. Les résultats arrivent en lignes Python.
  - Aucun cache disque du connecteur : `client_store_temporary_credential=False` (jeton SSO) et `crl_enable_disk_caching=False` (listes de révocation). Le test du critère 6 isole `HOME` et les dossiers de cache, puis vérifie qu'aucun fichier n'y apparaît, avec la bibliothèque comme avec le binaire figé.
  - `enable_server_session_keep_alive_auto_detection=False` : Atlas décide lui-même si la session survit à la fermeture.
  - Le module est importé à la première connexion. Le binaire figé l'embarque par `--collect-all snowflake.connector` et `--copy-metadata snowflake-connector-python` (`scripts/build-sidecar.sh`).
- **Le sidecar ouvre le navigateur du SSO.** `authenticator="externalbrowser"` est une fonction du connecteur, qui :
  - ouvre lui-même le navigateur du système ;
  - écoute le retour du fournisseur d'identité sur un port local.

  `POST …/authorize` prend l'identifiant Snowflake (`{user}`), lance la connexion dans un fil et rend `authorize_url: null`. L'écran relit l'état comme pour l'OAuth (`flow` : pending, connected, failed, expired). Après 5 minutes, le flux expire avec « Délai de connexion dépassé (5 minutes). ». L'identifiant est demandé à l'écran, puis gardé au registre local : il n'est pas secret, et Snowflake ne le devine pas.
- **Jetons de session au coffre, sinon en mémoire.** Après un SSO réussi, Atlas range au coffre du poste `Credential("sso", jeton de session, jeton maître, échéance)`. La connexion est fermée en gardant la session côté serveur (`server_session_keep_alive`).
  - Les connexions suivantes se rebranchent par `session_token` et `master_token`. Elles renouvellent la session si besoin, et les jetons renouvelés retournent au coffre.
  - Si le coffre refuse, la connexion vit en mémoire (`LIVE`) avec un `Credential("sso", "")` sans secret. L'écran affiche alors « Connecté · session SSO ». Au redémarrage d'Atlas, l'état devient « Session expirée ».
  - Une session refusée par Snowflake (erreur 390xxx) est marquée rejetée : « La plateforme refuse vos identifiants : se reconnecter. ».
  - Révoquer ferme la session chez Snowflake (`remote_revoked`), puis vide le coffre, la mémoire et le registre local.
  - L'écran n'affiche pas d'échéance pour une session SSO : elle se renouvelle tant qu'on s'en sert.
- **Paire de clés : chemin au registre local, passphrase au coffre.** `PUT …/key-pair` prend `{user, private_key_file, passphrase?}`.
  - Atlas lit la clé (PEM ou DER, RSA) avant de ranger quoi que ce soit, et répond 422 par cause : `key_file_unreadable`, `invalid_key_file`, `passphrase_required`, `passphrase_unexpected`, `wrong_passphrase`.
  - La passphrase va au coffre (`Credential("keypair", passphrase)`).
  - L'identifiant et le chemin absolu vont dans `<données>/logins.json`, registre local de l'utilisateur, hors de tout dépôt.
  - La clé n'est jamais copiée : elle est relue à chaque connexion.
  - Sous Tauri, « Choisir… » ouvre le sélecteur natif (`tauri-plugin-dialog`, permission `dialog:allow-open`). Ailleurs, on saisit le chemin.
- **`access_points.yaml`** gagne quatre champs Snowflake :
  - `account` : requis si l'hôte n'est pas en `*.snowflakecomputing.com` ; sinon, déduit de l'hôte, `.privatelink` compris ;
  - `warehouse` : facultatif, l'entrepôt par défaut de l'utilisateur sinon ;
  - `role` ;
  - `auth` : `sso` par défaut, ou `keypair`.

  Ces champs sont refusés sur un point Databricks, et ceux de Databricks sur un point Snowflake. Les points déjà déclarés restent valides. Le résumé d'une connexion porte `auth_mode`, `login` et `private_key_file`.
- **Exécution bornée par l'API asynchrone.** `execute_async`, puis relecture de l'état toutes les 0,5 s :
  - annulation et délai (`QUERY_TIMEOUT`) par `abort_query` ;
  - au-delà de `MAX_ROWS` : `result_too_large`.

  Les types de colonnes viennent de `FIELD_ID_TO_NAME`. Les garde-fous de compilation (`CAST('atlas: …' AS INT)`) reviennent de Snowflake en « Numeric value '…' is not recognized ». Le connecteur en extrait le message d'Atlas (`query_failed: atlas: cardinalité N:1 non respectée en n07…`).
- **Un déplacement de plateforme n'est pas une piste d'écart.** Une déclinaison qui lit ses sources sur Snowflake surcharge les nœuds source du canonique, à la plateforme près. Le diff structurel classe ces surcharges `override_undeclared`. Pour la piste « Nœud divergent », `divergent_node` ignore désormais les écarts qui ne portent que sur `platform` (`PHYSICAL_FIELDS`). Le diff reste affiché tel quel.
- **Vérification sans compte réel : un faux Snowflake.** `core/tests/connections/fake_snowflake.py` implémente l'API que le connecteur appelle, sur 127.0.0.1 :
  - connexion par JWT vérifié ;
  - SSO avec un fournisseur d'identité simulé qui rappelle le port local ;
  - jetons de session et renouvellement ;
  - requêtes synchrones et asynchrones, suivi, abandon, fermeture de session.

  Il exécute le SQL Snowflake dans DuckDB après traduction par SQLGlot. Les tests (connecteur, comparaison DE sur Snowflake et FR sur Databricks, binaire figé, bout en bout) passent ainsi par le vrai connecteur. `SF_TEST_BROWSER_OPENER=noop` empêche l'ouverture du navigateur. Lancé seul, le faux accepte tout identifiant SSO et écrit une clé de démonstration. Le test réel est marqué `snowflake` : il lit `ATLAS_SNOWFLAKE_*` et s'ignore sans eux.
- **Pas d'ajustement de compilation Snowflake à ce stade.** Le plan prévoyait ceux que révéleraient des exécutions réelles. Contre le faux compte, le SQL de Revenu net s'exécute et se réconcilie tel quel. Les écarts propres au vrai Snowflake (fuseaux, collations, arrondis) restent à observer sur un compte de test.

## Conséquences

- Le binaire figé passe de 39 à 54 Mo sous macOS arm64, sous le seuil d'alerte de 200 Mo. Le script affiche la taille et prévient au-delà.
- Le SSO dépend du fournisseur d'identité de chaque client : à vérifier à la main avec un client pilote.
- Le registre `logins.json` s'ajoute au coffre comme état local par utilisateur. Il ne contient rien de secret.
- Un point d'accès Snowflake sans entrepôt suppose que l'utilisateur en ait un par défaut. Sinon, la première requête échoue avec le message de Snowflake.
