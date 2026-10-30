# Plan 0008 — Coffre de secrets personnel et connecteur Databricks

## Objectif
Un utilisateur enregistre un point d'accès Databricks dans l'espace courant, s'authentifie par OAuth avec son compte (ou par token personnel), teste la connexion et exécute une requête agrégée en push-down ; ses identifiants vivent uniquement dans le trousseau de l'OS, rangés par espace, et il peut les révoquer.

## Périmètre
**Dedans** : coffre (`keyring`) rangé par espace ; registre des points d'accès (sans secret) ; OAuth U2M Databricks avec PKCE (mode par défaut) ; token personnel en repli (décision Q10) ; test de connexion ; exécution d'une requête et rapatriement d'un résultat agrégé borné ; API ; vérification du binaire figé sur ce périmètre.
**Dehors** : Snowflake (0018), autres plateformes ; écran (0016) ; comparaison (0009).

## Références
Brief 7, 7.1, 7.2 ; guide 10.6 (« jamais de champ pour saisir un token à la main ») ; ADR 0001 (keyring), 0004 ; analyse §5 risques 3 et 4.
Fichiers : `core/src/skifer_atlas/vault/{keyring_vault,model}.py`, `connectors/{base,databricks}.py`, `api/routes/connections.py`.

## Spécification

### Points d'accès (dans le dépôt, sans secret)
Le registre des points d'accès est partagé : `access_points.yaml` dans le dépôt de l'espace, avec `[{id, platform, host, http_path | warehouse_id, schema, entity, owner, freshness}]`. Le brief 7 (« registre des points d'accès », avec propriétaire et fraîcheur) le place côté espace. Une plateforme absente d'`allowed_platforms` est refusée.

### Coffre
- Service keyring `skifer-atlas`, nom de compte `<workspace_id>/<access_point_id>`. Valeur : JSON `{kind: oauth|pat, access_token, refresh_token, expires_at}`.
- Backend fixé explicitement : macOS Keychain, Windows Credential Locker, Secret Service sous Linux. En son absence, refus clair (`vault_unavailable`), jamais de repli sur un fichier en clair.
- `list_my_connections(ws)` lit les entrées du coffre pour cet espace uniquement ; `revoke(ws, ap)` supprime l'entrée et, si possible, révoque le token côté Databricks.
- Aucun secret n'est renvoyé par l'API, journalisé, ni écrit dans DuckDB ou dans Git (test par motif sur les journaux et les fichiers).

### OAuth U2M
Flux d'autorisation avec PKCE sur `https://<host>/oidc/v1/authorize`. Le client par défaut est le client public `databricks-cli` ; un identifiant d'application OAuth propre au client se configure dans `access_points.yaml` (`oauth_client_id`) si son admin bloque le client par défaut. Redirection vers `http://127.0.0.1:<port libre>/callback`. L'API renvoie l'URL d'autorisation ; l'UI l'ouvre dans le navigateur système par le shell Tauri (`tauri-plugin-opener`). Le serveur Python écoute le rappel 5 minutes au plus. Le cache de tokens du SDK est désactivé : seul le coffre stocke. Le rafraîchissement est automatique avant expiration ; un échec donne l'état `expired`.

### Token personnel (repli)
Proposé seulement si l'OAuth échoue ou est indisponible pour ce point d'accès, avec un message qui l'explique. Saisie unique dans un champ masqué, envoyée directement au coffre (`kind: pat`), jamais renvoyée ni réaffichée. L'état affiche « Connecté · token personnel » et l'expiration si Databricks la fournit. C'est une exception assumée à la règle du guide 10.6 (« jamais de champ pour saisir un token »), consignée dans l'analyse (§6).

### Exécution
`databricks-sql-connector` sur un SQL warehouse. `run_aggregate(ws, ap, sql, max_rows=50_000) -> Arrow table`. Au-delà de `max_rows`, la requête est refusée (`result_too_large`) : c'est une garde contre le rapatriement de données détaillées (brief 8.3, point 4). Délai et annulation sont exposés.

### API
`GET /api/workspaces/{ws}/connections` → `[{access_point, platform, schema, owner, freshness, my_access: connected|expired|never, expires_in_days}]` ; `POST …/connections` (déclarer un point d'accès : passe par une proposition, plan 0006, si l'utilisateur n'est pas référent) ; `POST …/connections/{ap}/authorize` → `{authorize_url}` ; `GET …/connections/{ap}/status` ; `POST …/connections/{ap}/test` → `{ok, latency_ms, error}` ; `DELETE …/connections/{ap}/token`.

### Binaire figé
`scripts/build-sidecar.sh` gagne les `--hidden-import` nécessaires (backends keyring, `databricks.sql`, `thrift`, `pyarrow` si utilisé). Un test de fumée exécute le binaire et appelle `/health` puis `/api/workspaces/{ws}/connections` ; la taille du binaire est mesurée et notée.

## Critères d'acceptation
1. Après l'OAuth, l'entrée existe dans le trousseau sous `<ws>/<ap>`, et nulle part ailleurs (recherche des tokens dans le dossier de données, les journaux et le dépôt : aucun résultat).
2. Le même point d'accès dans deux espaces donne deux entrées distinctes ; révoquer l'une laisse l'autre intacte.
3. `test` renvoie `ok` sur un warehouse réel (test marqué `databricks`, hors CI par défaut) et une erreur explicite pour un hôte injoignable.
4. Un token expiré est rafraîchi ; un rafraîchissement refusé donne `my_access: expired`.
5. En repli, un token personnel saisi est rangé au coffre ; aucune route ne le renvoie et le champ est vidé après envoi.
6. Une requête qui renverrait plus de `max_rows` est refusée sans rapatriement.
7. Une plateforme non autorisée est refusée à la déclaration.
8. Aucune route ne renvoie de champ contenant un secret (test sur toutes les réponses).
9. Le binaire figé démarre et répond sur les routes de connexion ; sa taille est notée dans le rapport de plan.
## Tests
- Unitaires : coffre sur un backend keyring de test en mémoire ; machine d'états des tokens ; PKCE.
- Intégration : serveur OAuth factice local (autorisation, échange, rafraîchissement) ; faux warehouse pour l'exécution (connecteur simulé à l'interface).
- À la main : OAuth réel sur un espace Databricks de test, puis `test` et une requête agrégée.

## Dépendances
0005 (0006 pour la déclaration par proposition).

## Estimation
**L**. Incertitudes : client OAuth à utiliser chez chaque client (application déclarée par leur admin) ; politique sur les tokens personnels ; comportement de keyring en binaire figé, sous Linux surtout.
