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

### `CODEOWNERS` généré (garde-fou côté GitHub)
`governance.yaml` reste l'unique source de vérité. À chaque proposition qui le modifie, Atlas régénère `.github/CODEOWNERS` dans la même branche : un domaine est un ensemble de fichiers (les documents dont `data_product.domain` vaut ce domaine, plus leurs variantes), auquel sont associés ses validateurs ; `governance.yaml` et `CODEOWNERS` sont associés aux référents de l'espace. Le fichier porte l'en-tête « généré par Atlas, ne pas modifier ». Un `CODEOWNERS` modifié à la main est signalé (`codeowners_drift`) au `sync`. L'écran d'administration (0017) rappelle d'activer la règle de branche GitHub « Require review from Code Owners » : une fusion faite directement sur GitHub ne peut alors plus contourner les validateurs. Le nombre de validations requises, qui varie selon la nature de la proposition, reste décompté par Atlas.

### `GitHost`
`create_pull_request(branch, title, body) -> pr`, `list_pull_requests(state)`, `get_reviews(pr)`, `submit_review(pr, approve|request_changes, body)`, `list_comments(pr)`, `add_comment(pr, body)`, `merge(pr)`, `current_account()`. Le token de l'hébergeur est lu dans le coffre (plan 0008 ; d'ici là, variable d'environnement en dev) et passé à git par `GIT_ASKPASS`. `LocalHost` stocke les PR dans `refs/atlas/proposals/*` et un fichier JSON par PR dans le dépôt nu, pour les tests et les démos hors ligne.

### Création (`POST /api/workspaces/{ws}/proposals`)
Corps : `{document_yaml, justification, base_version}`. Étapes : validation (0001, 0002 ; refus en cas d'erreur) ; diff contre la base (0003) ; branche `prop/<id>-<entity|canonical>-<n>` ; commit signé de l'identité Git de l'utilisateur ; push ; PR dont le corps contient la justification et un bloc `atlas-proposal` JSON (relation, `base_version`, classification, compteurs) pour un affichage sans recalcul.
Un `base_version` qui n'est plus la version courante renvoie `stale_base` et ne crée rien.

### Statut et fusion
`GET /api/workspaces/{ws}/proposals?domain=&kpi=&author=&entity=&status=` → `[{id, document_id, entity, nature, author, created_at, approvals: {obtained, required}, ready_to_merge}]` ; la `nature` ∈ {new_version, declared_point, undeclared, from_scratch}. Le tri met en tête les propositions des domaines de l'utilisateur courant. `POST …/merge` n'est accepté que si `ready_to_merge` : fusion, incrément de `data_product.version`, tag `doc/<id>/v<n>`, puis synchronisation et réindexation (0005).

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

## Tests
- Unitaires : règles de décompte (table de cas), validation de `governance.yaml`.
- Intégration : cycle complet sur `LocalHost` ; client GitHub contre un faux serveur HTTP (réponses enregistrées) ; test réel optionnel.
- À la main : créer une proposition par `curl`, puis la voir sur GitHub.

## Dépendances
0003, 0005.

## Estimation
**L**. Incertitudes : choix de l'hébergeur ; protections de branche côté client ; fusion faite hors d'Atlas (sur l'hébergeur) à rattraper au `sync` (pose du tag par Atlas a posteriori).
