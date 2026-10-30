# Skifer Atlas — Analyse avant découpage en plans

*30 octobre 2026, arbitrages intégrés le même jour (§6). Produite selon `docs/KICKOFF.md` §2. Entrées lues : `CLAUDE.md`, `docs/brief.md` v1.2, ADR 0001, `docs/design/style-guide.md`, les huit maquettes, `tokens.css`, le squelette `core/` et `app/`, et le moteur `../skifer` v4.0.0 (`README.md`, `CLAUDE.md`, `docs/yaml_spec.md`, `docs/project_analyzer.md`, `src/skifer/core/{op_catalog,ir,schema_loader,sql_compiler}.py`, `src/skifer/analyzer/`).*

---

## 1. Ce que j'ai compris

**Le problème.** Dans un groupe, les entités calculent le même KPI de façons différentes, sur des outils et des sources hétérogènes, sans définition partagée. Avant de générer quoi que ce soit, il faut un point central qui fasse foi, qui rende les divergences visibles et qui outille l'arbitrage, sans s'y substituer.

**Le modèle canonique.** Un espace de travail (un client) porte un modèle canonique unique, fait de concepts métier (client actif, commande, date de référence) et de KPI construits sur ces concepts. Une définition n'est pas du texte : c'est un graphe orienté sans cycle sur un vocabulaire fermé de dix types de nœuds (source, filtre, jointure, union, calcul de colonne, dédoublonnage, agrégation, opération temporelle, référence à un KPI, opération entre métriques agrégées). Sa sémantique est figée : nulls, cardinalité des jointures contrôlée à l'exécution, calendrier et fuseau déclarés, aucun arrondi dans le graphe. Appliquer le graphe doit toujours donner le même résultat. Chaque évolution crée une version immuable. Le « quoi » (le graphe) est séparé du « comment » (SQL, DAX en place sur les plateformes). Le format pivot est le YAML du moteur Skifer, enrichi d'un identifiant stable par nœud et d'un numéro de version de schéma, avec un schéma de validation qui rejette tout ce qui sort du vocabulaire.

**Les deux modes de variante.** Une déclinaison par entité est soit une **surcharge** (le graphe canonique plus une liste de surcharges sur des nœuds précis, chacune justifiée), soit une variante **from scratch** (un graphe complet indépendant, rattaché au canonique par ses concepts, justifié et marqué « candidate à la convergence »). Le canonique déclare à l'avance ses **points de variation**. Une surcharge sur un point déclaré passe en validation légère. Une surcharge hors des points déclarés exige la validation canonique et remonte comme écart à examiner.

