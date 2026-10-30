# Plan 0005 — Espaces de travail, dépôt Git et catalogue indexé

## Objectif
Un espace se crée ou se rejoint en clonant son dépôt Git ; ses concepts, KPI et variantes sont lus, validés et indexés dans la base DuckDB de l'espace ; l'API locale sert le catalogue (recherche, synonymes et filtres compris), la fiche d'un document, ses versions et ses dépendances.

## Périmètre
**Dedans** : disposition du dépôt ; création (initialisation d'un dépôt local) et adhésion (clone) ; synchronisation (`git fetch` + avance rapide de la branche principale) ; index DuckDB reconstructible ; versions par tags ; graphe de dépendances ; endpoints de lecture ; durcissement du token de session.
**Dehors** : écriture et propositions (0006) ; écrans (0010 et suivants) ; hébergeur distant (0006 introduit `GitHost`).

## Références
Brief 5.3, 9, 10.0, 10.1, 10.2 (Versions, Dépendances) ; ADR 0001, 0005 ; `core/src/skifer_atlas/{workspaces,paths}.py`, `api/app.py`.
Fichiers : `core/src/skifer_atlas/repo/{layout,git,sync,versions}.py`, `index/{schema,build,search}.py`, `api/routes/{workspaces,catalog}.py`.

## Spécification

### Disposition du dépôt d'un espace
```
atlas.yaml                         # schema_version, id, name, sector, entities[], main_branch
governance.yaml                    # plan 0006 ; ici seuls domains[] sont lus
calendars/<key>.yaml               # format calendrier du moteur Skifer
concepts/<id>.yaml
kpis/<id>.yaml
variants/<kpi-id>/<entity>.yaml
implementations/<kpi-id>/<entity>/<platform>.sql   # le « comment », lu tel quel
```
Le nom de fichier est l'`id` : un renommage de domaine ne déplace aucun fichier.

### Git
CLI `git` en sous-processus (`repo/git.py`) avec délai, `GIT_TERMINAL_PROMPT=0` et code de retour vérifié ; jamais d'identifiant dans l'URL. Au premier usage, on vérifie la présence de git (version ≥ 2.30) ; s'il manque, une erreur `git_missing` explique quoi installer.
- `create_workspace(meta)` : `git init`, écriture de `atlas.yaml` et d'un `governance.yaml` minimal (le créateur est référent), commit initial.
- `join_workspace(remote_url)` : clone dans `workspace_dir(id)/repo`, lecture d'`atlas.yaml`, ajout au registre local.
- `sync(id)` : fetch puis avance rapide ; un historique divergent produit `sync_conflict`, sans résolution automatique.

### Versions
Un tag `doc/<id>/v<n>` pointe sur le commit de fusion de chaque version. `versions(id)` renvoie `[{version, commit, date, author, message}]`, et `document_at(id, version)` lit le fichier au commit du tag (`git show`). Le plan 0006 pose les tags ; ici, un utilitaire de test les crée.

### Index DuckDB (`atlas.duckdb`, schéma `index`)
Tables `documents(id, kind, label, domain, owner, version, status, description, synonyms, fingerprint, path)`, `variants(id, kpi_id, entity, mode, override_count, undeclared_count)`, `dependencies(from_id, to_id, to_version, kind)` (`kpi_ref` ou `concept`), `index_meta(commit, built_at, schema_version)`. Reconstruction complète si le commit ou la version de schéma change ; elle est idempotente. Un document invalide est indexé avec `status: invalid` et ses erreurs, jamais ignoré en silence.
Recherche : sous-chaîne insensible à la casse et aux accents (`strip_accents` + `lower`) sur `label`, `id`, `synonyms` et `description`, classée par champ trouvé (label > synonymes > description).

### API (toutes sous `require_token`)
- `POST /api/workspaces` (création, corps `{id, name, sector, entities}`), `POST /api/workspaces/join` (`{remote_url}`), `POST /api/workspaces/{ws}/sync`.
- `GET /api/workspaces/{ws}/catalog?q=&domain=&owner=&status=&kind=` → `[{id, kind, label, domain, version, variant_count, convergence}]`. `convergence` ∈ {converged, candidates:n, divergences:n, never_compared} est calculé depuis les variantes et les résultats de diff : `never_compared` tant que 0009 n'a rien écrit.
- `GET /api/workspaces/{ws}/documents/{id}` (document et diagnostics), `…/versions`, `…/versions/{n}`, `…/dependencies` → `{references: [...], referenced_by: [...], impact: n}`.
- Toute route `{ws}` vérifie que l'espace existe dans le registre local : il n'y a aucun accès à un autre espace par construction (chemin résolu sous `workspace_dir(ws)`, refus des `..`).

### Durcissement du token
`server.main` refuse de démarrer si `ATLAS_TOKEN` est vide, sauf si `ATLAS_DEV_NO_TOKEN=1` (positionné seulement par le mode dev documenté) ; `require_token` compare en temps constant (`hmac.compare_digest`). Le serveur reste sur 127.0.0.1.

## Critères d'acceptation
1. Créer un espace produit un dépôt avec `atlas.yaml`, `governance.yaml` et un commit initial ; l'espace apparaît dans `GET /api/workspaces`.
2. Rejoindre un dépôt de démonstration (dépôt nu local) clone, indexe et liste les documents.
3. La recherche « ca net » trouve « Revenu net » par synonyme, et « revenu » sans tenir compte des accents ni de la casse.
4. Les filtres domaine, propriétaire, statut et type se combinent.
5. Un document invalide apparaît avec `status: invalid` et ses erreurs.
6. Supprimer `atlas.duckdb` puis relancer redonne un index identique (même contenu, à l'ordre près).
7. `versions` et `versions/{n}` restituent le contenu exact de chaque tag.
8. `dependencies` de « Revenu net » liste « Commande » et « Date de référence » en références, « Marge brute » et « Panier moyen » en référencé par, `impact: 2`.
9. Un identifiant d'espace inconnu ou un chemin contenant `..` renvoie 404.
10. Le serveur sans token refuse de démarrer ; avec un token, une requête sans en-tête ou avec un mauvais token renvoie 401.
11. Une divergence d'historique au `sync` renvoie `sync_conflict`, sans modifier le clone.

## Tests
- Unitaires : disposition, index (construction et recherche), versions.
- Intégration : dépôts Git temporaires (fixtures pytest qui créent un dépôt nu « distant » et un clone) ; API via `TestClient`.
- À la main : lancer `uv run skifer-atlas-server`, puis appeler les routes avec `curl` et le token.

## Dépendances
0001, 0002.

## Estimation
**M**. Incertitudes : comportement de git selon les postes clients (proxy, certificats d'entreprise) ; performance de l'index sur quelques milliers de documents (cible : reconstruction < 5 s).
