# ADR 0032 — Base d'un espace partagée entre processus

Date : 2026-11-01 · Statut : **acceptée** (mise en œuvre du plan 0028)

## Contexte

Chaque espace a un fichier DuckDB (`atlas.duckdb`) qui porte l'index (ADR 0005) et l'historique des comparaisons (ADR 0012). L'app (sidecar) et la CLI peuvent l'ouvrir en même temps, par exemple pour un `atlas compare` lancé pendant que l'app tourne.

La relecture de #60 (issue #61) craignait un « Catalog write-write conflict » entre deux processus. Vérifié : ce conflit ne se produit qu'entre threads d'un même processus, et le verrou de `compare/store.py` le règle déjà. Entre processus, DuckDB verrouille le fichier : tant que l'un l'a ouvert, l'autre échoue aussitôt, avec « IO Error: Could not set lock on file ». L'API répondait alors 500.

## Décision

- **Une seule porte.** Toute ouverture du fichier d'un espace passe par `skifer_atlas.dbfile.open_db` (`index/schema.py`, `compare/store.py`).
- **Attendre, puis le dire.** Sur « Could not set lock », `open_db` réessaie, avec une attente qui double de 20 ms à 500 ms, pendant au plus 10 s. Atlas ne garde le fichier ouvert que le temps d'une lecture ou d'une écriture : l'autre processus le libère vite. Au-delà de 10 s, l'erreur est `index_busy` : 503 côté API, « Base de l'espace occupée » côté app, avec la conduite à tenir.
- **Les ouvertures du processus passent une à une.** Quand plusieurs requêtes attendent la même base et réessaient ensemble à sa libération, DuckDB refuse certaines d'entre elles (« Unique file handle conflict »). Un verrou de processus sérialise donc l'appel à `duckdb.connect`, qui est bref ; l'attente entre deux essais se fait hors de ce verrou.
- **Les attentes ne s'additionnent pas.** `ensure_index` ouvre la base et lit l'état de l'index hors du verrou de reconstruction, puis vérifie à nouveau sous le verrou avant de reconstruire. Sinon, les requêtes d'un même écran attendaient l'une après l'autre, chacune jusqu'à 10 s. La reconstruction est une transaction : un lecteur voit l'ancien index ou le nouveau.
- **L'accessoire n'attend pas.** Les compteurs de la liste des espaces (`_counts`) ouvrent la base sous `dbfile.without_waiting()` : une base occupée donne aussitôt un compteur `None`, au lieu de retarder l'accueil et la coque de chaque écran de 10 s.
- **Rien d'autre n'est réessayé.** Une autre erreur d'ouverture (dossier absent, fichier corrompu) remonte aussitôt.
- **Pas de lecture seule partagée.** DuckDB permet à plusieurs processus d'ouvrir un fichier en lecture seule, mais aucun ne peut alors écrire. Or l'app reconstruit l'index à la lecture quand le commit a changé. Le gain ne vaut pas deux modes d'ouverture.

## Conséquences

- La CLI et l'app peuvent tourner ensemble ; au pire, l'une attend quelques secondes.
- Un processus qui garderait la base ouverte longtemps bloquerait l'autre. Aujourd'hui, aucun ne le fait : les connexions se ferment à la fin de chaque requête, et une comparaison n'ouvre la base que pour créer puis clore son enregistrement.
- Une requête de compteurs qui arrive pendant une reconstruction de l'index attend encore la fin de celle-ci. C'est rare, et sans rapport avec un autre processus.
- Tests : `core/tests/test_dbfile.py` ; `core/tests/repo/test_catalog_api.py::test_a_base_held_by_another_process_answers_index_busy`, `::test_a_busy_base_does_not_delay_the_workspace_list`, `::test_requests_waiting_for_a_busy_base_wait_side_by_side` ; `app/src/messages.test.ts` ; `app/e2e/base-occupee.spec.ts`.
