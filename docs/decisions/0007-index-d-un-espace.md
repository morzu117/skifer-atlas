# ADR 0007 — Index d'un espace : identifiants, statuts, versions résolues

Date : 2026-10-30 · Statut : **acceptée** (mise en œuvre du plan 0005)

## Contexte

Le plan 0005 lit le clone d'un espace, valide chaque document et l'indexe dans DuckDB. Plusieurs points ne sont pas fixés par le plan ni par le modèle (plans 0001 et 0002) :

- l'identifiant d'une variante, que la disposition range sous `variants/<kpi-id>/<entité>.yaml` ;
- le statut affiché d'un document, entre les erreurs de validation, les brouillons (ADR 0006) et un document sain ;
- la version d'un KPI contre laquelle on contrôle un `kpi_ref` ou une variante, quand le canonique a évolué depuis ;
- la convergence d'un KPI avant toute comparaison chiffrée (plan 0009).

## Décision

- **Le chemin impose l'identifiant.**
  - Un concept ou un KPI a pour identifiant le nom de son fichier.
  - Une variante a pour identifiant `<kpi-id>--<entité>`, comme dans les exemples du plan 0001.
  - Un `data_product.id` différent donne l'erreur `id_mismatch`. Un document rangé dans le mauvais dossier donne `wrong_folder` : un `kind` qui ne correspond pas au dossier, ou une variante dont `variant_of.id` ou `entity` contredit son chemin.
- **Statut indexé** :
  - `invalid` dès qu'il y a une erreur autre que `needs_curation` ou `blocking_residue` ;
  - sinon le `status` du document (`draft`, `needs_curation`) ;
  - sinon `validated`.
  
  `validated` veut dire « valide au commit indexé ». Ce n'est pas une approbation : le circuit de validation est celui du plan 0006.
- **Rien n'est ignoré.**
  - Un document invalide garde dans l'index ce qu'on a pu lire (libellé, domaine, version) et ses diagnostics.
  - Ses dépendances se lisent dans le YAML brut : elles restent visibles dans le graphe de dépendances, si bien que l'impact d'une modification tient compte des documents à réparer.
- **Versions résolues.**
  - La `Library` qui résout `kpi_ref` et canoniques contient les KPI valides au commit courant, plus chaque version qu'un document désigne et qui n'est plus la version courante. Celle-ci est relue au tag `doc/<id>/v<n>`.
  - Ainsi, un KPI qui passe en v5 n'invalide pas ce qui référence sa v4. Une variante résolue sur une version antérieure porte l'avertissement `outdated_canonical`, « à réaligner ».
  - Sans tag, la référence reste en erreur.
- **Convergence**, tant que le plan 0009 n'a rien écrit :
  - un KPI sans variante est `converged` ;
  - un KPI qui a des variantes est `never_compared` ;
  - un concept n'a pas de convergence (`null`).
- **Catalogue et fiches.** Le catalogue liste les concepts et les KPI. Les variantes sont indexées comme documents, mais on y accède par la fiche de leur KPI.
- **Fraîcheur.** L'index est reconstruit entièrement, à la lecture, dès que `HEAD` ou la version du schéma diffère de `index_meta`. Il n'y a pas de mise à jour incrémentale : mille documents se reconstruisent en une seconde environ, avec libyaml quand il est installé.

## Conséquences

- Renommer un fichier change l'identifiant du document. Le plan 0006 devra le traiter comme une suppression suivie d'une création, et non comme un renommage.
- Un tag posé ou retiré sans nouveau commit ne déclenche pas de reconstruction. Ce n'est pas un problème, car le plan 0006 pose les tags au commit de fusion.
- L'interface (plans 0011 et 0012) affiche les quatre statuts et les diagnostics tels quels. Elle n'a pas à relancer la validation.
