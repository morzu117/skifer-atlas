# Plan 0037 — Connecteur BigQuery

## Objectif
Un point d'accès BigQuery s'authentifie par OAuth avec le compte Google de l'utilisateur et participe aux comparaisons chiffrées au même titre que Databricks et Snowflake : troisième dialecte de compilation, troisième connecteur.

## Périmètre
**Dedans** : dialecte `bigquery` de la compilation ; `connectors/bigquery.py` sur l'interface de 0008, par l'API REST (`jobs.query`), sans bibliothèque cliente Google ; champs BigQuery du point d'accès ; OAuth Google (PKCE, retour en boucle locale) ; intégration dans `connections.py`, la comparaison (0009) et les écrans Connexions et Comparaison ; faux serveur de test ; recette réelle hors CI.
**Dehors** : Fabric et Redshift (brief 7.1) ; comptes de service et mode planifié (brief 7.2) ; extraction depuis du SQL BigQuery (0004) ; état « Compilable » de l'éditeur (guide 10.3, qui ne cite que Databricks et Snowflake) ; Storage Read API et résultats au-delà de `max_rows`.

## Références
Brief 7.1, 7.2, 8.3 ; plans 0007, 0008, 0009, 0016, 0018, 0021, 0030, 0031 ; ADR 0004, 0011, 0022, 0025, 0034, 0036.

## Découpage
Un point = une PR, fusionnée sur une CI verte avant d'ouvrir la suivante.

| Point | Objet | Dépend d'une décision humaine |
|---|---|---|
| 1 | Dialecte `bigquery` de la compilation (ADR 0076) | non |
| 2 | Connecteur REST, champs du point d'accès, faux serveur | non |
| 3 | OAuth Google, `connections.py`, écrans | **oui** : client OAuth Google (voir « Questions ouvertes ») |
| 4 | Recette réelle hors CI, ajustements de compilation révélés | **oui** : projet GCP de test |

## Spécification

### Point 1 — dialecte
- `bigquery` entre dans `compile.DIALECTS`. `editor.DIALECTS` et `extract.DIALECTS` ne changent pas.
- Chaque règle déjà posée pour deux moteurs a sa forme BigQuery (ADR 0076) : échec volontaire de la garde de cardinalité, division, début de semaine, tri des nulls, agrégats distincts en fenêtre, `TRY_CAST`, heure murale d'une colonne `timestamp`.
- Ce que SQLGlot ne traduirait pas fidèlement est refusé par `NotCompilable`, jamais traduit en silence.
- Aucune exécution BigQuery en CI : les tests portent sur le SQL produit, sa relecture par SQLGlot dans le dialecte, et, quand la formule est portable, son exécution sur DuckDB après traduction. La fidélité sur le moteur réel est l'objet du point 4.

### Point 2 — connecteur
- `POST /bigquery/v2/projects/{projet}/queries` (`useLegacySql: false`, `maxResults: max_rows + 1`, `timeoutMs` court), puis `getQueryResults` jusqu'à `jobComplete` ; annulation et délai par `jobs.cancel`. `location` transmis s'il est déclaré.
- Point d'accès : `project` (projet de facturation des requêtes), `location` facultatif, `schema` = `projet.dataset` ou `dataset`. Le connecteur exige `project`, un `host` Google (`https://bigquery.googleapis.com`) ou en boucle locale pour le faux serveur, et l'absence des champs Databricks et Snowflake. Le registre conserve la lecture des déclarations BigQuery anciennes ; Databricks et Snowflake refusent les nouveaux champs BigQuery. Les champs requis du panneau de déclaration relèvent du point 3.
- Types rendus en minuscules ; `INT64`, `NUMERIC`/`BIGNUMERIC` (Decimal), `FLOAT64`, `BOOL`, `DATE`, `DATETIME`, `TIMESTAMP` (instant UTC) convertis ; `RECORD` et `REPEATED` refusés (`query_failed`) : un résultat agrégé n'en porte pas.
- 401 : `AuthRejected`. 403 : `platform_forbidden`. 404 : `platform_not_found`. Le jeton est masqué dans tout message restitué.
- `bigquery` n'entre pas encore dans `SUPPORTED_PLATFORMS` : sans authentification (point 3), l'écran ne doit pas le proposer.

### Point 3 — OAuth Google et écrans
- Points d'entrée fixes de Google (pas de découverte par hôte), PKCE S256, retour sur `http://127.0.0.1:<port>`, `access_type=offline`, portée limitée à BigQuery en lecture et exécution de requêtes.
- Jetons au coffre local, par espace ; rafraîchissement, révocation et états de l'écran Connexions comme pour Databricks.
- `bigquery` entre dans `SUPPORTED_PLATFORMS` ; panneau « Nouveau point d'accès » : projet, emplacement, jeu de données.

### Point 4 — recette réelle
- `core/tests/test_bigquery_real.py`, marqué `bigquery`, hors CI, sur le modèle de `test_databricks_real.py` (ADR 0072) : SQL compilé des fixtures de 0007 comparé à DuckDB, types, borne `max_rows`, garde de cardinalité.
- Les écarts trouvés donnent chacun une issue et un correctif avec un test qui échoue sans lui.