**La comparaison.** Elle a deux niveaux. **Structurelle**, à partir de Git seul : on normalise (fusion et tri des filtres consécutifs entre deux opérations structurantes), on compare les empreintes, on aligne les nœuds, puis on classe chaque écart (normal, à examiner, from scratch à suivre, divergence critique sur filtre, granularité ou fonction d'agrégation, cosmétique). **Chiffrée** : chaque graphe est compilé dans le dialecte de sa plateforme, exécuté en push-down avec les droits de l'utilisateur sur un scope déclaré, et seuls des agrégats reviennent. On calcule l'écart par cellule, le pourcentage de cellules dans la tolérance et l'écart maximal, puis on relie l'écart au nœud divergent. Le mode **extraction** (SQL existant → graphe, via SQLGlot) est la priorité n°1. Le mode construction (générer metric views, business rules et tests) vient ensuite.

**Le local-first.** Tout tourne sur le poste : une application Tauri lance un serveur Python sur 127.0.0.1, protégé par un token de session. Il y a un dépôt Git par espace (une sauvegarde = une PR, sans que l'utilisateur métier voie Git), un coffre de secrets personnel rangé par espace dans le trousseau de l'OS, et une base DuckDB par espace pour les résultats de comparaison. Seules les données extraites sont purgées après enregistrement : le scope, les requêtes et les résultats restent. L'index de recherche se reconstruit depuis Git et n'est jamais une source de vérité. Aucun serveur, aucun compte technique.

---

## 2. Constat principal sur le YAML Skifer

C'est le point qui conditionne tout le reste ; le détail nœud par nœud est en §4.

Le moteur a aujourd'hui **deux formats YAML**, aucun n'est un graphe :

1. **Le schéma de pipeline** (`tables` → `join` → `where` → `business_rules` → `add_columns` → `aggregate` | `select_final`, plus `partials`, `data_product`, `contract`, `semantic`, `materialization`, `sink`). C'est un **gabarit à forme fixe** qui décrit une seule requête : les filtres de table s'appliquent avant les jointures, `where` après, `add_columns` avant l'agrégation. L'ordre des opérations n'est pas libre, il n'existe ni union ni opération temporelle, et rien ne porte d'identifiant (les filtres sont des chaînes `"col:op:val"`). Les `partials` permettent d'enchaîner des sous-requêtes, ce qui recoupe la lecture « suite de sous-modèles délimités par les opérations structurantes » du brief (8.2.1).
2. **Le modèle sémantique** (`key`, `table`, `base_filter`, `dimensions`, `metrics` {`sql`, `type`, `filters`, `additivity`}, `entities`, `relationships` {`cardinality`, `join_type`}, `calendar`) et les **calendriers versionnés** `calendars/<key>.yaml` (`key`, `version`, `periods`). Il décrit des métriques sur une table, sans les transformations amont.

Le moteur n'a **pas de champ de version de schéma**. Ses blocs sont validés à la main dans `schema_loader.py`, avec des listes de clés autorisées par bloc et un JSON Schema publié (`schemas/skifer-pipeline.schema.json`, `additionalProperties` strict). Ajouter des clés impose donc de modifier le moteur.

Ce qui est réutilisable tel quel : les grammaires de filtre (`FILTER_OPERATORS` : 19 opérateurs), d'opérations de colonne (`COLUMN_OPS`) et de fonctions d'agrégation (`AGGREGATE_FUNCTIONS` : 12 fonctions), les types de jointure, le bloc `data_product` (`id`, `version` semver, `owner`, `domain`), les calendriers versionnés, la cardinalité des relations sémantiques, l'empreinte versionnée `sha256:v1:`. Il y a surtout **l'analyseur `skifer analyze`** (Plan 43) : SQL → AST SQLGlot (dialecte `databricks`) → brouillon de pipeline, avec des résidus nommés pour ce qu'il ne sait pas traduire (CTE, `UNION`, fenêtres), un oracle de round-trip par recompilation, et déjà la détection de « même concept calculé de deux façons ».

Conséquence : **l'hypothèse du brief (3.4), selon laquelle « le YAML actuel » sérialise le graphe en n'ajoutant qu'un identifiant et une version, ne tient pas.** Il faut ajouter au format une notion de topologie (des nœuds et leurs entrées). C'est la question Q1 ci-dessous.

---

## 3. Écarts et ambiguïtés

Chaque point donne la question, les options et ma recommandation. Les questions Q1 à Q3 bloquent le plan 0001.

### Q1 — Comment le graphe s'écrit-il dans le YAML Skifer ? *(bloquant, produit et architecture)*

- **A.** Ajouter au document Skifer un bloc versionné `graph:` (une liste de nœuds `{id, type, inputs, …}`). Les champs des nœuds réutilisent les grammaires du moteur (filtres, opérations, fonctions d'agrégation, types de jointure, calendriers). Le reste du document garde les blocs existants (`data_product`, `semantic`, `contract`). Le bloc est spécifié dans le moteur et ignoré par le runtime Spark tant qu'il n'est pas compilé.
- **B.** Lecture stricte : un graphe = un pipeline Skifer découpé en `partials` aux opérations structurantes, avec un `id` ajouté sur chaque élément (table, filtre en forme dictionnaire, jointure, mesure). Pas de nouveau bloc, mais l'union, l'opération temporelle, la référence à un KPI et l'opération entre métriques n'ont pas d'équivalent. L'ordre imposé par le gabarit déforme les graphes réels, et le diff doit reconstruire une topologie implicite.
- **C.** Un format propre à Atlas : exclu par le brief.

**Recommandation : A.** C'est un ajout au YAML Skifer, pas un nouveau format : même document, mêmes grammaires, mêmes calendriers, même `data_product`. Le diff et l'éditeur travaillent directement sur la topologie déclarée. Un compilateur `graph` → pipeline (`tables`/`join`/`aggregate`/`partials`) reste possible pour le mode construction quand le graphe s'y prête. Proposé en ADR 0002.

### Q2 — Qu'est-ce qu'un concept au niveau YAML ? *(bloquant)*

Le brief rattache les variantes from scratch « par leurs concepts » et dit que la comparaison reste possible « si chaque source est rattachée aux mêmes concepts ». La fiche 10.2 liste « Commande · Date de référence » comme dépendances.

- **A.** Un concept est une **entité sémantique** : nom, clé, attributs typés, et éventuellement un graphe de définition sans agrégation finale (« client actif » = source + filtres). Les nœuds source déclarent le concept qu'ils alimentent et la correspondance colonnes ↔ attributs. C'est proche des `entities` du modèle sémantique Skifer.
- **B.** Un concept est un KPI sans agrégation, référencé par le nœud 9.
- **C.** Une simple étiquette de catalogue.

**Recommandation : A.** C'est le seul choix qui rende l'appariement possible entre deux graphes à sources différentes (Q4). Le nœud 9 reste réservé aux KPI. Une source peut référencer un concept défini par un graphe, et ce lien compte comme une dépendance dans l'onglet Dépendances.

### Q3 — Forme exacte d'une surcharge *(bloquant)*

Les maquettes se contredisent. En 10.3, la jointure n04 est marquée « VARIATION » mais sa note dit que « les entités peuvent surcharger la source droite (n02) ». En 10.4, c'est « Jointure · surchargée ».

- **A.** Une surcharge remplace un nœud entier : même `id`, même type, mêmes ports. Le point de variation se déclare sur le nœud remplaçable.
- **B.** Patch au niveau du champ (`n04.keys`, `n02.table`) : plus fin, mais le diff et la validation se compliquent.
- **C.** Remplacement d'un sous-graphe : trop ouvert pour une validation légère.

**Recommandation : A**, avec une règle simple : tout ce qui n'est pas le remplacement d'un nœud déclaré (ajout, retrait, changement de type, remplacement d'un nœud non déclaré) est « hors points déclarés ». *(Exemple de la maquette remplacé après l'arbitrage, voir §6 : plus de table de taxes, la déduction des taxes est un nœud de calcul déclaré point de variation.)*

```yaml
# variants/revenu-net/nordis-de.yaml
variant_of: {id: revenu-net, version: 4}
entity: nordis-de
mode: override
overrides:
  - node: n03                       # « déduction des taxes », point de variation déclaré
    justification: "TVA allemande à 19 %"
    replace: {id: n03, type: compute, inputs: [n02], column: montant_ht, expr: "montant_ttc / 1.19 - avoirs"}
```

### Q4 — Règle d'appariement des nœuds en diff

Entre deux versions d'un même graphe, ou entre le canonique et une surcharge, l'appariement se fait par `id` stable, sans ambiguïté. Entre le canonique et une variante from scratch, ou entre deux graphes extraits, les identifiants ne se correspondent pas. **Recommandation :** apparier d'abord par `id` ; pour les nœuds restants, chercher le meilleur appariement par (type, concept des colonnes touchées, position dans la suite de sous-modèles), avec un score déterministe et une égalité tranchée par l'ordre topologique. Un nœud resté sans partenaire est « ajouté » ou « retiré ». Un appariement à score faible est marqué « à vérifier » et part en comparaison chiffrée.

### Q5 — Format du scope

**Recommandation :** le scope est déclaré avec le KPI. Il comprend la période (bornes ISO ou nom de période d'un calendrier Skifer), le périmètre (une liste de filtres dans la grammaire Skifer sur des attributs de concept, par exemple `entite:in:FR,DE`) et la granularité (une liste de dimensions nommées, chacune résolue en colonne dans chaque déclinaison par le rattachement aux concepts). La tolérance est en pourcentage, globale dans l'espace et surchargeable par KPI. L'écran 10.5 choisit un scope parmi ceux déclarés et peut le restreindre, jamais l'élargir.

### Q6 — Langage des expressions

Les nœuds filtre, calcul de colonne et opération entre métriques portent des expressions. **Recommandation :** les filtres simples utilisent la grammaire Skifer (`col:op:val`, plus le drapeau nulls). Les expressions libres sont du SQL analysé par SQLGlot, restreint à une liste blanche de fonctions déterministes (pas de `now()`, `rand()`, `current_date`), qui ne référence que des colonnes amont. Une expression hors liste blanche est une erreur de validation. Cela correspond à l'échappatoire `expr:` du moteur, mais bornée.

### Q7 — Dédoublonnage déterministe

`quality_checks.drop_duplicates_on` ne déclare pas quelle ligne est gardée. Le moteur le refuse d'ailleurs en vue matérialisée, faute de forme SQL fidèle. **Recommandation :** le nœud de dédoublonnage exige des clés et une règle de choix totale (un tri sur des colonnes, plus un départage), compilée en `ROW_NUMBER() … = 1`. Une règle qui ne départage pas tous les cas est refusée.

### Q8 — Hébergeur Git, identité et validations

Le brief dit « une PR = une proposition » mais ne nomme pas l'hébergeur. L'écran 10.7 gère utilisateurs, rôles, domaines et nombre de validateurs, sans dire où ils vivent.

- **Hébergeur.** Recommandation : une abstraction `GitHost` avec GitHub en premier (API REST, authentification par l'appareil, token rangé dans le coffre), plus un hôte « dépôt local nu » pour les tests et les démos hors ligne. GitLab et Azure DevOps viendront ensuite. *Question produit : quel hébergeur chez les premiers clients ?*
- **Gouvernance.** Recommandation : un fichier `governance.yaml` versionné dans le dépôt de l'espace (domaines, référents, validateurs, rôles par entité et par domaine, nombre de validateurs canonique/déclinaisons, plateformes autorisées). Modifier la gouvernance passe aussi par une PR approuvée par un référent.
- **Validations.** Recommandation : Atlas décompte les approbations de revue de l'hébergeur faites par des comptes qui ont le rôle requis dans `governance.yaml`. La règle de protection de branche de l'hébergeur sert de garde-fou, réglée par le référent.
- **Identité.** Recommandation : l'utilisateur est identifié par son compte sur l'hébergeur Git ; `governance.yaml` associe ce compte à un nom et à une entité.

### Q9 — Versions

**Recommandation :** la version d'un KPI est un entier (v1, v2, …) porté par `data_product.version`. Une PR fusionnée qui modifie un KPI incrémente sa version et pose un tag Git `kpi/<id>/v<n>`. L'historique immuable vient des tags. Le nœud 9 référence `{kpi, version}` explicitement : une nouvelle version ne se propage pas d'elle-même, et on calcule la liste des KPI touchés.

### Q10 — Plateformes et authentification

- Snowflake par paire de clés contredit la règle « jamais de champ pour saisir un token » (10.6). Recommandation : un sélecteur de fichier de clé privée, avec une passphrase qui va au coffre ; jamais de saisie de clé ou de token en clair.
- Le moteur Skifer est « Spark/Databricks only » (son Plan 26). Recommandation : l'exécution en push-down vers Snowflake est faite par Atlas, avec le connecteur Snowflake et du SQL compilé par SQLGlot, pas par le moteur.

### Q11 — Sur quelles données s'exécute le canonique en comparaison chiffrée ?

Le brief compare « le graphe canonique et celui de chaque déclinaison », mais le canonique pointe vers ses propres sources. Mesurer l'effet de la définition suppose d'appliquer les deux graphes **aux mêmes données**. **Recommandation :** le canonique est rebranché sur les sources de la déclinaison (surcharges de sources, ou rattachement par concept pour une variante from scratch). Un écart chiffré mesure alors la seule différence de définition. Si le rebranchement est impossible, la comparaison est refusée et le message dit quoi rattacher.

### Q12 — Incohérences relevées dans les documents (à corriger hors de ce lot ; brief et guide non modifiés)

- Les maquettes affichent encore « Skifer / Annuaire » dans la barre latérale, au lieu d'Atlas.
- Le point de variation de 10.3 (n04 contre n02) : voir Q3.
- 10.3 affiche « schema 1.3 » alors qu'aucune version n'existe. Recommandation : `schema_version: 1` (un entier), avec migration explicite à chaque montée.
- Le rôle « lecteur » existe dans le code (`workspaces.py`) et dans le guide (badge), mais pas dans la liste de rôles du brief (5.1). Recommandation : le garder, comme rôle par défaut sans droit d'écriture.
- Le brief (10.0) réserve la création d'espace aux référents, mais on est référent *dans* un espace. Recommandation : créer un espace (local) est possible pour tout le monde, et fait de son créateur le référent de cet espace ; rejoindre un espace existant revient à cloner son dépôt.
- La fiche 10.2 est marquée « à retravailler ». Son plan traite l'onglet Définition et les tableaux, et laisse la mise en page ouverte.
- Squelette : `require_token` n'exige rien si `ATLAS_TOKEN` est vide, ce qui contredit `CLAUDE.md`. À corriger dans le plan 0005 (refus de démarrer sans token, sauf drapeau de dev explicite).

### Points reportés (brief §12)

Parseurs DAX et Power Query, normalisation plus poussée, mode hébergé ou partagé des résultats, mode planifié et comptes de service, tables de référence de paramètres. Ils ne font l'objet d'aucun plan.

---

## 4. Correspondance YAML Skifer ↔ dix nœuds

« Existe » = présent dans le moteur v4.0.0 ; « Étendre » = à ajouter à un élément existant ; « Créer » = absent.

| # | Nœud | Existe dans le moteur | À étendre | À créer |
|---|---|---|---|---|
| 1 | Source | `tables[].name` / `source` (fichiers), `alias` ; FQN 2 ou 3 parties ; `data_product.owner` | plateforme et connexion (le moteur ne connaît que Spark/Delta) ; propriétaire par source | colonnes déclarées et typées ; format et fuseau d'origine par colonne temporelle ; rattachement au concept |
| 2 | Filtre | `tables[].filter`, `where`, `filter_groups` / `where_groups` (OU de ET) ; 19 opérateurs ; `sql` brut | forme dictionnaire avec `id` ; position libre dans le graphe (aujourd'hui avant ou après les jointures seulement) | drapeau obligatoire `nulls: keep \| drop` |
| 3 | Jointure | `join[]` : `table_from`/`table_to`, `type` (7 types) ; `cardinality` existe dans les `relationships` sémantiques | cardinalité attendue (`1:1`, `N:1`, `1:N`) sur la jointure du pipeline | contrôle de cardinalité à l'exécution (`check: required \| bypass`) ; ports nommés gauche/droite |
| 4 | Union | — (l'analyseur la rejette : `union_requires_multi_schema`) | — | nœud complet : ordre des entrées, correspondance des colonnes, `all` / distinct |
| 5 | Calcul de colonne | `add_columns`, `select_final` ([source, alias, ops]), `COLUMN_OPS`, `when/then/else`, `expr:` | expression bornée (Q6) ; retirer `round` du graphe (arrondi interdit) | — |
| 6 | Dédoublonnage | `quality_checks.drop_duplicates_on` (sans règle de choix) | — | règle de choix totale (Q7) ; position libre |
| 7 | Agrégation | `aggregate: {group_by, measures, having}`, 12 fonctions ; `metrics[].type` sémantique | — | granularité nommée (dimensions rattachées aux concepts) |
| 8 | Opération temporelle | `to_date` seulement ; calendriers versionnés `calendars/<key>.yaml` ; `default_time_dimension` | réutiliser les calendriers comme référence `{calendar, version}` | conversions de fuseau et de format ; fenêtres ; affectation d'une date à une période fiscale |
| 9 | Référence à un KPI | `partials` (un sous-schéma exposé sous un alias), `data_product.id` + `version` | référence versionnée vers un autre document | graphe de dépendances entre KPI et calcul d'impact |
| 10 | Opération entre métriques | métriques sémantiques simples ; `additivity` (`non_additive` pour les ratios) | — | nœud ratio/différence/expression sur métriques agrégées, avec ordre calcul/agrégation explicite |

Attributs de document :

| Attribut | Existe | À créer |
|---|---|---|
| Identifiant stable par nœud | — (`data_product.id` au niveau du document seulement) | `id` par nœud, de la forme `n01`, unique dans le document et jamais réattribué |
| Version de schéma | — | `schema_version: 1` en tête de document |
| Version du KPI, propriétaire, domaine | `data_product.{version, owner, domain}` | version en entier (Q9) |
| Calendrier de référence, fuseau d'évaluation | `calendar:` (modèle sémantique) | `timezone` au niveau du KPI ; tous deux déclarables comme points de variation |
| Concept | `semantic.entity`, `entities[]` | document `kind: concept` (Q2) |
| Points de variation, surcharges, from scratch | — | `variation_points: [n03, n04]` ; documents `variant` (Q3) |
| Synonymes | `synonyms` (enrichissement sémantique) | au niveau du document |
| Scope et tolérance | — | bloc `scope` (Q5) |

---

## 5. Risques techniques, classés

1. **Écart entre le YAML du moteur et le graphe (élevé, structurant).** Voir §2 et Q1. Il faut faire évoluer le moteur (bloc `graph:`, `schema_version`) ou décider que le modèle vit d'abord dans Atlas, ce qui obligera à synchroniser deux dépôts. *Mitigation :* ADR 0002 et 0003 ; le modèle est développé dans `skifer_atlas.model`, en Python pur sans dépendance Spark, avec une interface prévue pour remonter dans le moteur une fois stable.
2. **Compilation multi-dialecte et déterminisme (élevé).** `compile_select` du moteur produit du SQL Spark sous forme de chaîne, sans dialecte ; `LEFT ANTI JOIN`, les fenêtres et les fonctions de date varient entre Databricks et Snowflake. *Mitigation :* compiler le graphe en AST SQLGlot puis générer par dialecte ; exécuter tous les tests sur DuckDB (troisième dialecte) ; prévoir un jeu de tests d'équivalence qui exécute le même graphe sur des données de test dans chaque dialecte disponible.
3. **Authentification native en sidecar (élevé).** L'OAuth Databricks U2M et le SSO Snowflake (`externalbrowser`) ouvrent un navigateur et écoutent sur un port de rappel local, depuis un processus sans fenêtre. Les caches de tokens propres aux SDK écrivent sur disque hors du coffre. *Mitigation :* désactiver les caches des SDK et passer par `keyring` ; ouvrir le navigateur par le shell Tauri si besoin ; un prototype jetable au début du plan 0008.
4. **PyInstaller et imports dynamiques (moyen).** `databricks-sdk`, `snowflake-connector-python` (plugins, `cryptography`), `keyring` (les backends sont choisis à l'exécution par point d'entrée) et `duckdb` cassent souvent en binaire figé. Côté moteur, seuls `cli.py` et `mcp/` font des `importlib.import_module` ; les modules utiles à Atlas (`core/op_catalog`, `ir`, `sql_compiler`, `analyzer`) s'importent sans pyspark (vérifié) et chargent SQLGlot paresseusement. *Mitigation :* un test de fumée du binaire figé dans la CI dès le plan 0008 (pas seulement au plan de packaging) ; `--hidden-import` explicites dans `scripts/build-sidecar.sh` ; backend `keyring` fixé explicitement par plateforme.
5. **Taille du binaire (moyen).** L'ADR 0001 accepte 100 à 150 Mo, mais `snowflake-connector-python` avec pyarrow et `databricks-sdk` peuvent dépasser 200 Mo. *Mitigation :* installer pyarrow seulement si nécessaire ; mesurer à chaque plan connecteur ; seuil d'alerte dans la CI.
6. **React Flow pour le diff (moyen).** Deux canevas synchronisés, un alignement par identifiant et une disposition stable sont du travail sur mesure. *Mitigation :* disposition déterministe calculée côté Python, ou dagre/elk côté client avec des positions figées par identifiant ; le diff en lecture utilise des cartes (10.4), pas l'éditeur complet.
7. **Performance de SQLGlot sur de gros graphes (faible à moyen).** L'analyse de requêtes de plusieurs milliers de lignes ou de corpus entiers, et la normalisation répétée à chaque frappe dans l'éditeur, peuvent coûter cher. *Mitigation :* valider l'éditeur de façon incrémentale par nœud, avec un cache par empreinte ; un banc d'essai sur le corpus `examples/24_project_analyzer` et un gros script de production anonymisé.
8. **Git piloté par CLI dans un sidecar (moyen).** Cela suppose `git` installé, des identifiants et un proxy d'entreprise. *Mitigation :* détecter et diagnostiquer au premier lancement ; passer le token de l'hébergeur par `GIT_ASKPASS` depuis le coffre, jamais dans l'URL distante.

---

## 6. Décisions du 30 octobre 2026

Arbitrages rendus sur les questions du §3. Ils priment sur les recommandations ci-dessus en cas d'écart.

| Question | Décision |
|---|---|
| Q1 — Format du graphe | Bloc `graph: {nodes, output}` dans le document YAML Skifer (ADR 0002, acceptée). Modèle développé dans Atlas, puis remonté dans le moteur une fois stable (ADR 0003, acceptée). |
| Q2 — Concept | Entité sémantique : clé, attributs typés, graphe de définition optionnel non agrégé ; les sources s'y rattachent. |
| Q3 — Surcharge | Remplacement d'un nœud entier (même `id`, même type, mêmes ports). Tout le reste est hors points déclarés. |
| Q3 bis — Exemple « Revenu net » | **Pas de table de paramètres** pour le moment, taxes comprises (cohérent avec le brief §12). La déduction des taxes est un nœud de calcul déclaré point de variation, que chaque pays remplace par sa formule. Nouvelle numérotation de l'exemple : n01 source, n02 filtre statut, n03 calcul « déduction des taxes » (variation), n04 temporel mois fiscal (variation), n05 agrégation. La surcharge DE de la maquette 10.4 porte sur n02 (filtre statut, hors points déclarés) et sur n03 (taxes, point déclaré). Les maquettes 10.2, 10.3 et 10.4 (source n02 des taxes, jointure n04) sont à mettre à jour dans ce sens. |
| Q4, Q6, Q7, Q9, Q12 | Recommandations validées telles quelles. |
| Q5 — Scope | Déclaré avec le KPI ; tolérance globale dans l'espace, surchargeable par KPI. |
| Q8 — Git et gouvernance | GitHub en premier, plus un hôte « dépôt local nu » pour les tests. `governance.yaml` versionné dans le dépôt ; validations décomptées sur les revues GitHub de comptes qui ont le rôle requis ; identité = compte GitHub. Ajout : `CODEOWNERS` généré depuis `governance.yaml`, avec la règle de branche « Require review from Code Owners », pour qu'une fusion faite directement sur GitHub ne contourne pas les validateurs (ADR 0005, acceptée). |
| Q10 — Authentification Databricks | OAuth d'abord (client public `databricks-cli` par défaut, identifiant d'application du client configurable par point d'accès). Token personnel en repli, saisi une seule fois dans un champ masqué et envoyé directement au coffre : exception assumée à la règle du guide 10.6. Snowflake par paire de clés : sélecteur de fichier et passphrase au coffre. |
| Q11 — Données du canonique | Le canonique est rebranché sur les sources de la déclinaison : l'écart mesure uniquement la différence de définition. |
| ADR 0004 — Compilation et exécution | Acceptée : Atlas compile le graphe en SQL par dialecte (SQLGlot) et exécute lui-même les requêtes en push-down, parce que le moteur est limité à Spark/Databricks. |
