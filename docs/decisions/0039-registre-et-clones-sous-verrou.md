# ADR 0039 — Registre et clones sous verrou entre processus

Date : 2026-11-06 · Statut : **acceptée** (suivi de la revue globale, issue #146)

## Contexte

Le plan 0028 admet deux processus Atlas sur le même dossier de données : l'app et la CLI. La revue de `b6af799` a trouvé trois défauts, qui viennent tous de ce que rien n'excluait l'autre processus (ni l'autre thread) :

- **Registre non atomique.** `save_registry` ouvrait `workspaces.yaml` en écriture : une interruption laissait un fichier vide (lu comme « aucun espace ») ou un YAML partiel qui ne se chargeait plus.
- **Mises à jour perdues.** `add_workspace` et `update_workspace` lisaient le registre, le modifiaient, le réécrivaient. Deux threads FastAPI, ou l'app et la CLI, se marchaient dessus : le `synced_at` d'un autre espace ou un espace créé disparaissait.
- **Verrou du clone limité au processus.** `clone_lock` (ADR 0035) était un `threading.RLock` : il n'empêchait pas un `fetch` ou une synchronisation de la CLI pendant ceux de l'app. L'ADR 0035 le notait comme limite.

À part : `create_workspace` supprimait le clone si Git échouait, mais pas si `add_workspace` levait ; le dossier restait et la création suivante du même identifiant était refusée.

## Décision

**Écriture atomique.** `save_registry` écrit dans un fichier temporaire créé dans le même dossier (`tempfile.mkstemp`), `flush` et `os.fsync`, puis `os.replace` sur `workspaces.yaml`, et enfin `fsync` du dossier (macOS et Linux). Sur échec, y compris pendant le dump YAML, le temporaire est supprimé et l'ancien registre reste en place. Sous Windows, `os.replace` est réessayé quelques fois (au plus environ 1,5 s) sur `PermissionError` : un lecteur qui a le fichier ouvert (antivirus, indexeur) le fait échouer de façon passagère.

**Un verrou de fichier du système, réentrant dans le processus** (`skifer_atlas/filelock.py`).
- `fcntl.flock` (macOS, Linux) ou `msvcrt.locking` (Windows) sur un fichier verrou ; un `threading.RLock` par fichier, avec un compteur de profondeur, exclut les threads du processus et donne la réentrance. Le verrou du système se prend à la première prise et se rend à la dernière. Sans ce relais, deux descripteurs du même processus se bloqueraient (`flock` est attaché à la description du fichier ouvert).
- **Bibliothèque standard seulement.** Pas de dépendance `filelock` : l'API dont on a besoin tient en une centaine de lignes, la réentrance demande de toute façon notre `RLock`, et rien n'est à déclarer à PyInstaller. `fcntl` et `msvcrt` sont des importations statiques sous une condition de plate-forme, que l'analyse de PyInstaller suit : aucun import dynamique n'est ajouté, `scripts/build-sidecar.sh` et `_selftest` sont inchangés.
- **Pas de verrou orphelin.** Le noyau rend le verrou à la mort du processus, même tué : aucun délai de péremption, aucun fichier à nettoyer. Le fichier verrou reste, vide, et n'est jamais supprimé (le supprimer ouvrirait une course entre deux processus qui verrouilleraient deux fichiers de même nom). Les descripteurs ne sont pas hérités par les sous-processus (`git`).
- **Attente.** Réessais toutes les 10 ms, doublant jusqu'à 200 ms, comme `dbfile.open_db` (ADR 0032) mais plus serrés : un verrou n'est tenu que le temps d'une écriture. Aucun verrou n'est jamais tenu en attendant une réponse de l'utilisateur.

**Le registre** : `workspaces.yaml.lock`, dans le dossier de données. `add_workspace`, `update_workspace`, `save_registry` et `load_registry` le prennent (réentrant : `add_workspace` le tient d'un bout à l'autre de lecture–modification–écriture). Les lectures le prennent aussi : sous Windows, elles évitent qu'un `os.replace` d'un autre processus se heurte à un fichier ouvert. Il n'existe pas d'autre écriture du registre (Atlas ne retire jamais un espace) ; toute nouvelle fonction qui le modifie doit passer par `registry_lock`.

**Les clones** : `repo.lock`, dans le dossier de l'espace à côté de `repo/` (`workspace_dir(id)/repo.lock`), donc hors de l'arbre de travail Git : ni `git status` ni `git clean` ne le voient. `clone_lock` et `clone_lock_if_free` utilisent le même mécanisme. `clone_lock_if_free` ne bloque pas et rend `False` quand un autre thread ou un autre processus tient le clone ; le thread qui le tient déjà le retrouve (réentrance).

**Attente bornée et codes.**

