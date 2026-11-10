# Plan 0036 — Points d'accès REST

## Objectif

`atlas compare` compare un KPI dont les sources sont servies par un point d'accès `rest` : les tables sont remplies par des appels HTTPS GET budgétés et mis en cache, la clé d'API vient du coffre ou, sans trousseau, de l'environnement, et aucune clé n'apparaît nulle part.

## Périmètre

**Dedans** : point d'accès `rest` (`access_points.yaml`) ; `rest_datasets.yaml` ; `allowed_platforms` élargi aux plateformes de points d'accès ; sorte `apikey` du coffre et variable `ATLAS_REST_KEY_<ID>` ; client HTTP à clé masquée ; `RestRunner`, aiguillage dans `remote_runner`, `choose()` et `dialect()` ; budgets, registre d'usage, cache Parquet ; CLI (`atlas compare --rafraichir`, `atlas rest-key`, `atlas rest-usage`) ; faux serveur de test et marqueur `rest`.

**Dehors** : écran Connexions, saisie de clé et affichage des budgets dans l'app (plan suivant, ADR 0054) ; route d'API pour la clé ; `atlas generate` et tout artefact autonome ; scission de Skifer ; élargissement de `PLATFORMS` (`model/nodes.py:47`) ; écriture de `rest_datasets.yaml` par une proposition ; push-down vers un fournisseur ; lignée jusqu'au code du fonds ; pagination autre que `next_url` ; comparaison de deux fournisseurs pour une même table (voir « Reliaison »).

## Références

