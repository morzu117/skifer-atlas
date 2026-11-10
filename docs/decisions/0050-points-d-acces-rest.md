# ADR 0050 — Points d'accès REST : une plateforme propre aux points d'accès

Date : 2026-11-07 · Statut : **proposée** (branche points d'accès REST, plan 0036)

## Contexte

Le fonds veut comparer des KPI dont les sources viennent d'API REST de fournisseurs de données financières (HTTPS GET, clé d'API, réponses JSON). Atlas sait déjà comparer sur Databricks et Snowflake en push-down, et exécuter un graphe compilé en DuckDB sur des fichiers (`LocalRunner`, `compare/orchestrate.py:278`). Les réponses REST, chargées dans un DuckDB en mémoire, se comparent par ce même chemin : le SQL compilé en dialecte `duckdb`.

Le propriétaire a donné son accord de principe, aux conditions de sa réponse. Questions à trancher :
- le vocabulaire des nœuds change-t-il (`platform: rest` sur une source) ;
- `schema_version` doit-il passer à 2 ;
- comment déclarer un point REST sans empêcher les anciens Atlas de lire les points Databricks et Snowflake (0022) ;
- ce que portent `host` et `http_path`, sachant que `host` est obligatoire (`connectors/access_points.py:66`) ;
- où vivent les budgets.

