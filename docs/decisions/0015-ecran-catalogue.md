# ADR 0015 — Écran Catalogue

Date : 2026-10-30 · Statut : **acceptée** (mise en œuvre du plan 0011)

## Contexte

Le plan 0011 branche l'écran 10.1 sur l'index et ajoute deux routes : les facettes des filtres et l'aperçu d'un document. Plusieurs points restaient ouverts :

- La colonne Convergence a quatre états dans le guide (Convergé, n candidate(s), n divergences, Jamais comparé). L'API du plan 0005 ne produisait jamais le deuxième.
- Le plan demande la sélection au clavier « flèches, Entrée », sans dire ce que fait Entrée.
- Il faut un état « index en reconstruction », alors que la lecture du catalogue reconstruit l'index sans le signaler.
- La fiche (0012) et l'éditeur (0013) n'existent pas encore, mais le catalogue y mène.

## Décision

- **Candidates et divergences.**
  - Le brief (§ 5.3) appelle « candidate à la convergence » une déclinaison from scratch. Elle a vocation à devenir une surcharge du canonique.
  - Pour chaque déclinaison, on prend sa dernière comparaison à la version courante du KPI. Un écart (moins de 100 % des cellules dans la tolérance) se compte selon son mode :
    - sur une surcharge, c'est une divergence ;
    - sur une déclinaison from scratch, elle reste candidate.
  - Les divergences priment : `divergences:n` dès qu'une surcharge s'écarte, sinon `candidates:n`, sinon `converged` si toutes les déclinaisons sont comparées, sinon `never_compared`.
  - Une déclinaison from scratch jamais comparée n'est donc pas encore candidate. Le catalogue affiche « Jamais comparé » tant qu'aucune comparaison n'existe (critère 7), comme le dit le README de l'espace de démonstration.
  - Un KPI sans déclinaison reste « Convergé » par construction. Un concept n'a pas de convergence : la cellule affiche « — », lu « sans objet pour un concept ».
- **Facettes.**
  - `GET …/catalog/facets` rend les valeurs présentes dans l'index pour les concepts et KPI : `domain`, `owner`, `status`, `kind`.
  - Les domaines et les propriétaires portent le libellé de `governance.yaml` (« Supply chain », « Claire M. »), ou leur identifiant à défaut.
  - Les libellés des statuts et des types sont ceux de l'interface.
- **Aperçu.**
  - `GET …/documents/{id}/summary` agrège :
    - l'index : ligne, déclinaisons, « référencé par » ;
    - la gouvernance : libellés ;
    - le YAML : points de variation, avec le libellé de leur nœud ;
    - les résultats : dernière comparaison.
  - La dernière comparaison du KPI donne la part des cellules dans la tolérance, toutes déclinaisons confondues. `stale` signale une comparaison faite sur une version antérieure.
  - Le plan citait le plan 0006 parmi les sources. L'aperçu n'en affiche rien : ni le guide ni le plan n'y prévoient les propositions. La gouvernance n'y sert qu'aux libellés.
- **État de l'index.**
  - `GET …/index` rend `{fresh}` sans rien reconstruire. L'écran le demande avant le catalogue.
  - Si l'index n'est pas à jour, le squelette du tableau dit « Reconstruction de l'index de l'espace depuis le dépôt… » au lieu de « Chargement du catalogue… ».
- **Adresse.**
  - Les filtres, la recherche et la ligne sélectionnée vivent dans l'adresse : `#/w/<espace>/catalogue?q=…&domain=…&owner=…&status=…&kind=…&sel=…`.
  - Un filtre ajoute une entrée d'historique, et le retour arrière le défait. La recherche à la frappe (temporisée à 200 ms) et la sélection remplacent l'entrée courante : le retour arrière ne repasse pas par chaque lettre.
  - En revenant de la fiche, la ligne reste sélectionnée.
- **Clavier.**
  - Le nom de chaque ligne est un lien vers la fiche. Un seul de ces liens est dans l'ordre de tabulation : celui de la ligne sélectionnée, ou de la première.
  - Flèches haut et bas, Début et Fin déplacent le focus d'une ligne à l'autre. La ligne qui reçoit le focus est sélectionnée, ce qui ouvre son aperçu. Entrée suit le lien et ouvre la fiche.
  - Un clic ailleurs dans la ligne la sélectionne sans quitter le catalogue.
  - La ligne sélectionnée porte `aria-current="true"`.
- **Ligne sélectionnée.**
  - Elle est sur `--atlas-pale`, où `--atlas-mid`, `--atlas-warn` et `--atlas-muted` passent sous 4,5:1 (ADR 0014). Le libellé de convergence y prend donc `--atlas-ink`, et seule la pastille garde sa couleur.
  - Le badge Concept, pâle lui aussi, y passe sur fond blanc.
- **Fiche et éditeur.**
  - Ils ont déjà leurs adresses : `#/w/<espace>/fiche/<id>` et `#/w/<espace>/editeur`. Ce sont des emplacements qui citent les plans 0012 et 0013, sous l'élément Catalogue de la navigation.
  - « + Nouveau concept ou KPI » mène à l'éditeur pour tout rôle sauf lecteur. Un lecteur qui ouvre cette adresse est ramené au catalogue.
- **Disposition.**
  - Les règles flex de la maquette sont reprises telles quelles :
    - tableau `flex: 999 1 520px`, `min-width: 560px` dans un conteneur qui défile ;
    - aperçu `flex: 1 1 300px`, `max-width: 340px`.
  - L'aperçu passe sous le tableau dès que la zone principale ne peut plus contenir les deux (520 + 20 + 300 px). Avec la barre latérale et les marges, cela arrive sous environ 1136 px de fenêtre, donc bien sous 900 px comme le veut le guide. Entre 960 et 1136 px, l'aperçu est déjà sous le tableau.
  - Les cinq nouvelles mesures sont des tokens : `--atlas-search-basis`, `--atlas-table-basis`, `--atlas-table-min-w`, `--atlas-preview-basis` et `--atlas-preview-w`.

- **Listes déroulantes.**
  - La vue de Tauri sous macOS est WebKit. Il ignore la hauteur d'un `<select>` natif : les filtres y tombaient à 22 px au lieu des 44 px du guide.
  - `components/Select.tsx` retire l'apparence native (`appearance: none`) et dessine le chevron. Le rendu est le même sous WebKit et sous Chromium.
  - Un projet Playwright WebKit (`*.webkit.spec.ts`) vérifie ces hauteurs. Les autres scénarios restent sous Chromium.

## Conséquences

- La convergence d'un KPI dépend du mode de ses déclinaisons. Une surcharge qui s'écarte rend le KPI divergent, même si ses autres déclinaisons sont candidates.
- Les liens stylés en bouton (`a.btn`) ne sont plus soulignés et gardent leur couleur au survol.
- Les tests de bout en bout lancent le serveur avec `ATLAS_COMPARE_DATA` pour exécuter une vraie comparaison en local (critère 7).
