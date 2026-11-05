# Plan 0033 — Rattacher un espace neuf à un dépôt vide

## Objectif

Une personne qui crée un espace sans dépôt distant le rattache ensuite, depuis l'interface, à un dépôt vide de GitHub (ou à tout dépôt Git vide), sans quitter Atlas ni toucher à Git. Le créateur garde son rôle de référent, la gouvernance s'enregistre, et les connexions aux plateformes (plan 0008) deviennent utilisables.

## Périmètre

**Dedans** : écran « Dépôt Git de l'espace » de l'Administration (connexion GitHub par le device flow du plan 0025, saisie de l'adresse, rattachement, états de chargement, d'erreur et de succès) ; même rattachement dans le panneau de création quand l'adresse saisie à la création est refusée ; route `POST /api/workspaces/{ws}/remote` et ses codes d'erreur ; vérification que le dépôt est vide et que le compte peut y écrire ; conservation du rôle du créateur ; invitations à rattacher dans Connexions.

**Dehors** : rattacher un dépôt qui contient déjà un historique (c'est l'adhésion, plan 0005, ou une décision séparée), créer le dépôt sur GitHub, changer ou retirer le dépôt d'un espace déjà rattaché, protéger la branche ou poser les règles Code Owners sur GitHub (plan 0017), rafraîchir un jeton GitHub à durée limitée.

## Références

Brief §4, §9 et §10.4 ; plans 0005 (espaces et dépôt Git), 0006 (propositions), 0008 (connexions), 0017 (administration), 0025 (jeton GitHub au coffre) et 0032 ; ADR 0029 (jeton GitHub) et 0037 (cette décision). Issue #137, contexte dans #112.

## Spécification

### Route

`POST /api/workspaces/{ws}/remote`, corps `{"remote_url": "<adresse>"}` (champs inconnus refusés). La route existait déjà, sans vérification ; elle vit maintenant dans `api/routes/workspaces.py`. Réponse 200 : l'espace tel que les autres routes le rendent, avec ses champs `git_remote`, `account`, `role`, `role_label` et `space_referent` mis à jour.

```json
{
  "id": "perrault",
  "name": "Perrault",
  "sector": "Distribution",
  "git_remote": "https://github.com/nordis/perrault.git",
  "account": "claire-m",
  "role": "referent",
  "domains": ["finance"],
  "entities": ["fr"],
  "synced_at": "",
  "role_label": "Référent",
  "space_referent": true
}
```

`account` est le compte de l'hébergeur (le login GitHub), plus l'identité locale d'avant ; `role` et `role_label` sont relus dans la gouvernance sous ce compte.

### Ordre des vérifications

Rien n'est écrit dans le clone ni sur le serveur tant que toutes les vérifications ne sont pas passées.

1. L'espace existe et n'a pas de dépôt distant (`remote_exists`). `HEAD` du clone est la branche principale, sinon `wrong_branch` : l'avance rapide finale ne doit faire avancer que cette branche (après un `git checkout` fait à la main, par exemple).
2. L'adresse est acceptable (`invalid_remote`, `credentials_in_url`) et l'hébergeur est connu (`unsupported_host`). Un `origin` déjà présent est comparé à l'adresse, à l'écriture équivalente près (`origin_conflict` sinon, adresse trouvée montrée sans identifiant) : contrôle local, avant tout appel réseau.
3. Pour GitHub : un jeton est au coffre pour l'espace, ou dans `ATLAS_GITHUB_TOKEN` (`host_auth_failed` sinon). `GET /user` donne le compte ; `GET /repos/<propriétaire>/<dépôt>` dit si le dépôt existe (`remote_not_found`), n'est pas archivé et laisse pousser (`remote_not_writable`).
4. `governance.yaml` n'a aucun changement local, enregistré ou non dans l'index (`workspace_dirty`), qu'un compte soit à réécrire ou non (le contrôle précède la lecture de la gouvernance, qui est alors celle du commit publié) ; un conflit non résolu ou une fusion, un cherry-pick, un revert ou un rebase en cours est refusé de même (`workspace_dirty`). L'avance rapide qui suit le push réécrirait ce fichier ; sale, elle échouerait après la publication, et le dépôt distant serait rempli pendant que l'espace resterait local. Un autre fichier modifié ne bloque pas.
5. `git ls-remote --refs -- <adresse>` vérifie les références. Un dépôt vide ou une publication locale reconnaissable peut être rattaché ; les autres sont refusés (`remote_not_empty` ou `remote_partial`, voir ADR 0037). Les erreurs de connexion sont classées par leur sortie.

### Écriture

