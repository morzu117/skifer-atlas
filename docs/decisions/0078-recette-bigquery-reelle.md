# ADR 0078 — Recette BigQuery réelle

Date : 2026-11-28 · Statut : **acceptée**

## Contexte

Les hypothèses des ADR 0076 et 0077 doivent être éprouvées sur le service réel ; le faux serveur ne démontre pas le format des réponses Google.

## Décision

La sonde `core/tests/test_bigquery_real.py`, marquée `bigquery` et hors CI, utilise un jeton de l'environnement. Elle charge de petites fixtures dans des tables aux noms aléatoires, compare le SQL compilé à DuckDB et vérifie les types et règles du dialecte. Le module `bigquery_recette.py` exécute les instructions de chargement par REST : une réponse DDL peut ne pas contenir de schéma. Il note les objets avant création et conserve le jeu de données préexistant. Le nettoyage vérifie la marque du jeu de données créé et ne le supprime que s'il est vide.

## Conséquences

Le projet et le jeton doivent autoriser les requêtes et la création des objets. Le nettoyage dépend du service et des droits. Les encodages, les erreurs et les comportements aux limites restent à constater sur BigQuery ; le bac à sable et ses quotas doivent être vérifiés par l'opérateur.

Premier passage réel : à faire.

Le chemin du fichier d'état est affiché au début du passage (`pytest -s`). Après une
interruption, avec le même projet et un jeton valide, reprendre le nettoyage depuis `core/` :

```sh
uv run --offline python tests/bigquery_recette.py drop /chemin/vers/etat.json
```

L'état contient le projet, le jeu de données et les marques, jamais le jeton. Une table
absente est ignorée ; seules les tables portant la marque du passage sont supprimées. Un
jeu créé par le passage n'est supprimé que si sa marque correspond. La suppression est
faite sans `deleteContents` : si des tables étrangères restent dans le jeu, BigQuery la
refuse et l'état est conservé pour une nouvelle tentative après intervention.

La sonde ne force pas la pagination réelle : `maxResults = max_rows + 1` renvoie
normalement une seule page tant que la réponse ne dépasse pas 10 Mo, et une pagination
forcée à bas coût n'est pas disponible ici. Elle ne teste pas non plus l'annulation et
le délai réels : une réponse immédiate peut terminer avant leur contrôle ; ces chemins
restent couverts par le faux serveur. Les observations incertaines sur le débordement
décimal et l'heure murale sont imprimées et enregistrées sans imposer leur résultat.
