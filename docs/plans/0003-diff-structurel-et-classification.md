# Plan 0003 — Diff structurel et classification des écarts

> **Décision** (Q4, validée le 30 octobre 2026) : appariement par `id`, puis par score déterministe (type, concept, position) pour les graphes sans identifiants communs.

## Objectif
Pour deux graphes donnés (deux versions, canonique contre variante, deux extractions), `atlas diff` produit la liste exhaustive des écarts (nœuds ajoutés, retirés, modifiés, changements d'ordre), chacun classé selon le brief 8.2, dans un JSON stable que l'UI et la comparaison chiffrée réutilisent.

## Périmètre
**Dedans** : comparaison d'empreintes en court-circuit ; alignement ; diff champ par champ ; détection des changements d'ordre entre opérations structurantes ; classification ; sortie JSON et texte ; CLI.
**Dehors** : rendu visuel (0014) ; lien vers la comparaison chiffrée (0009 consomme `node_ref`).

## Références
Brief 4.1, 4.2, 8.1, 8.2 ; guide 4 (« Diff », couleurs) et 10.4 ; plans 0001 et 0002.
Fichiers : `core/src/skifer_atlas/diff/{align,compare,classify,report}.py`.

## Spécification

### Entrées
`diff(base: ResolvedGraph, other: ResolvedGraph, context) -> DiffReport`. `context.relation` ∈ {`version` (deux versions d'un même document), `override` (canonique contre surcharge résolue), `from_scratch`, `free` (deux graphes sans lien, par exemple deux extractions)}.

### Algorithme
1. **Court-circuit** : empreintes égales (plan 0002) donnent `identical: true` et une liste vide.
2. **Alignement** sur les formes normalisées :
   - par `id`, si la relation est `version` ou `override` ;
   - sinon, ou pour les nœuds restants, un appariement glouton déterministe par score décroissant. Le score vaut 0 si les types diffèrent, sinon : +3 par concept commun aux colonnes touchées, +2 si la profondeur dans la suite de segments est la même, +1 par colonne commune en sortie, +1 si les entrées sont déjà appariées. Une égalité se départage par l'ordre topologique, puis par la forme canonique. Un score sous le seuil (3) ne produit aucun appariement.
3. **Comparaison** de chaque paire, champ par champ : la liste `changes: [{field, before, after}]`, les expressions étant comparées après normalisation SQLGlot.
4. **Ordre** : pour chaque chemin, on compare la séquence des types structurants. Une inversion produit un écart `reordered`.
5. **Non apparié** : un nœud de `base` seul est `removed` ; un nœud d'`other` seul est `added`.

### Classification (une seule classe par écart, appliquée dans cet ordre)
| Classe | Règle | Couleur UI |
|---|---|---|
| `override_declared` (normal) | écart sur un nœud surchargé et classé `declared` à la résolution | teal |
| `override_undeclared` (à examiner) | surcharge `undeclared` | orange |
| `from_scratch` (justifié, à suivre) | toute différence quand la relation est `from_scratch` ; les sous-classes critiques ci-dessous restent indiquées dans `severity` | orange |
| `critical` | changement de condition ou de `nulls` d'un filtre, de `group_by` ou de fonction d'agrégation, de `how`, `keys` ou `cardinality` d'une jointure, de `check` (bypass), de calendrier ou de fuseau, nœud structurant ajouté ou retiré, `reordered` | rouge |
| `cosmetic` | seuls `label`, `note` ou des noms de colonnes de sortie changent, de façon cohérente en aval | gris |
| `to_verify` | `compute` ou `metric_op` dont les expressions diffèrent mais dont l'équivalence ne peut être tranchée ; appariement à score faible | orange |

Chaque écart porte `severity` ∈ {info, warn, critical}, indépendamment de sa classe, pour que la matrice 10.5 puisse filtrer.

### Sortie
```json
{
  "identical": false,
  "base": {"id": "revenu-net", "version": 4, "fingerprint": "sha256:atlas1:…"},
  "other": {"id": "revenu-net--nordis-de", "version": 1, "fingerprint": "…"},
  "relation": "override",
  "pairs": [{"base": "n02", "other": "n02", "score": null}],
  "differences": [
    {"kind": "modified", "node_ref": {"base": "n02", "other": "n02"}, "node_type": "filter",
     "changes": [{"field": "condition", "before": "statut:equals:validée", "after": "statut:in:validée,expédiée"}],
     "classification": "override_undeclared", "severity": "critical",
     "message": "Filtre statut modifié hors des points de variation déclarés."}
  ],
  "summary": {"critical": 1, "override_declared": 1, "cosmetic": 0}
}
```
L'ordre des `differences` est déterministe : ordre topologique de `base`, puis nœuds ajoutés dans l'ordre topologique d'`other`.

### CLI
`atlas diff <a> <b> [--canonical <c>] [--relation …] [--format json|text]`. Si `b` est une variante, la relation et la résolution sont déduites. Code de sortie : 0 si identiques, 2 s'il y a des écarts sans `critical`, 3 s'il y a au moins un `critical`, 1 en cas d'erreur.

## Critères d'acceptation
1. Graphes identiques à l'ordre des filtres près : `identical: true`, code de sortie 0.
2. Maquette 10.4 (DE contre canonique v4) : exactement deux écarts, n02 (filtre statut) `override_undeclared` / `critical` et n03 (déduction des taxes) `override_declared`.
3. Deux versions où une agrégation passe de `sum` à `avg` : `critical`.
4. Jointure passée en `check: bypass` : `critical`, avec un message qui le dit.
5. Renommer seulement un libellé : `cosmetic`.
6. Inverser jointure et dédoublonnage : `reordered` / `critical`.
7. Variante from scratch ES contre canonique : appariement par score des nœuds équivalents, chaque écart classé `from_scratch` avec sa `severity`.
8. Deux `compute` d'expressions différentes mais non prouvées équivalentes : `to_verify`.
9. Sortie JSON identique à l'octet près sur deux exécutions ; elle respecte le schéma `core/schemas/diff-report.v1.schema.json`.
10. Codes de sortie 0, 2, 3 et 1 conformes.

## Tests
- Unitaires : alignement (cas de départage), classification (un test par ligne du tableau), ordre de sortie.
- Intégration : corpus de paires de fixtures, avec rapports attendus commités (tests « golden »).
- À la main : `atlas diff` texte sur la paire DE ; vérifier que le rapport se lit sans le JSON.

## Dépendances
0001, 0002.

## Estimation
**L**. Incertitudes : qualité de l'appariement par score sur des graphes from scratch réels, qu'il faudra calibrer sur les extractions du plan 0004 ; frontière entre `cosmetic` et renommage significatif.

## Mise en œuvre (30 octobre 2026)
- Paquet `core/src/skifer_atlas/diff/` : `align.py`, `compare.py`, `classify.py`, `report.py` (modèle de sortie, calcul, rendu texte). La normalisation expose désormais `logical_graph()`, que l'empreinte et le diff partagent : suites de filtres regroupées en `filter_set`, contenus sans métadonnées, encore désignés par les identifiants du document. `ResolvedGraph` garde la variante résolue (`variant`), pour nommer `other` dans le rapport.
- **Court-circuit** : il faut une empreinte égale, une sémantique égale et des métadonnées égales nœud par nœud. L'empreinte ignore libellés et notes : sans ce dernier test, le critère 5 (libellé seul, `cosmetic`) serait masqué. Un diff complet sans aucun écart rend aussi `identical: true`.
- **Alignement** :
  - par identifiant ; une suite de filtres s'apparie par n'importe lequel de ses membres ;
  - puis glouton par score, recalculé après chaque paire ;
  - le type comparé inclut l'opération d'un nœud temporel : un `to_date` n'est jamais apparié à un `period` ;
  - « concept commun aux colonnes touchées » : une colonne liée par un `binding` compte pour l'attribut du concept, sinon pour son nom ; deux sources rattachées au même concept prennent +3 ;
  - la profondeur est le nombre d'opérations structurantes sur le plus long chemin amont ;
  - départage par ordre topologique de `base`, puis d'`other` ; la forme canonique n'est jamais nécessaire, les positions étant uniques ;
  - un score de 3 ou 4 est « faible » (`LOW_SCORE = 5`) : l'écart est classé `to_verify`, sauf s'il est critique ou s'il relève d'une surcharge ou du from scratch.
- **Comparaison** :
  - un filtre seul se lit `condition` + `nulls` ; une suite, `conditions` (forme triée `col:op:val|nulls`) ;
  - les métadonnées (`label`, `note`, `owner`, `bypass_reason`) sont des changements cosmétiques ;
  - le calendrier n'est comparé qu'une fois, au niveau `semantics`, avec `timezone` et `currency` (écart de sémantique : `node_ref` nul, `node_type: semantics`) ;
  - un changement de devise est classé `to_verify` / `warn`.
- **Renommage cohérent** : le nouveau nom d'une colonne produite (calcul, cible temporelle, mesure, métrique, colonne d'union) est substitué en aval avant comparaison. Un renommage suivi partout ne donne qu'un écart `cosmetic`, sur le nœud qui produit la colonne. Les `binding` servent de renommage initial (ES : `sociedad` ↔ `entite`).
- **Équivalence d'expressions** : parenthèses retirées (l'arbre porte déjà les priorités), simplification SQLGlot, opérandes de `+`, `*`, `AND`, `OR`, `=`, `<>` triés. Équivalence démontrée : `cosmetic` / `info`. Sinon : `to_verify` / `warn`.
- **Entrées et ordre** :
  - les entrées d'une paire se comparent après avoir remonté les nœuds non appariés. Si elles diffèrent, le changement s'appelle `inputs`, il est critique, et le message dit « nœud déplacé dans le flux » (un filtre passé de l'autre côté d'une jointure, par exemple) ;
  - `reordered` : deux opérations structurantes appariées (hors sources) dont l'ordre d'ascendance s'inverse. Un écart par paire inversée, sur le nœud amont de `base`, avec `changes: [{field: "order", …}]`. Les changements d'entrées qu'une inversion explique ne sont pas répétés.
- **Gravité** :
  - écarts critiques ajoutés à la spécification : `grain` d'un découpage, `having`, `order` et `aggregate` d'un `metric_op`, fuseau ou format d'une colonne de source, filtre ajouté ou retiré ;
  - un calcul ajouté ou retiré est `warn` ;
  - un écart ni critique ni cosmétique (table source, mode d'union, colonne d'un nœud temporel…) est classé `to_verify`.
- Les classes `override_*` ne s'appliquent qu'en relation `override` : comparer deux variantes entre elles (`free`) ne réutilise pas leur classement de surcharge.
- **`summary`** : l'exemple mélangeait gravité et classe. Le rapport donne `{by_classification: {…six classes…}, by_severity: {info, warn, critical}}`.
- **CLI** :
  - la relation est déduite : `b` variante de `a` donne son mode ; même identifiant, `version` ; sinon `free` ;
  - `--canonical` et `--with` complètent la bibliothèque ;
  - un document qui ne passe pas `atlas check` donne le code 1 ;
  - `atlas schema --kind diff` publie `core/schemas/diff-report.v1.schema.json` ;
  - rapports « golden » dans `core/tests/fixtures/diff/`, à régénérer avec `ATLAS_UPDATE_GOLDEN=1`.
