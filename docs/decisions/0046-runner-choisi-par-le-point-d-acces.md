# ADR 0046 — Le runner REST est choisi par le point d'accès, pas par la plateforme du document

Date : 2026-11-07 · Statut : **proposée** (branche points d'accès REST, plan 0035)

## Contexte

Le design de droplet supposait que le runner se choisit d'après la plateforme du document, d'où `platform: rest` sur les nœuds. Le propriétaire a corrigé la prémisse. Le choix de l'exécution se fait en deux endroits, et aucun ne lit une plateforme de nœud pour le runner :
- `cli.py:457` : `LocalRunner(local) if local else service.remote_runner(workspace.id)` ;
- `compare/service.py:115` : `runner or (LocalRunner(data) if data is not None else remote_runner(workspace_id))`.

Il y a un runner local quand des données locales existent (`local_data()`, `service.py:35`), le runner distant sinon. Le point d'accès, lui, vient de `AccessPointChooser` (`compare/orchestrate.py:207`, « (entité, plateforme, point demandé) → point d'accès ; None en exécution locale »), fourni par `prepare_in` (`service.py:40-77`, fermeture `choose`, `service.py:51`).

`remote_runner(workspace_id)` (`service.py:101`) rend une fonction `run(plan, compiled, cancel)` qui appelle `connections.run_aggregate(workspace_id, plan.access_point, compiled.sql, cancel=cancel)` : le SQL part en push-down vers le point d'accès du plan.

## Décision

- **Règle : si le point d'accès choisi est `rest`, le runner est `RestRunner`.** Rien de nouveau dans le document KPI : pas de plateforme `rest` sur un nœud (0044), pas de champ de choix de runner.
- **L'aiguillage est dans `remote_runner`.** Sa fonction `run` reçoit le `VariantPlan` (`plan.access_point`) : elle lit le point d'accès (`connections.access_point(workspace_id, plan.access_point)`) et, quand sa plateforme est `rest`, appelle `RestRunner` au lieu de `connections.run_aggregate`. Les autres plateformes suivent le chemin actuel, à l'identique.
  - `RestRunner` respecte la signature de `Runner` (`orchestrate.py:274`), `(VariantPlan, Compiled, Event) -> QueryResult`, comme `LocalRunner` (`orchestrate.py:277`). `run_aggregate(sql)` n'est pas utilisé pour REST (pas de push-down).
  - `cli.py:457` et `service.py:115` appellent toujours `remote_runner` ; seule l'option `--rafraichir` y passe en plus.
  - `Runner` ne reçoit ni la fenêtre ni le périmètre de la comparaison. `Compiled` et `SourceTable` (`compile/builder.py:55-67`) les gagnent, en champs additifs à valeur par défaut vide, pour que `RestRunner` sache quoi appeler. Le SQL compilé ne change pas.
  - Les deux côtés d'un plan s'exécutent sur le même point d'accès (`plan.access_point`, `orchestrate.py:414`) : l'aiguillage se fait par plan.
- **Un point `rest` dessert les sources `duckdb` de son entité, et rien d'autre** (décision du propriétaire, 91871). Aujourd'hui, `choose` (`service.py:51-66`) exige `point.platform == platform` (`access_point_mismatch`) ou cherche un point de l'entité *sur cette plateforme* (`no_access_point`), la plateforme étant celle des sources du document (`platform_of`, `orchestrate.py:199`), ici `duckdb`. La règle s'applique aux deux branches de `choose` :
  - point demandé : un point `rest` est accepté pour des sources `duckdb` ; pour toute autre plateforme de sources, il reste refusé par `access_point_mismatch` ;
  - point cherché : pour des sources `duckdb`, les points `rest` de l'entité sont les candidats, avec les mêmes refus `no_access_point` et `ambiguous_access_point` qu'aujourd'hui.

  Un point `rest` ne dessert jamais une source `databricks` ou `snowflake`, et un point `databricks` ou `snowflake` ne dessert jamais une source `duckdb`.
- **Le dialecte est `duckdb` quand le point choisi est `rest`** (décision du propriétaire, 91871). `orchestrate.prepare` appelle `choose` puis `dialect_for(platform)` avec la plateforme des sources (`orchestrate.py:250-251`). `dialect` (`service.py:68-73`) gagne donc une branche, avant son contrôle actuel : des sources `duckdb` rendent `duckdb`, sans passer par `SUPPORTED_PLATFORMS`, où `duckdb` n'entre pas. Ce cas n'est atteint qu'après que `choose` a rendu un point `rest`, seul point qui dessert ces sources. Pour les autres plateformes, `dialect` ne change pas : même contrôle sur `SUPPORTED_PLATFORMS`, même refus `platform_not_supported`.
- **Les données locales gardent la priorité**, comme aujourd'hui : avec `local`, `prepare_in` n'appelle aucun point d'accès (`service.py:46-48`). Si des données locales et un point `rest` coexistent, c'est le comportement actuel qui s'applique ; le dire à l'utilisateur est à préciser au plan.
- **`check_access`** (`service.py:93`) exige un accès utilisable par point (`connections.ensure_usable`). Son sens pour `rest`, où l'accès est une clé (0047), est à préciser au plan.

## Conséquences

- Le document KPI, le SQL compilé et le diff restent identiques ; seule l'exécution diffère, et le résultat de compilation porte en plus la fenêtre et le périmètre.
- Deux sources `duckdb` ne se distinguent plus par la plateforme : une source fichier et une source REST se distinguent par l'exécution choisie (données locales ou point d'accès `rest`) et par `rest_datasets.yaml` (0045).
- `_STORED_ERRORS` (`orchestrate.py:45`) gagne les codes que `RestRunner` lève (retenus : `budget_exceeded`, `rate_limited`) ; sans cela, l'erreur stockée perd son texte.
- Comparer deux fournisseurs REST sur une même table logique n'est pas possible par cette mécanique : la reliaison (`compare/rebind.py`) rebranche le canonique sur les sources de la déclinaison, et les deux côtés lisent le même point. Hors de cette branche.
