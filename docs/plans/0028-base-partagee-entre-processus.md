# Plan 0028 — Base d'un espace partagée entre processus

## Objectif
Qu'un deuxième processus Atlas (la CLI pendant que l'app tourne, par exemple) qui ouvre la base DuckDB d'un espace attende qu'elle se libère, au lieu d'échouer aussitôt ; et, s'il attend trop, que l'utilisateur lise pourquoi.

## Constat
La relecture de #60 (issue #61) craignait un « Catalog write-write conflict » entre deux processus. Vérifié : entre processus, DuckDB verrouille le fichier. Tant que l'un l'a ouvert, l'ouverture par l'autre échoue tout de suite (`IOException` « Could not set lock on file »). Le « write-write conflict » ne se produit qu'entre threads d'un même processus, et le verrou de `compare/store.py` le règle déjà. Atlas n'ouvre la base que le temps d'une lecture ou d'une écriture : le conflit entre processus est rare, mais il donnait une erreur 500.

## Périmètre
**Dedans** : ouverture de `atlas.duckdb` (schémas `index` et `results`), API, message de l'app.
**Dehors** : plusieurs postes sur une même base (chaque poste a la sienne, brief 8.4), base en lecture seule partagée.

## Spécification
- Toute ouverture du fichier d'un espace passe par `skifer_atlas.dbfile.open_db`.
- Sur « Could not set lock », `open_db` réessaie, avec une attente qui double de 20 ms à 500 ms, pendant au plus 10 s (`WAIT_SECONDS`).
- Au-delà : `RepoError("index_busy")`, 503 côté API, « Base de l'espace occupée » côté app, avec la conduite à tenir.
- Toute autre erreur d'ouverture remonte sans attente.

## Critères d'acceptation
1. La base tenue quelques secondes par un autre processus : l'écran attend, puis se charge normalement.
2. La base tenue plus de 10 s : l'écran affiche « Base de l'espace occupée » et la conduite à tenir ; une fois la base libérée, l'écran se recharge.
3. Une autre erreur d'ouverture (dossier absent) remonte sans attente.

## Tests
`core/tests/test_dbfile.py` (attente, requêtes qui attendent ensemble, `index_busy`, autre erreur) ; `core/tests/repo/test_catalog_api.py` (503, liste des espaces sans attente, attentes côte à côte) ; `app/src/messages.test.ts` (message) ; `app/e2e/base-occupee.spec.ts` (critères 1 et 2).

## Dépendances
0005, 0009 ; issue #61.

## Estimation
**S**.

## Mise en œuvre (1er novembre 2026)

- `core/src/skifer_atlas/dbfile.py` : `open_db`, seule porte vers `atlas.duckdb`, utilisée par `index/schema.py` et `compare/store.py`. Code `index_busy` (503) dans `api/app.py` ; message « Base de l'espace occupée » dans `app/src/messages.ts`.
- Le test e2e a fait apparaître trois défauts, corrigés avec un test chacun (ADR 0032) :
  - des requêtes qui attendent ensemble la même base se gênaient à sa libération (« Unique file handle conflict », 500) : les appels à `duckdb.connect` passent un à un ;
  - `ensure_index` ouvrait la base sous le verrou de reconstruction, si bien que les attentes des requêtes d'un même écran s'additionnaient et que l'écran ne recevait jamais `index_busy` : ouverture hors du verrou, seconde vérification dessous ;
  - les compteurs de la liste des espaces attendaient 10 s une base occupée, et chaque écran restait sur « Chargement » : `without_waiting()`, compteur `None` aussitôt.
- Scénarios S-0028-01 et S-0028-02 au catalogue (`docs/tests/scenarios.md`) ; S-0028-03 n'a pas d'écran.
- Vérifications : core 827 réussis ; `npm test` 159 réussis ; `npm run e2e` 189 réussis, 0 échec, 0 instable ; spec `base-occupee` réussie trois fois sur trois.

**Reste à faire** : une requête de compteurs pendant une reconstruction de l'index attend la fin de celle-ci.
