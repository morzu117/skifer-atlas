# ADR 0018 — Écran des propositions

Date : 2026-10-30 · Statut : **acceptée** (mise en œuvre du plan 0014)

## Contexte

Le plan 0014 fait de l'écran 10.4 la file de revue des propositions : maître-détail, diff deux colonnes, fil de commentaires, approbation et fusion. Les règles du décompte sont celles du plan 0006 (`governance/rules.py`). Plusieurs points restent ouverts :

- ce que le client reçoit pour filtrer la file et expliquer un bouton grisé ;
- la forme du diff d'une proposition ;
- la détection d'une surcharge qui revient d'une entité à l'autre ;
- les valeurs du filtre Statut, que la maquette nomme autrement que l'hébergeur ;
- le test de bout en bout à plusieurs comptes.

## Décision

- **`GET …/proposals/queue?status=`** rend, en un appel :
  - la file (`list_proposals` du plan 0006) ;
  - le compte, son rôle et `review_domains`, les domaines où il est validateur. C'est la base de « Mes domaines » ;
  - les libellés des domaines, les entités et les noms des membres.

  Le tri place les domaines du compte en premier, puis les plus récentes. « Mes domaines » est le filtre par défaut d'un validateur, « Tous les domaines » celui des autres comptes. Une valeur vide sort de l'adresse : « Tous » a donc sa propre valeur (`domain=tous`).
- **`viewer` dans le détail** (`GET …/proposals/{n}`) dit ce que le compte courant peut faire, et pourquoi pas :
  - `can_review` et `review_reason` :
    - « La proposition n'est plus ouverte. » ;
    - « Vous êtes l'auteur de cette proposition : un autre compte doit l'approuver. » ;
    - « Votre approbation ne compterait pas ici. Comptes habilités : … » ;
  - `can_merge` et `merge_reason` : l'explication du décompte, ou « Rôle contributeur requis pour fusionner. ».

  Le bouton grisé est `aria-disabled` (il reste focalisable) et porte la raison dans une infobulle `role="tooltip"`, reliée par `aria-describedby`. Le client ne recalcule aucune règle.
- **`GET …/proposals/{n}/graphs`** rend les deux graphes disposés (composant de 0012), le rapport de diff complet (0003), les surcharges hors points déclarés et celles qui reviennent.
  - La référence est le canonique désigné par une variante, la version de base d'une nouvelle version, et rien pour un document neuf.
  - La relation du diff est le `mode` de la variante (`override`, `from_scratch`), `version` sinon.
  - Après la fusion, le diff se relit sur le commit fusionné.
- **Marquage.** La colonne de gauche reste la référence : seul un nœud retiré y est marqué. À droite :
  - modifié, en rouge ;
  - ajouté, en teal ;
  - surchargé sur un point déclaré, en pointillé orange (`mark-overridden`).

  Le verdict s'écrit à droite de chaque nœud concerné :
  - « Normal » pour `override_declared` ;
  - sinon d'après la gravité : « Divergence critique », « À examiner » ou « Sans effet ».

  La liste textuelle des écarts (`DiffList`) suit le diff et reprend chaque écart, y compris ceux sans nœud (le fuseau horaire de DE).
- **Deux colonnes, défilement lié.** Les colonnes se partagent la largeur au-dessus de `--atlas-diff-col-min` (440 px) chacune et s'empilent en dessous. C'est le cas à 1280 px avec la file ouverte. Défiler un graphe fait défiler l'autre, qui a les mêmes couches.
- **Surcharge récurrente.** Le plan 0006 ne fournit pas l'information. `graphs` la calcule : un nœud surchargé hors points déclarés par au moins deux entités. Il compte les variantes de la branche principale et les autres propositions ouvertes `undeclared` du même KPI, lues dans le diff de leur corps. Le bandeau nomme alors les entités et suggère un point de variation au canonique.
- **Demande de changements.** `POST …/reviews` avec `request_changes` et un corps vide répond 422 `comment_required`. L'écran l'empêche aussi : le formulaire exige « Ce qui doit changer » avant tout envoi.
- **Libellés.** L'élément de file affiche le libellé du document, tiré du titre de la proposition (« Revenu net — nordis-de v4 »). Les entités sont nommées par leur identifiant, car la gouvernance ne porte pas de libellé d'entité.
- **Statut.** Le filtre propose Ouvertes, Fusionnées, Fermées et Toutes, les états de l'hébergeur. La maquette parle d'« Approuvées » et de « Refusées ». Une proposition approuvée reste ouverte jusqu'à sa fusion : on la reconnaît à « prête à fusionner ».
- **Filtres de 36 px** (`--atlas-control-h-filter`) : trois sélecteurs tiennent sur la largeur de la file (380 px).
- **Badges de nature** partagés dans `format.ts` (`NATURES`), avec la fenêtre de soumission de 0013. « Hors points déclarés » est orange plein (`badge-warn-solid`).
- **Contraste.** Sur l'élément sélectionné (fond `--atlas-pale`), la ligne secondaire passe en `--atlas-ink`, et le survol garde l'encre : `--atlas-muted` et `--atlas-mid` n'atteignent pas 4,5:1 sur ce fond.
- **Démonstration.** `examples/propositions-nordis.py` ouvre cinq propositions sur le dépôt de `depot-nordis.sh`, avec leurs revues et un commentaire, comme la maquette. Chaque compte agit sous son `ATLAS_ACCOUNT`, dans un dossier de données temporaire. Les tests Python et Playwright s'en servent.
- **Bout en bout à trois comptes.** Playwright lance deux serveurs de plus : claire.m sur 8798 et marc.d sur 8797, chacun avec son dossier de données, qui rejoignent le même dépôt distant. Pour l'interface de claire.m, `page.route` relaie les appels de 8799 vers 8798. L'origine reste `localhost:1420` : la liste CORS du serveur ne change pas.

## Conséquences

- L'écran n'embarque aucune règle de gouvernance. Un changement de `governance.yaml` change les boutons et leurs raisons sans toucher au client.
- `graphs` résout les deux documents et analyse le dépôt à chaque ouverture d'une proposition, sans cache. Ce coût n'a pas été mesuré au-delà du dépôt de démonstration.
- Les surcharges récurrentes ne regardent que les propositions ouvertes et la branche principale. Une proposition fermée ne compte plus.
- Le diff from scratch n'a pas été relu à la main, comme le plan le demande. Son appariement par score reste le cas le plus fragile.