| Verrou | Délai | Code (statut) | Constante |
|---|---|---|---|
| Registre | 10 s | `registry_busy` (503) | `workspaces.LOCK_WAIT_SECONDS` |
| Clone | 150 s | `clone_busy` (503) | `repo.git.CLONE_WAIT_SECONDS` |

Le délai du clone dépasse celui d'une commande git (`TIMEOUT`, 120 s) : le second attend la fin d'un fetch ou d'une synchronisation en cours, qui est le but de l'ADR 0035. Il est désormais borné : un processus qui resterait bloqué ne gèle plus l'autre pour toujours. Les constantes sont lues à chaque appel, pour qu'un test les raccourcisse. L'app traduit les deux codes (`app/src/messages.ts`) : « Liste des espaces occupée » et « Espace en cours d'utilisation », avec « Réessayez ». Le message du serveur ne contient aucun chemin.

**Ordre de prise des verrous.** Un seul ordre, dans le code et ici :

1. le verrou **du clone** d'un espace (`clone_lock`), un seul à la fois ;
2. puis le verrou **du registre** (`registry_lock`), dernier.

Le registre est une feuille : tant qu'il est tenu, le code n'y fait que lire et écrire `workspaces.yaml`, et ne prend jamais un verrou de clone, ni un verrou de base (`dbfile`), ni n'attend le réseau. Tous les appelants actuels le respectent : la synchronisation et le rattachement (`set_remote`) appellent `update_workspace` sous `clone_lock` ; les autres appels (`refresh_account`, lectures) prennent le registre sans clone. `create_workspace` prend le clone, puis `add_workspace`. Deux clones ne sont jamais tenus ensemble. Aucun appelant ne prend le registre puis un clone : il ne peut donc pas y avoir de cycle. Les verrous d'un même fichier sont réentrants, ce qui évite l'auto-blocage dans un thread. `test_clone_then_registry_never_deadlocks` le vérifie sous charge.

**Création et adhésion sous le verrou du clone.** `create_workspace` tient le clone de bout en bout et revérifie l'identifiant dedans. `join_workspace` clone d'abord hors verrou, dans un dossier temporaire (le réseau peut être long) ; l'identifiant n'est connu qu'après la lecture d'`atlas.yaml`, il prend alors le même verrou, `workspace_dir(id)/repo.lock`, et le tient de `_ensure_new` jusqu'à `add_workspace` (déplacement du clone, coffre, compte sur l'hébergeur compris). Sans lui, une adhésion passait `_ensure_new` pendant qu'une création du même identifiant était en cours, déplaçait son clone et s'enregistrait ; la création échouait alors à `add_workspace` et son nettoyage supprimait le dépôt de l'espace rejoint. L'ordre reste clone, puis registre.

**Aucune opération ne supprime un `repo` qu'elle n'a pas créé.** `create_workspace` ne nettoie que si son propre `mkdir` a réussi (`created`) ; `join_workspace` ne supprime la cible que s'il l'a posée après un `_ensure_new` réussi sous le verrou (`ours`). Les autres suppressions de dossier (`reset_remote`, `githost/local`) ne concernent que des dépôts temporaires de l'appel. Atlas ne retire pas d'espace : aucune autre suppression de clone n'existe, et la réinitialisation, le rattachement et la synchronisation modifient un clone existant sous `clone_lock` sans le supprimer. `sync_workspace` vérifie l'existence de l'espace avant de prendre le verrou, pour ne pas créer le dossier d'un espace inconnu.

**Clone orphelin.** `add_workspace` entre dans le bloc de `create_workspace` qui supprime le clone sur échec : registre illisible, disque plein, `registry_busy`. `join_workspace` nettoyait déjà son clone dans ce cas.

## Conséquences

- Un registre vide ou partiel ne remplace plus jamais le bon ; une mise à jour concurrente n'en efface plus une autre, entre threads comme entre processus.
- L'app et la CLI ne synchronisent plus le même clone en même temps : le second attend, puis lit des références à jour. La limite notée par l'ADR 0035 disparaît.
- Un dossier de données sur un partage réseau (SMB, NFS) n'est pas pris en charge : `flock` y est peu fiable. Atlas écrit en local (brief §8.4).
- Un `workspaces.yaml.lock` et un `repo.lock` par espace apparaissent dans les données. Ils sont vides et inoffensifs.
- Limite : sous Windows, le chemin `msvcrt` n'est exercé que par la CI Windows x64 ; les tests de ce suivi ont tourné sous macOS.
- Tests : `core/tests/test_registry_lock.py` (écriture interrompue, deux threads, deux processus, `registry_busy`, processus tué, échec d'ouverture du fichier verrou) et `core/tests/repo/test_clone_lock.py` (verrou du clone entre processus, `clone_lock_if_free`, ordre, clone orphelin, création et adhésion concurrentes du même identifiant en threads et en deux processus). Scénario : S-0005-12.