ADR 0050 à 0054 (proposées, commitées avec ce plan) ; plans 0007 (compilation), 0008 (coffre, points d'accès), 0009 (comparaison), 0018 (Snowflake, motif des champs étrangers) ; `docs/KICKOFF.md` §3 et §4. Réponses du propriétaire 91811 et 91871. Fichiers, relatifs à `core/src/skifer_atlas/` (lignes vérifiées à HEAD (8191997, rebasé sur 80d2a55)) : `connectors/access_points.py`, `connectors/http.py`, `connections.py`, `compare/service.py`, `compare/orchestrate.py`, `compare/rebind.py`, `compile/builder.py`, `run/duckdb_local.py`, `vault/model.py`, `vault/keyring_vault.py`, `governance/model.py`, `api/app.py`, `cli.py`. Nouveaux : `connectors/rest_datasets.py`, `connectors/rest_budget.py` (limiteur, registre), `connectors/rest_cache.py`, `compare/rest_runner.py`.

## Spécification

### Réponses aux points laissés ouverts par les ADR

Origine : **J** = tranché par le propriétaire (91811, 91871), **D** = « (choix de droplet) », modifiable par le propriétaire.

| ADR | Point | Réponse | |
|---|---|---|---|
| 0050 | Nom de l'énumération | `ACCESS_POINT_PLATFORMS = (*PLATFORMS, "rest")`, définie dans `governance/model.py`, pas dans `connectors/access_points.py` : ce dernier importe `Governance` (`access_points.py:45`) et `governance/model.py:70` en a besoin, d'où un import circulaire. `AccessPoint.platform` (`access_points.py:65`) et `allowed_platforms` (`governance/model.py:70`) s'y rapportent | D |
| 0050 | `schema_version` d'`access_points.yaml` | reste `Literal[1]` (`access_points.py:151`) : un Atlas ancien refuse déjà un point `rest` par modèle fermé, comme pour les champs Snowflake de 0018 ; passer à 2 interdirait à un Atlas ancien de lire un fichier sans point `rest` | D |
| 0050 | Forme de `host` | nom d'hôte DNS en minuscules, au moins un point, sans schéma, chemin, requête, identifiant, port, ni adresse IP ; l'exception de `_LOOPBACK` (`access_points.py:52`) : `127.0.0.1` ou `localhost`, port `1024-65535` admis, schéma `http`. La validation `rest` se branche avant `urlparse` (`access_points.py:84`) car un nom sans schéma n'a pas de `hostname` | D |
| 0050 | `base_url` | inchangée : rend `host` (`access_points.py:110`), donc le nom d'hôte, que `_bound_to` compare à `Credential.host` (`connections.py:94`) sans modification. L'URL d'appel vient d'une méthode à part, `call_url(path)` = schéma + `host` + `http_path` sans barre finale + `path` | D |
| 0050 | Où vit le mode d'envoi de la clé | sur le point d'accès, trois champs propres à `rest` : `key_in` (`header` ou `query`), `key_name`, `key_prefix` (facultatif, en-tête seulement, ex. `Bearer `). Les jeux de données n'en portent aucun | D |
| 0050 | Sens de `schema` | refusé sur `rest` (« ne s'applique pas à un point d'accès rest ») : les tables se nomment dans `rest_datasets.yaml`, et rien ne lirait ce champ. `entity`, `owner`, `freshness` gardent leur sens | D |
| 0050 | Budgets | `calls_per_minute` entier 1 à 10 000, `bytes_per_day` entier 1 à 10^13, tous deux facultatifs et refusés hors `rest`. Un point `rest` sans aucun budget donne un `Issue` d'avertissement `rest_no_budget` | D |
| 0050 | Test de cohérence | chaque plateforme de `PLATFORMS` est dans `ACCESS_POINT_PLATFORMS`, `rest` n'est pas dans `PLATFORMS`, un nœud `source` en `platform: rest` est refusé | D |
| 0051 | Où déclarer le mode d'envoi | voir 0050 : au point d'accès | D |
| 0051 | Champs, `schema_version`, contrôles | section « rest_datasets.yaml » ci-dessous ; `schema_version: Literal[1]` | D |
| 0051 | Table sans jeu de données | `rest_dataset_missing` ; jeu de données sur un autre point : même code, message distinct | D |
| 0051 | Où remonte un fichier mal formé | au lancement et à l'aperçu d'une comparaison, dans `prepare_in`, seulement si un plan est servi par un point `rest` : `invalid_rest_datasets` avec les `Issue` en détails. Un espace sans point `rest` n'est pas affecté. `analyze` (documents) ne le lit pas | D |
| 0051 | Lecture, écriture, empreinte | lu dans l'arbre de travail du clone (`repo_dir`), comme `access_points.yaml` (`connections.py:60-66`). Écriture à la main puis commit : ni proposition (`proposals/create.py:50`) ni entrée dans `governance/codeowners.py:49`. Pas d'empreinte propre : la clé de cache contient l'empreinte de la définition du jeu de données, donc une modification invalide le cache | D |
| 0052 | Données locales et point `rest` | `--duckdb-data` ou `ATLAS_COMPARE_DATA` gardent la priorité (`service.py:46-48`, `service.py:115`) ; aucun appel REST. La CLI le dit sur la sortie d'erreur quand l'espace déclare un point `rest` | D |
| 0052 | `check_access` pour une clé | `ensure_usable` d'un point `rest` lit la clé sans réseau : `not_connected` (coffre disponible sans entrée), `access_expired` (entrée refusée par le fournisseur), `access_host_mismatch`, `vault_unavailable` (coffre indisponible et variable absente) | D |
| 0052 | Reliaison | aucun changement de `compare/rebind.py` (voir « Reliaison ») | D |
| 0053 | États de la sorte `apikey` | `Kind` gagne `"apikey"` et la table du docstring (`vault/model.py:25`, tableau `vault/model.py:6-12`) ; aucune méthode ne change : pas d'échéance, `needs_refresh` reste réservé à `oauth` (`vault/model.py:51-52`), `state` rend `expired` quand `rejected` (`vault/model.py:54-57`), `describe` rend `{"kind": "apikey", "my_access": …, "expires_in_days": None}` | D |
| 0053 | Comparaison d'hôte | égalité exacte de chaîne de `Credential.host` et de `host` (minuscules imposées par la validation) ; `_bound_to` n'est pas modifié. Pour une URL de réponse (`next_url`) : schéma et `netloc` égaux à ceux du point et chemin sous `http_path`, sinon `rest_next_url_refused`, sans envoi | D |
| 0053 | Forme du masquage | `ApiKey` (valeur hors `repr`) ; réutiliser `masking.mask_secrets` et `mask_body` (ADR 0044, jetons masqués), en passant la clé comme secret à `message_of(body, *secrets)` et au masquage de `host_unreachable`, avant toute troncature. Seul complément : `mask_url(url, key_name)` dans `masking.py`, qui masque aussi la valeur du paramètre de requête `key_name` ; toute URL rendue passe par ce complément et par `mask_secrets` avec la clé. Aucun message n'embarque d'URL ni de corps de réponse | D |
| 0053 | Où afficher la source de clé | clé `key_source` (`vault`, `env` ou `None`) dans le résultat de `connections.status` pour un point `rest`, et ligne « clé : coffre/environnement » de la sortie de `atlas compare` ; l'écran est hors branche | D |
| 0050/0052 | Identifiant → variable | `ATLAS_REST_KEY_` + identifiant en majuscules, `-` devenu `_` ; coffre d'abord, variable seulement sur `vault_unavailable`, jamais écrite | J |

### Point d'accès `rest`

```yaml
schema_version: 1
access_points:
  - id: api-exemple
    platform: rest
    host: api.exemple.test            # nom d'hôte seul, HTTPS imposé
    http_path: /v1                    # chemin de base, facultatif
    key_in: query                     # header | query
    key_name: apikey                  # en-tête ou paramètre portant la clé
    entity: exemple
    owner: claire.m
    calls_per_minute: 60
    bytes_per_day: 500000000
```

- `http_path` : commence par `/`, caractères `[A-Za-z0-9._~/-]`, ni `..` ni `//` ; la barre finale est ignorée. Il est conservé sur `rest` alors qu'il est dans `_DATABRICKS_ONLY` (`access_points.py:54`) : le tuple des champs étrangers de `rest` est donc `warehouse_id`, `oauth_client_id`, `oauth_redirect_port`, `schema`, plus `_SNOWFLAKE_ONLY` (`access_points.py:55`, qui contient `warehouse_name`, clé YAML `warehouse`). Le dictionnaire `foreign` (`access_points.py:97`) gagne la clé `rest`.
- `key_in`, `key_name` obligatoires sur `rest` ; `key_name` : en-tête `^[A-Za-z][A-Za-z0-9-]{0,63}$`, paramètre `^[A-Za-z_][A-Za-z0-9_]{0,63}$`. `key_in`, `key_name`, `key_prefix`, `calls_per_minute`, `bytes_per_day` sont refusés sur Databricks et Snowflake avec « ne s'applique pas à un point d'accès <plateforme> » (même motif que 0018).
- `AccessPoint.auth_mode` (`access_points.py:133`) rend `apikey` pour `rest`. `SUPPORTED_PLATFORMS` (`connections.py:34`) gagne `rest`. `PLATFORM_LABELS` (`connections.py:136`) et `PLATFORM_AUTH` (`admin.py:32`) ne changent pas.
- `allowed_platforms` : `list[Literal[ACCESS_POINT_PLATFORMS]]` (`governance/model.py:70`), avec `platform_not_allowed` de `check_access_points` (`access_points.py:158-175`) inchangé. Ajout pur : un `governance.yaml` existant reste valide.

### Clé d'API

- `connections.rest_key(workspace_id, point, vault=None) -> tuple[str, str]` : **seule fonction** qui lit la clé, utilisée par `ensure_usable` et par `RestRunner`. Elle rend `(clé, "vault" | "env")`. Algorithme : dans un `try`, construire `Vault()` (qui lève `vault_unavailable` par `system_keyring`, `keyring_vault.py:66-85`) puis `vault.get` ; une entrée `apikey` valide est rendue ; pas d'entrée (`None`) ou une autre sorte : `not_connected`, **sans lire l'environnement** ; `rejected` : `access_expired` ; `Credential.host` différent de `host` : `access_host_mismatch` (`connections.py:94-101`). Sur `RepoError` de code `vault_unavailable` seulement : lire `ATLAS_REST_KEY_<ID>` ; absente ou vide après `strip`, relever l'erreur d'origine, inchangée.
- `ensure_usable` (`connections.py:439`) et `_usable` (`connections.py:421`) : la branche `rest` s'exécute **avant** `Vault()` (sinon `vault_unavailable` sort avant toute lecture de variable) et ne fait aucun appel réseau. `missing_access` (`service.py:79-90`) ne rattrape que `not_connected` et `access_expired` ; `vault_unavailable` interrompt donc la comparaison avec son message, comme aujourd'hui.
- Une valeur de variable ou de clé saisie est refusée en `invalid_token` si vide ou contenant un espace (même contrôle que `store_personal_token`, `connections.py:347`), sans jamais citer la valeur.
- `connections.store_api_key(workspace_id, access_point_id, key, vault=None)` : point `rest` requis, sinon `platform_not_supported` ; range `Credential("apikey", key, host=point.base_url)`. Pas de route d'API.
- `atlas rest-key <espace> <point>` : lit la clé sur l'entrée standard (jamais en argument ; invite masquée si l'entrée est un terminal) et appelle `store_api_key`. Si le coffre est indisponible, affiche l'erreur et l'indication « variable ATLAS_REST_KEY_<ID> ».
- `connections.status` (`connections.py:171`) ajoute `key_source` pour un point `rest`. `connections.run_aggregate` et `check_connection` sur un point `rest` restent refusés en `platform_not_supported` (`connections.py:446-462`) : pas de push-down.

