# ADR 0016 — Fiche d'un KPI ou d'un concept

Date : 2026-10-30 · Statut : **acceptée** (mise en œuvre du plan 0012)

## Contexte

Le plan 0012 branche l'écran 10.2 sur le dépôt, alors que la maquette est « à retravailler ». Le plan fixe le contenu des six onglets et une disposition du graphe calculée par le serveur. Il laisse ouverts :

- les routes de la fiche ;
- l'algorithme de disposition ;
- le comportement du graphe en lecture ;
- la cible du diff d'une implémentation ;
- ce que fait « Proposer une modification » tant que l'éditeur (0013) n'existe pas.

L'espace de démonstration n'avait d'ailleurs qu'un commit, alors que les critères 2 et 3 demandent quatre versions et un diff de v3 à v4.

## Décision

- **Routes.** Elles sont toutes sous `…/documents/{id}` :
  - `GET /sheet` : l'aperçu du plan 0011 (`summary`), plus :
    - la date de validation (date du tag de la version courante) ;
    - les validateurs requis pour une nouvelle version canonique (`null` pour une variante) ;
    - le nombre de versions ;
    - la sémantique déclarée ;
    - les déclinaisons avec leurs surcharges ;
    - les dépendances avec le domaine de chaque élément ;
    - les implémentations ;
    - les scopes ;
    - la tolérance du KPI et celle de l'espace.
  - `GET /layout?version=` : la disposition du graphe, de la version courante ou d'une version taguée.
  - `GET /diff?base=&other=` : le `DiffReport` du plan 0003 entre deux versions (relation `version`).
  - `POST /implementations/{entité}/{plateforme}/extract` : l'extraction du plan 0004, puis son diff au canonique.
  - `GET /draft` : le brouillon de la nouvelle version.

  Un document sans graphe, un concept par exemple, répond 422 `invalid_document` sur `/layout`.
- **Disposition.**
  - La couche d'un nœud est la longueur du plus long chemin depuis une entrée. Le rang trie les nœuds d'une même couche par identifiant.
  - Le résultat ne dépend ni de l'ordre des nœuds dans le YAML ni du poste. Il sert tel quel aux deux graphes du diff.
  - Le serveur calcule aussi le texte des cartes : libellé du type, titre et détail. Une condition s'y lit « statut = validée », « statut dans validée, expédiée » ou « date est nul ». Un `kpi_ref` affiche « revenu-net v4 ».
- **Graphe en lecture.**
  - `components/GraphView.tsx` place les cartes sur une grille de 206 × 150 unités : une carte de 150 px (`--atlas-node-read-w`), plus l'espace des arêtes. Les rangs sont centrés dans chaque couche.
  - Pas de zoom, de déplacement ni de sélection. Un graphe plus large que la zone défile dans son conteneur, comme un tableau. Le conteneur est focalisable pour défiler aussi au clavier (règle axe `scrollable-region-focusable`).
  - La mention React Flow est masquée (`hideAttribution`).
  - Une jointure a deux entrées, gauche et droite. Chaque arête vise la bonne, et son identifiant porte le côté (`n03-n07-left`).
- **Couleurs des cartes.**
  - En-tête blanc sur la couleur de famille, le blanc ne passe pas 4,5:1 (3,58:1 sur `--atlas-node-rows`). La famille est donc une pastille devant le libellé du type.
  - Point de variation : bordure de 2 px pointillée `--atlas-warn` sur `--atlas-warn-bg`, et « · variation » après le type.
  - Sortie : bordure `--atlas-brand` sur `--atlas-pale`. Son texte est en `--atlas-ink`, car `--atlas-muted` y tombe à 4,45:1.
- **Diff de versions.**
  - Le formulaire « De / À » propose par défaut l'avant-dernière et la dernière version. Les deux versions vont dans l'adresse (`?tab=versions&base=3&other=4`), ce qui permet de recharger la page ou de la partager.
  - Les écarts s'affichent en liste, dans l'ordre et avec la classification du plan 0003. Un filet de couleur marque la gravité : rouge (`critical`), orange (`warn`), aucun (`info`).
  - Sous la liste, les deux graphes sont l'un au-dessus de l'autre, l'avant puis l'après :
    - nœud modifié : rouge sur les deux ;
    - nœud retiré : rouge sur l'avant ;
    - nœud ajouté : vert d'eau (`--atlas-ok`) sur l'après.

    Chaque carte marquée le dit en toutes lettres (« modifié », « ajouté », « retiré »).
- **Implémentations.**
  - Le SQL extrait se compare à la version courante du canonique avec la relation `free` : une implémentation n'est pas une déclinaison déclarée.
  - Le résultat est bruité : types `TODO`, jointure de cardinalité inconnue. C'est le comportement fidèle des plans 0003 et 0004. La fiche affiche les résidus de l'extraction avant les écarts.
- **Proposer une modification.**
  - `GET /draft` rend le YAML courant avec `version` incrémentée. La ligne `version:` du bloc `data_product:` est réécrite sur place, pour que le diff du brouillon tienne en une ligne.
  - Un bloc `data_product` compact (`{…}`) est réécrit en entier.
  - En attendant le plan 0013, `#/w/<espace>/editeur?from=<id>` affiche ce brouillon en lecture : « Brouillon », « v5 · copie de la v4 ». Rien n'est encore enregistré.
  - Le bouton est absent pour un lecteur.
- **Libellés.**
  - L'impact se compte en documents (« Une nouvelle version touchera 2 documents ») et non en KPI comme dans le plan. `impact` compte aussi les concepts, et les déclinaisons d'un concept.
  - « Candidate à la convergence » vaut Oui pour une déclinaison from scratch (ADR 0015), sans attendre une comparaison.
  - L'arrondi est « À la restitution » pour tout KPI : c'est la règle du moteur Skifer, et le YAML ne le déclare pas.
  - Les entités s'affichent par leur identifiant (`nordis-fr`) : `governance.yaml` ne leur donne pas de libellé.
- **Concepts.** Leur fiche n'a que trois onglets : Définition, Versions et Dépendances. La carte Entité y remplace la sémantique et le graphe. Un onglet absent dans l'adresse ramène sur Définition.
- **Historique de démonstration.**
  - `examples/depot-nordis.sh <dossier>` construit le dépôt de l'espace Groupe Nordis avec quatre commits datés de Revenu net, par Claire M. et Marc D., tagués `doc/revenu-net/v1` à `v4`.
  - Les trois premières versions sont dans `examples/historique-nordis/`.
  - Le script sert aux tests Python, aux tests de bout en bout et au README de l'espace.
- **Index.** Les lignes de `dependencies()` portent désormais le domaine de chaque document.

## Conséquences

- La disposition est une donnée du serveur : le diff d'une proposition (0014) réutilise `/layout` et `GraphView` sans recalcul côté interface.
- Au-delà d'une trentaine de nœuds, le graphe défile horizontalement sans vue d'ensemble. On rouvrira la question avec le retour sur la maquette.
- L'éditeur (0013) partira de `GET /draft` et de l'adresse `editeur?from=`.
