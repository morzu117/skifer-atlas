# ADR 0075 — Comparaison Databricks réelle depuis l'écran, automatisée

Date : 2026-11-28 · Statut : **acceptée**

## Contexte

Le plan 0015 gardait « à la main » une comparaison réelle sur Databricks lancée depuis l'écran
(#31, #112). La sonde de l'ADR 0072 exécute déjà le SQL compilé sur un warehouse réel, mais
sans l'écran : ni la connexion depuis Mes connexions, ni le lancement, ni la matrice, le détail
et l'historique alimentés par un vrai calcul. Les parcours `comparaison-reelle.spec.ts` et
`comparaison-auth.spec.ts` passent par le faux Databricks, qui ne calcule pas le SQL métier.

## Décision

Le parcours Playwright `app/e2e/comparaison-databricks-reelle.spec.ts`, hors CI, rejoue
l'écran de comparaison de la démonstration Nordis sur un vrai SQL warehouse. Sans
`ATLAS_DATABRICKS_HOST`, `ATLAS_DATABRICKS_WAREHOUSE` et `ATLAS_DATABRICKS_TOKEN`, les mêmes
variables que la sonde, il est sauté : la CI le voit « skipped ».

- **Serveur** : celui de `julien.h` (8793), sans `ATLAS_COMPARE_DATA`, qui exécute vraiment
  sur les points d'accès. L'espace est une copie isolée de la démonstration (`isolatedDemo`,
  qui accepte désormais une retouche du clone avant sa publication).
- **Point d'accès** : dans ce seul clone, `dbx-fr` prend l'hôte et le warehouse de
  l'environnement. `examples/points-acces-nordis.py` n'est pas modifié, et aucune valeur
  réelle n'entre dans le dépôt.
- **Données et catalogue** : `core/tests/databricks_recette.py load|drop <état.json>` charge
  les fichiers de nordis-fr (`core/tests/fixtures/compare/revenu-net/nordis-fr/`) dans les
  tables exactes que lisent les documents, `gold.finance.fact_facturation` et
  `gold.finance.dim_date`, sans renommage. Les sources sont celles que l'écran compile (le
  canonique rebranché et la déclinaison), et leurs types viennent du chargement DuckDB local.
  La logique de chargement de l'ADR 0072 est factorisée dans ce module, et la sonde l'importe.
  - `SHOW CATALOGS` décide de la création : `gold` n'est créé, puis supprimé avec `CASCADE`
    en fin de passage, que s'il était absent. Sinon il reste, et seules les tables chargées
    sont supprimées. Il en va de même pour le schéma `finance`.
  - Chaque objet est noté dans l'état avant sa création. `drop` part de cet état, même après
    un chargement en échec, et ne l'efface qu'une fois tout supprimé.
  - Une table du même nom déjà présente n'est jamais remplacée, sauf si elle porte le
    commentaire des tables de recette, celui d'un passage précédent interrompu.
  - Les requêtes passent par `DatabricksConnector.run_aggregate` du produit.
- **Jeton** : le geste réel de l'écran. On clique « Se connecter » dans Mes connexions, puis
  on refuse l'autorisation : la page du vrai Databricks n'est jamais chargée, le test répond à
  sa place par le retour `access_denied`. L'écran propose alors « Utiliser un token
  personnel » (plan 0008, ADR 0020). Le jeton y est saisi, rangé au coffre (en mémoire pour
  les tests), puis « Tester » exécute `SELECT 1` sur le warehouse. Le jeton n'apparaît ni dans
  le DOM ni sur une ligne de commande, et il est révoqué localement en fin de parcours. Un jeton
  OAuth court (`databricks auth token`) convient, comme pour la sonde.
- **Oracle** : la même comparaison sur les mêmes fichiers en DuckDB local (serveur 8799,
  `ATLAS_COMPARE_DATA`). Elle est relancée par le test, qui vérifie d'abord ses chiffres
  attendus : 8 cellules, 100 %, écart max 0,0 %, montants de 5 163 000 à 5 313 500. Le calcul
  Databricks doit rendre exactement les mêmes cellules, par l'API comme à l'écran :
  - la matrice, dont la teinte vient de `PASS_THRESHOLD` et `WARN_THRESHOLD` ;
  - le détail, avec les valeurs exactes en infobulle ;
  - l'historique ;
  - axe-core, sans violation sérieuse.

  Les deux exécutions doivent être passées par `dbx-fr`. Les seuils et `tone` quittent
  `screens/Comparison.tsx` pour `app/src/thresholds.ts` (réexportés par l'écran) : le parcours
  les importe sans charger l'interface.

Délais : 10 min pour le chargement, le parcours et le nettoyage, 5 min pour la fin de la
comparaison (démarrage du warehouse serverless).

## Conséquences

Le passage réel se lance par une personne disposant d'un workspace (Free Edition suffit), avec
le droit de créer un catalogue si `gold` n'existe pas. Il crée des objets dans ce workspace et
les retire. Un processus tué avant `afterAll` laisse l'état dans le dossier temporaire affiché au début
du passage : `drop` le reprend.

Limites :
- L'ouverture du navigateur système par le plugin shell de Tauri et l'OAuth réel avec de vrais
  identifiants ne s'automatisent pas : le parcours tourne dans Chromium, contre l'app Vite.
- Le consentement refusé est simulé au niveau du réseau du navigateur de test.
- La validation produit des seuils 99 / 90 reste une décision humaine (relecture produit du
  plan 0015) : le test vérifie qu'ils sont appliqués, pas qu'ils sont les bons.
- Une trace Playwright (`--trace on`) enregistrerait le jeton saisi : ne pas l'activer pour ce
  passage.

Premier passage réel : à faire.
