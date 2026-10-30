# ADR 0002 — Le graphe s'écrit dans un bloc `graph:` du document YAML Skifer

Date : 2026-10-30 · Statut : **acceptée** (arbitrage du 30 octobre 2026, voir `docs/analysis.md` §6)

## Contexte

Le brief (3.4) veut sérialiser le graphe dans « le YAML actuel du moteur Skifer » en n'y ajoutant qu'un identifiant stable par nœud et une version de schéma. Or le schéma de pipeline du moteur est un gabarit à forme fixe (`tables` → `join` → `where` → `add_columns` → `aggregate`) : il n'a pas de topologie libre, ni union, ni opération temporelle, ni référence versionnée. Le modèle sémantique ne décrit que des métriques sur une table.

## Décision

- Un document Atlas est un document YAML Skifer. Il garde les blocs existants (`data_product` pour `id`, `version`, `owner`, `domain`) et en ajoute trois : `schema_version` (entier), `kind` (`concept` | `kpi` | `variant`) et `graph: {nodes, output}`.
- Chaque nœud a un `id` stable (`n01`…), un `type` pris parmi les dix et des `inputs`. Ses champs réutilisent les grammaires du moteur : opérateurs de filtre `FILTER_OPERATORS`, opérations `COLUMN_OPS`, fonctions `AGGREGATE_FUNCTIONS`, types de jointure, calendriers `calendars/<key>.yaml`.
- Le bloc est spécifié une seule fois, avec son JSON Schema, et sera reconnu par le moteur, qui l'ignore au runtime Spark tant qu'aucun compilateur `graph` → pipeline n'est branché.

## Options écartées

- Découper le graphe en `partials` avec des `id` posés sur les éléments existants : union, temporel, référence et opération entre métriques n'ont pas d'équivalent, et l'ordre imposé par le gabarit déforme les graphes réels.
- Un format propre à Atlas : interdit par le brief.

## Conséquences

- Le moteur Skifer doit accepter les clés `schema_version`, `kind` et `graph` (aujourd'hui, ses listes de clés autorisées les rejetteraient). Voir l'ADR 0003 pour l'ordre de livraison.
- Le diff, l'éditeur et la validation travaillent directement sur la topologie déclarée.
