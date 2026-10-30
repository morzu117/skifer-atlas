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
## Mise en œuvre (30 octobre 2026)
- **Paquets** :
  - `core/src/skifer_atlas/repo/` :
    - `layout.py` porte `WorkspaceMeta` (`atlas.yaml`), `Governance` (les seuls `domains` et `referents`) et l'inventaire des documents ;
    - `git.py` porte `run_git`, `RepoError` et le contrôle des URL ;
    - `sync.py` crée, rejoint et synchronise ;
    - `versions.py` gère les tags.
  - `core/src/skifer_atlas/index/` : `schema.py`, `build.py`, `search.py`.
  - `core/src/skifer_atlas/api/routes/` : `workspaces.py`, `catalog.py` et `common.py` (contrôles 404).
  
  Les choix propres à l'index (identifiant d'une variante, statuts, versions résolues, convergence) sont décidés dans l'**ADR 0007**.
- **Emplacements** :
  - `paths.data_dir()` accepte `ATLAS_DATA_DIR`, pour les tests et la démonstration ;
  - le clone est dans `workspace_dir(id)/repo`, l'index dans `workspace_dir(id)/atlas.duckdb` ;
  - `workspace_dir` refuse tout identifiant qui n'est pas un slug.
- **Git** :
  - `run_git` passe `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1` et `LC_ALL=C`, avec un délai de 120 s ;
  - une URL `http(s)` qui porte un identifiant donne `credentials_in_url`, une URL qui commence par `-` donne `invalid_remote` ;
  - le clone passe `--` avant l'URL et `--no-recurse-submodules`.
- **Création** :
  - le créateur est le `user.name` de Git, à défaut « referent » ;
  - le registre local le note `referent` ;
  - un échec efface le dépôt à moitié créé.
- **Adhésion** :
  - le clone se fait d'abord dans un dossier temporaire sous `data_dir()`. On y lit `atlas.yaml` : absent ou invalide, c'est `invalid_workspace`. Le clone n'est déplacé dans `workspace_dir(id)/repo` qu'ensuite ;
  - le rôle est `lecteur` jusqu'au plan 0006, qui le lira dans `governance.yaml` ;
  - un espace déjà présent donne `workspace_exists`.
- **Synchronisation** :
  - `fetch --prune`, puis comparaison de `HEAD` et de `origin/<main_branch>`. Le résultat est `up_to_date`, `ahead` (commits locaux non poussés), `fast_forward` (avec `merge --ff-only`) ou `sync_conflict` ;
  - un espace sans dépôt distant (créé localement) donne `no_remote` ;
  - nom, secteur, entités et domaines du registre sont relus après une avance rapide.
- **Index** :
  - une table `index.documents` a, en plus du plan, une colonne `issues` (JSON des diagnostics) ;
  - `index.variants` a une colonne `kpi_version` ;
  - `built_at` est un `TIMESTAMP` UTC : un `TIMESTAMPTZ` exigerait `pytz` à la lecture ;
  - la reconstruction se fait dans une transaction (`DROP SCHEMA index CASCADE`, puis recréation), sous un verrou par base ;
  - les routes de lecture appellent `ensure_index`, qui reconstruit si `HEAD` a changé.
- **Recherche** :
  - c'est `contains(lower(strip_accents(…)))` en SQL sur le libellé, l'identifiant, les synonymes (joints par le caractère 0x1F, pour qu'aucune correspondance ne se fasse à cheval sur deux synonymes) et la description ;
  - rang 0 pour le libellé ou l'identifiant, 1 pour les synonymes, 2 pour la description, puis ordre alphabétique du libellé ;
  - le catalogue rend aussi `owner`, `status`, `description` et `synonyms`, dont le panneau d'aperçu aura besoin (plan 0011).
- **Dépendances** : `references` et `referenced_by` sont directes ; `impact` compte les documents qui dépendent du document, directement ou non (CTE récursive). Variantes comprises : une variante `from_scratch` dépend de ses `concepts`.
- **Fiche** : `GET …/documents/{id}` rend la ligne d'index, les diagnostics, le YAML du fichier et, pour un KPI, ses variantes (`variant` pour une variante). `versions/{n}` rend `{version, commit, date, author, message, id, content}`. Pour une version non taguée, la réponse est 404.
- **API** :
  - une erreur métier répond `{"detail": {"code", "message"}}`. Le statut HTTP dépend du code :
    - 404 : `not_found` ;
    - 409 : `workspace_exists`, `sync_conflict` ;
    - 422 : `credentials_in_url`, `invalid_remote`, `invalid_workspace`, `no_remote` ;
    - 502 : `clone_failed`, `fetch_failed`, `git_failed` ;
    - 503 : `git_missing` ;
    - 504 : `git_timeout`.
  - `POST /api/workspaces` attend `{id, name, sector, entities}` (et, en option, `main_branch`). Tout autre champ est refusé : l'ancien corps, qui posait directement le rôle, n'est plus accepté.
- **Token** :
  - `create_app(token=None)` garde le token dans `app.state`, lu par défaut dans `ATLAS_TOKEN`. Sans token et sans `ATLAS_DEV_NO_TOKEN=1`, toute route protégée répond 401 : on ferme par défaut ;
  - `server.main` sort avec le code 2 et un message sur la sortie d'erreur. Le mode dev est documenté dans le README racine et dans `core/README.md`.
- **YAML** : `model.io.read_yaml` utilise libyaml (`CSafeLoader`) quand il est là, et ne compose plus le document qu'une fois. Les contrôles d'alias, d'ancres, de balises et de clés répétées restent les mêmes. La reconstruction de 1 000 documents est passée de 3,5 s à environ 1 s.
- **Tests** :
  - `core/tests/repo/` contient `test_workspace_repo.py`, `test_index.py` et `test_catalog_api.py`. Les fixtures (`workspace_helpers.py`) créent un dépôt nu « distant » à partir de `examples/espace-nordis`, avec les tags `doc/revenu-net/v3`, `v4` et `doc/commande/v5`, et isolent Git du poste (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_COUNT`) ;
  - `core/tests/test_api.py` couvre le critère 10 ;
  - les onze critères sont couverts ;
  - banc d'essai : 1 000 documents reconstruits en 1,3 s environ (MacBook, Apple Silicon). Le test échoue au-delà de 5 s.
- **Démonstration** : `examples/espace-nordis/` (voir son README) contient sept concepts et KPI et trois variantes de Revenu net, avec des surcharges et une variante `from_scratch`.
- **À la main** : `skifer-atlas-server` sans token sort en 2. Avec un token, l'adhésion au dépôt nu, la recherche « ca net », les dépendances et les versions ont été vérifiées avec `curl`. Le comportement de Git derrière un proxy ou des certificats d'entreprise reste à éprouver sur un poste client.