## Critères d'acceptation
1. Tout document des fixtures de 0007 qui se compile en Databricks et Snowflake se compile en BigQuery ou rend `not_compilable` avec le nœud et la raison ; le SQL produit se relit en BigQuery.
2. Les règles de l'ADR 0025 (division, semaine, garde) et des ADR 0034 et 0036 (heure murale) ont un test BigQuery chacune.
3. Le connecteur, contre le faux serveur : `test`, requête agrégée, pagination, `result_too_large`, délai, annulation, 401, 403, 404, jeton masqué.
4. L'OAuth contre le faux serveur : connexion, rafraîchissement, révocation, refus, port occupé ; aucun jeton hors du coffre.
5. Une comparaison Revenu net avec une entité sur BigQuery s'exécute et se réconcilie (0009).
6. Recette réelle : même résultat que DuckDB sur un projet GCP de test (bac à sable BigQuery suffisant).
7. Le binaire figé compile et exécute en BigQuery (`_selftest` charge `sqlglot.dialects.bigquery`).

## Questions ouvertes (décision humaine avant le point 3)
1. **Client OAuth Google.** Google n'a pas de client public réutilisable comme `databricks-cli`, et un client « application de bureau » a un `client_secret` que Google ne tient pas pour confidentiel. Options :
   a. un client « Skifer Atlas » posé dans la build de release, comme `ATLAS_GITHUB_CLIENT_ID` (0025), surchargeable par point d'accès — recommandé ; demande de créer le client et, pour un usage hors comptes de test, la vérification Google de la portée BigQuery ;
   b. `oauth_client_id` obligatoire par point d'accès, déclaré par le référent de l'espace, le `client_secret` étant saisi une fois par utilisateur et rangé au coffre ;
   c. réutiliser les identifiants `gcloud` du poste (ADC) : écarté d'avance, les jetons vivraient hors du coffre d'Atlas.
2. **Projet GCP de test** pour le point 4 : à créer par le propriétaire (bac à sable BigQuery, sans carte bancaire).

## Tests
- Unitaires : formes SQL par règle, conversions de types, machine d'états OAuth.
- Intégration : `core/tests/connections/fake_bigquery.py`, parcours Playwright de l'écran Connexions contre ce faux serveur.
- Réels, hors CI : marqueur `bigquery`.

## Dépendances
0007, 0008, 0009, 0016, 0018.

## Estimation
**L**. Incertitudes : heure murale sans fonction `TYPEOF` en BigQuery ; vérification Google du client OAuth ; élagage des partitions sous les formules d'heure murale.

## Mise en œuvre

### Point 1 — dialecte (28 novembre 2026)
Dialecte et garde dans `core/src/skifer_atlas/compile/dialects.py`, `cardinality.py` et
`builder.py` ; import dynamique dans `selftest.py`. ADR 0076, tests de compilation et deux
références SQL BigQuery dans `core/tests/fixtures/compile/golden/`. Les tests couvrent les
formes GoogleSQL, leurs refus, la CLI, le selftest et les formules portables sur DuckDB :
dix tests ajoutés, un test de selftest complété et quatre cas de test d'arrondi décimal.
Après les corrections de l'échelle décimale et du type du début de semaine, la suite
`tests/compile` compte 146 succès. Les deux contrôles Ruff passent.

### Point 2 — connecteur (28 novembre 2026)
Connecteur REST, contrôle des champs à son initialisation, faux serveur et tests du contrat. Les anciens points BigQuery restent lisibles ; les champs requis à la déclaration dans le panneau relèvent du point 3.
Les hypothèses d'encodage des cellules et les limites des types sont consignées dans
l'ADR 0077 ; elles restent à vérifier sur BigQuery au point 4. Le connecteur reçoit un
jeton déjà obtenu et n'est pas encore proposé par les écrans.

### Point 4 — recette réelle (28 novembre 2026)
La sonde et son chargeur sont décrits dans l'ADR 0078. Depuis `core/`, avec un projet de test et les droits nécessaires :

```sh
export ATLAS_BIGQUERY_PROJECT='<projet>'
export ATLAS_BIGQUERY_TOKEN="$(gcloud auth print-access-token)"
# Facultatifs : ATLAS_BIGQUERY_LOCATION et ATLAS_BIGQUERY_DATASET (défaut : atlas_recette).
uv run --offline pytest -s -m bigquery
```

Le chemin de l'état est affiché avec `-s`. En cas d'interruption, `uv run --offline python tests/bigquery_recette.py drop <état.json>` reprend le nettoyage avec le projet et le jeton
de l'environnement. Le jeu créé est supprimé sans `deleteContents` : des tables étrangères
empêchent sa suppression et l'état est conservé. La pagination, l'annulation et le délai ne
sont pas forcés sur le service réel ; leurs limites et la couverture par le faux serveur
sont précisées dans l'ADR 0078. Premier passage réel encore à faire.
