# ADR 0035 — Un fetch à la fois par clone

Date : 2026-11-02 · Statut : **acceptée**

## Contexte

Chaque espace a un clone local de son dépôt (ADR 0009). Trois chemins y lancent `git fetch` :
- la synchronisation (`sync_workspace`) ;
- l'ouverture d'un contexte de proposition (`open_context`), à chaque lecture de l'écran Propositions ;
- la fusion, avant de poser le tag.

Rien ne les empêchait de tourner en même temps. Deux `git fetch` concurrents se disputent le verrou de `refs/remotes/origin/main`, et le second échoue : « cannot lock ref 'refs/remotes/origin/main': is at … but expected … ». L'API répondait alors 502 `fetch_failed`. L'e2e S-0006-12 l'a rencontré deux fois sous forte charge, et un utilisateur pouvait y tomber en synchronisant pendant le chargement de l'écran Propositions.

## Décision

- **Un verrou par clone** (`repo.git.clone_lock`), réentrant, propre au processus. La synchronisation le tient d'un bout à l'autre : fetch, avance rapide, tags. Le fetch d'`open_context` et celui de la fusion le prennent aussi.
- **Attendre plutôt qu'échouer.** Un fetch prend au plus quelques secondes ; le second appel attend la fin du premier, puis lit des références à jour.
- Les opérations qui ne touchent pas aux références distantes (lecture, `commit-tree`, push d'une branche de proposition) restent hors du verrou.

## Conséquences

- La synchronisation et l'écran Propositions ne se gênent plus dans l'app.
- **Limite.** Entre deux processus (la CLI pendant que l'app tourne), git garde son propre verrou, et le second fetch peut encore échouer. C'est rare, et un nouvel essai suffit.
- Tests : `core/tests/repo/test_workspace_repo.py::test_fetches_of_one_clone_never_overlap` (synchronisation et écran Propositions) et `core/tests/repo/test_proposals_view.py::test_the_tag_fetch_of_a_merge_waits_for_a_concurrent_sync` (fetch du tag d'une fusion, suivi #76). Chacun échoue sans le verrou.
