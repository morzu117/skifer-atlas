# Plan 0006 — Propositions (branche + PR) et gouvernance

> **Décisions du 30 octobre 2026** (Q8) : GitHub en premier, plus un hôte « dépôt local nu » pour les tests ; gouvernance dans `governance.yaml` ; validations décomptées sur les revues GitHub ; identité = compte GitHub ; `CODEOWNERS` généré depuis `governance.yaml` comme garde-fou côté GitHub.

## Objectif
Enregistrer une modification crée une branche, un commit et une pull request, avec la classification des écarts et la justification ; Atlas décompte les validations obtenues sur les validations requises selon `governance.yaml`, et la fusion pose le tag de version.

## Périmètre
**Dedans** : `governance.yaml` (schéma et validation) ; génération de `CODEOWNERS` ; interface `GitHost` et ses implémentations GitHub et locale ; création de proposition ; liste et détail des propositions ; commentaires ; approbation et demande de changements ; décompte ; fusion et tag ; règles « hors points déclarés » ; API.
**Dehors** : écrans (0014, 0017) ; notifications ; mode hébergé.

## Références
Brief 4.1 (validation légère contre canonique), 5.1, 5.2, 9 ; guide 10.4, 10.7 ; ADR 0005 ; plans 0002, 0003, 0005.
Fichiers : `core/src/skifer_atlas/governance/{model,rules}.py`, `githost/{base,github,local}.py`, `proposals/{create,status,merge}.py`, `api/routes/{proposals,governance}.py`.

## Spécification

### `governance.yaml`
```yaml
schema_version: 1
validators_required: {canonical: 2, variants: 1}        # entiers >= 1
domains:
  - id: finance
    label: Finance
    referents: [claire-m]
    validators: [claire-m, marc-d]
    validators_required: {canonical: 2, variants: 1}     # optionnel, surcharge par domaine
members:
  - account: claire-m            # identifiant sur l'hébergeur
    name: Claire M.
    entity: groupe
    roles: [{role: referent, domains: [finance]}]
allowed_platforms: [databricks, snowflake]
```
Règles : au moins un référent d'espace ; un domaine sans référent produit un avertissement (bandeau 10.7) ; les rôles ∈ {referent, validateur, contributeur, lecteur}.

### Nombre de validations requises pour une proposition
- Nouvelle version d'un canonique : `canonical` du domaine (ou de l'espace).
- Variante dont toutes les surcharges sont `declared` : `variants`.
- Variante avec au moins une surcharge `undeclared`, ou variante from scratch : `canonical`, avec la mention « validation canonique exigée ».
- Modification de `governance.yaml` : 1 référent d'espace, au minimum.
- Ne comptent que les approbations de comptes ayant le rôle `validateur` ou `referent` sur le domaine du document ; l'auteur ne compte jamais ; une approbation est invalidée par un nouveau commit sur la branche.
- Exception (ADR 0008) : si aucun autre compte n'est habilité à approuver la proposition, d'après le `governance.yaml` de la branche principale, l'auteur peut fusionner sans approbation. Le nombre requis n'est jamais abaissé : dès qu'un autre compte est habilité, le décompte normal s'applique. Une telle fusion porte la mention « Fusionnée sans revue : aucun autre compte habilité » et le trailer `Atlas-Review: none (no other eligible approver)`.

### `CODEOWNERS` généré (garde-fou côté GitHub)
`governance.yaml` reste l'unique source de vérité. À chaque proposition qui le modifie, Atlas régénère `.github/CODEOWNERS` dans la même branche : un domaine est un ensemble de fichiers (les documents dont `data_product.domain` vaut ce domaine, plus leurs variantes), auquel sont associés ses validateurs ; `governance.yaml` et `CODEOWNERS` sont associés aux référents de l'espace. Le fichier porte l'en-tête « généré par Atlas, ne pas modifier ». Un `CODEOWNERS` modifié à la main est signalé (`codeowners_drift`) au `sync`. L'écran d'administration (0017) rappelle d'activer, dès qu'il y a deux référents (ADR 0008), la règle de branche GitHub « Require review from Code Owners » : une fusion faite directement sur GitHub ne peut alors plus contourner les validateurs. Le nombre de validations requises, qui varie selon la nature de la proposition, reste décompté par Atlas.

