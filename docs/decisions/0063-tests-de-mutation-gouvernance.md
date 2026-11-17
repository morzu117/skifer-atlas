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

## Extension aux propositions (17 novembre 2026)

`paths_to_mutate` inclut aussi `core/src/skifer_atlas/proposals/`, et la sélection de tests
s'étend aux tests qui les exercent : éditeur, contrats d'API, routes d'espace et catalogue.
Le passage compte 3 418 mutants et dure plus de deux heures. Sur les 1 826 premiers, 514
survivent (28 %). Ils se concentrent dans `revise`, dans la création des propositions de
gouvernance et de points d'accès, dans `view.graphs` et dans `viewer`. Pour `viewer`, ce sont
les droits affichés, `can_close` et `can_revise` ; le serveur, lui, refuse bien l'action.
Comme pour la gouvernance, les survivants significatifs deviendront des tests.