### Client HTTP (`connectors/http.py`)

- `ApiKey(value, placement, name, prefix)` : dataclass gelée, `value` hors `repr`.
- `get(url, *, key: ApiKey, origin: str, timeout=TIMEOUT, max_bytes=MAX_BODY) -> Response` : refuse (`rest_next_url_refused`) tout `url` dont schéma et `netloc` diffèrent de `origin` ; retire de l'URL un paramètre portant déjà `key.name` ; ajoute la clé en-tête (`prefix` + valeur) ou paramètre ; réutilise `_OPENER` sans redirection (`http.py:21-26`) : une 3xx est rendue comme statut, jamais suivie. Corps lu jusqu'à `MAX_BODY` (50 Mio), au-delà `rest_response_too_large`. `Response` (`http.py`) gagne `size` (octets reçus). Toute erreur réseau lève `host_unreachable` en réutilisant `masking.mask_secrets` avec la clé comme secret (`http.py:55-59`), avant toute troncature et sans inclure d'URL ni de corps de réponse dans le message.
- `request` et `message_of` gardent leur contrat. Réutiliser `masking.mask_secrets` (`masking.py:16-22`) et `mask_body` (`masking.py:25-35`), conformément à l'ADR 0044 (jetons masqués) : passer la clé d'API comme secret à `message_of(body, *secrets)` (`http.py:70-78`), qui applique déjà `mask_body` avant la troncature. Ajouter seulement `mask_url(url, key_name)` dans `masking.py` pour masquer aussi la valeur du paramètre de requête `key_name` ; toute URL rendue passe par ce complément et par `mask_secrets` avec la clé. Aucun journal, aucune URL ni aucun corps de réponse dans un message ou une erreur stockée.

