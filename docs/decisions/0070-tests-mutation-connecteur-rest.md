# ADR 0070 — Tests de mutation du connecteur REST

Date : 2026-11-25 · Statut : **acceptée**

## Contexte

Les ADR 0062 (couverture) et 0063 (mutation sur la gouvernance, étendue aux propositions)
ont posé la règle : une ligne exécutée n'est pas une ligne vérifiée. Le connecteur REST
(plan 0036, ADR 0050–0054, PR #208) manipule une surface sensible — clés d'API, requêtes
sortantes, bornes de budget, sécurité de la pagination (`next_url`) — mais n'était pas dans
`paths_to_mutate`.

Un premier passage de mutmut 3.8.1 sur les six fichiers du connecteur tue **897 mutants sur
1 328 (67,5 %)** et laisse **423 survivants**, dont de vrais trous : messages et codes
d'erreur non assertés, mapping de statut HTTP, branche de retry 429, comptabilité du budget
sur les chemins d'erreur, gardes de la pagination.

## Décision

- `[tool.mutmut]` de `core/pyproject.toml` ajoute à `governance/` et `proposals/` les six
  fichiers REST : `connectors/rest_access_points.py`, `rest_budget.py`, `rest_cache.py`,
  `rest_datasets.py`, `rest_errors.py` et `compare/rest_runner.py`. La sélection de tests
  s'étend aux sept suites REST existantes et aux cinq nouvelles suites de mutation.
- Les mutants significatifs sont tués par des assertions **exactes** : code **et** texte de
  chaque `RepoError`/`Issue`, mapping `{402, 403, 429, ≥500, autre}`, retry-after (présent,
  absent, hors borne, annulation pendant l'attente), comptabilité `read_usage`
  (`calls`/`errors`/`bytes`), gardes `next_url` (origine, préfixe de base, `..`, `\`,
  caractères de contrôle), conversions (`epoch_s`/`epoch_ms`, fuseau, booléens), round-trip du
  cache Parquet et du registre d'usage.
- Les nouveaux tests vivent dans `tests/compare/test_rest_runner_mutation.py`,
  `test_rest_datasets_mutation.py`, `tests/connections/test_rest_cache_mutation.py`,
  `test_rest_budget_mutation.py`, `test_rest_access_points_mutation.py`. Comme pour l'ADR 0063,
  ils ne dépendent pas de l'emplacement de leur fichier (mutmut les copie dans `core/mutants/`).
- Les mutants équivalents sont acceptés sans test artificiel (voir plus bas).
- Le passage reste manuel, hors CI (≈ 20 min sur ce périmètre, score non stable d'une version
  de mutmut à l'autre). On le relance quand on touche au connecteur REST :

  ```sh
  cd core && uv run --with mutmut==3.8.1 mutmut run && uv run --with mutmut==3.8.1 mutmut results
  ```

## Résultat

Après trois passes de renforcement, mutmut 3.8.1 tue **1 218 mutants sur 1 328 (91,7 %)**.
Les **110 survivants** se répartissent en `compare/rest_runner.py` (70), `rest_cache.py` (20),
`rest_budget.py` (12), `rest_access_points.py` (6), `rest_datasets.py` (2) ; `rest_errors.py`
n'a aucun survivant. Tous sont jugés équivalents ou pratiquement inatteignables :

- **SQL DuckDB interne** (`CREATE TABLE`/`INSERT`/`COPY`/`SELECT … WHERE`/`ORDER BY`/
  `ON CONFLICT` du cache et du registre d'usage) : mutations de casse de mot-clé ou de
  reformatage de requête paramétrée qui ne changent pas le résultat observable, lequel est déjà
  vérifié par round-trip (écriture puis relecture des valeurs exactes).
- **`model_dump(mode="json", by_alias=…, exclude_none=…)`** sur des modèles ne contenant que
  des types JSON : les modes produisent les mêmes valeurs.
- **`http.message_of(body, key.value)`** dont le retour est ignoré (appel défensif de masquage,
  `rest_runner` ~l.220) : ses mutations n'ont aucun effet observable.
- **Calcul de l'origine** `urlsplit(url)._replace(path="", query="")` : la validation de
  pagination ne compare que `(scheme, netloc)` ; `query=""`, `query=None` ou son omission
  donnent la même chaîne, et une query factice n'est jamais lue.
- **Équivalences sémantiques** : `\x7f` ↔ `\x7F`, `UTF-8` ↔ `utf-8`, et dans la coercition
  booléenne `False` ↔ `0`/`True` ↔ `1` (Python : `False == 0`) ; variantes du défaut
  `retry-after` qui aboutissent toutes au même `NaN`.
- **Double-faute I/O inatteignable** : le message `"Cache REST illisible."` et les boucles de
  nettoyage `unlink(missing_ok=True)` sur le chemin d'un `OSError` survenant *après* la
  corruption d'un Parquet — inatteignable sans forcer artificiellement l'échec du système de
  fichiers ; documenté plutôt que couvert par un test fragile.

## Conséquences

Pour le connecteur REST, un survivant **nouveau** après modification est à traiter comme un
test manquant, sauf s'il relève d'une des familles d'équivalence ci-dessus. Le score (91,7 %)
est plus bas que celui de la gouvernance/propositions (98,2 %) par nature du module : beaucoup
d'I/O et de SQL dont les mutations sont équivalentes.

Un **vrai défaut** a été relevé pendant l'exercice, hors de cette ADR et sans correctif ici :
dans `rest_runner._fetch`, la garde contre les caractères de contrôle de `next_url` (ligne
~271) s'applique **avant** le `unquote` du chemin (ligne ~280) ; un caractère de contrôle
**percent-encodé** (`%00`, `%20`) échappe à la garde. L'impact reste limité — l'URL réellement
appelée conserve la forme encodée et seuls `scheme`/`netloc`/préfixe de base sont validés — mais
l'incohérence mérite une issue de correctif distincte.
