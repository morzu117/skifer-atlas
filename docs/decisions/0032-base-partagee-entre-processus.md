# ADR 0032 — Base d'un espace partagée entre processus

Date : 2026-11-01 · Statut : **acceptée** (mise en œuvre du plan 0028)

## Contexte

Chaque espace a un fichier DuckDB (`atlas.duckdb`) qui porte l'index (ADR 0005) et l'historique des comparaisons (ADR 0012). L'app (sidecar) et la CLI peuvent l'ouvrir en même temps, par exemple pour un `atlas compare` lancé pendant que l'app tourne.

La relecture de #60 (issue #61) craignait un « Catalog write-write conflict » entre deux processus. Vérifié : ce conflit ne se produit qu'entre threads d'un même processus, et le verrou de `compare/store.py` le règle déjà. Entre processus, DuckDB verrouille le fichier : tant que l'un l'a ouvert, l'autre échoue aussitôt, avec « IO Error: Could not set lock on file ». L'API répondait alors 500.

## Décision

- **Une seule porte.** Toute ouverture du fichier d'un espace passe par `skifer_atlas.dbfile.open_db` (`index/schema.py`, `compare/store.py`).
- **Attendre, puis le dire.** Sur le verrou d'un autre processus (« Could not set lock », « Conflicting lock »), `open_db` réessaie, avec une attente qui double de 20 ms à 500 ms, pendant au plus 10 s. Atlas ne garde le fichier ouvert que le temps d'une lecture ou d'une écriture : l'autre processus le libère vite. Au-delà de 10 s, l'erreur est `index_busy` : 503 côté API, « Base de l'espace occupée » côté app, avec la conduite à tenir.
- **Les ouvertures du processus passent une à une.** Quand plusieurs requêtes attendent la même base et réessaient ensemble à sa libération, DuckDB refuse certaines d'entre elles (« Unique file handle conflict »). Un verrou par fichier sérialise donc l'appel à `duckdb.connect`, qui est bref ; l'attente entre deux essais se fait hors de ce verrou, et l'ouverture d'un espace ne retient pas celle d'un autre.
- **Les attentes ne s'additionnent pas.** `ensure_index` ouvre la base et lit l'état de l'index hors du verrou de reconstruction, puis vérifie à nouveau sous le verrou avant de reconstruire. Sinon, les requêtes d'un même écran attendaient l'une après l'autre, chacune jusqu'à 10 s. La reconstruction est une transaction : un lecteur voit l'ancien index ou le nouveau.
- **L'accessoire n'attend pas.** Les compteurs de la liste des espaces (`_counts`) ouvrent la base sous `dbfile.without_waiting()` : une base occupée, ou un index en cours de reconstruction, donne aussitôt un compteur `None`, au lieu de retarder l'accueil et la coque de chaque écran.
- **La lecture d'une comparaison en démarrage est bornée.** Le verrou qui associe la ligne `running` à son job ne retient `GET …/comparisons/{id}` qu'une seconde au plus. Si la création attend encore la base, la réponse garde `running` sans progression ; l'écran relit ensuite l'état. Les verrous par chemin ne restent en mémoire que tant qu'une opération les utilise.
- **Rien d'autre n'est réessayé.** Une autre erreur d'ouverture (dossier absent, fichier corrompu) remonte aussitôt.
- **Pas de lecture seule partagée.** DuckDB permet à plusieurs processus d'ouvrir un fichier en lecture seule, mais aucun ne peut alors écrire. Or l'app reconstruit l'index à la lecture quand le commit a changé. Le gain ne vaut pas deux modes d'ouverture.

## Conséquences

- La CLI et l'app peuvent tourner ensemble ; au pire, l'une attend quelques secondes.
- Un processus qui garderait la base ouverte longtemps bloquerait l'autre. Aujourd'hui, aucun ne le fait : les connexions se ferment à la fin de chaque requête, et une comparaison n'ouvre la base que pour créer puis clore son enregistrement.
- **Libellé de DuckDB.** DuckDB n'a pas d'exception propre au verrou d'un autre processus : `open_db` le reconnaît au libellé de son message (`dbfile.LOCK_MESSAGES`). Un test vérifie ces libellés sur la version épinglée (2.0.0) : une montée de version qui les change fait échouer un test, pas une requête.
- Tests : `core/tests/test_dbfile.py` ; `core/tests/repo/test_catalog_api.py::test_a_base_held_by_another_process_answers_index_busy`, `::test_a_busy_base_does_not_delay_the_workspace_list`, `::test_requests_waiting_for_a_busy_base_wait_side_by_side`, `::test_a_rebuild_in_progress_does_not_delay_the_workspace_list` ; `app/src/messages.test.ts` ; `app/e2e/base-occupee.spec.ts`.

## Complément du 2026-11-04 — le schéma `results` ne se crée jamais dans une lecture (suivi #140)

Au premier catalogue d'un espace neuf, le serveur répondait parfois 500 : `Catalog write-write conflict on create with "results"`. Le verrou de `compare/store.py` ne suffisait pas : il ne couvre que l'exécution de la requête, pas la transaction qui la contient. Or une lecture de l'index (`ensure_index`) garde sa transaction ouverte jusqu'à la fermeture de sa connexion, et `latest` et `matrix` y créaient le schéma `results`. Cette création restait en attente, non validée, et la création faite par une autre requête du même écran (ou par `connect`) entrait en conflit avec elle. Le conflit ne dépend donc pas du nombre de connexions ni de leur ouverture, mais de la durée de la transaction qui crée.

- **Décision.** Seule une connexion neuve de `store.connect`, en validation automatique, crée le schéma (`ensure_schema`, sous le verrou). Les lectures faites sur la connexion de l'index (`latest`, `matrix`, et l'aperçu d'un document, déjà corrigé ainsi) ne créent rien : tant que les tables `comparisons` et `summaries` n'existent pas, elles répondent « aucun résultat ». La première écriture (`create`) crée le schéma, et les lectures ouvertes ensuite le voient.
- **Écarté.** Réessayer sur ce conflit : il resterait vrai tant que la transaction fautive vit, c'est-à-dire pour toute la requête.
- Tests : `core/tests/repo/test_index.py::test_concurrent_catalogs_of_a_new_workspace_do_not_conflict` (des threads ouvrent et lisent le catalogue en même temps, aucune ne ferme avant que toutes aient répondu) et `::test_a_reader_never_creates_the_results_schema`.