### `rest_datasets.yaml`

```yaml
schema_version: 1
datasets:
  - table: marche.prix.cours_jour      # a.b[.c], TABLE_PATTERN (model/nodes.py:41)
    access_point: api-exemple          # id d'un point de plateforme rest
    path: /historique                  # relatif à http_path
    params: {interval: 1d}             # fixes ; jamais key_name
    window: {from_param: from, to_param: to, format: "%Y-%m-%d"}
    perimeter: {param: symbol, column: symbol, mode: each, required: true}
    rows_path: results                 # clés et indices séparés par des points ; vide = racine
    error_keys: [error, message]    # corps 200 portant l'une de ces clés = erreur
    pagination: {kind: next_url, next_path: next_url, max_pages: 20}
    columns:
      - {name: trade_date, from: t, type: date, format: "%Y-%m-%d"}
      - {name: close, from: c, type: double}
```

- Clé d'un jeu de données : (`table`, `access_point`) ; une même table peut avoir un jeu par point. Modèle fermé `extra="forbid"`, erreurs en `Issue` (`model/errors.py:38`) via `issues_from_validation_error`.
- `type` ∈ `ColumnType` (`model/nodes.py:68`). `format` : `strptime`, `epoch_s` ou `epoch_ms`, pour `date` et `timestamp`. `timezone` (IANA, UTC par défaut) lit un texte sans fuseau ; le chargement range des `timestamp` en UTC, comme le suppose `wall_clock` (`compile/builder.py:317-319`). `from` : chemin pointé dans l'objet ligne ; clé absente = `NULL`. Valeur illisible : `rest_bad_response` (nom de colonne, jamais la valeur).
- `perimeter.mode` : `each` (un appel par valeur du périmètre, la colonne remplie par la valeur si la réponse ne la porte pas) ou `list` (valeurs jointes par des virgules). `required` vaut `true` par défaut. `pagination.max_pages` : 1 à 200, 20 par défaut.
- Codes de validation : `duplicate_rest_dataset`, `unknown_access_point`, `access_point_not_rest`, `key_param_in_dataset` (un paramètre porte `key_name`), `param_clash` (paramètres de fenêtre égaux entre eux ou à un paramètre fixe), `perimeter_column_unknown`, plus `invalid_value` et les codes pydantic habituels.

### Choix du runner, `choose()`, `dialect()`

- `remote_runner` (`service.py:101`) devient un objet appelable `RemoteRunner(workspace_id, refresh=False)` de même signature `Runner` (`orchestrate.py:275`) : pour un plan, il lit `connections.access_point(workspace_id, plan.access_point)` ; plateforme `rest` : `RestRunner` ; sinon `connections.run_aggregate`, à l'identique. Il garde le `RestRunner` de la comparaison pour `report()`. `cli.py:457` et `service.py:115` ne changent que par le passage de `refresh` (CLI) ; aucun autre appelant.
- `choose` (`service.py:51-67`) : pour des sources `duckdb`, seuls les points `rest` sont éligibles, dans les deux branches (point demandé : `access_point_mismatch` sinon ; point cherché : `no_access_point` et `ambiguous_access_point` sur les points `rest` de l'entité). Pour toute autre plateforme de sources, un point `rest` reste refusé par `access_point_mismatch` ; un point `databricks`, `snowflake` ou `duckdb` ne dessert jamais une source `duckdb` (le dernier cas change de code : `platform_not_supported` à `dialect`, aujourd'hui, devient `access_point_mismatch`).
- `dialect` (`service.py:69-73`) : il reçoit la plateforme des sources, `duckdb`, que `SUPPORTED_PLATFORMS` (même avec `rest`) ne contient pas, et le refus `platform_not_supported` tomberait. Règle : `duckdb` rend `duckdb`, sans autre contrôle, car `prepare` n'y arrive qu'après `choose` (`orchestrate.py:251-252`), qui n'a rendu qu'un point `rest` ; les autres plateformes gardent le contrôle actuel.
- **Compilation** : `RestRunner` n'a ni le scope ni le périmètre (`Runner` ne reçoit que plan, `Compiled`, annulation). `Compiled` (`compile/builder.py:62-67`) gagne `window: tuple[date, date] | None = None`, renseignée là où `self.bounds` est calculé (`builder.py:255`) pour le document principal, et `SourceTable` (`builder.py:55-59`, gelée) gagne `perimeter: tuple[str, ...] = ()`, les conditions `colonne:opérateur:valeurs` de `perimeter_filters` pour ce nœud (`builder.py:233-236`), posées à la création de la source (`builder.py:312`). Champs additifs, valeurs par défaut vides : aucun test existant ne change.
- **Contrôle avant exécution** dans `prepare_in` (`service.py:75-76`), après `orchestrate.prepare` : pour chaque plan dont le point est `rest`, chaque table de `compiled.sources` des deux côtés a un jeu de données sur ce point (`rest_dataset_missing`), ses colonnes déclarées par les nœuds existent et ont un type compatible (`compatible`, `rebind.py:70`, sinon `rest_dataset_mismatch`), et `compiled.window` n'est pas vide quand le jeu déclare `window` (`rest_period_required`, scope sans période). Rien n'est lancé, aucune ligne de comparaison n'est créée (`orchestrate.py:5-6`). `comparison_setup` (`service.py:161-163`) montre ces refus comme `unavailable`.
- **Reliaison** : `rebind` (`rebind.py:165`) rebranche le canonique sur les sources de la déclinaison ; les deux côtés s'exécutent avec le même `plan.access_point` (`orchestrate.py:417`). Un point `rest` lit donc les mêmes tables des deux côtés, et le second côté est servi par le cache (une seule série d'appels). Les sources communes (ADR 0026) se lisent sur le point du plan : il leur faut un jeu de données sur ce point. Atlas ne compare pas deux fournisseurs via cette mécanique ; hors périmètre.

