# ADR 0013 — Coque applicative et accueil des espaces

Date : 2026-10-30 · Statut : **acceptée** (mise en œuvre du plan 0010)

## Contexte

Le plan 0010 pose la première interface réelle : la coque, l'accueil branché sur l'API et les formulaires de création et d'adhésion. Il suppose deux enrichissements de l'API qui n'existaient pas encore : les compteurs des cartes et le filtre des propositions qui attendent l'utilisateur. Le guide de style laisse plusieurs points ouverts, et en contredit deux :

- il annonce des contrastes que les tokens n'atteignent pas ;
- il ne prévoit pas de taille pour certaines valeurs de la maquette.

## Décision

- **Compteurs de l'accueil.**
  - `GET /api/workspaces` renvoie `counts: {kpi, concept, open_proposals}` pour chaque espace, calculés sans réseau côté Git.
  - `kpi` et `concept` viennent de l'index du clone.
  - `open_proposals` compte les propositions ouvertes qui attendent la revue de l'utilisateur, d'après le dernier fetch. Il vaut 0 pour un espace sans dépôt distant.
  - Un compteur indisponible vaut `null` et n'empêche pas la liste. La carte ne l'affiche pas.
- **Propositions qui m'attendent.**
  - Chaque proposition ouverte porte `awaiting_me`. Il est vrai si l'auteur est quelqu'un d'autre, si mon compte est habilité à la valider, et si je ne l'ai encore ni approuvée ni refusée sur son dernier commit.
  - `GET …/proposals?for_me=true` ne rend que celles-là. C'est le compteur orange de la navigation et des cartes.
- **Routage par hash.**
  - `#/` mène à l'accueil, `#/w/<espace>/<vue>` à une vue d'un espace, sans serveur.
  - Une vue inconnue mène au catalogue.
  - Un espace absent du registre ramène à l'accueil avec un message.
  - `administration` ramène au catalogue si l'utilisateur n'est pas référent.
- **« + Créer un espace » est toujours visible.**
  - Le guide le réserve au référent, mais l'accueil n'a pas d'espace courant, donc aucun rôle à consulter. Le créateur devient référent de l'espace qu'il crée.
  - « Rejoindre un espace », absent de la maquette, est un bouton secondaire à côté.
- **Formulaires** (non maquettés).
  - Ce sont des panneaux latéraux de 340 px. Chacun est un dialogue modal : Échap le ferme, le focus reste dans le panneau, puis revient au bouton qui l'a ouvert.
  - L'identifiant de l'espace se dérive du nom (minuscules, sans accents, tirets) tant qu'on ne le modifie pas.
  - Les entités se saisissent séparées par des virgules.
  - Le dépôt distant se rattache après la création. S'il échoue, l'espace reste créé et le panneau propose de l'ouvrir.
- **États du serveur.**
  - Hors Tauri, le serveur est sondé sur `/health` pendant 10 s au plus (« Démarrage du serveur local… »).
  - Toute requête qui n'aboutit pas déclenche le bandeau critique « Serveur local injoignable ». « Réessayer » sonde à nouveau et recharge l'écran.
  - Une erreur d'API s'affiche dans un bandeau, avec le message traduit et une action.
  - Hors Tauri, l'adresse du serveur vient de `VITE_ATLAS_API`, par défaut `http://127.0.0.1:8765`.
- **Focus.** À chaque vue, le focus va au titre H1 (`tabindex="-1"`), comme lors d'un chargement de page. Sans cela, il restait sur l'élément retiré et Tab repartait d'un point arbitraire.
- **Polices.**
  - Inter (400 à 700) et JetBrains Mono (400, 500) sont embarquées dans `app/src/assets/fonts`, en sous-ensemble latin de Fontsource, qui couvre le français, œ compris. La licence SIL OFL est jointe.
  - Aucun paquet de polices n'est installé.
- **Tokens ajoutés.**
  - Ils couvrent les valeurs de la maquette ou du guide qui n'avaient pas de token :
    - tailles de texte 10, 15 et 18 px ;
    - espacements 40 et 48 px ;
    - épaisseurs de bordure 1, 2 et 3 px ;
    - largeurs : contenu 1040 px, carte 280 px, panneau 340 px, base de la zone principale 560 px ;
    - avatars, logos, icônes et pastilles.
  - `docs/design/tokens.css` et `app/src/tokens.css` restent identiques, et un test le vérifie.
  - Ailleurs dans `app/src`, aucune valeur `#…` ni `…px` : le test n'admet que ses propres données.
  - Les espacements hors de la base de 4 px de la maquette (10, 14 et 22 px) sont arrondis au token le plus proche.

## Écart avec le guide, à arbitrer

Le guide annonce 4,6:1 pour `--atlas-warn` sur blanc. Le calcul WCAG donne **4,09:1**. Le blanc sur `--atlas-mid`, l'élément actif de la navigation, donne **4,04:1**, et le blanc sur `--atlas-warn`, le compteur de la navigation, donne **4,09:1**. Ces trois couples sont sous le seuil de 4,5:1 que fixe la section 6 du guide pour un texte de 11 à 14 px.

L'interface suit le guide et les tokens, qui ne sont pas modifiés. Le test axe-core (critère 10) n'admet d'exception que pour ces trois usages, identifiés par leur élément (`aria-current="page"`, `.nav-count`, `.count-warn`). Toute autre violation sérieuse le fait échouer.

Deux corrections sont possibles :

- foncer `--atlas-warn` et `--atlas-mid` d'environ 10 % ;
- changer ces trois usages, par exemple un élément actif sur `--atlas-deep`.

L'une ou l'autre modifie le guide. Elle relève donc d'une décision de design.

## Conséquences

- La liste des espaces reconstruit l'index d'un espace si son clone a changé. Le premier affichage après une synchronisation est donc un peu plus lent.
- Avec GitHub, `open_proposals` interroge l'API de l'hébergeur : une requête par espace, plus une par proposition ouverte. Sans token ou sans réseau, le compteur est absent, mais l'accueil s'affiche.
- Les vues Catalogue, Propositions, Comparaison, Connexions et Administration sont des emplacements qui citent leur plan (0011 à 0017).
- Les tests de bout en bout simulent l'arrêt du serveur en coupant les requêtes dans le navigateur (critère 5). Le serveur lui-même n'est pas arrêté.
