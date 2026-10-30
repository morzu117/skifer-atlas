# ADR 0006 — Brouillons d'extraction : statut, valeurs `TODO` et trace d'origine dans le document

Date : 2026-10-30 · Statut : **acceptée** (mise en œuvre du plan 0004)

## Contexte

`atlas extract` (plan 0004) produit un document à partir d'un SQL existant. Une partie de ce que demande le modèle (plan 0001) ne se lit pas dans le SQL : propriétaire, domaine, calendrier, fuseau, types des colonnes, cardinalité des jointures, entité d'un concept. Il y a trois options :

- un format de brouillon à part, ce que le principe « le YAML Skifer est le format pivot » (ADR 0002) écarte ;
- des valeurs inventées, qui passeraient la validation sans que personne ne les ait choisies ;
- un document ordinaire qui marque explicitement ce qui reste à compléter.

## Décision

- **Un brouillon est un document Atlas ordinaire** (concept ou KPI), avec deux champs facultatifs de plus :
  - `status: draft | needs_curation` ;
  - `extraction: {source_file, line, dialect, sql_sha256, residues}`, la trace de l'origine. Elle n'est admise qu'avec un `status`.
  
  Un document curé n'a ni l'un ni l'autre.
- **`TODO` est un littéral réservé.** Il n'est accepté que là où l'extraction ne peut pas savoir :
  - `owner` d'un produit ou d'une source ;
  - `data_product.domain` ;
  - `semantics.calendar` et `semantics.timezone` ;
  - le type d'une colonne de source ;
  - la `cardinality` d'une jointure ;
  - le fuseau d'un `to_date` ou d'un `convert_timezone` ;
  - l'`entity` d'un concept ;
  - le schéma d'une table, sous la forme `TODO.<table>`.
  
  Ailleurs, un champ typé (énumération, motif) la refuse dès le schéma.
- **Validation** :
  - chaque `TODO` est signalé (`todo`, « Valeur à compléter. ») ;
  - c'est un avertissement dans un brouillon, une erreur dans un document sans statut ;
  - un document `needs_curation` est refusé (`needs_curation`) ;
  - un brouillon `draft` qui garde un résidu bloquant est refusé (`blocking_residue`).
  
  `ValidationResult.valid` signifie désormais « aucune erreur » : les avertissements n'empêchent ni le chargement ni le diff.
- **Résidus** : `{code, message, blocking, sql_excerpt_hash}`. Un message ne cite jamais de valeur, de nom de table, de colonne ni de fonction propre au client. Seuls des mots-clés SQL et des noms de fonctions connues de SQLGlot le complètent. L'extrait fautif n'est désigné que par son empreinte (16 caractères hexadécimaux du SHA-256).
- **Statut** : un brouillon qui a au moins un résidu bloquant est écrit en `needs_curation`. Le curateur lève les résidus, les retire de la liste, passe le statut à `draft`, complète les `TODO`, puis retire `status` et `extraction`.

## Conséquences

- Un brouillon se charge, se contrôle et se compare (`atlas diff`) avant toute curation. C'est ce qui permet de confronter deux implémentations d'un même KPI dès l'extraction.
- La liste des champs qui admettent `TODO` fait partie du schéma (`core/schemas/atlas-document.v1.schema.json`). L'étendre passe par une modification du plan 0001.
- Une colonne de type `TODO` est de type inconnu pour les contrôles de colonnes. Elle ne déclenche pas `implicit_timezone_conversion` : ce contrôle ne s'applique qu'à une colonne dont on sait qu'elle n'a pas de fuseau.