### `RestRunner` (`compare/rest_runner.py`)

`RestRunner(workspace_id, refresh=False, now=utc_now)` respecte `Runner`. Pour un appel `(plan, compiled, cancel)` :

1. Point (`connections.access_point`), clé (`rest_key`), jeux de données ; aucun appel avant que tout soit résolu.
2. Pour chaque `SourceTable` : paramètres = fixes + fenêtre (`compiled.window` formatée selon `format`) + périmètre. Périmètre : pour la colonne du jeu, opérateur `equals` ou `in` (formes canoniques du catalogue, `compile/scope.py:101`), autre : `rest_perimeter_unsupported` ; absent alors que `required` : **`rest_scope_required`, avant tout appel**. Les conditions sur d'autres colonnes ne servent pas : le SQL compilé les applique (le chargement est un sur-ensemble).
3. Clé de cache = SHA-256 de (point, table, chemin, paramètres sans la clé, fenêtre, valeur de périmètre, empreinte du jeu de données). Hors `repo/` : `workspace_dir(id)/rest_cache/<clé>.parquet` + `<clé>.json` (date, `provisional`, appels, octets ; ni URL, ni valeur de réponse), écrits par fichier temporaire puis renommage, le `.json` en dernier.
4. **Fraîcheur** : fenêtre dont la fin précède le jour UTC courant : **immuable**, resservie sans limite. Fenêtre incluant le jour courant, ou jeu sans fenêtre : **provisoire**, durée de vie 15 minutes. `--rafraichir` force un appel par clé, une seule fois par comparaison (le second côté lit le cache neuf).
5. Défaut de cache : appels page par page (`next_url` : même `origin`, au plus `max_pages`, sinon `rest_too_many_pages`), annulation vérifiée avant chaque appel (`query_canceled`). Total de lignes borné à 1 000 000 (`rest_response_too_large`). Lignes extraites par `rows_path` (non-liste : `rest_bad_response`), converties, chargées dans une table DuckDB typée puis `COPY … TO` Parquet.
6. Chargement : un dossier temporaire reçoit `<table>.parquet` par source (plusieurs valeurs de périmètre réunies par `read_parquet`) puis `LocalRunner(dossier)(plan, compiled, cancel)` (`orchestrate.py:278`) fait le reste : `open_database` (`duckdb_local.py:90`) crée les schémas et bases des noms `a.b[.c]` (`duckdb_local.py:52-61`), convertit selon les types déclarés et exécute le SQL `duckdb`, dont les limites `MAX_ROWS` et l'annulation.
7. Rapport : `report()` rend, par jeu de données, `{access_point, table, calls, bytes, cache: "none"|"immutable"|"provisional"|"refreshed", key_source}`.

**Budgets** (`connectors/rest_budget.py`), avant **chaque** appel HTTP (page ou nouvel essai compris) :
- `calls_per_minute` : fenêtre glissante de 60 s par (espace, point), en mémoire du processus, verrou propre ; dépassement : `budget_exceeded`, sans attente, sans appel.
- `bytes_per_day` : somme du registre pour le point et le jour UTC ; si elle atteint déjà la limite : `budget_exceeded`. Pas d'estimation d'une réponse à venir : l'appel qui franchit la limite a lieu, le suivant est refusé.
- **Registre d'usage** : table `rest.usage(day DATE, access_point, dataset, calls, bytes, errors, cache_hits)`, clé (`day`, `access_point`, `dataset`), mise à jour par `INSERT … ON CONFLICT DO UPDATE`, dans `atlas.duckdb` de l'espace (`index_path`), schéma `rest` : l'index ne reconstruit que `index` (`index/build.py:257`). Connexion et verrou sur le modèle de `compare/store.py:82-96`. Chaque appel compte (échecs et nouvel essai compris) ; un succès de cache ne compte que `cache_hits`. Le registre ignore `--db` : le budget est celui de l'espace.

