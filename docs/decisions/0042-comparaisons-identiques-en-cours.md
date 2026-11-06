# ADR 0042 — Refuser les comparaisons identiques en cours

Date : 6 novembre 2026

## Contexte

Des demandes simultanées peuvent lancer deux fois la même comparaison et exécuter les mêmes requêtes sur les plateformes.

## Décision

Dans un espace, le cœur refuse une comparaison préparée identique à une exécution encore active avec `comparison_running` (HTTP 409). La vérification et l'inscription du job sont sérialisées par le verrou de création de la base. Les comparaisons différentes restent possibles. Une exécution terminée peut être relancée.

## Conséquences

Le client reçoit une erreur explicite et ne prend pas possession silencieusement d'une exécution déclenchée ailleurs. La protection concerne les jobs actifs du processus ; après redémarrage, une nouvelle demande peut être lancée.

## Précision des dimensions — revue du 6 novembre 2026

Les dimensions décimales qui ne survivent pas exactement à l'aller-retour via `float` sont représentées par un texte exact normalisé (sans zéros finaux superflus). Deux décimaux égaux gardent la même clé. En revanche, un décimal précis, notamment au-delà de 15 chiffres significatifs, n'est plus apparié avec le flottant arrondi renvoyé par une autre plateforme. Ce compromis évite de déclarer égales deux dimensions distinctes : la jointure signale alors des cellules absentes d'un côté. Les nombres et décimaux qui survivent à l'aller-retour continuent à s'apparier entre plateformes.
