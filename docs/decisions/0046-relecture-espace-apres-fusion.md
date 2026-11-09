# ADR 0046 — Relecture de l'espace après une fusion

Date : 9 novembre 2026

## Contexte et décision

Une fusion de gouvernance peut modifier les domaines proposés à la création d'un document. L'espace conservé par la coque restait inchangé après cette fusion, notamment après un rattachement dont la réponse ne contient pas les domaines actualisés.

Après une fusion réussie depuis l'Administration ou les propositions, la coque relit l'espace et transmet l'objet actualisé aux écrans, sans démonter la vue en cours. Une proposition simplement ouverte ne déclenche pas cette relecture. En cas d'échec de la relecture, la vue reste disponible avec les dernières données reçues.

Cette décision est distincte de l'ADR 0045 : elle concerne la cohérence de la gouvernance dans toute l'application, indépendamment du calendrier civil intégré.

## Limites acceptées

- Une relecture en vol n'est pas annulée par un `setLoad` issu du rattachement ou de la réinitialisation. Cette séquence est quasi impossible : le rattachement exige l'absence de dépôt, la fusion un dépôt.
- Une relecture pendant « Nouvelle variante » peut relancer la lecture de la fiche : l'effet de `Editor.tsx` dépend de `ws.entities`.
- Si l'enregistrement retire le rôle de référent, la relecture redirige vers le catalogue et le message « Paramètres enregistrés » disparaît avec la vue.
- La valeur initiale du domaine de « Nouveau concept ou KPI » est lue au montage.