**Erreurs** (`RepoError`) :

| Situation | Code | Notes |
|---|---|---|
| 401 | `access_expired` | marque l'entrée du coffre `rejected` ; clé d'environnement : rien n'est écrit |
| 402 | `rest_payment_required` | point d'API hors forfait |
| 403 | `rest_forbidden` | idem ; la clé n'est pas marquée refusée |
| 429 | `rate_limited` | un nouvel essai après `Retry-After` (≤ 60 s) ; sans cet en-tête ou au-delà, aucun |
| 200 avec clé d'`error_keys` | `rest_error_body` | texte du corps jamais recopié |
| autre 4xx, 5xx | `rest_http_error`, `rest_server_error` | pas de nouvel essai |
| réseau | `host_unreachable` | existant (`http.py`) |
| autres | `budget_exceeded`, `rest_bad_response`, `rest_response_too_large`, `rest_too_many_pages`, `rest_next_url_refused`, `rest_scope_required`, `rest_perimeter_unsupported`, `rest_period_required`, `rest_dataset_missing`, `rest_dataset_mismatch`, `invalid_rest_datasets` | |

`_STORED_ERRORS` (`orchestrate.py:45-50`) reçoit un texte fixe pour tous les codes d'exécution (`budget_exceeded`, `rate_limited`, `rest_*`) : sinon `_stored_error` (`orchestrate.py:53-57`) remplace leur texte par « Échec de la comparaison. ». Le cas existant `result_too_large`, traité séparément avec `max_rows`, reste inchangé. `ERROR_STATUS` (`api/app.py:38`) reçoit chaque nouveau code : 422 pour les erreurs de configuration et de périmètre, 429 pour `budget_exceeded` et `rate_limited`, 502 pour les erreurs de fournisseur.

### CLI et ce que voit l'utilisateur

- `atlas compare <espace> <kpi> --variants … [--scope|--period|--perimeter|--by] [--rafraichir]` : `--rafraichir` (nouveau, `refresh`) force un nouvel appel par jeu de données et par clé ; sans lui, le cache sert selon la fraîcheur. Codes de sortie inchangés (0, 2, 1). `--duckdb-data` garde la priorité : sur la sortie d'erreur, « Données locales (--duckdb-data) : les points d'accès REST de l'espace ne sont pas appelés. »
- Texte (`_compare_text`, `cli.py:409-437`) : les lignes actuelles, avec `(duckdb)` comme plateforme, puis par jeu de données :
  `sources REST : api-exemple · marche.prix.cours_jour : 2 appel(s), 18342 octets, cache neuf ; clé : environnement`
  `sources REST : api-exemple · marche.prix.cours_jour : 0 appel, cache immuable ; clé : coffre`
  `sources REST : … cache provisoire (15 min)`
  `--format json` : clé supplémentaire `rest` (liste du rapport) ajoutée à la sortie, pas au stockage ; le résultat de l'API ne change pas.
- Refus : `budget_exceeded : …` sur `erreur :` de la comparaison (exit 1) ; `needs_auth`, `vault_unavailable` et les refus de préparation comme aujourd'hui. Pour `vault_unavailable` sur un point `rest`, la CLI ajoute « Sans trousseau : variable ATLAS_REST_KEY_<ID> ».
- `atlas rest-usage <espace> [--point id] [--day AAAA-MM-JJ] [--format text|json]` : lignes du registre.

### Tests, secrets, documentation

- Faux serveur `core/tests/connections/fake_rest.py` (sur le modèle de `fake_databricks.py`, `127.0.0.1`, port libre, compteur de requêtes) : motif A clé en paramètre et liste ; B clé en paramètre, `next_url` et lignes sous `results` ; C jeton en en-tête sans pagination ; modes d'échec 401, 402, 403, 429 (avec et sans `Retry-After`), 200 avec corps d'erreur, 500, redirection, `next_url` vers un autre hôte (deuxième faux serveur).
- Marqueur `rest` ajouté à `[tool.pytest.ini_options].markers` (`core/pyproject.toml:53-59`) : test réel (`ATLAS_REST_TEST_*`), qui s'ignore sans configuration, hors CI comme les marqueurs `databricks` et `snowflake`.
- **Aucune clé, URL complète, nom de fournisseur ni secret** dans plan, ADR, fixtures, tests ou messages : hôte `api.exemple.test`, clé `cle-de-test`. Les jeux de données validés ne portent aucun secret en paramètre (`key_param_in_dataset`).
- Documentation (même PR de construction) : section « Points d'accès REST » de `core/README.md` (YAML d'exemple, clé, variable, budgets, cache), ligne de `docs/plans/README.md`, passage des ADR 0050 à 0054 à « acceptée » après l'approbation du propriétaire.

## Critères d'acceptation

Fichiers de test sous `core/tests/` ; abrégés : `AP` = `connections/test_rest_access_points.py`, `KEY` = `connections/test_rest_key.py`, `HTTP` = `connections/test_rest_http.py`, `DS` = `compare/test_rest_datasets.py`, `RUN` = `compare/test_rest_runner.py`, `BUD` = `compare/test_rest_budgets.py`, `CLI` = `repo/test_rest_compare_cli.py`.

