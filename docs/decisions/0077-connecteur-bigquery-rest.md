# ADR 0077 — Connecteur BigQuery REST

Date : 2026-11-28 · Statut : **acceptée**

## Contexte

Le point 2 du plan 0037 exécute les requêtes agrégées BigQuery avec un jeton déjà obtenu.
Le binaire figé doit rester léger et ne pas confier les identifiants à un cache tiers.

## Décision

Le connecteur utilise l'API REST avec la bibliothèque standard, sans client Google. Il
emploie `jobs.query`, puis `getQueryResults` et `jobs.cancel`, avec une limite de lignes et
un délai. Il demande `useInt64Timestamp` pour lire les instants en microsecondes UTC. Il
n'envoie pas `jobCreationMode` : un job est toujours créé, même lorsque l'attente expire.
Les types structurés, répétés, BYTES, TIME, GEOGRAPHY, JSON et RANGE sont refusés.

À son initialisation, le connecteur exige un projet, un hôte Google ou en boucle locale
et aucun champ propre à Databricks ou Snowflake. Le modèle conserve la lecture des
anciens points BigQuery ; les champs requis du panneau de déclaration relèvent du point 3.

Les pages consultées ne documentent pas la forme des cellules retenue ici : ligne `f`,
cellule `v`, scalaire en chaîne, NULL en null, booléen en minuscules, TIMESTAMP entier
microseconde, DATE ISO et DATETIME ISO avec séparateur `T`. Ces hypothèses et les
conversions strictes doivent être vérifiées sur le moteur réel au point 4.

## Résultat

Le connecteur produit des entiers, décimaux, flottants, booléens, dates, heures murales
naïves et instants UTC avec fuseau ; il refuse les valeurs et types inattendus.

## Conséquences

Le faux serveur ne prouve pas le format réel de BigQuery. La recette réelle doit vérifier
les encodages, la pagination, les délais et l'annulation. L'authentification et l'exposition
dans les écrans restent au point 3.
