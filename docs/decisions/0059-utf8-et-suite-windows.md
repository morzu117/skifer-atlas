# 0059 — UTF-8 et suite Python sous Windows

## Contexte

La distribution Windows utilise Git et DuckDB comme les autres plateformes. Le code
page local ne représente pas les messages et identités Unicode ; les objets Git peuvent
être en lecture seule sous Windows et DuckDB y signale autrement un fichier occupé.

## Décision

Les échanges textuels avec Git et les sorties de la CLI utilisent UTF-8, indépendamment
de la locale ; Git restitue les chemins et messages en Unicode. Les fichiers du produit
sont lus et écrits explicitement en UTF-8. Le message de verrouillage DuckDB Windows
suit la même politique d'attente et d'erreur `index_busy` que sur Unix. Le nettoyage
retire l'attribut lecture seule des fichiers lorsque nécessaire et laisse remonter les
autres erreurs. La démonstration est construite en Python et Git, sans Bash, par `examples/depot-nordis.py`,
seule source de son historique ; `examples/depot-nordis.sh` n'en est plus qu'un relais.
La suite conserve des tests portables de ces comportements sur les trois plateformes.

À la création d'un espace, `atlas.yaml` et `governance.yaml` sont écrits en UTF-8
avec des fins de ligne LF explicites. Les commits d’identité et de retour écrivent
directement le YAML de gouvernance en UTF-8 avec des fins de ligne LF. Ainsi, l'arbre initial et le commit de retour d'identité
concordent même si `core.autocrlf` est désactivé sous Windows. Nous ne forçons pas la
configuration Git des dépôts existants : leurs attributs et préférences de copie de travail
restent ceux de leurs utilisateurs.