| # | Critère vérifiable | Test |
|---|---|---|
| 1 | Un point `rest` valide est lu ; `host` avec schéma, chemin, port, identifiant, majuscule, IP ou sans point est refusé | `AP::test_rest_host_validation` |
| 2 | `127.0.0.1:<port>` et `localhost:<port>` admis en `http`, uniquement eux | `AP::test_rest_loopback_http_with_port` |
| 3 | Champs de Databricks et Snowflake refusés sur `rest` sauf `http_path` ; champs `rest` refusés ailleurs ; `schema` refusé | `AP::test_rest_foreign_fields_refused`, `AP::test_rest_fields_refused_elsewhere` |
| 4 | `key_in` et `key_name` obligatoires, motifs respectés, `key_prefix` seulement en en-tête | `AP::test_rest_key_mode_required` |
| 5 | Bornes des budgets ; avertissement `rest_no_budget` | `AP::test_rest_budget_bounds`, `AP::test_rest_without_budget_warns` |
| 6 | `schema_version` reste 1 ; un fichier sans point `rest` se relit et se réécrit à l'identique | `AP::test_access_points_schema_version_unchanged` |
| 7 | `PLATFORMS` sans `rest`, inclus dans `ACCESS_POINT_PLATFORMS` ; nœud `source` en `rest` refusé | `AP::test_platform_enums_consistent` |
| 8 | `allowed_platforms` accepte `rest` ; ancien fichier valide ; point `rest` non autorisé : `platform_not_allowed` | `AP::test_allowed_platforms_accepts_rest`, `AP::test_rest_point_needs_allowed_platform` |
| 9 | Sorte `apikey` : `state`, `describe`, `needs_refresh` ; `rejected` donne `expired` | `KEY::test_apikey_credential_states` |
| 10 | Deux identifiants valides distincts donnent deux noms de variable distincts (énumération exhaustive des identifiants de 2 et 3 caractères) ; `ma-source` donne `ATLAS_REST_KEY_MA_SOURCE` | `KEY::test_env_variable_names_never_collide` |
| 11 | Ordre des sources : entrée du coffre ; coffre indisponible et variable posée ; coffre disponible sans entrée et variable posée (`not_connected`, variable non lue) ; coffre indisponible sans variable (`vault_unavailable`) | `KEY::test_rest_key_source_order` |
| 12 | La variable n'est écrite ni au coffre, ni dans un fichier de l'espace, ni dans la base, le cache, le registre ; l'environnement est inchangé | `KEY::test_env_key_is_never_written` |
| 13 | Entrée liée à un autre hôte : `access_host_mismatch` ; `next_url` d'un autre hôte : aucune requête n'atteint le second serveur ; redirection non suivie | `KEY::test_key_bound_to_host`, `HTTP::test_next_url_other_host_refused`, `HTTP::test_redirect_not_followed` |
| 14 | `masking.mask_secrets` et `mask_body` sont réutilisés avec la clé comme secret pour `message_of` et `host_unreachable`, avant troncature ; `mask_url(url, key_name)` masque aussi la valeur du paramètre nommé, `ApiKey.value` reste hors `repr`, aucun message ne contient d'URL ni de corps. La clé brute ou encodée (coffre et environnement) est absente des URL rendues, `repr`, messages d'exception, erreur stockée, lignes `comparison_runs`, registre, métadonnées de cache, sorties de la CLI et journaux capturés | `HTTP::test_mask_unit`, `CLI::test_key_masked_everywhere` |
| 15 | Les trois motifs d'authentification et de pagination chargent leurs lignes | `RUN::test_pattern_query_list`, `RUN::test_pattern_next_url_results`, `RUN::test_pattern_header_token` |
| 16 | 401, 402, 403, 200 avec corps d'erreur, 500 donnent les codes du tableau ; 429 : un seul nouvel essai après `Retry-After`, aucun sans | `HTTP::test_errors_map_to_codes`, `HTTP::test_429_retries_once` |
| 17 | `calls_per_minute` et `bytes_per_day` refusent **avant** l'appel (compteur du serveur inchangé) ; `budget_exceeded` et `rate_limited` sont stockés avec leur texte | `BUD::test_calls_per_minute_refused_before_call`, `BUD::test_bytes_per_day_refused_when_reached`, `BUD::test_budget_codes_stored_with_text` |
| 18 | Registre par point, jeu de données et jour UTC ; échecs comptés ; succès de cache = `cache_hits` ; survit à la reconstruction de l'index | `BUD::test_usage_ledger_counts`, `BUD::test_usage_survives_index_rebuild`, `CLI::test_rest_usage_command` |
| 19 | Fenêtre passée : cache immuable ; fenêtre du jour : refaite après 15 min (horloge injectée) ; `--rafraichir` : un appel par clé | `RUN::test_immutable_window_served_from_cache`, `RUN::test_provisional_window_expires`, `RUN::test_refresh_one_call_per_key` |
| 20 | La clé de cache ignore la clé d'API et change avec le jeu de données | `RUN::test_cache_key_ignores_api_key_follows_mapping` |
| 21 | Périmètre vide refusé avant tout appel ; opérateur non pris en charge refusé ; `each` : un appel par valeur | `RUN::test_empty_perimeter_refused_before_call`, `RUN::test_perimeter_each_and_unsupported` |
| 22 | Codes de validation de `rest_datasets.yaml` | `DS::test_rest_datasets_validation` |
| 23 | Table sans jeu de données ou sur un autre point : refus à la préparation, aucune ligne `comparisons` créée ; fichier mal formé : `invalid_rest_datasets` seulement s'il y a un plan `rest` | `DS::test_missing_dataset_stops_before_any_run`, `DS::test_malformed_file_only_matters_for_rest_plans` |
| 24 | `choose` : point demandé et cherché, `ambiguous_access_point`, `no_access_point` ; `rest` ne dessert aucune autre plateforme ; Databricks, Snowflake, DuckDB ne desservent pas `duckdb` | `RUN::test_choose_rest_serves_duckdb_sources`, `RUN::test_rest_never_serves_other_platforms` |
| 25 | `dialect` rend `duckdb` après un choix `rest`, inchangé ailleurs | `RUN::test_dialect_duckdb_after_rest_choice` |
| 26 | `RemoteRunner` envoie un plan `rest` à `RestRunner`, un plan Databricks en push-down ; le test existant du chemin distant reste vert | `RUN::test_remote_runner_routes_by_point`, `repo/test_comparisons_api.py::test_remote_comparison_uses_my_access` |
| 27 | `check_access` : `not_connected` donne `needs_auth` ; variable seule suffit ; `vault_unavailable` remonte | `KEY::test_check_access_rest_states` |
| 28 | Données locales et point `rest` : aucun appel REST, avis sur la sortie d'erreur | `CLI::test_local_data_wins_over_rest_point` |
| 29 | Les deux côtés d'une déclinaison lisent le même point ; les tables partagées ne sont appelées qu'une fois | `RUN::test_both_sides_share_one_load` |
| 30 | Noms à trois parties, types `date`, époque, fuseau (UTC en base) | `RUN::test_loads_three_part_names`, `RUN::test_column_conversion` |
| 31 | **Livrable** : `atlas compare` sur un espace servi par un point `rest` du faux serveur : lignes de comparaison, lignes `sources REST`, sortie 0 ; JSON avec `rest` ; second lancement sans appel ; `--rafraichir` refait l'appel | `CLI::test_compare_text_on_rest_point`, `CLI::test_compare_json_has_rest_report`, `CLI::test_rafraichir` |
| 32 | `atlas rest-key` lit l'entrée standard, jamais un argument ; coffre indisponible : indication de la variable | `CLI::test_rest_key_reads_stdin` |
| 33 | Marqueur `rest` déclaré ; test réel ignoré sans configuration | `test_rest_real.py::test_real_provider`, `AP::test_rest_marker_declared` |
| 34 | Chaque nouveau code a un statut HTTP ; aucun secret ni URL complète dans les nouveaux fichiers | `AP::test_new_codes_have_http_status`, `AP::test_no_secret_in_rest_files` |

