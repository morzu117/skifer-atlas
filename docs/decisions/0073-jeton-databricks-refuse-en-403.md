# ADR 0073 — Jeton Databricks refusé en 403

Date : 2026-11-26 · Statut : **acceptée**

## Contexte

Lors de la recette Databricks Free Edition (#223), l'API Statement Execution répond 403 avec
un message commençant par `Invalid access token` pour un jeton inconnu. Sans en-tête
`Authorization`, elle répond 401. Le connecteur ne traitait que le 401 comme un refus
d'authentification : le 403 empêchait le rafraîchissement OAuth et donnait à tort
`platform_forbidden`.

## Décision

Un 403 dont le champ JSON `message`, après suppression des espaces de tête et sans tenir
compte de la casse, commence par `Invalid access token` déclenche `AuthRejected`, comme un
401. Les autres 403 restent des refus de droits `platform_forbidden`. Le service conserve le
comportement de l'ADR 0011 : un jeton OAuth est rafraîchi et la requête retentée une fois ;
un refus persistant marque l'accès `rejected` et renvoie `access_expired`.

Le faux Databricks reproduit les réponses 403 pour un jeton inconnu et 401 pour un en-tête
absent, sans modifier son 403 de droits.

## Résultat

Les tests du connecteur couvrent les deux variantes du message, le 401 et les autres 403.
Les tests du service vérifient le rafraîchissement réussi et le refus persistant avec l'accès
marqué `rejected`. Sans la condition sur le 403, les quatre variantes échouent.
Contre le warehouse réel (Free Edition, 26 novembre 2026), un jeton fantaisiste et un PAT
inconnu lèvent désormais `AuthRejected`, et un jeton valide passe toujours.

## Conséquences

Un jeton refusé peut être renouvelé ou signalé expiré ; un refus de droits conserve son
code distinct. La reconnaissance dépend du préfixe du message renvoyé par Databricks.