Les règles de 0008 tiennent : aucun secret dans le dépôt, un coffre par utilisateur (clé d'API : 0053).

## Décision

- **Les nœuds `source` gardent `platform: duckdb`.** DuckDB, dans Atlas, est la comparaison locale sans infrastructure : c'est ce que fait l'exécution REST. Le vocabulaire des nœuds ne change pas, `schema_version` du document reste à 1 et les anciens Atlas lisent toujours les documents.
- **`rest` n'existe que comme plateforme de point d'accès.** `PLATFORMS` (`model/nodes.py:47`) n'est pas élargi : il sert aussi au champ `platform` des nœuds (`model/nodes.py:311`) et à `allowed_platforms` de la gouvernance (`governance/model.py:70`), et `rest` deviendrait valide sur un nœud source.
  - `ACCESS_POINT_PLATFORMS = (*PLATFORMS, "rest")` est défini dans `governance/model.py` pour `allowed_platforms` seulement. `AccessPoint.platform` (`connectors/access_points.py:65`) reste `Literal[PLATFORMS]`.
- **Les points REST vivent dans `rest_access_points.yaml`**, à la racine du dépôt de l'espace, à côté d'`access_points.yaml`. Ce dernier reste inchangé, avec `schema_version: Literal[1]` (`connectors/access_points.py:151`) : il n'admet pas `rest`, un Atlas ancien le lit toujours et ignore le fichier REST.
  - Le nouveau fichier a son propre `schema_version: Literal[1]` et une liste `access_points`. Le conteneur et ses entrées sont fermés (`extra="forbid"`). Un modèle distinct `RestAccessPoint` conserve `id`, `host`, `http_path`, `entity`, `owner`, `freshness`, ajoute `key_in`, `key_name`, `key_prefix` et les budgets ; son champ obligatoire `platform: Literal["rest"]` garde une plateforme explicite pour les consommateurs communs. Il n'élargit pas `AccessPoint`.
  - Les identifiants sont uniques dans les deux fichiers réunis : réutiliser l'`Issue` `duplicate_access_point` (`connectors/access_points.py:166`), y compris pour un doublon entre fichiers. Le plan précise l'isolation des erreurs et interdit toute sélection ambiguë.
  - `connections` lit les deux fichiers : `access_point` et la liste rendent les points des deux. Fichier REST absent : liste REST vide. Fichier REST invalide : diagnostic `invalid_rest_access_points` avec les `Issue`, remonté par la lecture du registre, affiché par la CLI et transmis aux refus de préparation REST ; les points Databricks et Snowflake restent disponibles. Le plan précise ce canal de diagnostic sans faire échouer leur lecture.
- **`host` porte le nom d'hôte seul** (sans schéma, chemin ni port hors boucle locale de test), `http_path` le chemin de base, et **HTTPS est imposé**. Le modèle REST a sa propre validation, sans modifier celle d'`AccessPoint` (`connectors/access_points.py:83`). Sa propriété `base_url` rend `host` sans barre finale, comme celle d'`AccessPoint` (`connectors/access_points.py:110`), pour la liaison à `Credential.host` (`connections.py:94`). L'URL d'appel se construit séparément ; le plan borne l'exception HTTP locale.
- **Champs refusés : le modèle REST fermé remplace le contrôle `foreign` pour REST.** Il ne déclare ni `warehouse_id`, ni `oauth_client_id`, ni `oauth_redirect_port`, ni `warehouse`, ni `role`, ni `auth`, ni `account`, ni `schema`. Ils sont refusés comme champs supplémentaires, même avec une valeur nulle. `http_path` est admis comme chemin de base. Le dictionnaire `foreign` existant (`connectors/access_points.py:97`) ne gagne aucune clé `rest` ; les champs REST restent refusés par le modèle fermé d'`access_points.yaml`. `entity`, `owner` et `freshness` gardent leur sens.
- **Gouvernance :** `rest_access_points.yaml` gagne une ligne CODEOWNERS avec les mêmes référents qu'`access_points.yaml` (`governance/codeowners.py:49`). Écriture à la main puis commit dans cette branche ; aucun ajout à `SHARED_FILES` (`proposals/create.py:50`). Le plan suivant ajoutera les propositions avec l'écran.
- **Budgets déclarés sur le point d'accès**, donnée de gouvernance non secrète : `calls_per_minute` et `bytes_per_day`. Noms et bornes sont ceux du design, à valider au plan ; ils sont refusés hors `rest`. Leur application (refus avant l'appel, `budget_exceeded`, `rate_limited`, registre d'usage) n'est pas décidée ici : elle relève du plan.
- **Les plateformes autorisées acceptent l'énumération des points d'accès** (décision du propriétaire, 91871). `allowed_platforms` (`governance/model.py:70`) passe de `list[Literal[PLATFORMS]]` à l'énumération des points d'accès : les plateformes existantes plus `rest`. Un espace autorise `rest` en l'ajoutant à `allowed_platforms`, et le contrôle `platform_not_allowed` de `check_access_points` (`access_points.py:171`) s'applique à `rest` comme aux autres. C'est un ajout : un fichier de gouvernance existant reste valide et garde son sens, et `PLATFORMS` n'est toujours pas élargi.

## Conséquences

- Le fichier séparé protège les équipes aux versions mélangées : ajouter des points REST ne coupe pas les connexions Databricks et Snowflake des anciens Atlas.
- Aucun document existant n'est touché, et un Atlas ancien lit tous les documents KPI.
- `SUPPORTED_PLATFORMS` (`connections.py:34`) gagne `rest` : un point `rest` est marqué `supported` dans le résumé des connexions (`connections.py:111`). Les autres plateformes n'y changent pas. `PLATFORM_LABELS` (`connections.py:136`) et `PLATFORM_AUTH` (`admin.py:32`, lu par `admin.py:152-154`) ne changent pas dans cette branche : le panneau « Nouveau point d'accès » (`connections.py:144`) et l'Administration ne proposent pas `rest`, l'interface n'étant pas dans cette branche. Le dialecte d'un point `rest` est décidé en 0052 et ne passe pas par cette liste.
- L'éditeur liste `PLATFORMS` (`editor.py:447`) pour les nœuds : il ne propose pas `rest`, ce qui est voulu.
- Deux énumérations de plateformes coexistent. Le test de cohérence (toute plateforme de nœud est une plateforme de point d'accès) est à prévoir au plan.
- Le lien entre une source `duckdb` et une table REST ne se lit pas dans le document : il est dans `rest_datasets.yaml` (0051), et le choix de l'exécution dans 0052.
