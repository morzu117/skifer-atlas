# ADR 0051 — Jeux de données REST dans un fichier d'espace de travail

Date : 2026-11-07 · Statut : **proposée** (branche points d'accès REST, plan 0036)

## Contexte

Un point d'accès REST (0050) dit où l'on se connecte. Il ne dit pas quel appel remplit quelle table : les nœuds `source` nomment des tables au format `a.b[.c]` (`TABLE_PATTERN`, `model/nodes.py:41`) et gardent `platform: duckdb`. Il faut déclarer, pour chaque table, l'appel qui la remplit.

Où le déclarer :
- `rest_access_points.yaml` est de la gouvernance, comme `access_points.yaml` (qui, où, quels quotas) ; son modèle REST est fermé (0050), suivant le modèle existant `extra="forbid"` (`connectors/access_points.py:60`) ;
- les jeux de données sont nombreux, changent souvent et vivent avec les documents KPI.

## Décision

- **Un fichier `rest_datasets.yaml` à part, dans l'espace de travail**, à côté des documents KPI. Rien n'est ajouté à `rest_access_points.yaml` pour eux.
- **Un jeu de données associe une table à son appel.** Le design retient, par jeu de données :
  - l'identifiant de la table logique, au format `a.b[.c]`, celui qu'un nœud `source` vise ;
  - le point d'accès (id, `^[a-z0-9][a-z0-9-]{1,63}$`, `access_points.py:64`) ;
  - le chemin de l'appel, relatif à `http_path` du point d'accès, et ses paramètres fixes ;
  - les paramètres liés à la fenêtre (`from`, `to`, donnés par `period_bounds`, `compile/scope.py`) et au périmètre (par exemple `symbol`) ; le jeu de données déclare quel paramètre reçoit le périmètre et quelle colonne il remplit ;
  - le chemin JSON vers la liste de lignes, et la correspondance champ JSON vers colonne, avec le type, le fuseau et le format des dates ;
  - la pagination éventuelle.
- **Trois motifs de pagination et d'authentification** doivent être couverts (le design les teste avec un faux serveur) :
  - clé en paramètre de requête, réponse en liste ;
  - clé en paramètre, pagination par `next_url`, lignes sous `results` ;
  - jeton en en-tête, sans pagination.

  La clé n'est jamais dans ce fichier (0053) ; seul le mode d'envoi se déclare, et où (jeu de données ou point d'accès) est à préciser au plan.
- **Un périmètre vide est refusé** pour un jeu de données qui l'exige : pas de récupération d'un univers entier par accident.
- Le fichier a son propre `schema_version`, un modèle fermé comme `access_points.yaml`, et une validation qui rend des `Issue` (`model/errors.py`). Les noms de champs, leurs valeurs et le contrôle que le point d'accès cité existe dans `rest_access_points.yaml` sont précisés au plan (un identifiant du seul fichier historique ne suffit pas).
- Un nœud `source` dont la table n'a pas de jeu de données, quand l'exécution est REST, est une erreur de comparaison : son code est à préciser au plan.

## Conséquences

- Le document KPI ne change pas (0050) ; la lignée d'une table REST se lit dans un fichier que le fonds relit et fait évoluer sans toucher à la gouvernance.
- Un jeu de données mal formé n'est pas une erreur de document : où il remonte (analyse de l'espace ou lancement de la comparaison) est à préciser au plan.
- Le fichier est lu comme les documents de l'espace de travail : sa lecture, son écriture (propositions, ADR 0040) et son empreinte sont à préciser au plan.
- Les valeurs de réponse ne sortent pas du poste ; le cache et la fraîcheur sont retenus par le propriétaire tels que dans le design, et décrits au plan.