## Tests

- **Unitaires** : critères 1 à 12, 20 à 22, 30, 34 (modèles, énumérations, sorte `apikey`, variable, validation).
- **Intégration** avec le faux serveur : critères 13 à 19, 21, 23 à 29, 31 à 32. Fixture d'espace dédiée `core/tests/fixtures/rest/` (un KPI, une déclinaison, entité `exemple`, sources `platform: duckdb`), avec `ATLAS_VAULT=memory` et `ATLAS_DATA_DIR` isolé ; coffre indisponible simulé en faisant lever `vault_unavailable` à `system_keyring`. Aucun accès réseau hors `127.0.0.1`.
- **À la main** (hors CI, marqueur `rest`) : un fournisseur réel avec une clé de test, sur un serveur Linux sans session graphique, pour la variable d'environnement ; vérifier que le registre d'usage correspond au compteur du fournisseur. Rien d'écrit dans l'app (aucun écran).

## Dépendances

Plans 0007 (compilation DuckDB), 0008 (coffre, points d'accès), 0009 (comparaison, runners), 0018 (motif des champs étrangers). ADR 0050 à 0054 approuvés par le propriétaire avant tout code.

## Estimation

**L.** Incertitudes : (1) l'ajout de `window` et `perimeter` à `Compiled`/`SourceTable` touche le compilateur (ADR 0052) ; (2) la forme réelle des réponses des fournisseurs (types, dates, pagination) ne se vérifie qu'avec le marqueur `rest`, hors CI ; (3) une base d'espace ouverte par deux processus en même temps (registre d'usage, ADR 0032) ; (4) le limiteur à la minute est par processus, pas par machine ; (5) le cache grandit sans purge dans ce plan.
