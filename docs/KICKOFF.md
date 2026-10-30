# Skifer Atlas — prompt de lancement

Tu travailles dans le dépôt `skifer-atlas`, un module de l'écosystème Skifer. Ta mission : t'approprier le projet, puis découper le développement en plusieurs plans « spec-driven », chacun livrable et testable indépendamment. Tu ne codes rien avant que les plans soient validés.

## 1. Lecture obligatoire, dans cet ordre

1. `CLAUDE.md` — règles du dépôt, non négociables.
2. `docs/brief.md` — source de vérité fonctionnelle. Lis-le intégralement, sections 3 à 9 avec une attention particulière : vocabulaire fermé des dix nœuds, sémantique figée, variantes par surcharge et from scratch, gouvernance, espaces et domaines, comparaison structurelle et chiffrée, stockage Git et DuckDB.
3. `docs/decisions/0001-stack-tauri-sidecar-python.md` — la stack retenue et ses conséquences.
4. `docs/design/style-guide.md` — règles de style, composants, grammaire des graphes, et spécification écran par écran (section 5). Le tableau des champs obligatoires par type de nœud (10.3) est une spec à part entière.
5. `docs/design/screens/*.html` — ouvre les huit maquettes. Elles sont la référence visuelle ; la fiche KPI (10.2) est marquée « à retravailler ».
6. `docs/design/tokens.css` — les tokens ; toute couleur ou taille passe par là.
7. Le code existant : `core/src/skifer_atlas/` (registre des espaces, API FastAPI, point d'entrée sidecar), `app/src/` (accueil des espaces), `app/src-tauri/src/lib.rs` (lancement du sidecar). C'est un squelette : il fixe les conventions, pas l'architecture finale.
8. Le moteur Skifer dans `../skifer` : son `README.md`, son `CLAUDE.md`, et surtout le format YAML qu'il utilise aujourd'hui (schemas de pipeline, semantic layer). Atlas doit s'appuyer sur ce YAML, pas en inventer un autre. Relève précisément ce que le YAML actuel sait exprimer, ce qui manque pour les dix nœuds, et où un identifiant stable par nœud et une version de schéma peuvent s'insérer.

## 2. Restitution attendue avant tout plan

Produis `docs/analysis.md` avec :

- **Ce que tu as compris**, en une page : le problème, le modèle canonique, les deux modes de variante, la comparaison, le local-first.
- **Écarts et ambiguïtés** : tout ce que le brief ou les maquettes laissent ouvert et qui bloque une implémentation (par exemple : forme exacte d'une surcharge dans le YAML, règle d'appariement des nœuds en diff, format du scope, ce qu'est un « concept » au niveau YAML par rapport à un KPI). Pour chaque point : la question, les options, ta recommandation. Ne tranche pas seul ce qui relève du produit ; propose.
- **Correspondance YAML Skifer ↔ dix nœuds** : un tableau nœud par nœud, avec ce qui existe déjà dans le moteur, ce qu'il faut étendre, ce qu'il faut créer.
- **Risques techniques** classés : PyInstaller et imports dynamiques, authentification native Databricks/Snowflake en sidecar, taille du binaire, React Flow pour le diff, performance de SQLGlot sur de gros graphes.

## 3. Découpage en plans spec-driven

Propose ensuite une série de plans numérotés dans `docs/plans/`, un fichier par plan (`0001-<slug>.md`). Chaque plan est autonome et respecte ce gabarit :

```
# Plan NNNN — <titre>

## Objectif
Une phrase. Ce qui est vrai à la fin et ne l'était pas avant.

## Périmètre
Dedans / Dehors, explicite.

## Références
Sections du brief, écrans, ADR, fichiers concernés.

## Spécification
Comportement attendu, formats de données (YAML, JSON d'API, schéma DuckDB), règles métier avec les cas limites.
Tout ce qu'un développeur doit savoir pour implémenter sans revenir vers le produit.

## Critères d'acceptation
Liste vérifiable. Chaque critère correspond à au moins un test.

## Tests
Unitaires, intégration, et ce qui doit être vérifié à la main dans l'app.

## Dépendances
Plans requis avant celui-ci.

## Estimation
Taille (S / M / L) et ce qui la rend incertaine.
```

Contraintes sur le découpage :

- Le cœur avant l'interface : le modèle des dix nœuds, le YAML, la validation de schéma et le diff structurel se livrent et se testent sans UI.
- Chaque plan produit quelque chose d'exécutable : une commande CLI, un endpoint testé, un écran branché sur de vraies données locales. Pas de plan « mise en place » sans livrable observable.
- Le mode extraction (SQL → graphe via SQLGlot) est la priorité n°1 du brief : il doit apparaître tôt, pas en fin de série.
- Les connecteurs arrivent dans l'ordre du brief : Databricks puis Snowflake, les trois autres plus tard.
- Les points reportés de la section 12 du brief ne font pas l'objet de plans ; mentionne-les une fois dans l'analyse et n'y reviens pas.
- Ordre suggéré, à remettre en cause si ta lecture le justifie : modèle et YAML des nœuds → validation et normalisation → diff structurel et classification des écarts → espaces et dépôt Git (clone, lecture, proposition = branche + PR) → extraction SQL → coffre de secrets et connecteur Databricks → compilation et comparaison chiffrée avec DuckDB → écrans dans l'ordre de la section 10 → connecteur Snowflake → packaging sidecar et build release.

## 4. Règles de travail

- Français pour la documentation et l'interface, anglais pour les identifiants de code.
- Toute décision d'architecture prise pendant les plans devient un ADR dans `docs/decisions/`, numéroté à la suite.
- Si un point de l'analyse (section 2) bloque un plan, le plan le dit en tête et propose une hypothèse de travail par défaut.
- Ne modifie ni le brief ni le guide de style : si tu y vois une incohérence, consigne-la dans l'analyse.
- Termine par un message de synthèse : nombre de plans, chemin critique, les trois questions produit qui méritent une réponse avant de commencer le plan 0001.
