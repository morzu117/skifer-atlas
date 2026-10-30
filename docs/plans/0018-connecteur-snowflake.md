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
