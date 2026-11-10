# ADR 0053 — Clé d'API : le coffre d'abord, l'environnement quand il n'y a pas de trousseau

Date : 2026-11-07 · Statut : **proposée** (branche points d'accès REST, plan 0036)

## Contexte

Un point d'accès REST (0050) s'authentifie par une clé d'API. Les règles de 0008 s'appliquent : aucun secret dans le dépôt, un coffre par utilisateur, et le coffre ne range rien en clair.

Le coffre ne connaît pas cette sorte d'identifiant : `Kind = Literal["oauth", "pat", "sso", "keypair", "github"]` (`vault/model.py:25`). Il est de plus lié à l'hôte du point d'accès (`Credential.host`, `vault/model.py:36`).

Sur Linux, le coffre n'a que SecretService (`vault/keyring_vault.py:80-82`) : sans session D-Bus, `system_keyring()` lève `vault_unavailable` (`keyring_vault.py:85`, message construit par `_unavailable`, `keyring_vault.py:61-63` : « Atlas ne range aucun identifiant ailleurs. »). C'est le cas du contrôle nocturne du fonds, sur un serveur Linux sans session graphique.

Le fonds a déjà vu une clé fuiter dans des fichiers suivis par Git et dans des messages d'erreur qui avaient capturé l'URL complète.

## Décision

- **Une sorte `apikey` s'ajoute à `Kind`** (`vault/model.py:25`). Sa valeur est `access_token`. Ses états (`state`, `describe`), son absence d'échéance et son traitement par `needs_refresh` (réservé à `oauth`) sont à préciser au plan.
- **La clé est liée à l'hôte du point d'accès et n'est envoyée qu'à lui.** `Credential.host` porte le nom d'hôte du point (0050, sans schéma). Le client HTTP refuse d'envoyer la clé ailleurs : aucun suivi de redirection, aucune URL fournie par une réponse (par exemple `next_url` d'une pagination) vers un autre hôte. La comparaison exacte de l'hôte et son effet sur `connectors/http.py` (déjà sans redirection, `_NoRedirect`, `http.py:21`) sont à préciser au plan.
- **Seconde source de lecture : la variable d'environnement `ATLAS_REST_KEY_<ID>`**, où `<ID>` est l'identifiant du point d'accès en majuscules.
  - Elle n'est lue **que si le coffre répond `vault_unavailable`** : le coffre d'abord, la variable seulement après. `ensure_usable` construit aujourd'hui le coffre avant tout contrôle (`connections.py:439-443`), et `Vault()` lève déjà `vault_unavailable` à cet endroit : pour un point `rest`, une seule fonction lit la clé, tente le coffre et ne lit la variable que sur cette erreur. Un coffre disponible mais sans entrée pour ce point ne déclenche pas la lecture de la variable (ce n'est pas `vault_unavailable`) : le point reste `not_connected`, comme aujourd'hui (confirmé par le propriétaire, 91871).
  - Les identifiants suivent `^[a-z0-9][a-z0-9-]{1,63}$` (`access_points.py:64`) et un nom de variable d'environnement ne porte pas de trait d'union de façon portable : **le trait d'union devient un souligné et l'identifiant passe en majuscules** (`ma-source` donne `ATLAS_REST_KEY_MA_SOURCE` ; décision du propriétaire, 91871). Le motif exclut `_` et les majuscules : deux identifiants valides distincts donnent deux noms de variable distincts. Un test le vérifie.
  - **Elle n'est jamais écrite nulle part** : ni dans le coffre, ni dans un fichier, ni dans le registre local, ni dans le cache de réponses, ni dans la provenance.
  - Le message du coffre (« Atlas ne range aucun identifiant ailleurs », `keyring_vault.py:62-63`) reste vrai : lire l'environnement n'est pas ranger. Il n'est pas modifié.
  - Même lien à l'hôte : la clé lue dans l'environnement n'est envoyée qu'à l'hôte du point dont elle porte l'identifiant.
- **Même masquage, partout.** La clé, qu'elle vienne du coffre ou de l'environnement, est masquée dans toute URL (la clé voyage en paramètre de requête chez certains fournisseurs), exception, journal et erreur stockée. Réutiliser `masking.mask_secrets` (`masking.py:16-22`) et `mask_body` (`masking.py:25-35`), déjà introduits par l'ADR 0044 (jetons masqués) : la clé d'API est passée comme secret à `message_of(body, *secrets)` (`connectors/http.py:70-78`, qui appelle `mask_body`) et au masquage de `host_unreachable` (`connectors/http.py:55-59`). Le masquage du secret brut ou encodé pour une URL précède toute troncature. Seul complément de masquage à ajouter : `mask_url(url, key_name)` dans `masking.py`, à côté des fonctions existantes, pour masquer aussi la valeur du paramètre de requête `key_name` ; toute URL rendue passe par ce complément et par `mask_secrets` avec la clé. `ApiKey` garde sa valeur hors `repr`. Aucun message ne contient d'URL ni de corps de réponse ; les erreurs stockées gardent les textes fixes (0052, `_STORED_ERRORS`).
- **Ni clé, ni URL complète dans les commits, tests, fixtures et messages** : les tests utilisent de fausses valeurs et un faux serveur (0051).

## Conséquences

- Un serveur sans trousseau peut lancer `atlas compare` sur un point REST, sans qu'Atlas range la clé : elle vit dans l'environnement du processus, dont la gestion revient à l'opérateur du serveur.
- Une variable d'environnement est lisible par les processus de même utilisateur et héritée par les processus fils : ce risque est celui de l'environnement, et il est accepté pour le seul cas `vault_unavailable`.
- Deux sources de clé donnent deux états à afficher : la source utilisée (coffre ou environnement) n'est pas un secret et peut figurer dans le résumé du point ; où, est à préciser au plan (l'écran Connexions est hors branche).
- Le coffre de test (`ATLAS_VAULT=memory`, `keyring_vault.py:68-69`) permet de tester les deux chemins : coffre indisponible simulé, puis variable posée.