1. Si le créateur est inscrit dans `governance.yaml` sous l'ancienne identité locale, un commit dédié, « Identité du créateur : `<ancien>` devient `<nouveau>` », réécrit son compte (membres, référents et validateurs de domaine). Il est basé explicitement sur `refs/heads/<branche principale>` et créé sans toucher à l'arbre de travail ni à l'index.
2. `origin` est ajouté, puis la branche principale (avec ce commit) est poussée. Si le push échoue sans confirmation, l'erreur est classée et un `origin` nouvellement ajouté est retiré. Si le serveur a accepté le push, ou si une étape ultérieure échoue, le dépôt peut rester publié et le rattachement se reprend selon l'ADR 0037 ; une étape locale qui échoue après le push donne `attach_incomplete`, sans la sortie de git.
3. Après le push seulement : avance rapide locale sur le commit d'identité, branche suivie, registre mis à jour (`git_remote`, `account`, rôle relu dans la gouvernance).

### Codes d'erreur

| Code | HTTP | Cas |
|---|---|---|
| `not_found` | 404 | espace inconnu |
| `remote_exists` | 409 | l'espace a déjà un dépôt distant |
| `origin_conflict` | 409 | `origin` existe avec une adresse différente (à l'écriture équivalente près : `.git` ou `/` final, casse de l'hôte) ou une configuration incomplète ; le message montre l'adresse trouvée, identifiant masqué ; contrôle local, avant tout appel réseau |
| `remote_partial` | 409 | publication partielle reconnue, mais compte changé, clone divergé (`--amend`, `reset`) ou évolué, ou branche distante changée pendant la vérification ou pendant le rattachement |
| `attach_incomplete` | 409 | le dépôt est publié, mais une étape locale a échoué après le push (fetch, fusion, branche suivie, gouvernance, registre) : un nouvel essai termine le rattachement |
| `remote_not_empty` | 409 | le dépôt a des branches ou des tags, ou en a reçu pendant le push |
| `wrong_branch` | 409 | une autre branche (ou `HEAD` détachée) est extraite dans le clone : revenir sur la branche principale |
| `workspace_dirty` | 409 | `governance.yaml` a des modifications locales non enregistrées dans le clone : à enregistrer ou annuler avant de rattacher |
| `invalid_remote` | 422 | adresse mal formée, ou chemin local hors tests |
| `credentials_in_url` | 422 | identifiants dans l'adresse |
| `unsupported_host` | 422 | hébergeur sans prise en charge |
| `remote_not_found` | 422 | dépôt inexistant, ou compte sans accès |
| `remote_not_writable` | 422 | lecture seule, dépôt archivé, branche protégée |
| `host_auth_failed` | 502 | pas de jeton GitHub, jeton refusé |
| `host_unreachable` | 502 | hébergeur injoignable |
| `push_failed` | 502 | refus du push sans cause reconnue |

La sortie brute de git ne remonte jamais à l'API ; elle sert seulement à classer l'erreur.

### Interface

- **Administration** : sans dépôt distant, le titre « Dépôt Git de l'espace » est suivi de « Cet espace n'a pas encore de dépôt distant » et du groupe « Rattacher un dépôt distant ». Le champ « Adresse du dépôt vide » accepte l'entrée au clavier ; « Rattacher le dépôt » est désactivé pendant l'envoi (« Vérification du dépôt, puis envoi de l'espace… »). Pour une adresse GitHub, l'état de la connexion est affiché (« Connecté à GitHub en tant que @login. », ou le bouton de connexion du plan 0025) et le bouton reste désactivé tant qu'aucune connexion n'existe. Une erreur s'affiche dans une bannière, avec le texte propre à son code, et le formulaire reste utilisable. Le succès affiche « Dépôt rattaché : l'espace est publié sur <adresse>, sous le compte <compte>. » et rouvre l'enregistrement de la gouvernance, désactivé tant que l'espace est local. Les modifications non enregistrées de la page sont gardées à travers le rattachement : le brouillon passe dans le parent d'`Administration`, le compte du créateur y est réécrit comme sur le serveur (jamais deux membres fusionnés), et le formulaire remonté le reprend ; si le login GitHub figure déjà dans le brouillon comme un autre membre, le brouillon est abandonné avec un avertissement (« Vos modifications non enregistrées n'ont pas été reprises… »), sans fusion de rôles ; l'enregistrement part avec la base relue. Une modification de domaine ou de membre encore ouverte n'est pas dans le brouillon : « Rattacher le dépôt » est alors désactivé (Entrée aussi), avec « Validez ou annulez la modification en cours avant de rattacher le dépôt. »
- **Création** : si l'adresse saisie à la création est refusée, l'espace reste créé et le même groupe s'ouvre dans le panneau, adresse préremplie, au lieu d'une impasse.
- **Connexions** : l'invitation « Configurer les plateformes » renvoie vers l'Administration quand l'espace n'a pas de dépôt.

## Critères d'acceptation

