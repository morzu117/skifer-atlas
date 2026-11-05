# Plan 0034 — Réinitialiser le rattachement d'un espace resté local

## Objectif

Une personne dont le rattachement à un dépôt (plan 0033) a été interrompu remet, depuis l'interface, la copie locale de l'espace dans l'état d'un espace neuf, prête à être rattachée à n'importe quelle adresse, sans toucher au dépôt distant ni perdre un commit ni son rôle de référent.

## Périmètre

**Dedans** : route `POST /api/workspaces/{ws}/remote/reset` ; retrait d'`origin` (adresses et adresses d'envoi comprises), des références `refs/remotes/origin/*`, du suivi de branche et des restes d'inspection ; commit d'identité du créateur défait en local ; gardes, verrou du clone, codes d'erreur ; action « Réinitialiser le rattachement » dans le groupe de rattachement (Administration et panneau de création), avec sa confirmation.

**Dehors** : toute écriture sur le dépôt distant (push, suppression de branche ou de dépôt : il se vide à la main sur l'hébergeur) ; détacher un espace déjà rattaché (`git_remote` renseigné) ; changer l'adresse d'un espace rattaché ; modifier le registre local ; résoudre à la place de l'utilisateur une divergence de son clone ; réinitialiser depuis la ligne de commande.

## Références

Brief §4, §9 et §10.7 ; plans 0005 (espaces et dépôt Git), 0017 (administration) et 0033 (rattacher un dépôt) ; ADR 0035 (un fetch à la fois par clone), 0037 (rattacher un dépôt vide, reprise et suivi de #143) et 0038 (cette décision). Fichiers : `core/src/skifer_atlas/repo/reset_remote.py` (nouveau), `repo/sync.py` (gardes réutilisées), `api/routes/workspaces.py`, `app/src/components/AttachRemote.tsx`.

## Spécification

### Route

`POST /api/workspaces/{ws}/remote/reset`, sans corps, derrière le contrôle de token comme le reste de l'API. Réponse 200, l'espace tel que les autres routes le rendent (il reste local : `git_remote` vide, `account` et `role` inchangés), plus la clé `reset` :

```json
{
  "id": "perrault",
  "git_remote": "",
  "account": "anna.k",
  "role": "referent",
  "reset": { "status": "reset", "identity_reverted": true, "reverted_account": "claire-m" }
}
```

- `reset.status` vaut `reset` quand le clone a changé, `nothing_to_do` quand il n'y avait rien à défaire : le second appel d'une réinitialisation, ou un espace jamais rattaché. C'est un succès (200), pas une erreur : l'appel est idempotent.
- `identity_reverted` et `reverted_account` disent que la gouvernance locale a changé : le compte de l'hébergeur que le commit d'identité y avait inscrit (`reverted_account`) est redevenu le compte local du registre. L'écran s'en sert pour relire la gouvernance.
- Un espace rattaché (`git_remote` renseigné) est refusé en `remote_exists` (409), avec un message propre : « Cet espace est rattaché à son dépôt distant : Atlas ne le détache pas. Rien n'a été modifié. » Le registre est relu sous le verrou du clone : un rattachement qui vient de finir est vu.
- Pourquoi `POST …/remote/reset` et non `DELETE …/remote` : `DELETE` dit « retirer le dépôt de l'espace », exactement ce que cette route refuse pour un espace rattaché. L'action nomme ce qu'elle fait : elle remet le clone à zéro. Voir l'ADR 0038.

### Effet local uniquement

Aucune commande réseau : ni `push`, ni `fetch`, ni `ls-remote`, ni `clone`, ni appel à l'API de l'hébergeur, ni lecture du coffre. La réinitialisation marche hors ligne, et même quand le dépôt distant a disparu. Le dépôt distant garde ce qu'il a reçu (publication partielle comprise) ; l'utilisateur le vide ou le supprime sur l'hébergeur s'il veut le réutiliser. L'interface le dit dans la confirmation et après la réussite.

### Ce qui est retiré

Dans la configuration du clone seule (`git config --local`), jamais celle de l'utilisateur :

1. La section `remote.origin` : une ou plusieurs `url`, `pushurl`, `fetch`, `tagopt`, etc. Un `origin` sans adresse est retiré aussi.
2. Les références `refs/remotes/origin/*`, y compris la référence symbolique `HEAD` (supprimée sans suivre sa cible).
3. Le suivi : `branch.<b>.remote`, `.merge` (et `.pushremote`) des branches qui passent par `origin`, la branche principale après un rattachement, et `remote.pushDefault` s'il vaut `origin`. Le suivi d'un autre dépôt (`miroir`, par exemple), les autres branches, les tags (`doc/…`) et le reste de la configuration ne bougent pas.
4. Les restes : les dépôts temporaires d'inspection (`atlas-attach-*` du dossier temporaire du système) de plus d'une heure appartenant à l'utilisateur, que seul un processus tué laisse derrière lui. Les dossiers plus récents peuvent servir à un rattachement en cours (d'un autre espace) : ils restent. Un échec à cette étape n'est pas celui de la réinitialisation. `FETCH_HEAD` n'est pas touché : il peut venir d'une récupération sans rapport avec le rattachement.

Un `origin` défini hors du dépôt (fichier inclus, ancien dossier `.git/remotes`) ne peut pas être retiré d'ici : la réinitialisation le constate à la fin et lève `reset_incomplete`.

### Commit d'identité du créateur

Le rattachement renomme le créateur dans un commit dédié, « Identité du créateur : `<local>` devient `<login>` ». Si la branche principale l'a déjà fusionné (la fusion a réussi, le registre a échoué), la gouvernance locale désigne le login alors que le registre garde le compte local : le créateur serait lecteur en local. La réinitialisation le défait, sans jamais perdre un commit de l'utilisateur.

Reconnaissance (la règle de `_require_empty`, ADR 0037, plus la signature d'Atlas : le message exact écrit par le rattachement, « Identité du créateur : `<local>` devient `<login>` » et son corps ; un renommage identique fait à la main sous un autre message n'est pas défait) : parent unique connu du clone, seul `governance.yaml` change, contenu exactement égal au renommage du compte du registre vers un membre. On ne cherche à défaire que si la gouvernance de la tête ne contient plus le compte du registre mais contient le compte publié, et le commit se cherche dans tous les commits qui touchent la gouvernance, sans borne. Garde-fou : sans commit reconnu, si la gouvernance n'a plus le compte du registre et désigne un autre référent d'espace, la réinitialisation refuse (`identity_not_found`, 409) avant toute écriture, plutôt que de réussir en laissant ce compte.

| Situation | Action |
|---|---|
| La gouvernance contient déjà le compte du registre | rien (le plus fréquent : la fusion n'a pas eu lieu) |
| Un commit d'identité reconnu est la tête, ou plus profond dans l'historique | nouveau commit « Identité du créateur : `<login>` redevient `<local>` » (renommage inverse de la gouvernance de la tête), créé sans toucher à l'index ni à l'arbre de travail, puis avance rapide de la branche : l'historique n'est jamais réécrit |
| Aucun commit reconnu (autre message, contenu retouché, `--amend` modifié) | rien : le commit n'est pas celui d'Atlas, on n'y touche pas ; si un autre référent a pris la place du créateur, refus `identity_not_found` |

Pas de `reset` : même quand le commit d'identité est la tête, reculer la branche réécrit l'historique et, avec `--keep`, vide l'index des autres fichiers (les modifications mises en attente redeviennent non indexées, et le prochain commit les oublie). Le commit de retour suivi d'une avance rapide ne change dans l'arbre que `governance.yaml`, vérifié propre par les gardes : l'index, les autres modifications et les fichiers non suivis sont conservés. L'avance rapide s'arrête si elle devait écraser une modification de ce fichier.

Après la réinitialisation, le créateur est référent sous le compte du registre dans chaque cas. Une nouvelle tentative vers la même adresse reprend la publication partielle (le commit de retour et les commits locaux sont poussés en avance rapide, sans force) ; vers une autre adresse vide, elle republie tout, commit d'identité compris.

### Gardes

Mêmes gardes que le rattachement, dans le même ordre et avant toute écriture, avec leurs codes (`wrong_branch`, `workspace_dirty` pour une opération en cours ou un conflit, `workspace_dirty` pour `governance.yaml` modifié). Leur message se termine par « puis réinitialiser le rattachement ». Elles s'appliquent même quand il n'y a que `origin` à retirer : défaire le commit d'identité déplace la branche principale et réécrit `governance.yaml`, et un clone dans cet état ne se rattacherait pas non plus. Un espace inconnu donne `not_found` (404).

### Concurrence et reprise

- `clone_lock` (ADR 0035), comme le rattachement et la synchronisation : une réinitialisation attend un `fetch` ou un rattachement en cours du même clone, et voit alors le registre à jour.
- Ordre des écritures : le compte du créateur d'abord (seule étape qui puisse échouer pour une raison locale), puis le suivi, les références, la section `origin`. Chaque étape se rejoue sans effet : une réinitialisation interrompue se reprend.
- Une étape qui échoue lève `reset_incomplete` (409) : « La réinitialisation n'a pas pu aller au bout (étape : …). Aucun commit n'est perdu et le dépôt distant n'a pas été touché : un nouvel essai la reprend. » La sortie de git n'est jamais rendue ni journalisée (elle peut montrer une adresse configurée) ; seuls l'étape et le code le sont.

### Codes d'erreur

| Code | HTTP | Cas |
|---|---|---|
| `not_found` | 404 | espace inconnu |
| `remote_exists` | 409 | l'espace est rattaché : on ne le détache pas par cette voie |
| `wrong_branch` | 409 | une autre branche (ou `HEAD` détachée) est extraite |
| `workspace_dirty` | 409 | `governance.yaml` modifié, ou opération git ou conflit en cours |
| `reset_incomplete` | 409 | une étape locale a échoué : un nouvel essai la reprend |
| `identity_not_found` | 409 | la gouvernance n'a plus le créateur et désigne un autre référent, sans commit d'identité reconnu : rien n'est modifié |

Les messages d'`origin_conflict` et de `remote_partial` (« clone divergé », « clone évolué », « compte changé ») ajoutent : « Vous pouvez aussi réinitialiser le rattachement : seule la copie locale change, le dépôt distant n'est pas modifié. »

### Interface

- **Où.** Dans `AttachRemote`, donc dans l'Administration et dans le panneau de création. Quand le rattachement échoue en `origin_conflict`, `remote_partial` ou `attach_incomplete`, la bannière d'erreur porte un bouton secondaire « Réinitialiser le rattachement ». Les autres refus (dépôt non vide, introuvable, droits, adresse, `workspace_dirty`, `wrong_branch`…) n'en proposent pas : il n'y a rien de local à défaire ou le clone doit d'abord être corrigé. Dans le panneau de création, quand le refus de la création est l'un de ces trois codes, il est détaillé une seule fois, dans le groupe, avec son bouton.
- **Confirmation.** Un bloc en ligne, sous la bannière, `role="alertdialog"` nommé « Réinitialiser le rattachement ? » et décrit par son texte : « Seule la copie locale de l'espace est réinitialisée : elle revient à l'état d'un espace sans dépôt distant, sans perdre aucun de vos commits. Le dépôt distant n'est pas modifié : s'il a gardé une publication partielle, il faudra peut-être le vider avant de le réutiliser. » Deux boutons : « Annuler » (neutre) et « Confirmer la réinitialisation » (destructif, `btn-danger`). Pas de panneau latéral : le groupe vit déjà dans un panneau (création), et deux panneaux modaux s'empileraient.
- **Clavier et focus.** À l'ouverture, le focus va sur « Annuler », le choix sans effet. Tab reste entre les deux boutons (le champ et « Rattacher le dépôt » sont désactivés tant que la confirmation est ouverte). Échap ferme la confirmation (sans fermer le panneau de création, l'événement est arrêté) et, comme « Annuler », rend le focus au bouton « Réinitialiser le rattachement ». Après une réussite, le champ d'adresse, vide, reçoit le focus.
- **Pendant la requête.** « Réinitialisation de la copie locale… » (`role="status"`), les deux boutons désactivés, et le reste de l'écran gelé comme pendant un rattachement (`onPending`). Le bouton « Réinitialiser le rattachement » est désactivé tant qu'une modification de domaine ou de membre est ouverte, avec le message déjà affiché.
- **Réussite.** La bannière et la confirmation disparaissent, le champ d'adresse est vidé, la région « Dépôt Git de l'espace » dit toujours « Pas encore de dépôt distant », et un court message `role="status"` : « Rattachement réinitialisé. Seule la copie locale a changé : le dépôt distant n'a pas été modifié. » (ou « Rien à réinitialiser : la copie locale n'avait aucun reste de rattachement. »). Dans le panneau de création, la bannière d'en-tête devient « Dépôt distant non rattaché : Le rattachement a été réinitialisé. »
- **Gouvernance relue.** Après toute réinitialisation réussie, y compris « rien à faire », l'Administration relit les paramètres : un essai précédent interrompu après le retour du compte ne laisse plus `identity_reverted` à vrai, et l'écran garderait sinon l'ancien compte publié. Les modifications non enregistrées suivent quand `reverted_account` est connu : il redevient le compte local dans le brouillon. Sans renommage d'identité (`origin` retiré seul, « rien à faire »), le brouillon est gardé tel quel. Il n'est jeté, toujours avec la bannière « Modifications non reprises », quand le compte local figure déjà dans le brouillon (ajouté à la main : jamais deux membres fusionnés, comme au rattachement) ou quand l'écran avait lu une gouvernance sans lui sans qu'un compte publié soit connu. Le message de réussite survit au remontage du formulaire. Si la relecture échoue, le formulaire reste gelé avec « Réessayer » : « Le rattachement est réinitialisé, mais les paramètres n'ont pas pu être relus. »
- **Échec.** Une erreur de la réinitialisation s'affiche dans la confirmation (message du serveur, en français ; `reset_incomplete` traduit dans `messages.ts`), qui reste ouverte pour un nouvel essai. La bannière d'origine et son bouton restent.
- **Style.** Aucune couleur ni taille en dur : `--atlas-bad`, `--atlas-panel`, `--atlas-space-*`, `--atlas-radius-lg`, `--atlas-text-*` (`.attach-reset`, `styles.css`).

