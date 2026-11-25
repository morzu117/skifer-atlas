# 0063 — Tests de mutation sur la gouvernance

## Contexte

La couverture (ADR 0062) dit qu'une ligne est exécutée, pas qu'une assertion la vérifie.
Le module `governance/` décide qui peut approuver une proposition et quand elle peut être
fusionnée (plan 0006, ADR 0008) : une erreur muette y ouvre ou ferme un droit.

Le 15 novembre 2026, un passage de mutmut 3.8.1 sur `core/src/skifer_atlas/governance/`
tue 443 mutants sur 555 (80 %). Parmi les 112 survivants, il y a de vrais trous. Une revue
« commentée » pourrait par exemple effacer une approbation. Les noms `access_points` et
`kpis` n'étaient pas vérifiés. La frontière « assez de comptes habilités » n'était pas testée
non plus.

## Décision

- La configuration `[tool.mutmut]` de `core/pyproject.toml` cible `governance/`. Elle lance
  la sélection de tests qui l'exercent.
- Les tests tuent les mutants significatifs avec des assertions exactes : `Issue`, texte des
  explications, sortie YAML et CODEOWNERS.
- Les mutants équivalents sont acceptés sans test artificiel. C'est le cas de `"UTF-8"` au
  lieu de `"utf-8"`, ou de `rsplit` sans limite, qui garde le même dernier élément.
- Les tests ne doivent pas dépendre de l'emplacement de leur fichier : mutmut les copie dans
  `core/mutants/`, qui est ignoré par Git.
- Le passage est manuel, pas en CI : environ 8 minutes pour ce module, et le score n'est pas
  stable d'une version de mutmut à l'autre. On le relance quand on touche à la gouvernance :

  ```sh
  cd core && uv run --with mutmut==3.8.1 mutmut run && uv run --with mutmut==3.8.1 mutmut results
  ```

## Résultat

Avec `core/tests/repo/test_governance_mutation.py`, 546 mutants sont tués sur 555 (98,4 %).
Les 9 survivants sont équivalents :

- `codeowners._body` 49 et 52 : `rsplit("/")` et `rsplit("/", 2)` donnent le même dernier
  élément.
- `codeowners._checksum` 4 : `"UTF-8"` au lieu de `"utf-8"`.
- `model.dump_governance` 2, 4, 6 et 7 : les modes de `model_dump` produisent les mêmes
  valeurs, le modèle n'a que des types JSON.
- `model.dump_governance` 11 : `sort_keys=None` ne trie pas, comme `False`.
- `model.validate_governance` 17 : `issues_from_validation_error` ne lit le YAML brut que
  pour les nœuds de graphe et les discriminants, et la gouvernance n'en a pas.

## Conséquences

Pour la gouvernance, un survivant nouveau est à traiter comme un test manquant, sauf s'il
est équivalent. Les modules suivants (droits des propositions, publication) pourront
rejoindre `paths_to_mutate` de la même façon.

## Extension aux propositions (24 novembre 2026)

`paths_to_mutate` inclut aussi `core/src/skifer_atlas/proposals/`, et la sélection de tests
s'étend aux tests qui les exercent : éditeur, contrats d'API, routes d'espace et catalogue.

Le passage final, hors bac à sable, utilise mutmut 3.8.1 sur le code rebasé sur `main` avec
#210. Il tue 3 478 mutants sur 3 542 (98,2 %) : 561 dans `governance/` et 2 981 dans
`proposals/`. Tous les survivants sont équivalents :

- 55 dans `proposals/`, détaillés ci-dessous.
- 3 dans `governance/`, déjà listés dans Résultat.
- 6 de `model.dump_governance` et `model.validate_governance`, déjà listés dans Résultat,
  finissent en « segfault » : nanobind fait planter le processus à la sortie.

Les équivalents de `proposals/` sont regroupés par motif :

- `common.commit_files` 1, 2, 3, 10 et 11 : le préfixe du répertoire et le nom de l'index
  temporaires ne changent pas le commit.
- `common.commit_files` 28, `create._digest` 4 et `merge.merge_proposal` 107 : `UTF-8`
  et `utf-8` désignent le même encodage.
- `common.parse_body` 4 : pour un corps vide, `"XXXX"` ne contient aucun bloc Atlas, comme
  la chaîne vide.
- `common.render_body` 3 : `ensure_ascii=None` et `False` sont tous deux falsy pour
  `json.dumps`.
- `create.create_access_point_proposal` 37, 40, 43 et 44 : les modes de `model_dump`
  produisent les mêmes valeurs pour les champs primitifs JSON.
- `create.create_access_point_proposal` 42 et 46 : inclure les champs `None` ne change pas
  le modèle revalidé.
- `create.create_governance_proposal` 23 : le contexte ouvert exige déjà une gouvernance
  valide et non vide ; le repli n'est pas utilisé.
- `create.create_governance_proposal` 135 et 136, `create.create_proposal` 172 et 173,
  `current.current_block` 136 et 137 : les erreurs empêchent déjà la construction du bloc
  ou le filtrage des avertissements.
- `create.create_proposal` 121, 127 et 128 : seule la mention de `requirement` est utilisée ;
  elle ne dépend pas du domaine.
- `current.current_block` 79 : la recherche supplémentaire d'un tag ne change pas le diff
  d'une déclinaison ; pour une création canonique, le diff reste absent.
- `current.current_block` 83 et 84 : le diff d'une déclinaison n'utilise pas la base remplacée.
- `merge.merge_proposal` 82, 83 et 84 : `decide` fournit toujours une explication non vide
  quand la fusion est refusée ; le texte de repli est inaccessible.
- `revise.revise` 102 à 110 : le commit construit contient le chemin correspondant à
  l'identité ; l'entrée est donc indexée et la branche de repli est inatteignable.
- `status._label` 15 : `Context.show` remplace une révision `None` par `context.base`.
- `status._revisions` 39, 40 et 42 : un commit Git valide ne contient pas de NUL dans ses
  métadonnées ou son corps ; les deux séparateurs donnent les mêmes trois champs.
- `view._base` 28 : sans graphe de base, le libellé retourné n'est pas utilisé.
- `view._recurring` 34 et 37 : la bibliothèque n'affecte que les diagnostics de `resolve` ;
  seules ses surcharges sont lues.
- `view._undeclared` 3 : l'appelant ne l'utilise que pour une variante dont le canonique
  fournit une base.
- `view.graphs` 110 : un document non variant résolu n'a aucune surcharge ; le résultat
  reste `[]`.
- `view.graphs` 150, 151 et 152 : les valeurs du rapport sont compatibles JSON ; les modes
  de `model_dump` donnent le même dictionnaire.
- `view.graphs` 160 : la proposition courante réajoute son entité à un ensemble qui la
  contient déjà.
- `view.queue` 36 : `fetch=None` et `fetch=False` empêchent tous deux le fetch.

Les tests ajoutés sont `tests/repo/test_proposals_mutation_create.py`,
`tests/repo/test_proposals_mutation_review.py` et `tests/repo/test_proposals_mutation_context.py`.
Ils ont trouvé l'issue #209 : un bloc `atlas-proposal` malformé cassait la liste. Elle est
corrigée par #210 (ADR 0066).

Le passage complet dure plus de deux heures. Après un changement local, une mesure ciblée
suffit : placer les noms des mutants dans un fichier, puis les passer à `mutmut run` :

```sh
cd core && xargs uv run --with mutmut==3.8.1 mutmut run < noms-mutants.txt
```
