# ADR 0044 — Points d'accès REST : une plateforme propre aux points d'accès

Date : 2026-11-07 · Statut : **proposée** (branche points d'accès REST, plan 0035)

## Contexte

Le fonds veut comparer des KPI dont les sources viennent d'API REST de fournisseurs de données financières (HTTPS GET, clé d'API, réponses JSON). Atlas sait déjà comparer sur Databricks et Snowflake en push-down, et exécuter un graphe compilé en DuckDB sur des fichiers (`LocalRunner`, `compare/orchestrate.py:277`). Les réponses REST, chargées dans un DuckDB en mémoire, se comparent par ce même chemin : le SQL compilé en dialecte `duckdb`.

Le propriétaire a donné son accord de principe, aux conditions de sa réponse. Questions à trancher :
- le vocabulaire des nœuds change-t-il (`platform: rest` sur une source) ;
- `schema_version` doit-il passer à 2 ;
- comment `access_points.yaml` déclare un point REST, à côté de Databricks et Snowflake (0022) ;
- ce que portent `host` et `http_path`, sachant que `host` est obligatoire (`connectors/access_points.py:66`) ;
- où vivent les budgets.

Les règles de 0008 tiennent : aucun secret dans le dépôt, un coffre par utilisateur (clé d'API : 0047).

## Décision

- **Les nœuds `source` gardent `platform: duckdb`.** DuckDB, dans Atlas, est la comparaison locale sans infrastructure : c'est ce que fait l'exécution REST. Le vocabulaire des nœuds ne change pas, `schema_version` du document reste à 1 et les anciens Atlas lisent toujours les documents.
- **`rest` n'existe que comme plateforme de point d'accès.** `PLATFORMS` (`model/nodes.py:46`) n'est pas élargi : il sert aussi au champ `platform` des nœuds (`model/nodes.py:310`) et à `allowed_platforms` de la gouvernance (`governance/model.py:70`), et `rest` deviendrait valide sur un nœud source.
  - Une énumération propre aux points d'accès, `ACCESS_POINT_PLATFORMS = (*PLATFORMS, "rest")`, est déclarée dans `governance/model.py` : `connectors/access_points.py` importe déjà la gouvernance (`access_points.py:45`), et `allowed_platforms` (`governance/model.py:70`) en a besoin ; la déclarer côté points d'accès créerait un import circulaire. `AccessPoint.platform` (`access_points.py:65`) et `allowed_platforms` s'y rapportent au lieu de `Literal[PLATFORMS]`.
  - Les points Databricks et Snowflake déjà déclarés restent valides : leurs valeurs sont dans l'énumération, aucun champ n'est retiré.
  - `access_points.yaml` garde son propre `schema_version` (`Literal[1]`, `access_points.py:151`). Un fichier sans point `rest` reste lisible par un Atlas ancien ; un Atlas ancien refuse un fichier qui en contient (plateforme inconnue, modèle fermé `extra="forbid"`). Faut-il passer ce `schema_version` à 2 : à préciser au plan.
- **`host` porte le nom d'hôte seul** (sans schéma, sans chemin, sans port : à préciser au plan), le champ existant `http_path` porte le chemin de base, et **HTTPS est imposé**. Pas de champ `base_url` : la propriété `AccessPoint.base_url` (`access_points.py:110`) rend toujours `host` sans barre finale, donc le nom d'hôte pour un point `rest`. C'est la valeur que la liaison de la clé compare à `Credential.host` (`_bound_to`, `connections.py:91`, 0047). L'URL d'un appel se construit à part, de l'hôte, de `http_path` et du chemin du jeu de données (0045). La validation actuelle de `host` (`access_points.py:83-89`) attend une adresse avec schéma : pour `rest`, elle s'applique à un nom d'hôte. L'exception « http en boucle locale » des faux serveurs de test (`_LOOPBACK`, `access_points.py:52`) est à préciser au plan.
- **Champs refusés sur un point `rest`**, selon le motif de 0022 (`_platform_fields`, `access_points.py:83-107` : le tableau `foreign` donne les champs de l'autre plateforme, refusés avec « ne s'applique pas à un point d'accès <plateforme> ») :
  - de `_DATABRICKS_ONLY` (`access_points.py:54`), `warehouse_id`, `oauth_client_id` et `oauth_redirect_port` sont refusés ; `http_path` est conservé, avec un autre sens (chemin de base, et non plus `/sql/1.0/warehouses/<id>`) : comme il figure dans `_DATABRICKS_ONLY`, `rest` a sa propre liste de champs étrangers ;
  - de `_SNOWFLAKE_ONLY` (`access_points.py:55`), `warehouse_name` (clé YAML `warehouse`), `role`, `auth` et `account` sont refusés. Le mode d'envoi de la clé (en-tête ou paramètre de requête) n'a donc pas de place dans `auth`, dont les valeurs sont `sso` et `keypair` (`access_points.py:79`) : où il vit est à préciser au plan.
  - À l'inverse, les champs propres à `rest` (budgets ci-dessous) sont refusés sur Databricks et Snowflake.
  - `schema` (`schema_`), `entity`, `owner` et `freshness` gardent leur sens ; ce que `schema` désigne pour `rest` est à préciser au plan.
- **Budgets déclarés sur le point d'accès**, donnée de gouvernance non secrète : `calls_per_minute` et `bytes_per_day`. Noms et bornes sont ceux du design, à valider au plan ; ils sont refusés hors `rest`. Leur application (refus avant l'appel, `budget_exceeded`, `rate_limited`, registre d'usage) n'est pas décidée ici : elle relève du plan.
- **Les plateformes autorisées acceptent l'énumération des points d'accès** (décision du propriétaire, 91871). `allowed_platforms` (`governance/model.py:70`) passe de `list[Literal[PLATFORMS]]` à l'énumération des points d'accès : les plateformes existantes plus `rest`. Un espace autorise `rest` en l'ajoutant à `allowed_platforms`, et le contrôle `platform_not_allowed` de `check_access_points` (`access_points.py:171`) s'applique à `rest` comme aux autres. C'est un ajout : un fichier de gouvernance existant reste valide et garde son sens, et `PLATFORMS` n'est toujours pas élargi.

## Conséquences

- Aucun document existant n'est touché, et un Atlas ancien lit tous les documents KPI.
- `SUPPORTED_PLATFORMS` (`connections.py:34`) gagne `rest` : un point `rest` est marqué `supported` dans le résumé des connexions (`connections.py:108`). Les autres plateformes n'y changent pas. `PLATFORM_LABELS` (`connections.py:133`) et `PLATFORM_AUTH` (`admin.py:32`, lu par `admin.py:153`) ne changent pas dans cette branche : le panneau « Nouveau point d'accès » (`connections.py:141`) et l'Administration ne proposent pas `rest`, l'interface n'étant pas dans cette branche. Le dialecte d'un point `rest` est décidé en 0046 et ne passe pas par cette liste.
- L'éditeur liste `PLATFORMS` (`editor.py:443`) pour les nœuds : il ne propose pas `rest`, ce qui est voulu.
- Deux énumérations de plateformes coexistent. Le test de cohérence (toute plateforme de nœud est une plateforme de point d'accès) est à prévoir au plan.
- Le lien entre une source `duckdb` et une table REST ne se lit pas dans le document : il est dans `rest_datasets.yaml` (0045), et le choix de l'exécution dans 0046.