### Espace rouvert : indicateur `attachment` et bannière de la coque

Cas qui motive cette section : le rattachement échoue après la fusion du commit d'identité, avant l'écriture du registre. La gouvernance locale désigne le login de l'hébergeur ; le registre garde le compte local, qui n'est plus référent. Une fois l'écran quitté, l'Administration (réservée au référent d'espace) répond 403 et le bouton du formulaire de rattachement est hors d'atteinte.

- **Core.** `GET /api/workspaces/{ws}` rend `attachment` : `"interrupted"` quand l'espace n'est pas rattaché au registre (`git_remote` vide) et que le clone garde un `origin`, des références distantes, un suivi de branche ou un commit d'identité d'Atlas non défait ; `null` sinon. Le calcul (`attachment_state`, `repo/reset_remote.py`) réutilise l'inspection de la réinitialisation (`_inspect`), sans l'écrire une seconde fois ; il est local (quelques lectures git, aucun réseau). Il ne prend pas le verrou du clone en attente : si une opération le tient (un rattachement en cours), l'état n'est pas « interrompu ». Une gouvernance inexpliquée (`identity_not_found`) ou un clone illisible ne sont pas signalés. La liste de l'accueil n'a pas besoin de l'indicateur.
- **Aucun rôle exigé.** `POST …/remote/reset` n'a jamais eu de garde de rôle (ADR 0038) : la route est derrière le token de session comme tout `/api`, et un espace local n'existe que sur ce poste. Rien à retirer ; un test le vérifie avec un créateur dont l'Administration répond 403. La réponse rend l'espace relu après la réinitialisation (rôle, `space_referent`, `attachment: null`).
- **Coque (`WorkspaceShell`).** Bannière « Rattachement interrompu » visible de tout écran pour tout rôle : « Le rattachement de cet espace à un dépôt a été interrompu. » Bouton « Réinitialiser le rattachement » (même confirmation, même composant que le formulaire : `components/ResetAttachment.tsx`, partagé avec `AttachRemote`) et, pour un référent d'espace hors de l'Administration, le lien « Reprendre le rattachement ». Après la réussite, l'espace relu remplace l'ancien : la bannière disparaît, le rôle de référent et la navigation d'Administration reviennent, un bandeau d'information « Réinitialisation terminée » le dit, et le focus repart sur le titre de l'écran. Composants et jetons existants ; tout se fait au clavier.
- **Administration.** Une réinitialisation faite depuis le formulaire met aussi la coque à jour (`onWorkspaceChange`), pour que la bannière ne reste pas affichée.

## Critères d'acceptation

1. Après `origin_conflict`, `remote_partial` ou `attach_incomplete`, la bannière propose « Réinitialiser le rattachement », bouton secondaire. Aucun autre refus ne le propose.
2. Le bouton ouvre une confirmation qui dit que seule la copie locale est réinitialisée, que le dépôt distant n'est pas modifié et qu'il faudra peut-être le vider. Rien n'est envoyé avant la confirmation ; « Annuler » et Échap la ferment et rendent le focus.
3. Confirmée, la réinitialisation remet l'espace à « Pas encore de dépôt distant », vide le champ d'adresse et affiche un message court. Le clone n'a plus d'`origin`, de référence `refs/remotes/origin/*` ni de suivi ; les références du dépôt distant sont identiques avant et après. Une seconde réinitialisation répond « rien à faire » en succès.
4. Un commit d'identité déjà fusionné en local est défait (commit de retour puis avance rapide, jamais de réécriture) : le créateur reste référent sous le compte du registre, aucun commit de l'utilisateur ne disparaît, et les modifications non enregistrées des autres fichiers restent.
5. Un espace rattaché est refusé (`remote_exists`). Une gouvernance modifiée, une opération git en cours ou une autre branche extraite sont refusées avant toute écriture, avec un message qui dit quoi faire. L'écran affiche ces refus dans la confirmation, qui reste ouverte.
6. La réinitialisation prend le verrou du clone. Pendant la requête et le rechargement qui suit, le reste de l'Administration est gelé ; le bouton est suspendu tant qu'une modification de domaine ou de membre est ouverte.
7. Dans le panneau de création, le refus d'un des trois codes se détaille une fois, dans le groupe, avec son bouton ; Échap ferme la confirmation sans fermer le panneau.
8. Juste après la réinitialisation, l'espace se rattache à un autre dépôt vide (`origin` conforme ou non, avec ou sans publication partielle abandonnée) et le créateur y est référent. Un espace rattaché n'est jamais détaché par cette voie.
9. Avec un compte GitHub réel : la réinitialisation laisse la publication partielle sur le dépôt, qui se vide ou se supprime sur l'hébergeur avant de le réutiliser (à la main).
10. Un espace à moitié rattaché rouvert (le créateur n'est plus référent, l'Administration est fermée) montre la bannière « Rattachement interrompu » de tout écran et pour tout rôle ; « Réinitialiser le rattachement » la retire, relit l'espace et rend le rôle de référent. La route n'exige aucun rôle.

## Tests

- Core : `core/tests/repo/test_reset_remote.py` (43 cas de test) couvre, sur des dépôts nus locaux et les mêmes échecs simulés que `test_set_remote.py` :
  - les états laissés par un rattachement interrompu : publication interrompue à la fusion et au suivi, `origin` conforme avec référence symbolique et suivi, `origin` d'une autre adresse (refus `origin_conflict` puis réinitialisation), adresses et `pushurl` multiples, `origin` sans adresse ;
  - le commit d'identité : défait quand il est la tête, commit de retour, que l'identité soit la tête ou plus profonde, modifications d'autres fichiers conservées et entrées d'index intactes, commit non reconnu laissé tel quel (dont un renommage manuel au même contenu sous un autre message) et refus `identity_not_found` quand un autre référent a pris la place du créateur ;
  - le rôle de référent sous le compte du registre, le registre inchangé, le dépôt distant identique par ses références avant et après ;
  - l'idempotence, le refus d'un espace rattaché, un espace inconnu ;
  - les gardes (gouvernance modifiée ou dans l'index, conflit, `MERGE_HEAD`, autre branche, `HEAD` détachée) : `origin`, branche et dépôt inchangés ;
  - aucune commande réseau, aucun appel à l'API de l'hébergeur, même avec le dépôt distant supprimé ;
  - un nouveau rattachement vers une autre adresse vide, vers la même adresse (reprise, avec ou sans commits de l'utilisateur) et après des commits de l'utilisateur ;
  - les restes (dépôt temporaire ancien retiré, récent conservé, `FETCH_HEAD` préexistant intact), les autres remotes, branches et tags conservés ;
  - le commit d'identité retrouvé au-delà de 200 commits de gouvernance, le refus `identity_not_found` (rien n'est modifié) et l'absence de blocage sans autre référent ;
  - l'indicateur `attachment` (espace neuf, `origin` résiduel, identité fusionnée, après la réinitialisation, espace rattaché, gouvernance inexpliquée, opération en cours sur le clone) et la route de lecture puis de réinitialisation avec un créateur qui n'est plus référent (Administration en 403, réinitialisation en 200, rôle revenu) ;
  - une étape qui échoue (`reset_incomplete`, sans sortie de git ni secret) puis la reprise, y compris après le retour du compte du créateur (gouvernance restée au compte local), le verrou du clone (attente, puis `remote_exists` si un rattachement a fini), la route (200, `reset`, 401, 404, 409) et l'absence de secret dans la réponse et dans la configuration.
- Interface : `app/src/screens/Reinitialisation.test.tsx` (29 tests) : le bouton sur les trois codes et sur aucun autre, la confirmation (rôle, description, focus, Tab, Annuler, Échap), la réussite (état, champ vide et focalisé, nouveau rattachement), « rien à faire » qui relit aussi la gouvernance, la gouvernance relue avec son brouillon, le brouillon gardé sans renommage d'identité (origin seul, « rien à faire »), le brouillon non repris, avec bannière (compte local déjà présent, gouvernance changée), la bannière de la coque pour un lecteur puis la réinitialisation (focus, Échap, rôle revenu, lien d'Administration réservé au référent), les refus dans la confirmation, le gel, la suspension pendant une modification et le panneau de création.
- Parcours : `app/e2e/reinitialisation.spec.ts` (3 tests, scénarios S-0034-01 à S-0034-04, S-0034-08 et S-0034-10) : `origin` d'une autre adresse avec deux `pushurl`, puis publication d'Atlas fusionnée en local ; confirmation, axe-core, dépôts distants identiques, rattachement ailleurs, refus d'un espace rattaché.
- Aucun test ne touche `~/Library/Application Support/skifer-atlas` ni le vrai trousseau (`ATLAS_DATA_DIR`, `ATLAS_VAULT=memory`).
- À la main : la réinitialisation sur un dépôt GitHub réel (critère 9, S-0034-09).

## Dépendances

0033 (rattachement, gardes, `origin_conflict`, `remote_partial`, `attach_incomplete`), 0005, 0017.

## Estimation

**S**. Le point délicat est le commit d'identité : trois cas, dont deux sans perte d'historique.

## Mise en œuvre (5 novembre 2026)

Livré :

- `core/src/skifer_atlas/repo/reset_remote.py` : `reset_remote` (verrou, relecture du registre, gardes, inspection en lecture seule, puis écritures dans l'ordre ci-dessus) ; `repo/sync.py` : les trois gardes prennent ce qu'il faut faire ensuite (`then`) pour que leur message dise « réinitialiser le rattachement », et les messages d'`origin_conflict` et de `remote_partial` mentionnent la réinitialisation ; `api/routes/workspaces.py` : la route ; `api/app.py` : `reset_incomplete` (409).
- `app/src/components/AttachRemote.tsx` (bouton, confirmation, focus, message), `app/src/screens/Administration.tsx` (gouvernance relue, brouillon repris, message gardé), `app/src/screens/CreateWorkspace.tsx`, `app/src/api.ts`, `app/src/messages.ts`, `app/src/styles.css` (jetons uniquement).
- Espace rouvert : `attachment_state` et `clone_lock_if_free` (core), champ `attachment` de `GET /api/workspaces/{ws}`, `components/ResetAttachment.tsx` (hook et confirmation partagés) et `components/InterruptedAttachment.tsx` (bannière de la coque).
- Décisions : ADR 0038 (route, refus d'un espace rattaché, effet local, commit d'identité, gardes, restes, confirmation en ligne).
- Le sidecar n'a aucun import dynamique de plus : `reset_remote.py` s'importe de façon ordinaire, et son import tardif de `proposals.common` suit le modèle de `_attach` (`scripts/build-sidecar.sh` inchangé).
- Le test front a été écrit par un agent Claude, un scénario par critère (`docs/tests/scenarios.md`, plan 0034).

Non testable à l'écran, ou sans compte réel (voir « Sans test front, et pourquoi » dans `docs/tests/scenarios.md`) :

- Le dépôt distant réel : ce qu'un GitHub garde après une publication partielle (branche, historique), et la façon de le vider ou de le supprimer, ne se voient qu'avec un compte réel (S-0034-09).
- Le verrou du clone, la reconnaissance du commit d'identité, l'ordre des écritures et l'absence de réseau sont de la logique serveur sans écran : tests core.
- Le panneau de création n'a que le rendu Vitest : à la création, aucun état de clone résiduel ne se fabrique depuis l'écran.

Reste à faire :

- Un test à la main sur GitHub : réinitialiser après une publication partielle, vider le dépôt, rattacher de nouveau (critère 9).
- Un clone dont `origin` vient d'un fichier inclus (`include.path`) ou de l'ancien dossier `.git/remotes` n'est pas réinitialisable d'ici (`reset_incomplete`). Aucun cas connu dans Atlas ; consigné.
