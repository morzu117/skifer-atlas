# ADR 0055 — Références en retard sur la fiche KPI

Date : 11 novembre 2026 · Statut : **acceptée**

## Contexte

Une référence à un KPI est épinglée sur une version immuable. Après la fusion d'une nouvelle version du KPI référencé, cette référence continue de fonctionner mais son retard n'était pas visible sur la fiche.

## Décision

Sur la fiche du KPI qui référence, chaque référence à une version antérieure à la version courante du KPI référencé affiche « Revenu net : épinglé v4, version courante v5 », avec un lien vers sa fiche. Sur la fiche du KPI référencé, chaque entrée en retard de « Référencé par » affiche « épinglé v4 » à côté du nom ; les entrées à jour restent inchangées. Le signal est informatif et accessible en texte. Il n'apparaît pas dans le catalogue.

Le retard est calculé depuis l'index lorsque les deux versions sont connues et que la version épinglée est inférieure à la version courante. Une cible absente ou sans version courante n'est pas déclarée en retard. Les références ne sont pas mises à jour automatiquement.

## Conséquences

Les dépendances exposent la version courante et le statut de retard en plus de la version épinglée, sans requête réseau par référence. La décision de modifier une référence reste explicite et passe par le processus de versionnement habituel. Le signal dépend de l'état de l'index local.
