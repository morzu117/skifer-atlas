# ADR 0074 — Racine des expressions SQL

Date : 2026-11-28 · Statut : **acceptée**

## Contexte

L'issue #226 montre qu'un bloc Python analysé en repli `Command` par SQLGlot, ou une
instruction comme `DROP TABLE ventes`, pouvait passer la validation et le contrôle du graphe.
L'absence de colonnes dans le repli ne provoquait aucune erreur de colonne inconnue.

## Décision

Dans le validateur commun, exiger une racine SQLGlot `exp.Condition` pour `compute.expr`,
`metric_op.metrics[].expr` et les conditions `{expr: ...}` de `filter` et `having`. Sinon,
rendre `invalid_value` : « Cette expression n'est pas une expression SQL. » La grammaire
Skifer des conditions simples reste inchangée. Le validateur de cadre temporel utilise aussi
ce point commun ; son expression enveloppante `Window` est une `Condition`.

Les formes demandées, notamment les fonctions fenêtrées et les dates ou intervalles en
opérande, ont cette racine avec SQLGlot installé : aucune exception n'est nécessaire. Un
intervalle isolé (`INTERVAL 1 DAY`) n'est pas une `Condition` et reste donc refusé. Cette
validation syntaxique ne remplace pas les contrôles ultérieurs de colonnes, fonctions,
agrégations, fenêtres et sous-requêtes dans le graphe.

SQLGlot peut toujours journaliser son avertissement de repli `Command` avant le rejet : il ne
propose pas ici d'option locale pour le désactiver, et modifier le journal global affecterait
les autres analyses concurrentes.

## Résultat

Les tests couvrent les quatre champs et dix racines refusées, les formes d'expression admises,
la CLI et le rendu API. Sans la règle, les 40 cas de rejet du modèle et les deux cas CLI de
l'issue échouent ; les deux témoins CLI passent. Le test API échoue également sans la règle.
La comparaison des documents YAML et JSON du dépôt avant et après la règle ne révèle aucun
nouveau rejet.

## Conséquences

Une instruction ou une requête complète n'est plus acceptée comme expression. Une expression
syntaxiquement admise peut encore être refusée par les contrôles sémantiques du graphe.