### `GitHost`
`create_pull_request(branch, title, body) -> pr`, `list_pull_requests(state)`, `get_reviews(pr)`, `submit_review(pr, approve|request_changes, body)`, `list_comments(pr)`, `add_comment(pr, body)`, `merge(pr)`, `current_account()`. Le token de l'hébergeur est lu dans le coffre (plan 0008 ; d'ici là, variable d'environnement en dev) et passé à git par `GIT_ASKPASS`. `LocalHost` stocke les PR dans `refs/atlas/proposals/*` et un fichier JSON par PR dans le dépôt nu, pour les tests et les démos hors ligne.

### Création (`POST /api/workspaces/{ws}/proposals`)
Corps : `{document_yaml, justification, base_version}`. Étapes : validation (0001, 0002 ; refus en cas d'erreur) ; diff contre la base (0003) ; branche `prop/<id>-<entity|canonical>-<n>` ; commit signé de l'identité Git de l'utilisateur ; push ; PR dont le corps contient la justification et un bloc `atlas-proposal` JSON (relation, `base_version`, classification, compteurs) pour un affichage sans recalcul.
Un `base_version` qui n'est plus la version courante renvoie `stale_base` et ne crée rien.

### Statut et fusion
`GET /api/workspaces/{ws}/proposals?domain=&kpi=&author=&entity=&status=` → `[{id, document_id, entity, nature, author, created_at, approvals: {obtained, required}, ready_to_merge, merge_mode}]`, où `merge_mode` ∈ {reviewed, no_other_eligible} ; la `nature` ∈ {new_version, declared_point, undeclared, from_scratch}. Le tri met en tête les propositions des domaines de l'utilisateur courant. `POST …/merge` n'est accepté que si `ready_to_merge` : fusion, incrément de `data_product.version`, tag `doc/<id>/v<n>`, puis synchronisation et réindexation (0005).

## Critères d'acceptation
1. Une proposition sur un canonique de domaine Finance exige 2 validations ; une surcharge déclarée, 1 ; une surcharge non déclarée ou une variante from scratch, 2, avec la mention.
2. L'approbation de l'auteur, d'un contributeur, ou d'un validateur d'un autre domaine ne compte pas.
3. Un nouveau commit sur la branche remet le décompte à zéro.
4. La fusion pose le tag et incrémente la version ; la fiche (0005) montre la nouvelle version.
5. `stale_base` est renvoyé quand la base a avancé.
6. Une proposition invalide n'est jamais poussée.
7. Avec `LocalHost`, tout le cycle (créer, commenter, approuver deux fois, fusionner) passe sans réseau.
8. Avec GitHub, le même cycle passe sur un dépôt de test (test d'intégration marqué `github`, hors CI par défaut).
9. Le token de l'hébergeur n'apparaît ni dans l'URL distante, ni dans `.git/config`, ni dans les journaux.
10. `governance.yaml` sans référent est refusé ; un domaine sans référent produit un avertissement.
11. Modifier `governance.yaml` régénère `CODEOWNERS` dans la même proposition, de façon déterministe ; une modification manuelle de `CODEOWNERS` est signalée au `sync`.
12. Dans un espace à un seul référent, ce référent peut fusionner sans approbation une modification de `governance.yaml`, et l'unique compte habilité d'un domaine peut faire de même pour un document. La fusion porte la mention et le trailer. L'exception tombe dès qu'un deuxième habilité figure sur la branche principale, et une proposition qui retire les autres habilités n'en bénéficie pas.
13. Avec GitHub, si une règle de protection empêche la fusion, l'erreur est `branch_protected`, sans contournement.

## Tests
- Unitaires : règles de décompte (table de cas), validation de `governance.yaml`.
- Intégration : cycle complet sur `LocalHost` ; client GitHub contre un faux serveur HTTP (réponses enregistrées) ; test réel optionnel.
- À la main : créer une proposition par `curl`, puis la voir sur GitHub.

## Dépendances
0003, 0005.

## Estimation
**L**. Incertitudes : choix de l'hébergeur ; protections de branche côté client ; fusion faite hors d'Atlas (sur l'hébergeur) à rattraper au `sync` (pose du tag par Atlas a posteriori).

## Mise en œuvre (30 octobre 2026)
- **Paquets** (`core/src/skifer_atlas/`) :
  - `governance/` :
    - `model.py` porte le schéma de `governance.yaml` (pydantic, `extra="forbid"`), ses contrôles de cohérence et les rôles ;
    - `rules.py` porte le nombre requis et le décompte (`decide`), ADR 0008 compris ;
    - `codeowners.py` génère `CODEOWNERS` et détecte une retouche manuelle.
  - `githost/` :
    - `base.py` déclare l'interface `GitHost`, implémentée par `github.py` (API REST, `urllib`, pagination) et par `local.py` (`LocalHost`) ;
    - `host_for(url)` choisit l'hôte : une adresse GitHub donne GitHub, un chemin ou `file://` donne `LocalHost`, toute autre adresse donne `unsupported_host`.
  - `proposals/` : `common.py` (contexte, bloc `atlas-proposal`, plomberie Git), `create.py`, `status.py` et `merge.py`.
  - `api/routes/` : `proposals.py` et `governance.py`.
  
  Les choix qui s'écartent du plan, ou qu'il ne fixait pas, sont dans l'**ADR 0009** : version fixée à la création, union des rôles, demande de changements bloquante, forme de `CODEOWNERS`, jeton par assistant d'identification, identité.
- **`governance.yaml`** :
  - erreurs : `no_referent`, `unknown_member`, `unknown_domain`, `duplicate_member` et `duplicate_domain`, plus les erreurs de schéma (`validators_required` ≥ 1, rôles et plateformes connus, comptes au format GitHub) ;
  - avertissement : `domain_without_referent`, qui alimente le bandeau 10.7 ;
  - la démonstration (`examples/espace-nordis/`) passe au format complet, avec membres et rôles. Marketing y reste sans référent, et sert à montrer l'avertissement ;
  - la création d'un espace écrit une gouvernance où le créateur est seul référent d'espace. Le registre local lit désormais le compte, le rôle et les domaines dans `governance.yaml`, à l'adhésion comme à chaque `sync`.
- **Création** :
  - la proposition part de `origin/<main>`, après une synchronisation ;
  - le commit est construit sans toucher à la copie de travail, avec un index temporaire, puis l'arbre proposé est extrait dans un dossier temporaire ;
  - ce dossier est contrôlé comme un clone (plans 0002 et 0005), avec les tags du dépôt pour les versions antérieures ;
  - une erreur donne `invalid_document`, avec ses diagnostics, et rien n'est poussé ;
  - la nature se déduit du document (`new_version`, `declared_point`, `undeclared`, `from_scratch`). Le domaine d'une variante est celui de son KPI ;
  - le diff (plan 0003) se calcule contre la version courante pour un canonique, contre le canonique désigné pour une variante. Il est plafonné à 200 écarts dans le bloc ;
  - les branches : `prop/<id>-canonical-<n>`, `prop/<kpi>-<entité>-<n>` ou `prop/governance-<n>`. Le rang `n` est le premier libre sur le distant.
- **Rôles requis** :
  - proposer un document : au moins `contributeur` (sinon `forbidden`, 403) ;
  - proposer une gouvernance : référent d'espace ;
  - approuver : tout compte peut le faire, mais seuls les habilités comptent. Avec les deux hôtes, l'auteur ne peut pas approuver sa propre proposition (`cannot_review_own`).
- **Routes** (préfixe `/api/workspaces/{ws}`) :
  - `GET /proposals` (filtres `domain`, `kpi`, `author`, `entity` ; `status` vaut `open`, `merged`, `closed` ou `all`) ;
  - `POST /proposals` (201) et `GET /proposals/{n}` ; le détail ajoute la justification, le bloc, les revues (`outdated` si elles portent sur un ancien commit), les commentaires et le YAML proposé ;
  - `POST /proposals/{n}/comments` (201), `POST /proposals/{n}/reviews` (`approve` ou `request_changes`) et `POST /proposals/{n}/merge` ;
  - `GET /governance`, qui donne la gouvernance, ses diagnostics, le compte, le rôle et `single_referent` pour le bandeau de l'ADR 0008 ;
  - `POST /governance` (201) crée une proposition de gouvernance ;
  - `POST /remote` rattache un dépôt distant à un espace créé localement, et pousse la branche principale. Le plan 0017 en aura besoin.
- **Décompte** : il est recalculé à chaque lecture, avec la gouvernance de la branche principale. Une règle qui change s'applique donc aux propositions déjà ouvertes. `merge_mode` vaut `reviewed` ou `no_other_eligible` ; `explanation` dit ce qui manque.
- **Fusion** :
  - Atlas revérifie le décompte sur la tête de branche et la base ;
  - la fusion est un commit `--no-ff`, qui porte les trailers `Atlas-Proposal: #n` et `Atlas-Review` ;
  - le tag `doc/<id>/v<n>` est posé sur ce commit et poussé, puis l'espace est synchronisé et réindexé ;
  - avec `LocalHost`, la fusion se fait dans un clone temporaire du dépôt nu. Avec GitHub, elle passe par `PUT …/merge` avec le `sha` décompté : une tête qui a bougé donne `head_changed`.
- **API**, codes ajoutés :
  - 403 : `forbidden` ;
  - 409 : `stale_base`, `not_ready`, `not_open`, `head_changed`, `merge_conflict`, `merge_refused`, `branch_protected` ;
  - 422 : `invalid_document`, `invalid_governance`, `cannot_review_own`, `host_rejected`, `unsupported_host` ;
  - 502 : `push_failed`, `host_auth_failed`, `host_forbidden`, `host_unreachable`, `host_failed`.
  
  Une erreur qui a des diagnostics les rend dans `detail.issues`.
- **Variables d'environnement** :
  - `ATLAS_GITHUB_TOKEN` porte le jeton GitHub, d'ici le coffre du plan 0008 ;
  - `ATLAS_GITHUB_API_URL` désigne GitHub Enterprise ou un faux serveur ;
  - `ATLAS_ACCOUNT` donne l'identité avec `LocalHost`.
- **Tests** (`core/tests/repo/`) :
  - `test_governance.py` : schéma, rôles, table des nombres requis, décompte, ADR 0008 et `CODEOWNERS` ;
  - `test_proposals.py` : cycle complet par l'API sur `LocalHost`, avec changement de membre par `ATLAS_ACCOUNT` ;
  - `test_githost.py` : client GitHub contre un faux serveur HTTP (`ThreadingHTTPServer`, pagination, erreurs) et hygiène du jeton ;
  - le test réel est marqué `github` et ne tourne que si `ATLAS_GITHUB_TEST_REPO` et `ATLAS_GITHUB_TOKEN` sont définis. Il se limite à la lecture. Le cycle complet sur GitHub, avec deux comptes, reste à jouer à la main (critère 8) ;
  - les treize critères sont couverts, le 8 en partie seulement.
- **À la main** : sur la démonstration, avec `curl` et le serveur relancé sous trois comptes (`ATLAS_ACCOUNT`), on a enchaîné adhésion, proposition, deux approbations et fusion. Le commit de fusion porte `Atlas-Review: approved by claire.m, marc.d`, le tag `doc/revenu-net/v5` est posé et la fiche montre la v5.
- **Reste à faire** :
  - poser le tag au `sync` quand une PR a été fusionnée directement sur GitHub ;
  - ajouter une route de révision d'une proposition, si l'écran 0014 en a besoin ;
  - remplacer `ATLAS_GITHUB_TOKEN` par le coffre (plan 0008).