1. Depuis l'Administration d'un espace local, saisir l'adresse d'un dépôt Git vide et rattacher envoie la branche principale au dépôt et inscrit l'adresse dans l'espace ; l'enregistrement de la gouvernance, fermé jusque-là, s'ouvre.
2. Chaque refus dit pourquoi, sans rien écrire : adresse invalide, dépôt absent, dépôt avec une branche ou un tag, dépôt introuvable, en lecture seule ou archivé. Avant publication, aucune modification n'est conservée ; après publication, `origin` et la branche peuvent subsister pour permettre la reprise.
3. Une adresse GitHub demande d'abord la connexion de l'espace (device flow) ; sans elle, aucune requête de rattachement ne part. Une adresse hors GitHub n'en demande aucune.
4. Après le rattachement à GitHub, le créateur reste référent : son compte est réécrit dans la gouvernance sous son login GitHub, par un commit identifiable présent sur le dépôt et dans le clone.
5. Une adresse refusée à la création d'un espace mène au même rattachement dans le panneau de création, sans quitter le panneau.
6. L'espace rattaché peut enregistrer sa gouvernance (autoriser une plateforme, par exemple) : le référent est reconnu, et la proposition est fusionnée.
7. Les connexions aux plateformes deviennent utilisables sur l'espace rattaché : créer une connexion, l'authentifier, la tester et proposer son point d'accès.
8. Les modifications de la gouvernance faites avant le rattachement ne sont pas perdues : le brouillon (plateformes, validateurs, membres) reste à l'écran, le compte du créateur y est réécrit comme sur le serveur, et il s'enregistre ensuite sur la base relue. Tant qu'un domaine ou un membre est en cours de modification (valeurs pas encore dans le brouillon), le rattachement est suspendu ; pendant la requête et jusqu'à la fin du rechargement de l'administration, le reste du formulaire est gelé ; si la relecture échoue, il le reste, avec une bannière d'erreur et « Réessayer ».
9. Avec un compte GitHub réel, un dépôt vide, créé sans README, reçoit l'espace et le créateur y reste référent (à la main : le faux GitHub ne prouve pas le comportement de l'hébergeur).

## Tests

