# ADR 0029 — Jeton GitHub au coffre, par le device flow

Date : 2026-10-31 · Statut : **acceptée** (mise en œuvre du plan 0025)

## Contexte

Les propositions, revues et fusions passent par l'API de GitHub, et un dépôt privé ne se clone pas sans jeton. Depuis le plan 0006, ce jeton venait de `ATLAS_GITHUB_TOKEN`, en attendant le coffre (ADR 0009). Le brief demande des tokens « rangés par espace de travail », dans un coffre local. Le guide de style interdit tout champ pour saisir un token à la main.

## Décision

- **Device flow d'OAuth** (`githost/device.py`).
  - Atlas demande un code à GitHub et l'affiche. L'utilisateur le saisit sur `github.com/login/device`, depuis le navigateur de son choix.
  - Aucun champ ne reçoit de jeton, aucune adresse de retour n'écoute sur le poste, et aucun secret client n'est embarqué : c'est le flux prévu par GitHub pour les applications de bureau.
  - Portée demandée : `repo` (dépôts privés, branches, pull requests).
- **Client OAuth d'Atlas.** Son identifiant est public : `ATLAS_GITHUB_CLIENT_ID`. La build de release le fixe à la compilation de l'app Tauri, qui le passe au serveur ; une valeur présente sur le poste garde la main. Sans lui, `github_not_configured`, et l'écran le dit sans proposer de bouton.
- **Un jeton par espace**, au coffre : compte `<espace>/@github` du trousseau.
  - `@` n'entre dans aucun identifiant de point d'accès : les deux entrées ne se confondent pas.
  - `host_for` et `remote_token` prennent l'espace et lisent son jeton. Un jeton refusé ou expiré ne sert plus.
  - `ATLAS_GITHUB_TOKEN` reste un repli pour les tests et l'intégration continue ; le jeton de l'espace passe avant.
- **Rythme imposé par GitHub.** L'écran relit le flux, et le serveur n'interroge GitHub qu'une fois par intervalle, allongé à chaque `slow_down`. Refus et expiration sont des états (`denied`, `expired`), pas des erreurs.
- **Rejoindre un dépôt privé.**
  - L'espace n'existe pas avant le clonage. Le flux est donc lancé sans espace, et son jeton reste dans la mémoire du processus local, jamais sur disque.
  - `POST /api/workspaces/join` le reçoit (`github_flow`), clone avec, puis le range sous l'identifiant lu dans `atlas.yaml`.
  - Une adhésion qui échoue garde le flux, pour réessayer. Un flux en attente expire avec son code ; un flux abouti reste disponible 15 minutes de plus.
- **Compte relu à la connexion.** Un espace rejoint sans jeton n'avait pas de compte GitHub, donc il était en lecture seule. À la connexion, `refresh_account` relit le compte (`/user`) et le rôle que lui donne la gouvernance.
- **Déconnecter** retire le jeton du coffre de ce poste. La révocation chez GitHub se fait dans les réglages du compte, et l'écran le rappelle.

## Conséquences

- Mes connexions affiche en tête « Dépôt de l'espace », pour un dépôt GitHub seulement : état, compte (`@login`) et action (se connecter, reconnecter ou déconnecter). « Rejoindre un espace » propose la connexion après un échec de clonage d'une adresse `https://github.com/…`.
- Un jeton à durée limitée (option des GitHub Apps) n'est pas rafraîchi : une fois expiré, l'écran propose « Reconnecter GitHub ».
- En SSH, git utilise la clé de l'agent ; le jeton ne sert qu'à l'API.
- Tests :
  - `core/tests/repo/test_github_device.py` (8 tests, contre un faux GitHub) ;
  - `app/src/screens/GitHub.test.tsx` (6 tests).