- Core : `core/tests/repo/test_set_remote.py` (114 cas de test) couvre le succès sur un dépôt nu vide et par la route, les dépôts non vides (commit, autre branche, tag seul), le chemin absent, les adresses invalides et d'hébergeur inconnu, le second rattachement, l'espace inconnu, le hook qui refuse le push, une gouvernance modifiée localement (refus `workspace_dirty` avant toute écriture distante : dépôt nu vide, pas d'`origin`, état inchangé), une modification locale qui retire le compte local (refusée aussi), une autre branche extraite ou une `HEAD` détachée (`wrong_branch`, mêmes garanties), la course (dépôt rempli entre la vérification et le push), GitHub sans connexion ou avec jeton refusé, introuvable, lecture seule, archivé, la réécriture du créateur et son rôle relu (`open_context`), le jeton du coffre, la gouvernance intacte après un push refusé, les codes HTTP, `rename_account`, et l'autorisation de Databricks après rattachement. Un faux GitHub (`core/tests/connections/fake_github.py`) répond à `/repos/<propriétaire>/<dépôt>`. Les adresses `https://github.com/…` sont redirigées vers des dépôts nus locaux par `url.<dir>.insteadOf`.
- Interface : `app/src/screens/Rattachement.test.tsx` (23 tests, dont le brouillon gardé, le rattachement suspendu pendant une modification et le formulaire gelé pendant la requête et le rechargement, relecture en échec puis « Réessayer », brouillon abandonné en cas de collision de compte) et `app/src/screens/Home.test.tsx` rendent le groupe contre un faux serveur.
- Parcours : `app/e2e/rattachement.spec.ts` (3 tests, scénarios S-0033-01 à S-0033-08 ; le S-0033-09 est à la main, dans `docs/tests/scenarios.md`) sur un espace isolé : dépôt local puis fausse API GitHub avec device flow, dépôts nus locaux et vérification des commits dans le dépôt.
- Aucun test ne touche `~/Library/Application Support/skifer-atlas` ni le vrai trousseau (`ATLAS_DATA_DIR`, `ATLAS_VAULT=memory`).

## Dépendances

0005, 0006, 0008, 0017, 0025 et 0032.

## Estimation

**M**.

## Mise en œuvre (4 novembre 2026)

Livré :

- 5 novembre 2026 : reprise idempotente après publication ambiguë ou échec ultérieur, selon le complément de l’ADR 0037 (issue #140).
- 5 novembre 2026, suivi de l'issue #143 (ADR 0037, dernier complément) :
  - `remote_partial` « Clone divergé » quand le parent du commit d'identité n'est plus ancêtre de la tête locale (`--amend`, `reset`), au lieu de `remote_not_empty` ;
  - fetch d'inspection filtré (`--filter=blob:limit=1k`, `origin` nommé dans le dépôt temporaire, repli sans filtre) et contenu du commit d'identité comparé par identifiant d'objet (`ls-tree` et `hash-object`), sans lire de blob ;
  - `origin` comparé après `normalize_remote_url` (`repo/git.py`) et contrôlé avant tout appel réseau ; `origin_conflict` montre l'adresse trouvée, identifiant masqué par `mask_remote_url` ; pas de route de remise à zéro (plan à part) ;
  - `attach_incomplete` (409) pour toute étape qui échoue après la publication, traduit dans `app/src/messages.ts` (`origin_conflict` et `remote_partial` y montrent le message du serveur) ;
  - tests : dossier temporaire supprimé, y compris sur erreur ; `origin` conforme conservé après un push refusé ; push non rapide jamais forcé ; `origin_conflict` sans appel réseau ; secret d'identifiant absent de la réponse ; chaque étape après le push, puis nouvel essai. `core/tests/repo/test_set_remote.py` compte maintenant 114 cas de test, `app/src/screens/Rattachement.test.tsx` 23.
- `core/src/skifer_atlas/repo/sync.py` : `set_remote` vérifie, puis `_attach` écrit (ordre ci-dessus) ; `_explain_git` classe la sortie de git ; `_require_empty` appelle `ls-remote`. `core/src/skifer_atlas/repo/git.py` : `RepoError.output` garde la sortie brute nettoyée, sans jamais la rendre. `core/src/skifer_atlas/githost/{base,github}.py` : `check_writable`. `core/src/skifer_atlas/governance/model.py` : `rename_account`. `core/src/skifer_atlas/api/routes/workspaces.py` : la route ; `api/app.py` : codes de rattachement et de reprise associés aux réponses HTTP.
- `app/src/components/AttachRemote.tsx` (groupe de rattachement, réutilisé par `Administration.tsx` et `CreateWorkspace.tsx`), `app/src/messages.ts`, `app/src/screens/Connections.tsx`, `app/src/styles.css` (jetons uniquement).
- Après la revue : refus `workspace_dirty` avant le push, et brouillon de l'Administration gardé à travers le rattachement, et rattachement suspendu tant qu'une modification de domaine ou de membre est ouverte et formulaire gelé pendant la requête (critère 8), refus `wrong_branch` avant le push, commit d'identité basé sur la branche principale.
- Décisions : ADR 0037 (réécriture de l'identité du créateur dans un commit poussé avec l'historique, dépôt vide vérifié par `ls-remote` et l'API de l'hébergeur, jeton exigé pour GitHub et reprise des publications partielles).
- Le test front a été écrit par un agent Claude, un scénario par critère (`docs/tests/scenarios.md`, plan 0033).
- Le sidecar n'a aucun import dynamique de plus : les imports tardifs de `_attach` sont des `import` ordinaires, que PyInstaller suit (`scripts/build-sidecar.sh` inchangé).

Non testable à l'écran, ou sans compte réel (voir « Sans test front, et pourquoi » dans `docs/tests/scenarios.md`) :

- Un push réel vers un dépôt GitHub vide, et la forme réelle de `permissions` dans `GET /repos/…` : le faux GitHub reproduit la forme documentée ; les restrictions d'organisation (SAML SSO, règles de branche par défaut) ne se voient qu'avec un compte réel.
- L'enregistrement de la gouvernance bout en bout sur un espace hébergé par le faux GitHub : il n'a ni pull requests ni fusion. Le core le vérifie avec l'hébergeur local ; le parcours e2e le fait sur un dépôt local, et le rôle sous l'identité GitHub est vérifié par `open_context`.
- Le trousseau système et la fenêtre native Tauri (déjà au « Reste à faire »).

Reste à faire :

- Dépôt GitHub de test : un rattachement réel à un dépôt vide, créé sans README (0033, critères 1 et 4).
- Course entre `ls-remote` et `push` (ADR 0037, limite acceptée) : un autre client qui crée une branche autre que la principale, ou un tag, entre les deux n'est pas détecté ; le push réussit sans rien écraser. Git n'a pas de vérification atomique « dépôt vide ».
- Message si GitHub refuse le push sur la branche par défaut à cause d'une règle de branche : il tombe aujourd'hui dans `remote_not_writable` ou `push_failed`, selon la sortie de git.

Limites relevées en chemin, hors du périmètre : sur un espace tout neuf, la première ouverture du catalogue peut répondre 500 (« Catalog write-write conflict », DuckDB), puis se rétablit au rechargement ; le test `test_validation_of_50_nodes_under_150_ms` échoue quand la machine est chargée.
