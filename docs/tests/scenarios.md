# Scénarios de test front

**Règle : chaque vérification a un scénario et un test front.** Une vérification est un critère d'acceptation d'un plan (`docs/plans/00*.md`) ou une vérification à la main du « Reste à faire » de `docs/plans/README.md`. Le test front rend l'écran : parcours Playwright (`app/e2e/*.spec.ts`) ou, à défaut, test de composant Vitest (`app/src/**/*.test.tsx`). Un test core seul ne compte pas. Une vérification sans test front figure dans l'une des deux sections finales, avec la raison et le test qui la couvre malgré tout :

- « Sans test front, et pourquoi » : rien ne l'affiche à l'écran (compte réel, fenêtre native Tauri, CI de release, revue produit, logique serveur sans écran) ;
- « Sans test front, testable » : un écran la montre, mais aucun test ne la vérifie. Ce sont des tests à écrire ; il n'en reste aucun.

## Lancer les tests

- Parcours : `cd app && npm run e2e`. Playwright démarre lui-même les serveurs Python, les faux Databricks, Snowflake et GitHub, et Vite, sur des ports fixes (1420, 8791 à 8799, 8020 pour le retour OAuth). Chromium passe tous les scénarios, puis WebKit les `*.webkit.spec.ts`. Un seul worker, et une seule exécution à la fois sur le poste : deux exécutions se disputeraient les ports.
- Tests de composants et unitaires : `cd app && npm test` (Vitest, jsdom). Ils rendent l'écran contre un faux serveur ; ils n'exercent pas de navigateur.

## Identifiants

- `S-<plan sur quatre chiffres>-<critère sur deux chiffres>` : `S-0013-02` est le deuxième critère d'acceptation du plan 0013.
- `S-RAF-<nn>` : les vérifications à la main du « Reste à faire » de `docs/plans/README.md`, numérotées dans l'ordre de leurs lignes terminales ; l'intitulé « Sous Tauri » n'est qu'un regroupement (S-RAF-02 à S-RAF-08).
- Le titre d'un test commence par tous les identifiants qu'il couvre, entre crochets : `[S-0013-02] …`. Un test se cite par son fichier et son identifiant (`app/e2e/editor.spec.ts` › `[S-0013-02]`), jamais par la suite du titre, qui peut changer.
- Quelques titres sont produits par une boucle (`diff.spec.ts`, `validation.spec.ts`, le test éditeur de `parcours.webkit.spec.ts`) : l'identifiant figure alors dans la table des cas, au-dessus du `test(…)`.
- D'autres boucles écrivent l'identifiant dans le gabarit du titre et produisent un test par cas : `validation-testables.spec.ts` (S-0001-02, S-0001-14, S-0002-01) et `connexions-testables.spec.ts` (S-0008-04). Le scénario le signale.

## Synthèse

| Plan | Vérifications | Test front e2e | Test front Vitest seulement | Sans test front | dont testables |
|---|---:|---:|---:|---:|---:|
| 0001 | 14 | 11 | 0 | 3 | 0 |
| 0002 | 11 | 8 | 0 | 3 | 0 |
| 0003 | 10 | 8 | 0 | 2 | 0 |
| 0004 | 8 | 2 | 0 | 6 | 0 |
| 0005 | 11 | 7 | 0 | 4 | 0 |
| 0006 | 13 | 9 | 0 | 4 | 0 |
| 0007 | 9 | 4 | 0 | 5 | 0 |
| 0008 | 9 | 5 | 0 | 4 | 0 |
| 0009 | 10 | 5 | 1 | 4 | 0 |
| 0010 | 10 | 9 | 0 | 1 | 0 |
| 0011 | 7 | 7 | 0 | 0 | 0 |
| 0012 | 7 | 7 | 0 | 0 | 0 |
| 0013 | 11 | 11 | 0 | 0 | 0 |
| 0014 | 7 | 7 | 0 | 0 | 0 |
| 0015 | 7 | 5 | 2 | 0 | 0 |
| 0016 | 6 | 6 | 0 | 0 | 0 |
| 0017 | 8 | 8 | 0 | 0 | 0 |
| 0018 | 6 | 1 | 0 | 5 | 0 |
| 0019 | 6 | 1 | 0 | 5 | 0 |
| 0020 | 4 | 4 | 0 | 0 | 0 |
| 0021 | 7 | 5 | 0 | 2 | 0 |
| 0022 | 6 | 6 | 0 | 0 | 0 |
| 0023 | 4 | 4 | 0 | 0 | 0 |
| 0024 | 4 | 2 | 2 | 0 | 0 |
| 0025 | 6 | 6 | 0 | 0 | 0 |
| 0026 | 9 | 9 | 0 | 0 | 0 |
| RAF | 11 | 7 | 0 | 4 | 0 |
| **Total** | **221** | **164** | **5** | **52** | **0** |

Lecture : « Test front e2e » compte les vérifications citées par un parcours Playwright, « Vitest seulement » celles qui n'ont qu'un test de composant. « Sans test front » regroupe les deux sections finales ; « dont testables » en est la part qui a une surface à l'écran.

Une ligne « Limite » signale qu'un test vérifie moins que le critère ; elle renvoie au test core qui couvre le reste.

## Accueil

Les tests de `app/e2e/accueil.spec.ts` se suivent sur un serveur qui leur est propre (port 8791, compte anna.k, registre vide au départ) : registre vide, création de Maison Perrault, adhésion à Groupe Nordis, puis accueil à deux cartes.

**Plan 0005**

### S-0005-01 — Créer un espace l'ouvre et le liste
Plan 0005, critère 1 · Test : `app/e2e/accueil.spec.ts` › `[S-0005-01]`
- **Étant donné** le registre de l'accueil, sans espace Maison Perrault
- **Quand** je clique « Créer un espace », saisis le nom Maison Perrault, le secteur Luxe, les entités « mp-fr, mp-it », puis clique « Créer l'espace »
- **Alors** l'adresse devient `#/w/maison-perrault/catalogue` et le titre « Catalogue » s'affiche
- **Et** l'espace apparaît ensuite sur l'accueil (carte vérifiée par S-0010-01)
- Limite : le contenu du dépôt (`atlas.yaml`, `governance.yaml`, commit initial) et `GET /api/workspaces` sont vérifiés par `core/tests/repo/test_workspace_repo.py::test_create_workspace` et `core/tests/repo/test_catalog_api.py::test_create_then_list`.

### S-0005-02 — Rejoindre un dépôt nu le clone et l'ouvre
Plan 0005, critère 2 · Test : `app/e2e/accueil.spec.ts` › `[S-0005-02]`
- **Étant donné** le dépôt nu de démonstration Groupe Nordis, produit par `examples/depot-nordis.sh`
- **Quand** je clique « Rejoindre un espace », saisis son chemin dans « Adresse du dépôt », puis clique « Cloner et ouvrir »
- **Alors** le catalogue `#/w/groupe-nordis/catalogue` s'ouvre, le sélecteur affiche « Espace Groupe Nordis » et le rôle « Contributeur » est affiché
- Limite : le test ne compte pas les documents ; S-0011-01 compare le tableau à l'index, et `core/tests/repo/test_catalog_api.py::test_join_indexes_and_lists` vérifie l'indexation.

**Plan 0010**

### S-0010-01 — Deux espaces, deux cartes conformes
Plan 0010, critère 1 · Test : `app/e2e/accueil.spec.ts` › `[S-0010-01]`
- **Étant donné** le registre avec Maison Perrault et Groupe Nordis, laissés par les deux tests précédents
- **Quand** j'ouvre l'accueil
- **Alors** la liste « Espaces » compte deux cartes ; Groupe Nordis affiche « Contributeur », « Distribution · 3 entités · 4 domaines », « 4 KPI », « 3 concepts » et « Aucune proposition »
- **Et** Maison Perrault affiche « Référent d'annuaire » et « Luxe · 2 entités · 0 domaine »

### S-0010-02 — Sans espace, la carte vide
Plan 0010, critère 2 · Test : `app/e2e/accueil.spec.ts` › `[S-0010-02]`
- **Étant donné** le registre vide du serveur de l'accueil
- **Quand** j'ouvre l'accueil
- **Alors** « Aucun espace pour l'instant » s'affiche

### S-0010-03 — Créer ouvre le catalogue ; un identifiant pris est signalé sous le champ
Plan 0010, critère 3 · Test : `app/e2e/accueil.spec.ts` › `[S-0010-03]`
- **Étant donné** le dialogue « Créer un espace »
- **Quand** je saisis le nom Maison Perrault et crée l'espace, puis reviens à l'accueil et crée de nouveau Maison Perrault
- **Alors** l'identifiant se remplit en `maison-perrault` et la première création ouvre son catalogue, avec le lien « Administration » (la créatrice est référente)
- **Et** la seconde laisse le dialogue ouvert, le champ Identifiant décrit par « Un espace porte déjà cet identifiant »

### S-0010-04 — Rejoindre un dépôt local ouvre l'espace
Plan 0010, critère 4 · Test : `app/e2e/accueil.spec.ts` › `[S-0010-04]`
- **Étant donné** le dépôt nu de démonstration
- **Quand** je le rejoins par « Rejoindre un espace » puis « Cloner et ouvrir »
- **Alors** l'espace Groupe Nordis s'ouvre sur son catalogue, avec le lien « Connexions » dans « Navigation de l'espace »

### S-0010-05 — Serveur injoignable, puis « Réessayer »
Plan 0010, critère 5 · Test : `app/e2e/accueil.spec.ts` › `[S-0010-05]`
- **Étant donné** l'accueil chargé avec ses cartes
- **Quand** toute requête au serveur échoue (connexion refusée), j'ouvre Groupe Nordis et clique « Réessayer » ; puis le serveur revient et je clique de nouveau « Réessayer »
- **Alors** l'alerte « Serveur local injoignable » apparaît et reste après le premier essai
- **Et** après le second, elle disparaît et le catalogue s'affiche
- Limite : l'arrêt est simulé par interception réseau ; le processus serveur n'est pas arrêté.

### S-0010-06 — Le sélecteur montre l'espace courant et ramène à l'accueil
Plan 0010, critère 6 · Test : `app/e2e/accueil.spec.ts` › `[S-0010-06]`
- **Étant donné** le catalogue de Maison Perrault, juste créé
- **Quand** je clique le sélecteur « Espace Maison Perrault »
- **Alors** l'adresse revient à `#/`

### S-0010-07 — Pas d'« Administration » pour une contributrice
Plan 0010, critère 7 · Test : `app/e2e/accueil.spec.ts` › `[S-0010-07]`
- **Étant donné** Groupe Nordis, qu'anna.k rejoint comme contributrice
- **Quand** son catalogue s'ouvre
- **Alors** « Navigation de l'espace » n'a pas de lien « Administration », alors que celle de Maison Perrault, dont anna.k est référente, en a un (S-0010-03)

### S-0010-09 — Polices locales, aucune requête externe
Plan 0010, critère 9 · Test : `app/e2e/accueil.spec.ts` › `[S-0010-09]`
- **Étant donné** toute requête hors `localhost` et `127.0.0.1` interrompue et relevée
- **Quand** l'accueil s'affiche et que je charge Inter 600 et JetBrains Mono 400
- **Alors** chaque police donne une face, et aucune requête externe n'a été émise

### S-0010-10 — Navigation au clavier, sans violation axe sérieuse
Plan 0010, critère 10 · Test : `app/e2e/accueil.spec.ts` › `[S-0010-10]` (deux tests : registre vide, deux cartes)
- **Étant donné** l'accueil avec deux cartes
- **Quand** je tabule jusqu'à la carte Groupe Nordis et appuie sur Entrée, puis remonte par Maj+Tab jusqu'à « Propositions », Entrée, puis jusqu'au sélecteur d'espace, Entrée
- **Alors** le focus passe au titre « Catalogue », à « Connexions », à « Propositions », au titre « Propositions », au sélecteur, puis au titre « Vos espaces de travail »
- **Et** axe-core ne relève aucune violation sérieuse ou critique sur l'accueil vide, le dialogue de création, le catalogue de l'espace créé et l'accueil à deux cartes

**Plan 0025**

### S-0025-04 — Rejoindre un dépôt privé après une connexion GitHub
Plan 0025, critère 4 · Test : `app/e2e/github.spec.ts` › `[S-0025-04]`
- **Étant donné** un espace isolé sur le serveur 8793 (julien.h) et l'adresse `https://github.com/nordis/<espace>.git` ; la route d'adhésion est interceptée : sans flux GitHub, elle répond 502 `clone_failed` (« Authentication failed »)
- **Quand** je clique « Rejoindre un espace », saisis l'adresse et clique « Cloner et ouvrir » ; puis « Se connecter à GitHub », « Ouvrir GitHub », et « Autoriser » dans la fenêtre du faux GitHub
- **Alors** le dialogue propose « Si le dépôt est privé, connectez-vous à GitHub », puis le groupe « Connexion à GitHub » montre le code
- **Et** le catalogue de l'espace s'ouvre ; deux adhésions sont parties, la première sans flux, la seconde avec `github_flow`, flux que le serveur dit connecté avant de répondre
- Limite : la seconde adhésion est servie par l'espace local, sans clone. Le clonage avec le jeton du flux est vérifié par `core/tests/repo/test_github_device.py::test_join_takes_the_token_of_a_flow_made_before_the_workspace_exists` ; un vrai dépôt privé exige un compte. Le même enchaînement est rendu en Vitest : `app/src/screens/GitHub.test.tsx` › `[S-0025-04]`.

## Catalogue

Les tests de `app/e2e/catalogue.spec.ts` se suivent sur Groupe Nordis, vu par anna.k (contributrice) ; le dernier lance une comparaison.

**Plan 0005**

### S-0005-03 — « CA net » trouve Revenu net par synonyme
Plan 0005, critère 3 · Test : `app/e2e/catalogue.spec.ts` › `[S-0005-03]`
- **Étant donné** le catalogue de Groupe Nordis
- **Quand** je saisis « CA net » dans « Rechercher dans le catalogue »
- **Alors** l'adresse porte `?q=CA+net` et le tableau ne contient plus que Revenu net
- Limite : « revenu » sans accents ni casse n'est pas saisi ici. L'insensibilité aux accents est exercée sous WebKit par S-0026-02 ; le cas exact est vérifié par `core/tests/repo/test_index.py::test_search_by_synonym_ignoring_accents_and_case`.

### S-0005-04 — Les filtres se combinent
Plan 0005, critère 4 · Test : `app/e2e/catalogue.spec.ts` › `[S-0005-04]`
- **Étant donné** le catalogue complet, sept documents
- **Quand** je choisis le domaine Finance, puis le type KPI
- **Alors** il reste trois documents, puis deux
- Limite : propriétaire et statut ne sont pas combinés ici ; `core/tests/repo/test_index.py::test_filters_combine`.

### S-0005-05 — Un document invalide est indexé et se filtre « Invalide »
Plan 0005, critère 5 · Test : `app/e2e/depot-testables.spec.ts` › `[S-0005-05]`
- **Étant donné** un espace isolé sur le serveur 8793, où un commit poussé ajoute `kpis/invalide.yaml`, « Document invalide », au graphe vide ; l'espace est synchronisé
- **Quand** j'ouvre le catalogue et choisis « Invalide » dans le filtre Statut, puis ouvre ce document dans l'éditeur
- **Alors** le filtre vaut `invalid`, la ligne « Document invalide » s'affiche et Revenu net disparaît
- **Et** « Validation du document » affiche « Schéma invalide »
- Limite : le tableau n'a pas de colonne Statut (guide 10.1), et l'éditeur recalcule la validation au lieu de lire les erreurs de l'index. Le statut `invalid` et les erreurs indexées sont vérifiés par `core/tests/repo/test_index.py::test_invalid_documents_are_indexed_with_their_errors`.

**Plan 0011**

### S-0011-01 — Le tableau reprend l'index
Plan 0011, critère 1 · Test : `app/e2e/catalogue.spec.ts` › `[S-0011-01]`
- **Étant donné** l'index de Groupe Nordis lu par l'API `/catalog` : sept documents
- **Quand** j'ouvre le catalogue
- **Alors** le tableau « Concepts et KPI » compte sept lignes ; pour chaque document, la colonne version affiche `v<n>` de l'index, et la colonne déclinaisons leur nombre pour un KPI, « — » pour un concept
- **Et** Revenu net est rangé en Finance, et « Nouveau concept ou KPI » est proposé à la contributrice

### S-0011-02 — « CA net » trouve « Revenu net »
Plan 0011, critère 2 · Test : `app/e2e/catalogue.spec.ts` › `[S-0011-02]`
- **Étant donné** le catalogue de Groupe Nordis
- **Quand** je saisis « CA net », puis « zzz »
- **Alors** seule Revenu net reste, puis « Aucun concept ou KPI ne correspond » s'affiche

### S-0011-03 — Les filtres se combinent et restent dans l'adresse
Plan 0011, critère 3 · Test : `app/e2e/catalogue.spec.ts` › `[S-0011-03]`
- **Étant donné** le catalogue complet
- **Quand** je choisis Finance puis KPI, reviens en arrière, puis recharge la page
- **Alors** l'adresse vaut `?domain=finance&kind=kpi` ; après le retour, `?domain=finance`, le type vide et trois documents
- **Et** après le rechargement, le domaine reste Finance

### S-0011-04 — Une ligne ouvre l'aperçu
Plan 0011, critère 4 · Test : `app/e2e/catalogue.spec.ts` › `[S-0011-04]`
- **Étant donné** le catalogue complet
- **Quand** je clique la cellule Domaine de Revenu net
- **Alors** l'aperçu « Revenu net » affiche « Finance · v4 · propriétaire : Claire M. », le point de variation « n03 déduction des taxes », « nordis-es (from scratch) », « Référencé par Marge brute, Panier moyen » et « Dernière comparaison Jamais comparé »
- **Et** au clavier, flèche bas depuis le lien Revenu net donne le focus à Taux de service et ouvre son aperçu, Entrée ouvre sa fiche, et le retour arrière retrouve l'aperçu Taux de service

### S-0011-05 — Pas de « + Nouveau » pour un lecteur
Plan 0011, critère 5 · Test : `app/e2e/catalogue.spec.ts` › `[S-0011-05]`
- **Étant donné** la liste des espaces réécrite par interception pour donner le rôle Lecteur
- **Quand** j'ouvre le catalogue
- **Alors** Revenu net est listé, et le lien « Nouveau concept ou KPI » est absent

### S-0011-06 — Sous 900 px, l'aperçu passe sous le tableau
Plan 0011, critère 6 · Test : `app/e2e/catalogue.spec.ts` › `[S-0011-06]`
- **Étant donné** le catalogue à 1280 px de large, Revenu net sélectionné (`?sel=revenu-net`), l'aperçu à droite du tableau
- **Quand** je réduis la fenêtre à 880 × 820
- **Alors** l'aperçu passe sous le tableau

### S-0011-07 — « Jamais comparé », puis mis à jour après une comparaison
Plan 0011, critère 7 · Test : `app/e2e/catalogue.spec.ts` › `[S-0011-07]`
- **Étant donné** la colonne Convergence : Revenu net « Jamais comparé », Marge brute (sans déclinaison) « Convergé »
- **Quand** je lance par l'API une comparaison de Revenu net sur nordis-de et nordis-fr (scope `fy2026-mois-entite`), attends qu'elle soit terminée, puis recharge
- **Alors** Revenu net affiche « 1 divergence » (nordis-de à 94 %)
- **Et** son aperçu affiche « Dernière comparaison 9x % · à l'instant »

## Fiche

**Plan 0003**

Les six premiers scénarios partent du même montage (`app/e2e/diff.spec.ts`) : un espace isolé, copie du dépôt de démonstration, où deux versions d'un document de test, construites par `core/tests/model/graphs.py`, sont taguées v1 et v2 puis synchronisées. J'ouvre la fiche du document, onglet Versions, de v1 à v2 (`?tab=versions&base=1&other=2`).

### S-0003-01 — Permuter des filtres ne produit aucun écart
Plan 0003, critère 1 · Test : `app/e2e/diff.spec.ts` › `[S-0003-01]`
- **Étant donné** v1 et v2 qui ne diffèrent que par l'ordre de leurs filtres (`with_filters(CONDITIONS)` et la liste inversée)
- **Quand** j'affiche le diff de v1 à v2
- **Alors** « Aucun écart : les deux graphes sont identiques. » s'affiche, et la liste ne contient aucun écart
- Limite : `identical: true` et le code de sortie 0 sont vérifiés par `core/tests/model/test_diff.py::test_identical_up_to_filter_order` et `core/tests/model/test_cli.py::test_diff_exit_codes`.

### S-0003-03 — Passer de sum à avg est critique
Plan 0003, critère 3 · Test : `app/e2e/diff.spec.ts` › `[S-0003-03]`
- **Étant donné** v2 dont la mesure de n05 passe de `sum` à `avg`
- **Quand** j'affiche le diff de v1 à v2
- **Alors** un seul écart, marqué « Divergence critique »

### S-0003-04 — Contourner une cardinalité est critique
Plan 0003, critère 4 · Test : `app/e2e/diff.spec.ts` › `[S-0003-04]`
- **Étant donné** v1 avec une jointure contrôlée, v2 avec la même jointure en `check: bypass` (raison « Doublons connus. »)
- **Quand** j'affiche le diff de v1 à v2
- **Alors** un seul écart, marqué « Divergence critique »
- Limite : le texte qui nomme le contournement n'est pas lu ici ; `core/tests/model/test_diff.py::test_join_bypass_is_critical_and_says_so`.

### S-0003-05 — Renommer un libellé est sans effet
Plan 0003, critère 5 · Test : `app/e2e/diff.spec.ts` › `[S-0003-05]`
- **Étant donné** v2 où n03 est renommé « Montant hors taxes »
- **Quand** j'affiche le diff de v1 à v2
- **Alors** un seul écart, marqué « Sans effet »

### S-0003-06 — Inverser jointure et dédoublonnage
Plan 0003, critère 6 · Test : `app/e2e/diff.spec.ts` › `[S-0003-06]`
- **Étant donné** v1 et v2 construites par `_join_then_dedup` de `core/tests/model/test_diff.py`, l'une jointure puis dédoublonnage, l'autre l'inverse
- **Quand** j'affiche le diff de v1 à v2
- **Alors** un seul écart, qui contient « Ordre inversé » et « Divergence critique »

### S-0003-07 — Une déclinaison from scratch affiche ses écarts et leur gravité
Plan 0003, critère 7 · Test : `app/e2e/diff.spec.ts` › `[S-0003-07]`
- **Étant donné** un espace isolé, copie du dépôt de démonstration
- **Quand** j'ouvre la fiche de `revenu-net--nordis-es` avec son diff au canonique (`?diff=canonique`)
- **Alors** chaque écart porte « From scratch », et au moins un porte la marque de gravité critique
- Limite : l'appariement par score n'est pas visible ; `core/tests/model/test_diff.py::test_es_from_scratch_is_paired_by_score`.

### S-0003-08 — Deux expressions non équivalentes restent à examiner
Plan 0003, critère 8 · Test : `app/e2e/diff.spec.ts` › `[S-0003-08]`
- **Étant donné** v2 où l'expression de n03 devient `montant_ttc * 0.8 - avoirs`
- **Quand** j'affiche le diff de v1 à v2
- **Alors** un seul écart, marqué « À examiner »

**Plan 0004**

### S-0004-01 — Extraire une implémentation donne un brouillon et son diff
Plan 0004, critère 1 · Test : `app/e2e/fiche.spec.ts` › `[S-0004-01]`
- **Étant donné** la fiche Revenu net, onglet Implémentations, section « nordis-fr · Databricks » : `implementations/revenu-net/nordis-fr/databricks.sql`, qui calcule `SUM(f.montant_ttc / 1.2 - f.avoirs) AS revenu_net`
- **Quand** je clique « Extraire et comparer au canonique »
- **Alors** « fidélité au SQL vérifiée » et « Cardinalité de la jointure inconnue » s'affichent
- **Et** la région « Écarts au canonique » titre « Écarts au canonique v4 » et liste au moins un écart
- Limite : un seul script est extrait. Les huit scripts du corpus, le résidu bloquant `window_function` de `08_kpi_monthly.sql` et son nœud `union` sont vérifiés par `core/tests/extract/test_extract.py::test_corpus_statuses` et `::test_monthly_kpi_union_is_a_node`.

### S-0004-06 — Aucun message de résidu ne cite le SQL
Plan 0004, critère 6 · Test : `app/e2e/depot-testables.spec.ts` › `[S-0004-06]`
- **Étant donné** un espace isolé sur le serveur 8793, où `implementations/revenu-net/nordis-fr/databricks.sql` est remplacé par `core/tests/fixtures/sql/sentinelles.sql` : quatorze instructions semées de valeurs sentinelles (`zqx…`, `987654321`, `'ZQX_SECRET'`) ; l'espace est synchronisé
- **Quand** j'ouvre l'onglet Implémentations de Revenu net et clique « Extraire et comparer au canonique » dans la section « nordis-fr · Databricks »
- **Alors** la section montre le SQL semé (témoin : `ZQX_SECRET`), puis au moins un résidu
- **Et** aucun résidu affiché ne contient `zqx`, quelle que soit la casse, ni `987654321`
- Limite : seuls les résidus affichés sont lus ; tous les messages de l'extraction sont vérifiés par `core/tests/extract/test_extract.py::test_residue_messages_never_quote_the_sql`.

**Plan 0005**

### S-0005-08 — Dépendances de Revenu net
Plan 0005, critère 8 · Test : `app/e2e/fiche.spec.ts` › `[S-0005-08]`
- **Étant donné** la fiche Revenu net, onglet Dépendances
- **Quand** je lis la région « Référencé par » et suis son lien « Panier moyen »
- **Alors** Panier moyen y figure avec « KPI · Ventes · v4 », et le lien ouvre la fiche Panier moyen
- Limite : Commande, Date de référence, Marge brute et `impact: 2` ne sont pas lus à l'écran ; `core/tests/repo/test_index.py::test_dependencies_of_revenu_net`.

**Plan 0009**

### S-0009-02 — La tolérance du KPI est celle qui s'affiche
Plan 0009, critère 2 · Test : `app/e2e/fiche.spec.ts` › `[S-0009-02]`
- **Étant donné** la fiche Revenu net, onglet Scope
- **Quand** je lis le scope `fy2026-mois-entite`
- **Alors** il couvre « 2026-02-01 → 2026-09-30 », et la tolérance affichée est « 1,5 % (propre au KPI) »
- Limite : la priorité sur la tolérance globale de 1 % dans le calcul est vérifiée par `core/tests/compare/test_compare.py::test_kpi_tolerance_overrides_the_global_one`.

**Plan 0012**

### S-0012-01 — Le graphe de Revenu net et ses points de variation
Plan 0012, critère 1 · Test : `app/e2e/fiche.spec.ts` › `[S-0012-01]`
- **Étant donné** le catalogue de Groupe Nordis
- **Quand** je clique Revenu net
- **Alors** la fiche s'ouvre, titre « Revenu net » focalisé, avec « v4 · validée le 12 oct. 2026 » et « Propriétaire : Claire M. · Validateurs : 2 requis (canonique) · Synonymes : CA net, net revenue »
- **Et** les cartes n01 à n07 sont visibles ; n03 et n04 portent « · variation » et une bordure supérieure pointillée orange de 2 px (`--atlas-warn`), n02 une bordure pleine ; « Une nouvelle version touchera 2 documents. » s'affiche ; le fil d'Ariane « Catalogue » ramène à la ligne Revenu net, aperçu ouvert
- La démonstration compte aujourd'hui sept nœuds (n06, date de référence, et n07, jointure) ; le critère en citait cinq.

### S-0012-02 — Les compteurs des onglets correspondent au dépôt
Plan 0012, critère 2 · Test : `app/e2e/fiche.spec.ts` › `[S-0012-02]`
- **Étant donné** la fiche Revenu net ouverte depuis le catalogue
- **Quand** je lis « Onglets de la fiche »
- **Alors** « Déclinaisons 3 » et « Versions 4 » s'affichent, « Définition » est l'onglet courant

### S-0012-03 — Le diff de v3 à v4, classé et coloré
Plan 0012, critère 3 · Test : `app/e2e/fiche.spec.ts` › `[S-0012-03]`
- **Étant donné** l'onglet Versions de Revenu net : quatre versions, « v4 · courante », Marc D. auteur de v3, De 3 et À 4 présélectionnés
- **Quand** je clique « Afficher les écarts »
- **Alors** l'adresse porte `tab=versions&base=3&other=4` ; trois écarts : n04 « À examiner » à bordure orange, puis deux « Divergence critique » à bordure rouge (`--atlas-bad`) ; le résumé dit « 3 écarts : 2 critiques, 1 à surveiller, 0 sans effet. »
- **Et** le graphe de la version 4 marque n06 « ajouté » (bordure verte, `--atlas-ok`) et n04 « modifié », comme celui de la version 3 ; après rechargement, les trois écarts restent

### S-0012-04 — Implémentations : extraire un SQL et voir son diff au canonique
Plan 0012, critère 4 · Test : `app/e2e/fiche.spec.ts` › `[S-0012-04]`
- **Étant donné** la fiche Revenu net, onglet Implémentations
- **Quand** je clique « Extraire et comparer au canonique » dans la section « nordis-fr · Databricks »
- **Alors** la section montre le fichier et son SQL, puis la région « Écarts au canonique v4 » avec au moins un écart

### S-0012-05 — « Proposer une modification » ouvre une copie en v5
Plan 0012, critère 5 · Test : `app/e2e/fiche.spec.ts` › `[S-0012-05]`
- **Étant donné** la fiche Revenu net (v4)
- **Quand** je clique « Proposer une modification »
- **Alors** l'adresse devient `#/w/groupe-nordis/editeur?from=revenu-net`, le titre « Revenu net : v5 · brouillon » et la barre d'état « schéma 1 · 7 nœuds · 6 arêtes »

### S-0012-06 — Deux chargements donnent la même disposition
Plan 0012, critère 6 · Test : `app/e2e/fiche.spec.ts` › `[S-0012-06]`
- **Étant donné** la fiche Revenu net
- **Quand** je relève les boîtes des cartes n01 à n07, recharge la page et les relève de nouveau
- **Alors** les deux relevés sont identiques

### S-0012-07 — Une fiche de concept masque les onglets propres aux KPI
Plan 0012, critère 7 · Test : `app/e2e/fiche.spec.ts` › `[S-0012-07]`
- **Étant donné** la fiche du concept Commande
- **Quand** je lis ses onglets, puis ouvre `?tab=scope`
- **Alors** seuls « Définition », « Versions 1 » et « Dépendances » s'affichent, avec la ligne « Clé », sans « Lancer une comparaison »
- **Et** `?tab=scope` retombe sur Définition

## Éditeur

**Plan 0001**

Les scénarios S-0001-03 à S-0001-08 partent du même montage (`app/e2e/validation.spec.ts`) : Revenu net, tel que l'éditeur l'ouvre, est modifié par le test puis enregistré comme brouillon indépendant ; l'API `/editor/check` doit rendre le code attendu. Pour chaque modification, j'ouvre le brouillon dans l'éditeur et clique « Soumettre la proposition ». Le message du problème s'affiche dans « Validation du document » et l'alerte « Soumission bloquée » apparaît.

Les scénarios de `app/e2e/validation-testables.spec.ts` partagent un seul espace isolé, sur le serveur 8793. Chaque cas part des fixtures de référence de `core/tests/model` (Revenu net à cinq nœuds, surcharge nordis-de, from scratch nordis-es, nœuds minimaux des dix types), les modifie, et vérifie que `/editor/check` rend le code, le `node_id` et, le cas échéant, le `path` attendus. Il enregistre le document comme brouillon à identifiant unique et l'ouvre dans l'éditeur. Le message s'affiche dans « Validation du document » ; quand le problème désigne un nœud, la ligne cite son identifiant et porte le bouton « Aller au nœud nXX ».

### S-0001-01 — Les documents de référence affichent « Schéma valide »
Plan 0001, critère 1 · Test : `app/e2e/validation.spec.ts` › `[S-0001-01]`
- **Étant donné** Groupe Nordis
- **Quand** j'ouvre dans l'éditeur Revenu net, sa surcharge nordis-de, sa déclinaison from scratch nordis-es et le concept Commande
- **Alors** chacun affiche « Schéma valide » dans « Validation du document »
- Limite : l'indicateur porte sur le schéma ; l'absence de toute erreur est vérifiée par `core/tests/model/test_document.py::test_reference_fixtures_are_valid` et `core/tests/model/test_graph.py::test_reference_kpi_and_concept_are_clean`.

### S-0001-02 — Pour chaque type de nœud, chaque champ requis manquant est signalé
Plan 0001, critère 2 · Test : `app/e2e/validation-testables.spec.ts` › `[S-0001-02]` (boucle : un test par champ des dix types, 54 tests)
- **Étant donné** pour chacun des dix types, son nœud minimal privé d'un champ, seul nœud du graphe (n01)
- **Quand** j'ouvre le brouillon
- **Alors** `/editor/check` rend `missing_field` avec le chemin `/graph/nodes/0/<champ>`, et le nœud n01 (aucun nœud pour le champ `id`)
- **Et** le panneau affiche « Champ requis manquant : « <champ> ». », avec n01 et « Aller au nœud n01 » quand le nœud est désigné
- Limite : la soumission n'est pas tentée. Le chargement de chaque nœud minimal valide est vérifié par `core/tests/model/test_nodes.py::test_minimal_node_is_valid`, et le contrat complet par `::test_missing_required_field`.

### S-0001-03 — Une clé inconnue est signalée
Plan 0001, critère 3 · Test : `app/e2e/validation.spec.ts` › `[S-0001-03]`
- **Étant donné** deux brouillons : une clé `inconnue` à la racine du document, puis une clé `inconnue` dans n03
- **Quand** j'ouvre chacun et tente de soumettre
- **Alors** le problème `unknown_key` s'affiche, et la soumission est bloquée
- Limite : les autres niveaux (entrées de jointure, colonnes d'union, dédoublonnage) sont vérifiés par `core/tests/model/test_document.py::test_unknown_key_anywhere`.

### S-0001-04 — Type de nœud et version de schéma inconnus
Plan 0001, critère 4 · Test : `app/e2e/validation.spec.ts` › `[S-0001-04]`
- **Étant donné** un brouillon où n03 est de type `pivot`, puis un brouillon en `schema_version: 2`
- **Quand** j'ouvre chacun et tente de soumettre
- **Alors** le premier affiche le problème `unknown_node_type`, le second `unknown_schema_version`, et la soumission est bloquée

### S-0001-05 — `nulls`, `cardinality` et raison du bypass sont obligatoires
Plan 0001, critère 5 · Test : `app/e2e/validation.spec.ts` › `[S-0001-05]`
- **Étant donné** trois brouillons : n02 (filtre) sans `nulls` ; n07 (jointure) sans `cardinality` ; n07 en `check: bypass` sans `bypass_reason`
- **Quand** j'ouvre chacun et tente de soumettre
- **Alors** chacun affiche un problème `missing_field`, et la soumission est bloquée

### S-0001-06 — `round`, `first` et `last` sont refusés
Plan 0001, critère 6 · Test : `app/e2e/validation.spec.ts` › `[S-0001-06]`
- **Étant donné** des brouillons où l'expression de n03 devient `ROUND(montant_ttc, 2)`, puis où la mesure de n05 utilise `first`, puis `last`
- **Quand** j'ouvre chacun et tente de soumettre
- **Alors** chacun affiche un problème `forbidden_function`, et la soumission est bloquée

### S-0001-07 — Un horodatage de source exige son fuseau
Plan 0001, critère 7 · Test : `app/e2e/validation.spec.ts` › `[S-0001-07]`
- **Étant donné** un brouillon où la colonne `date_facture` de n01 devient `timestamp`, sans `timezone`
- **Quand** je l'ouvre et tente de soumettre
- **Alors** le problème `missing_field` s'affiche, et la soumission est bloquée

### S-0001-08 — Un identifiant de nœud dupliqué est signalé
Plan 0001, critère 8 · Test : `app/e2e/validation.spec.ts` › `[S-0001-08]`
- **Étant donné** un brouillon où n03 figure deux fois
- **Quand** je l'ouvre et tente de soumettre
- **Alors** le problème `duplicate_node_id` s'affiche, et la soumission est bloquée

### S-0001-09 — Un YAML aux clés désordonnées est réécrit, puis stable
Plan 0001, critère 9 · Test : `app/e2e/validation-testables.spec.ts` › `[S-0001-09]`
- **Étant donné** le brouillon de Revenu net ouvert dans l'éditeur
- **Quand** je clique « Éditer en YAML », remplace le texte par le même document aux clés en ordre inverse (écrit en JSON, qui est du YAML), reviens au canevas et rouvre la vue YAML
- **Alors** le texte, relu par le presse-papiers, commence par `schema_version: 1` puis `kind: kpi`, et diffère du texte collé
- **Et** après deux nouveaux allers-retours entre canevas et YAML, il est identique
- Limite : un seul document est réécrit. `dump(load(f)) == f` sur toutes les fixtures canoniques est vérifié par `core/tests/model/test_io.py::test_canonical_fixtures_round_trip` ; la réécriture d'un fichier désordonné par `::test_non_canonical_file_is_rewritten_then_stable`.

### S-0001-10 — Une ancre ou un alias YAML empêche le retour au canevas
Plan 0001, critère 10 · Test : `app/e2e/editor.spec.ts` › `[S-0001-10]`
- **Étant donné** un brouillon indépendant de Revenu net ouvert dans l'éditeur
- **Quand** je clique « Éditer en YAML », remplace tout le texte par `base: &b {a: 1}` suivi de `other: *b`, puis clique « Revenir au canevas »
- **Alors** l'alerte « YAML illisible : corriger l'erreur signalée pour revenir au canevas. » s'affiche, et la vue YAML reste ouverte
- **Et** le panneau du bas explique « Les ancres YAML (&) ne sont pas admises (ligne 1, colonne 7) »

### S-0001-14 — Une variante sans ses champs propres est refusée
Plan 0001, critère 14 · Test : `app/e2e/validation-testables.spec.ts` › `[S-0001-14]` (boucle : trois tests)
- **Étant donné** la surcharge nordis-de sans `overrides`, puis la déclinaison from scratch nordis-es sans `justification`, puis sans `concepts`
- **Quand** j'ouvre chaque brouillon et clique « Soumettre la proposition »
- **Alors** `/editor/check` rend `missing_field` au chemin du champ (`/overrides`, `/justification`, `/concepts`), et le panneau affiche « Champ requis manquant : « <champ> ». »
- **Et** l'alerte « Soumission bloquée » apparaît

**Plan 0002**

### S-0002-01 — Chaque code du validateur désigne le bon nœud
Plan 0002, critère 1 · Test : `app/e2e/validation-testables.spec.ts` › `[S-0002-01]` (boucles : treize cas de graphe, dix cas de schéma, deux de résolution ; plus quatre tests isolés)
- **Étant donné** un brouillon par code : graphe (`reaggregation`, `ambiguous_column`, `cardinality_bypass`, `unknown_input`, `cycle`, `orphan_node`, `branch_not_merged`, `metric_op_on_rows`, `kpi_output_not_aggregated`, `concept_output_aggregated`, `missing_calendar`, `unknown_kpi_ref`, `unknown_column`) ; schéma (`unknown_key`, `unknown_node_type`, `unknown_schema_version`, `missing_field`, `forbidden_function`, `duplicate_node_id`, `invalid_value`, `todo`, `needs_curation`, `blocking_residue`) ; résolution (`unknown_override_target`, `undeclared_override`, `unbound_concept`) ; enfin `override_type_change`, `implicit_timezone_conversion` et `kpi_ref_cycle`, vus en S-0002-07, S-0002-05 et S-0002-11
- **Quand** j'ouvre chaque brouillon
- **Alors** `/editor/check` rend le code avec le nœud attendu (par exemple n02 pour `cycle`, n07 pour la jointure ajoutée d'`ambiguous_column`, aucun pour `unknown_schema_version`)
- **Et** le panneau affiche le message du code, avec le nœud et son bouton « Aller au nœud » quand il en désigne un
- Limite : le bouton n'est pas cliqué. `subquery_in_expr`, `variant_of_mismatch` et `missing_canonical` (propre à la CLI) ne sont pas exercés à l'écran ; ils sont vérifiés par `core/tests/model/test_columns.py::test_subquery_in_expr`, `core/tests/model/test_resolve.py::test_variant_of_mismatch` et `core/tests/model/test_cli.py::test_check_variant_without_its_canonical`.

### S-0002-02 — Les colonnes en sortie de chaque nœud de Revenu net
Plan 0002, critère 2 · Test : `app/e2e/validation-testables.spec.ts` › `[S-0002-02]`
- **Étant donné** la fixture Revenu net à cinq nœuds, ouverte dans l'éditeur
- **Quand** je sélectionne chaque nœud et ouvre l'onglet « Colonnes en sortie de nXX »
- **Alors** n01 et n02 listent les sept colonnes des factures (`facture_id`, `entite`, `statut` en `string`, `date_facture` en `date`, `montant_ttc`, `montant_taxes`, `avoirs` en `decimal`) ; n03 y ajoute `montant_ht decimal`, n04 encore `mois_fiscal date`
- **Et** n05 liste `mois_fiscal date`, `entite string`, `revenu_net decimal`
- Limite : la même table de vérité est vérifiée côté serveur par `core/tests/model/test_columns.py::test_columns_at_revenu_net`.

### S-0002-03 — Une clé de jointure inconnue est refusée
Plan 0002, critère 3 · Test : `app/e2e/validation.spec.ts` › `[S-0002-03]`
- **Étant donné** un brouillon où les clés de n07 deviennent `date_factur` = `date_jour`
- **Quand** je l'ouvre et tente de soumettre
- **Alors** le problème `unknown_column` s'affiche, propose la colonne proche `date_facture`, et la soumission est bloquée

### S-0002-04 — `NOW()` et `ROUND(x, 2)` sont refusés
Plan 0002, critère 4 · Test : `app/e2e/validation.spec.ts` › `[S-0002-04]`
- **Étant donné** des brouillons où l'expression de n03 devient `ROUND(montant_ttc, 2)`, puis `NOW()`
- **Quand** j'ouvre chacun et tente de soumettre
- **Alors** chacun affiche un problème `forbidden_function`, et la soumission est bloquée

### S-0002-05 — Un `period` sur un horodatage exige un `to_date` en amont
Plan 0002, critère 5 · Test : `app/e2e/validation-testables.spec.ts` › `[S-0002-05]`
- **Étant donné** Revenu net où `date_facture` devient un `timestamp` en UTC
- **Quand** j'ouvre ce brouillon, puis le même avec un nœud `to_date` (n06, `Europe/Paris`) intercalé avant n04, qui lit sa colonne `jour_facture`
- **Alors** le premier affiche `implicit_timezone_conversion` sur n04, avec un message qui cite `to_date`
- **Et** le second affiche « Aucun problème. » et « Compilable Databricks, Snowflake »
- Limite : le second document perd ses points de variation, que le nœud intercalé décalerait. Les deux cas sont vérifiés côté serveur par `core/tests/model/test_columns.py::test_period_on_a_timestamp_is_refused` et `::test_period_after_an_explicit_to_date_passes`.

### S-0002-07 — Une surcharge ne change pas le type d'un nœud
Plan 0002, critère 7 · Test : `app/e2e/validation-testables.spec.ts` › `[S-0002-07]`
- **Étant donné** la surcharge nordis-de dont le remplaçant de n03 devient un filtre
- **Quand** j'ouvre ce brouillon
- **Alors** `/editor/check` rend `override_type_change` sur n03, au chemin `/overrides/1/replace/type`
- **Et** le panneau affiche le refus, qui cite le type, avec n03 et « Aller au nœud n03 »
- Limite : le brouillon est écrit par l'API, pas saisi dans la vue YAML ; le formulaire de surcharge ne propose pas ce changement.

### S-0002-11 — Un cycle de `kpi_ref` entre deux KPI est détecté
Plan 0002, critère 11 · Test : `app/e2e/validation-testables.spec.ts` › `[S-0002-11]`
- **Étant donné** un brouillon de Revenu net réduit à une référence à Marge brute v2, qui référence déjà Revenu net v4
- **Quand** je l'ouvre
- **Alors** `/editor/check` rend `kpi_ref_cycle` sur n01
- **Et** le panneau affiche « revenu-net v4 → marge-brute v2 → revenu-net v4 », avec « Aller au nœud n01 »

**Plan 0007**

### S-0007-01 — Revenu net compile pour chaque plateforme
Plan 0007, critère 1 · Test : `app/e2e/sql.spec.ts` › `[S-0007-01]`
- **Étant donné** le brouillon v5 de Revenu net ouvert par `editeur?from=revenu-net`
- **Quand** j'ouvre l'onglet « SQL compilé » et choisis Databricks, puis Snowflake
- **Alors** chaque SQL contient l'étape `n07`, la garde `atlas_guard` et `UNION ALL`
- Limite : le panneau ne propose pas DuckDB. La compilation DuckDB et le résultat attendu commité sont vérifiés par `core/tests/compile/test_compile.py::test_revenu_net_compiles_in_every_dialect` et `::test_revenu_net_duckdb_gives_the_committed_result`.

### S-0007-02 — La garde de cardinalité figure dans le SQL
Plan 0007, critère 2 · Test : `app/e2e/sql.spec.ts` › `[S-0007-02]`
- **Étant donné** le brouillon v5 de Revenu net, dont n07 est une jointure contrôlée
- **Quand** j'affiche le SQL Databricks, puis Snowflake
- **Alors** chacun contient la garde `atlas_guard`
- Limite : l'échec sur clé dupliquée, qui cite la jointure, et le passage en bypass avec son commentaire sont vérifiés par `core/tests/compile/test_compile.py::test_duplicate_key_on_the_one_side_fails_citing_the_join` et `::test_bypass_runs_and_leaves_a_comment`.

### S-0007-06 — Une compilation répétée donne le même SQL
Plan 0007, critère 6 · Test : `app/e2e/sql.spec.ts` › `[S-0007-06]`
- **Étant donné** le brouillon v5 de Revenu net ouvert par `editeur?from=revenu-net`, sur Groupe Nordis
- **Quand** pour Databricks puis Snowflake, je relève le texte de « SQL compilé », recharge la page et le relève de nouveau
- **Alors** les deux textes sont identiques, caractère pour caractère
- Limite : les deux compilations viennent du même processus. L'identité entre processus est vérifiée par `core/tests/compile/test_compile.py::test_compilation_is_identical_across_processes`, et l'identité à l'octet par `::test_repeated_compilation_is_byte_identical`.

### S-0007-07 — `TRY_CAST` numérique n'est pas compilable en Snowflake
Plan 0007, critère 7 · Test : `app/e2e/sql.spec.ts` › `[S-0007-07]`
- **Étant donné** un brouillon de trois nœuds (source, calcul n02 `TRY_CAST(montant_ttc AS DOUBLE)`, agrégation)
- **Quand** j'ouvre « SQL compilé » et choisis Snowflake
- **Alors** le panneau affiche « Non compilable (n02) » et une raison qui cite `TRY_CAST`

**Plan 0013**

### S-0013-01 — Reconstruire Revenu net à la souris donne la fixture
Plan 0013, critère 1 · Test : `app/e2e/editor.spec.ts` › `[S-0013-01]`
- **Étant donné** le catalogue de Groupe Nordis
- **Quand** je clique « Nouveau concept ou KPI », saisis Revenu net (propriétaire claire.m, domaine Finance ; l'identifiant `revenu-net`, déjà pris, est refusé, puis un identifiant libre), renseigne description, synonymes « CA net » et « net revenue », calendrier `fiscal-nordis@2026.1`, fuseau Europe/Paris, devise EUR, puis ajoute depuis la palette n01 Source (sept colonnes), n02 Filtre, n03 Calcul de colonne (point de variation), n04 Opération temporelle (`period`, mois, point de variation) et n05 Agrégation (`sum` de `montant_ht` en `revenu_net`, par `mois_fiscal` et `entite`)
- **Alors** la barre d'état affiche « schéma 1 · 5 nœuds · 4 arêtes »
- **Et** le YAML relu par `/editor/check` est identique, octet pour octet, à `core/tests/fixtures/documents/revenu-net.yaml`, identifiant et version mis à part

### S-0013-02 — Une clé de jointure se choisit parmi les colonnes amont
Plan 0013, critère 2 · Test : `app/e2e/editor.spec.ts` › `[S-0013-02]`
- **Étant donné** un brouillon indépendant de Revenu net, n07 (jointure entre n03 et n06) sélectionné
- **Quand** j'ouvre les listes « Clé gauche 1 » et « Clé droite 1 », choisis `date_jour` à droite, puis retire la première colonne de n06
- **Alors** la gauche ne propose que les neuf colonnes de n03 (`facture_id` à `montant_ht`), la droite seulement `date_jour` et `date_comptable`
- **Et** un problème qui nomme `date_jour` apparaît, avec le bouton « Aller au nœud n07 »

### S-0013-03 — Une arête qui fermerait un cycle est refusée
Plan 0013, critère 3 · Test : `app/e2e/editor.spec.ts` › `[S-0013-03]`
- **Étant donné** le brouillon v5 de Revenu net, sans brouillon antérieur, « Compilable Databricks, Snowflake »
- **Quand** je choisis « Ajouter une arête », puis clique n05 et n02
- **Alors** l'alerte « Arête refusée : elle créerait un cycle n02 → n03 → n07 → n04 → n05 → n02. » s'affiche
- **Et** le graphe reste à « 7 nœuds · 6 arêtes »

### S-0013-04 — Un filtre sans `nulls` bloque la soumission
Plan 0013, critère 4 · Test : `app/e2e/editor.spec.ts` › `[S-0013-04]`
- **Étant donné** le brouillon reconstruit en S-0013-01, où n02 n'a pas de choix de nulls : un seul problème ERREUR, qui nomme n02
- **Quand** je clique « Soumettre la proposition », puis « Aller au nœud n02 », puis coche « exclues »
- **Alors** l'alerte « Soumission bloquée : 1 erreur à corriger » s'affiche, puis Propriétés montre le Filtre et n02 est sélectionné sur le canevas
- **Et** le statut devient « Compilable Databricks, Snowflake » et le brouillon « Enregistré … (local) »

### S-0013-05 — Vingt opérations s'annulent et se rétablissent
Plan 0013, critère 5 · Test : `app/e2e/editor.spec.ts` › `[S-0013-05]`
- **Étant donné** un brouillon indépendant de Revenu net, dont le document initial est conservé
- **Quand** je répète cinq fois : sélectionner n01, ajouter un Filtre (n08 à n12), changer son libellé en « Filtre temporaire i », tracer l'arête n06 → ce filtre, le supprimer ; puis clique vingt fois « Annuler » et vingt fois « Rétablir »
- **Alors** le document relu par l'API est identique à l'initial après les vingt opérations, après les annulations et après les rétablissements
- **Et** « Annuler », puis « Rétablir », sont désactivés à leur extrémité

### S-0013-06 — YAML plein écran : illisible refusé, aller-retour exact
Plan 0013, critère 6 · Test : `app/e2e/editor.spec.ts` › `[S-0013-06]`
- **Étant donné** le brouillon v5 de Revenu net, vue « Éditer en YAML » ouverte
- **Quand** j'ajoute `label: [ouvert` à la fin et clique « Revenir au canevas » ; puis remplace tout par le YAML courant où le libellé devient « Revenu net (YAML) » et reviens au canevas
- **Alors** la première tentative affiche « YAML illisible » et garde la vue YAML
- **Et** la seconde affiche le titre « Revenu net (YAML) : v5 · brouillon », le YAML enregistré est exactement le texte saisi, et « Annuler » rend « Revenu net : v5 · brouillon »

### S-0013-07 — En mode surcharge, seul le remplacement est possible
Plan 0013, critère 7 · Test : `app/e2e/editor.spec.ts` › `[S-0013-07]`
- **Étant donné** un brouillon ouvert depuis la surcharge `revenu-net--nordis-fr` (v3)
- **Quand** je sélectionne n02, clique « Remplacer ce nœud », puis saisis la valeur `validée,expédiée`, l'opérateur `in` et la justification « Expédiées comprises. »
- **Alors** avant le remplacement, le Filtre de la palette et « Ajouter une arête » sont désactivés, et la valeur de n02 n'est pas modifiable
- **Et** après, « Hors points déclarés : la validation canonique s'appliquera » s'affiche, n02 porte « Surcharge », et le statut reste « Compilable Databricks, Snowflake »

### S-0013-08 — Le SQL du nœud sélectionné, par plateforme
Plan 0013, critère 8 · Test : `app/e2e/editor.spec.ts` › `[S-0013-08]`
- **Étant donné** le brouillon v5 de Revenu net
- **Quand** je sélectionne n03, ouvre « SQL compilé », puis choisis Snowflake
- **Alors** « Étape n03 (CTE du SQL complet) » s'affiche ; le SQL Databricks contient `montant_ht`, puis le SQL Snowflake aussi

### S-0013-09 — Le brouillon survit au rechargement
Plan 0013, critère 9 · Test : `app/e2e/editor.spec.ts` › `[S-0013-09]`
- **Étant donné** le brouillon reconstruit en S-0013-01, « Enregistré … (local) »
- **Quand** je recharge la page
- **Alors** « schéma 1 · 5 nœuds · 4 arêtes » revient, et n05 porte « sortie du graphe »
- Limite : le test recharge l'app web ; il ne redémarre ni Tauri ni le sidecar. La persistance des brouillons côté serveur est vérifiée par `core/tests/repo/test_editor_api.py::test_draft_survives_and_is_deleted`.

### S-0013-10 — La soumission crée la proposition
Plan 0013, critère 10 · Test : `app/e2e/editor.spec.ts` › `[S-0013-10]`
- **Étant donné** le brouillon reconstruit en S-0013-01, sans erreur
- **Quand** je clique « Soumettre la proposition », lis « Nouvelle version », saisis la justification « Revenu net reconstruit dans l'éditeur. » et clique « Soumettre »
- **Alors** « Proposition n° N créée » s'affiche
- **Et** la liste des propositions de l'API contient le document, et son brouillon répond 404

### S-0013-11 — Sur cinquante nœuds, la validation suit la saisie
Plan 0013, critère 11 · Test : `app/e2e/editor.spec.ts` › `[S-0013-11]`
- **Étant donné** un brouillon de cinquante nœuds (source, calculs en chaîne, agrégation ; `longKpi` de `app/e2e/graphe.ts`), « Compilable Databricks, Snowflake »
- **Quand** je sélectionne le premier « Calcul de colonne » entièrement visible dans la région Graphe, remplace son expression par `colonne_absente + 1`, puis par `montant_ttc - montant_taxes`
- **Alors** un problème qui nomme `colonne_absente` apparaît, puis le statut redevient « Compilable Databricks, Snowflake »
- **Et** la durée entre la saisie et le problème est écrite dans la console, sans seuil
- Limite : cette durée comprend la temporisation de 300 ms et le transport. Le seuil de 150 ms est vérifié par `core/tests/repo/test_editor_api.py::test_validation_of_50_nodes_under_150_ms`.

**Plan 0021**

### S-0021-02 — Une division d'entiers est castée en DOUBLE
Plan 0021, critère 2 · Test : `app/e2e/sql.spec.ts` › `[S-0021-02]`
- **Étant donné** un brouillon de trois nœuds : source `gold.finance.mesures` (`entite`, `a` et `b` entiers), n02 calcul `a / NULLIF(b, 0)` sans type déclaré, agrégation
- **Quand** je sélectionne n02 et affiche le SQL Databricks, puis Snowflake
- **Alors** chacun contient `CAST(a AS DOUBLE) / NULLIF(b, 0)`
- Limite : le même `DOUBLE` dans les trois dialectes et la relecture par SQLGlot sont vérifiés par `core/tests/compile/test_ecarts.py::test_integer_division_is_a_double_everywhere`.

### S-0021-03 — Le `NULLIF` de l'auteur n'est pas doublé
Plan 0021, critère 3 · Test : `app/e2e/sql.spec.ts` › `[S-0021-03]`
- **Étant donné** le même brouillon, dont l'expression porte déjà `NULLIF(b, 0)`
- **Quand** j'affiche le SQL Databricks, puis Snowflake
- **Alors** aucun ne contient `NULLIF(NULLIF`
- Limite : le littéral non nul et l'opérande `double` sont vérifiés par `core/tests/compile/test_ecarts.py::test_division_rewrite_adds_nothing_superfluous`.

### S-0021-04 — Le type inféré d'une division d'entiers est `double`
Plan 0021, critère 4 · Test : `app/e2e/sql.spec.ts` › `[S-0021-04]`
- **Étant donné** le même brouillon, n02 sélectionné
- **Quand** j'ouvre l'onglet « Colonnes en sortie »
- **Alors** la colonne `c2` est de type `double`
- Limite : la division de décimaux est vérifiée par `core/tests/compile/test_ecarts.py::test_inferred_type_of_a_division_is_double`.

### S-0021-05 — La semaine Snowflake ne dépend pas de `WEEK_START`
Plan 0021, critère 5 · Test : `app/e2e/sql.spec.ts` › `[S-0021-05]`
- **Étant donné** un brouillon hebdomadaire construit par `weekly()` de `core/tests/compile/test_ecarts.py`
- **Quand** j'affiche le SQL Snowflake
- **Alors** il contient `DAYOFWEEKISO` et pas `DATE_TRUNC('WEEK'`
- Limite : l'égalité avec `DATE_TRUNC('WEEK', …)` de DuckDB sur plus d'un an de dates est vérifiée par `core/tests/compile/test_ecarts.py::test_snowflake_week_formula_matches_iso_weeks_over_a_year`.

### S-0021-06 — La garde est lue dans une branche indépendante
Plan 0021, critère 6 · Test : `app/e2e/sql.spec.ts` › `[S-0021-06]`
- **Étant donné** le brouillon v5 de Revenu net
- **Quand** j'affiche le SQL Databricks, puis Snowflake
- **Alors** chacun contient la garde `atlas_guard` et la branche `UNION ALL` qui la lit
- Limite : la forme DuckDB et l'exécution (une anomalie fait échouer une sortie vide ; sans anomalie, les lignes et elles seules) sont vérifiées par `core/tests/compile/test_ecarts.py::test_guard_is_read_by_a_branch_independent_of_the_output`, `::test_anomaly_on_an_empty_output_fails_on_duckdb` et `::test_no_anomaly_gives_the_rows_and_only_them`.

**Plan 0024**

### S-0024-01 — Déplacer un nœud ne redessine que sa carte
Plan 0024, critère 1 · Test : `app/src/editor/Canvas.test.tsx` › `[S-0024-01]` (Vitest)
- **Étant donné** le composant Canvas rendu avec une chaîne de cinquante nœuds (`LARGE_GRAPH`), toutes les cartes dessinées
- **Quand** la position de n007 passe à (600, 600)
- **Alors** seule la carte n007 est redessinée (compteur : les appels à `summary`, un par rendu de carte)
- Limite : test de composant, React Flow simulé sous jsdom ; pas de navigateur.

### S-0024-02 — Une modification ou une sélection ne redessine que les cartes concernées
Plan 0024, critère 2 · Test : `app/src/editor/Canvas.test.tsx` › `[S-0024-02]` (Vitest, deux tests)
- **Étant donné** le même Canvas de cinquante nœuds
- **Quand** la sélection passe de n003 à n004 ; puis, dans un autre rendu, l'expression de n010 devient `a + b`
- **Alors** seules n003 et n004 sont redessinées ; puis seule n010
- Limite : test de composant, sans navigateur.

### S-0024-03 — Sur 200 nœuds, seules les cartes visibles sont dans le DOM
Plan 0024, critère 3 · Test : `app/e2e/graphe-volumineux.spec.ts` › `[S-0024-03]`
- **Étant donné** un brouillon de 200 nœuds construit par `longKpi`
- **Quand** je l'ouvre dans l'éditeur
- **Alors** le canevas dessine au moins une carte et moins de 200

### S-0024-04 — Sur 200 nœuds, ouvrir, sélectionner et déplacer aboutissent
Plan 0024, critère 4 · Test : `app/e2e/graphe-volumineux.spec.ts` › `[S-0024-04]`
- **Étant donné** le même brouillon ouvert
- **Quand** je clique la première carte dessinée, puis fais glisser la deuxième de 48 px vers le bas, en douze pas
- **Alors** Propriétés affiche l'identifiant de la première, et la deuxième descend
- **Et** les durées d'ouverture, de sélection et de déplacement sont notées dans les annotations du rapport et dans la console

## Propositions

Les tests de `app/e2e/propositions.spec.ts` portent sur les cinq propositions de démonstration (`examples/propositions-nordis.py`). Trois comptes, trois serveurs sur le même dépôt nu : anna.k (autrice de la surcharge DE, serveur par défaut), claire.m (port 8798) et marc.d (port 8797), validateurs Finance. Pour claire.m, les requêtes de l'app sont relayées vers son serveur. Chaque test travaille sur sa propre copie de la démonstration, que claire.m et marc.d rejoignent.

`app/e2e/propositions-testables.spec.ts` fait de même : une copie par test, rejointe par les validateurs au besoin. S-0006-12 travaille sur le serveur 8793 (julien.h).

**Plan 0002**

### S-0002-06 — La surcharge DE remplace n03 sous son identifiant ; celle de n02 est hors points
Plan 0002, critère 6 · Test : `app/e2e/propositions.spec.ts` › `[S-0002-06]`
- **Étant donné** claire.m sur la proposition « Revenu net · nordis-de »
- **Quand** je lis le graphe « Déclinaison nordis-de v4 (proposée) » et le bandeau de la proposition
- **Alors** la carte n03 porte « Normal » et une bordure pointillée (point de variation déclaré) ; la carte n02 porte « Divergence critique »
- **Et** l'alerte « Surcharge hors des points de variation déclarés » nomme « Factures validées » (n02)
- Limite : l'écran montre l'effet de la résolution, pas son résultat. Le remplacement de n03 sous le même identifiant et les classes `declared` / `undeclared` sont vérifiés par `core/tests/model/test_resolve.py::test_de_override_replaces_n03_and_classifies_overrides`.

**Plan 0003**

### S-0003-02 — Le diff de la surcharge DE contre le canonique v4
Plan 0003, critère 2 · Test : `app/e2e/propositions.spec.ts` › `[S-0003-02]`
- **Étant donné** claire.m sur la proposition « Revenu net · nordis-de »
- **Quand** je lis le graphe proposé, le canonique v4 et le diff
- **Alors** n02 porte « Divergence critique » dans le graphe proposé et pas dans le canonique ; n03 porte « Normal »
- **Et** la région « Diff de la proposition » liste trois écarts, dont un sur `timezone`
- Limite : la démonstration ajoute un écart de fuseau au corpus de la maquette 10.4. Les deux écarts exacts (n02 `override_undeclared` / `critical`, n03 `override_declared`) sont vérifiés par `core/tests/model/test_diff.py::test_de_against_canonical_matches_the_mockup`.

**Plan 0006**

### S-0006-01 — Validations requises selon le type de proposition
Plan 0006, critère 1 · Test : `app/e2e/propositions-testables.spec.ts` › `[S-0006-01]`
- **Étant donné** une copie de la démonstration, et une nouvelle proposition, créée par l'API, qui ne change sur nordis-fr que le texte d'un point déclaré
- **Quand** j'ouvre Propositions
- **Alors** le canonique v5 affiche « Validations : 1 / 2 » ; nordis-de (hors points) « 0 / 2 (canonique requis) » ; nordis-es (from scratch) « 1 / 2 (canonique requis) »
- **Et** la nouvelle proposition affiche « Validations : 0 / 1 »

### S-0006-02 — Les approbations non habilitées ne comptent pas
Plan 0006, critère 2 · Test : `app/e2e/propositions-testables.spec.ts` › `[S-0006-02]`
- **Étant donné** une copie de la démonstration, où marc.d a approuvé le canonique v5 (« 1 / 2 »)
- **Quand** un commit poussé fait de marc.d un validateur Supply seulement et l'espace est synchronisé ; puis anna.k approuve par l'API sa propre proposition DE, puis le canonique v5 (n° 3), en simple contributrice ; enfin marc.d approuve DE depuis son serveur
- **Alors** après le changement de rôle, le canonique v5 et DE affichent « 0 / 2 »
- **Et** l'approbation de l'autrice est refusée (422 `cannot_review_own`) ; celles de la contributrice et du validateur Supply sont enregistrées, mais les deux compteurs restent à « 0 / 2 »
- Limite : le refus de l'autrice à l'écran est S-0014-04. Les règles d'habilitation sont vérifiées par `core/tests/repo/test_governance.py::test_only_eligible_approvals_on_the_head_count` et `core/tests/repo/test_proposals.py::test_rights`.

### S-0006-03 — Un nouveau commit remet le décompte à zéro
Plan 0006, critère 3 · Test : `app/e2e/propositions-testables.spec.ts` › `[S-0006-03]`
- **Étant donné** une copie de la démonstration, où claire.m a approuvé DE depuis son serveur : « Validations : 1 / 2 »
- **Quand** un commit est poussé par git sur la branche de la proposition, puis je recharge
- **Alors** DE affiche « Validations : 0 / 2 »
- **Et** la proposition sélectionnée n'a pas de bouton « Fusionner »

### S-0006-04 — La fusion incrémente la version, que la fiche montre
Plan 0006, critère 4 · Test : `app/e2e/propositions.spec.ts` › `[S-0006-04]`
- **Étant donné** la proposition DE approuvée par claire.m à l'écran et par marc.d par l'API : « Validations : 2 / 2 (canonique requis) · prête à fusionner »
- **Quand** claire.m clique « Fusionner », puis « Voir la fiche »
- **Alors** « Proposition n° 5 fusionnée » s'affiche, et la fiche `revenu-net--nordis-de` affiche « v4 · validée le … »
- Limite : le tag Git n'est pas lu ici ; `core/tests/repo/test_proposals.py::test_full_cycle` vérifie `doc/revenu-net/v5`.

### S-0006-05 — Une base avancée refuse la fusion
Plan 0006, critère 5 · Test : `app/e2e/propositions-testables.spec.ts` › `[S-0006-05]`
- **Étant donné** une copie de la démonstration, DE approuvée par claire.m et marc.d (« 2 / 2 »), vue par claire.m ; puis un commit poussé sur la branche principale change le document DE
- **Quand** je clique « Fusionner »
- **Alors** le serveur répond 409 `stale_base`, et une alerte dit que le document « a changé depuis la proposition »
- **Et** la branche principale du dépôt distant n'a pas bougé

### S-0006-07 — Le cycle de revue passe sur l'hébergeur local
Plan 0006, critère 7 · Test : `app/e2e/propositions.spec.ts` › `[S-0006-07]`
- **Étant donné** trois serveurs locaux sur un même dépôt nu, sans hébergeur distant (`LocalHost`)
- **Quand** claire.m approuve à l'écran, marc.d approuve par l'API, puis claire.m fusionne
- **Alors** le compteur passe de 0 / 2 à 1 / 2 puis 2 / 2, la fusion aboutit, et la file `?status=merged` affiche DE « Fusionnée »
- Limite : la proposition vient du script de démonstration (la création depuis l'éditeur est S-0013-10) ; aucun commentaire n'est posté, et seules les requêtes du navigateur restent locales. Le cycle complet, commentaire compris, est vérifié par `core/tests/repo/test_proposals.py::test_full_cycle`.

### S-0006-12 — Seul habilité : fusion sans revue, avec mention et trailer, jusqu'à un deuxième habilité
Plan 0006, critère 12 · Test : `app/e2e/propositions-testables.spec.ts` › `[S-0006-12]` ; `app/e2e/administration.spec.ts` › `[S-0006-12]` (deux tests, la gouvernance)
- **Étant donné** une copie de la démonstration sur le serveur 8793, dont la gouvernance ne garde que julien.h, sans référent ni validateur de domaine ; une proposition sur Revenu net, créée par l'API
- **Quand** je l'ouvre dans Propositions et clique « Fusionner » ; puis claire.m devient validatrice Finance par un commit poussé, et une nouvelle proposition sur Revenu net est créée
- **Alors** la proposition affiche « Fusionnée sans revue : aucun autre compte habilité », la fusion aboutit (« Proposition n° N fusionnée »), et le commit de tête porte le trailer `Atlas-Review: none (no other eligible approver)`
- **Et** la nouvelle proposition affiche « Validations : 0 / 2 », sans la mention ni le bouton « Fusionner »
- **Et** côté gouvernance, dans Administration, julien.h seul référent enregistre « fusionnée sans revue » ; après la nomination d'une deuxième référente, l'enregistrement suivant ouvre une proposition à relire (S-0017-08)
- Limite : une proposition qui retire les autres habilités ne profite pas de l'exception ; c'est vérifié par `core/tests/repo/test_proposals.py::test_removing_the_other_referents_does_not_unlock_the_exception`. Le rendu de la mention est aussi testé en Vitest dans `app/src/screens/Proposals.test.tsx` (deux tests, sans identifiant).

**Plan 0014**

### S-0014-01 — La file d'anna.k : badges et compteurs
Plan 0014, critère 1 · Test : `app/e2e/propositions.spec.ts` › `[S-0014-01]`
- **Étant donné** anna.k, qui ne valide aucun domaine
- **Quand** j'ouvre Propositions
- **Alors** le titre est focalisé, le filtre Domaine vaut « tous », et les cinq propositions du script figurent
- **Et** DE porte le badge « Hors points déclarés », « Surcharge · Finance · par Anna K. » et « Validations : 0 / 2 (canonique requis) » ; ES le badge « From scratch » et « 1 / 2 (canonique requis) » ; le canonique v5 « 1 / 2 » ; Taux de service canonique v3 « 1 / 1 · prête à fusionner »

### S-0014-02 — Un validateur Finance voit d'abord ses domaines
Plan 0014, critère 2 · Test : `app/e2e/propositions.spec.ts` › `[S-0014-02]`
- **Étant donné** claire.m, validatrice Finance
- **Quand** j'ouvre Propositions
- **Alors** le filtre Domaine vaut « mes-domaines », les quatre propositions de Revenu net figurent, et Taux de service (Supply) est absente

### S-0014-03 — La proposition DE : bandeau, n02 critique, n03 normal
Plan 0014, critère 3 · Test : `app/e2e/propositions.spec.ts` › `[S-0014-03]`
- **Étant donné** claire.m dans sa file
- **Quand** je sélectionne « Revenu net · nordis-de »
- **Alors** l'alerte « Surcharge hors des points de variation déclarés » nomme « Factures validées » (n02) et dit que nordis-de et nordis-fr surchargent tous n02 hors des points déclarés
- **Et** dans le graphe proposé, n02 porte « Divergence critique » et une bordure rouge (`--atlas-bad`), n03 « Normal » et une bordure pointillée

### S-0014-04 — Approuver incrémente ; l'autrice ne peut pas approuver
Plan 0014, critère 4 · Test : `app/e2e/propositions.spec.ts` › `[S-0014-04]` (deux tests : anna.k, claire.m)
- **Étant donné** la proposition DE, vue par anna.k puis par claire.m
- **Quand** anna.k survole « Approuver (0 / 2) » ; claire.m clique « Approuver (0 / 2) »
- **Alors** pour anna.k le bouton est désactivé (`aria-disabled`), avec l'infobulle « Vous êtes l'auteur de cette proposition : un autre compte doit l'approuver. »
- **Et** pour claire.m il devient « Approuver (1 / 2) », la file affiche « Validations : 1 / 2 (canonique requis) » et la proposition « Claire M. a approuvé »

### S-0014-05 — Pas de demande de changements sans commentaire
Plan 0014, critère 5 · Test : `app/e2e/propositions.spec.ts` › `[S-0014-05]`
- **Étant donné** claire.m sur la proposition DE
- **Quand** je clique « Demander des changements », puis « Envoyer la demande » sans rien écrire
- **Alors** le champ « Ce qui doit changer » a le focus, « Expliquer ce qui doit changer : la demande part avec ce commentaire. » s'affiche, et aucune requête POST n'est partie
- **Et** « Annuler » ferme le formulaire

### S-0014-06 — Une proposition prête se fusionne et quitte la file
Plan 0014, critère 6 · Test : `app/e2e/propositions.spec.ts` › `[S-0014-06]`
- **Étant donné** DE à « Validations : 2 / 2 (canonique requis) · prête à fusionner », sans bouton « Demander des changements »
- **Quand** claire.m clique « Fusionner »
- **Alors** « Proposition n° 5 fusionnée » s'affiche, et DE quitte la file, qui compte une entrée de moins
- **Et** « Voir la fiche » ouvre la fiche DE en v4, et la file `?status=merged` liste DE « Fusionnée »

### S-0014-07 — Chaque écart est repris en texte
Plan 0014, critère 7 · Test : `app/e2e/propositions.spec.ts` › `[S-0014-07]`
- **Étant donné** claire.m sur la proposition DE
- **Quand** je lis la région « Diff de la proposition »
- **Alors** elle liste trois écarts en texte, dont celui du fuseau (`timezone`), et axe-core ne relève aucune violation sérieuse

## Comparaison

Le serveur d'anna.k compare en local dans DuckDB, sur les fichiers de `core/tests/fixtures/compare/revenu-net` (`ATLAS_COMPARE_DATA`). Le serveur 8793 n'a pas ces données : il sert aux scénarios d'authentification et de refus, sur des espaces isolés.

**Plan 0009**

### S-0009-01 — Les valeurs de la maquette 10.5
Plan 0009, critère 1 · Test : `app/e2e/comparaison.spec.ts` › `[S-0009-01]`
- **Étant donné** l'écran Comparaison de Groupe Nordis, KPI Revenu net
- **Quand** je clique « Lancer la comparaison » et attends « Relancer »
- **Alors** la matrice affiche « Revenu net × nordis-de : 94 % de validation, écart max 6,1 % »
- Limite : le nœud divergent n02 est lu dans le détail par S-0015-02 ; les valeurs exactes sont vérifiées par `core/tests/compare/test_compare.py::test_mockup_values`.

### S-0009-03 — Une cellule absente d'un côté est hors tolérance
Plan 0009, critère 3 · Test : `app/e2e/comparaison-cellules.spec.ts` › `[S-0009-03]`
- **Étant donné** un espace isolé et une réponse simulée pour la comparaison n° 424242 : quatre cellules de nordis-de, dont une sans valeur canonique et une sans valeur de la déclinaison
- **Quand** j'ouvre `comparaison?id=424242&variant=nordis-de`
- **Alors** le détail compte quatre lignes ; la valeur manquante s'affiche « absente », côté canonique pour l'une, côté déclinaison pour l'autre
- **Et** ces deux lignes sont marquées « hors tolérance » (classe `is-out`), avec « — » pour l'écart
- Limite : la réponse du serveur est simulée ; le décompte hors tolérance est vérifié par `core/tests/compare/test_compare.py::test_cells_missing_on_one_side_are_out_of_tolerance`.

### S-0009-04 — Canonique à 0 : écart nul si la déclinaison vaut 0, sinon hors tolérance
Plan 0009, critère 4 · Test : `app/e2e/comparaison-cellules.spec.ts` › `[S-0009-04]`
- **Étant donné** la même réponse simulée : une cellule à 0 des deux côtés, une autre à 0 au canonique et 12 dans la déclinaison
- **Quand** j'ouvre le détail
- **Alors** la première affiche 0 et 0, l'écart « 0,0 % », et n'est pas hors tolérance
- **Et** la seconde affiche 0 et 12, l'écart « — », et elle est marquée « hors tolérance »
- Limite : la réponse est simulée ; la règle de calcul est vérifiée par `core/tests/compare/test_compare.py::test_gap`.

### S-0009-05 — Une jointure contournée est signalée avant le lancement
Plan 0009, critère 5 · Test : `app/src/screens/Comparison.test.tsx` › `[S-0009-05]` (Vitest)
- **Étant donné** l'écran Comparaison rendu contre un faux serveur dont l'aperçu signale une jointure contournée
- **Quand** l'écran se charge, sans lancer
- **Alors** l'alerte « Contrôle de cardinalité contourné » s'affiche, l'aperçu a été demandé pour nordis-de et nordis-fr, et aucun lancement n'est parti
- Limite : pas de parcours e2e, la démonstration n'a pas de jointure contournée. `bypass_nodes` est vérifié par `core/tests/compare/test_compare.py::test_bypassed_join_is_reported`.

### S-0009-06 — Sans accès valide, la comparaison demande une connexion
Plan 0009, critère 6 · Test : `app/e2e/comparaison-auth.spec.ts` › `[S-0009-06]`
- **Étant donné** un espace isolé sur le serveur 8793, sans données locales ni accès à dbx-fr
- **Quand** je décoche nordis-es et nordis-de, puis lance la comparaison
- **Alors** « Connexion requise » s'affiche, avec le bouton « Se connecter à dbx-fr »
- Limite : l'absence d'exécution partielle est vérifiée par `core/tests/repo/test_comparisons_api.py::test_needs_auth_before_any_execution`.

**Plan 0015**

### S-0015-01 — Lancer, voir la progression, lire 94 % / 6,1 %
Plan 0015, critère 1 · Test : `app/e2e/comparaison.spec.ts` › `[S-0015-01]`
- **Étant donné** l'écran Comparaison, KPI Revenu net, nordis-de et nordis-es cochées, et l'avertissement « Surcharge hors des points déclarés » affiché avant tout lancement
- **Quand** je clique « Lancer la comparaison »
- **Alors** les barres « Databricks · nordis-de, nordis-fr » et « Snowflake · nordis-es » apparaissent, puis « Relancer » ; l'adresse porte `id=…&variant=nordis-de`
- **Et** la cellule « Revenu net × nordis-de : 94 % de validation, écart max 6,1 % » est la cellule courante, et nordis-fr est à 100 %

### S-0015-02 — Le détail : Sept. 2026 hors tolérance, lien vers n02
Plan 0015, critère 2 · Test : `app/e2e/comparaison.spec.ts` › `[S-0015-02]`
- **Étant donné** une comparaison terminée de Revenu net
- **Quand** je clique la cellule nordis-de à 94 %, puis le lien « Nœud divergent : n02 · Factures validées »
- **Alors** le détail « Revenu net · nordis-de · par Mois fiscal × Entité » montre la ligne « Sept. 2026 DE » marquée « +6,1 % hors tolérance »
- **Et** le lien ouvre `fiche/revenu-net--nordis-de?diff=canonique&node=n02`, avec « Nœud sélectionné : n02 » et la carte Factures validées sélectionnée et visible

### S-0015-03 — Une déclinaison avec bypass affiche le bandeau avant lancement
Plan 0015, critère 3 · Test : `app/src/screens/Comparison.test.tsx` › `[S-0015-03]` (Vitest)
- **Étant donné** l'écran Comparaison rendu contre un faux serveur : nordis-es non comparable, un aperçu qui signale une jointure contournée
- **Quand** l'écran se charge, puis je change la granularité et passe la tolérance à 2
- **Alors** nordis-es est désactivée, décochée et décrite par « Non comparable : Le canonique ne se rebranche pas… », nordis-de est cochée, et « Contrôle de cardinalité contourné » s'affiche sans qu'aucun lancement soit parti ; la tolérance affichée est 1,5 %
- **Et** le nouvel aperçu porte un scope ad hoc (granularité `mois_fiscal`) et la tolérance 2
- Limite : pas de parcours e2e, faute de jointure contournée dans la démonstration.

### S-0015-04 — Sans accès, s'authentifier puis reprendre le lancement
Plan 0015, critère 4 · Test : `app/e2e/comparaison-auth.spec.ts` › `[S-0015-04]`
- **Étant donné** un espace isolé sur le serveur 8793, nordis-fr seule cochée, « Connexion requise » affichée après un premier lancement
- **Quand** je clique « Se connecter à dbx-fr » et termine l'OAuth dans la fenêtre du faux Databricks (« Connexion réussie »)
- **Alors** un nouveau lancement est accepté (HTTP 202) sans nouveau clic sur « Lancer », et le bouton de connexion disparaît
- Limite : le faux Databricks ne calcule pas le SQL métier ; le scénario s'arrête à la reprise.

### S-0015-05 — Annuler arrête la progression
Plan 0015, critère 5 · Test : `app/src/screens/Comparison.test.tsx` › `[S-0015-05]` (Vitest)
- **Étant donné** l'écran Comparaison contre un faux serveur, une exécution n° 8 en cours (barre « Databricks · nordis-de, nordis-fr » à 40 %, « En cours · 40 % »)
- **Quand** je clique « Annuler »
- **Alors** la requête `/comparisons/8/cancel` part, « Comparaison n° 8 annulée. » s'affiche, le bouton « Annuler » disparaît et le statut « Annulé » s'affiche
- Limite : pas de parcours e2e. L'arrêt réel et le nettoyage sont vérifiés par `core/tests/repo/test_comparisons_api.py::test_cancel_through_the_api` et `core/tests/compare/test_compare.py::test_cancel_leaves_cancelled_and_nothing_extracted`.

### S-0015-06 — L'arrondi n'est qu'à l'affichage
Plan 0015, critère 6 · Test : `app/e2e/comparaison.spec.ts` › `[S-0015-06]`
- **Étant donné** le détail de nordis-de
- **Quand** je lis l'écart de la ligne Sept. 2026
- **Alors** il s'affiche « +6,1 % », et son infobulle donne la valeur exacte, qui commence par `6.1001`

### S-0015-07 — L'historique complet et ses filtres
Plan 0015, critère 7 · Test : `app/e2e/comparaison.spec.ts` › `[S-0015-07]`
- **Étant donné** au moins une comparaison de Revenu net dans l'espace
- **Quand** je clique « Tout voir » dans « Dernières comparaisons », choisis l'utilisateur anna.k, puis « Depuis le » 2999-01-01
- **Alors** « Historique des comparaisons » s'ouvre ; la première ligne nomme anna.k et « nordis-de 94 % · nordis-es 75 % · nordis-fr 100 % » ; l'adresse porte `user=anna.k`
- **Et** la date future donne « Aucune comparaison ne correspond à ces filtres. »
- Limite : « seulement celles de l'espace » est vérifié par `core/tests/repo/test_comparisons_api.py::test_spaces_never_share_results`.

**Plan 0022**

### S-0022-01 — ES à 75 %, DE à 94 %, FR à 100 %
Plan 0022, critère 1 · Test : `app/e2e/comparaison.spec.ts` › `[S-0022-01]`
- **Étant donné** l'écran Comparaison de Revenu net, nordis-es cochée
- **Quand** je lance la comparaison et attends « Relancer »
- **Alors** la matrice affiche « Revenu net × nordis-es : 75 % de validation, écart max 2,9 % », nordis-de à 94 % et nordis-fr à 100 %
- Limite : l'interface arrondit à 2,9 %. Les huit cellules, la valeur exacte de 2,93 % et les mois de juin et juillet sont vérifiés par `core/tests/compare/test_compare.py::test_from_scratch_es_compares_with_fr_and_de`.

### S-0022-02 — Une source sans colonne lue est refusée, la colonne nommée
Plan 0022, critère 2 · Test : `app/e2e/comparaison-refus.spec.ts` › `[S-0022-02]`
- **Étant donné** un espace isolé où la source ES n'a plus la colonne `abonos` ni son rattachement à `avoirs`, synchronisé
- **Quand** j'ouvre Comparaison
- **Alors** nordis-es est désactivée et décochée, et un texte nomme `avoirs`
- Limite : le code `canonical_not_rebindable` est vérifié par `core/tests/compare/test_compare.py::test_canonical_not_rebindable_lists_missing_columns`.

### S-0022-03 — Les deux types sont nommés ; un entier se lit comme décimal
Plan 0022, critère 3 · Test : `app/e2e/comparaison-refus.spec.ts` › `[S-0022-03]`
- **Étant donné** un espace isolé où la colonne `iva` de la source ES est déclarée `string`, puis `integer`, chaque état synchronisé
- **Quand** j'ouvre Comparaison après chaque état
- **Alors** en `string`, nordis-es est désactivée et « montant_taxes (decimal attendu, string dans iva) » s'affiche
- **Et** en `integer`, nordis-es est active et cochée
- Limite : l'exécution avec la colonne entière est vérifiée par `core/tests/compare/test_compare.py::test_type_mismatch_is_named_and_integers_widen`.

### S-0022-04 — `facture_id` peut manquer, `commande_id` non
Plan 0022, critère 4 · Test : `app/e2e/comparaison-refus.spec.ts` › `[S-0022-04]`
- **Étant donné** un espace isolé dont la source ES n'a pas de `facture_id` : nordis-es est comparable
- **Quand** je retire `factura_id` (rattachée à `commande_id`) et son rattachement, synchronise et recharge
- **Alors** nordis-es devient désactivée, et « Non comparable : … commande_id » s'affiche

### S-0022-05 — Une déclinaison sans concept commun n'est pas comparable
Plan 0022, critère 5 · Test : `app/e2e/comparaison-refus.spec.ts` › `[S-0022-05]`
- **Étant donné** un espace isolé où la source de nordis-es est rattachée au seul concept `client-actif`, document toujours valide ; l'espace est synchronisé
- **Quand** j'ouvre Comparaison
- **Alors** nordis-es est désactivée et décochée
- **Et** « Non comparable : … aucune de ses sources n'est rattachée à un concept des sources du canonique » s'affiche
- Limite : la source commune (date de référence lue sur Snowflake) n'est pas encore affichée, `Rebound.common` n'étant pas exposé (Reste à faire). Elle est vérifiée par `core/tests/compare/test_compare.py::test_rebound_canonical_keeps_a_common_source` ; le refus par `::test_a_variant_sharing_no_concept_is_refused`.

### S-0022-06 — nordis-es proposée, cochée, et à 75 % dans la matrice
Plan 0022, critère 6 · Test : `app/e2e/comparaison.spec.ts` › `[S-0022-06]`
- **Étant donné** l'écran Comparaison de Revenu net
- **Quand** je lis le panneau de lancement, puis lance la comparaison
- **Alors** nordis-es est active et cochée avant le lancement
- **Et** la matrice l'affiche à 75 %

## Connexions

Les tests de `app/e2e/connexions.spec.ts` se suivent sur Groupe Nordis (anna.k, coffre en mémoire). dbx-fr pointe vers le faux Databricks, dont l'OAuth s'ouvre dans une fenêtre du navigateur et revient sur le serveur local (port 8020) ; snow-de (SSO) et snow-es (paire de clés) vers le faux Snowflake. `app/e2e/github.spec.ts` utilise le serveur 8793 et un faux GitHub (port 8792).

Les tests de `app/e2e/connexions-testables.spec.ts` travaillent chacun sur un espace isolé du serveur 8793 (julien.h). Ils pilotent le faux Databricks par sa route de test `/__test__/configure` (OAuth refusé, jeton expiré, rafraîchissement refusé), remise à zéro après chaque test.

**Plan 0008**

### S-0008-02 — Le même point d'accès dans deux espaces : deux accès indépendants
Plan 0008, critère 2 · Test : `app/e2e/connexions-testables.spec.ts` › `[S-0008-02]`
- **Étant donné** deux espaces isolés qui déclarent chacun dbx-fr
- **Quand** je connecte dbx-fr par OAuth dans chacun, puis révoque l'accès dans le premier
- **Alors** le premier revient à « Jamais connecté »
- **Et** le second reste « Connecté · session OAuth », et « Tester » y donne « Connexion OK · N ms »
- Limite : coffre en mémoire ; les deux entrées du trousseau sont vérifiées par `core/tests/connections/test_connections.py::test_same_access_point_in_two_spaces_gives_two_entries`.

### S-0008-03 — « Tester » nomme un hôte injoignable
Plan 0008, critère 3 · Test : `app/e2e/connexions-testables.spec.ts` › `[S-0008-03]`
- **Étant donné** un espace isolé où dbx-fr pointe, par un commit poussé, vers un port local libre où rien n'écoute ; un token personnel factice est rangé par l'API
- **Quand** je clique « Tester Databricks · dbx-fr »
- **Alors** le statut de la ligne affiche « Hôte injoignable »
- Limite : `ok` sur un warehouse réel exige un compte : `core/tests/connections/test_connections.py::test_real_warehouse` (marqué `databricks`) ; le cas du faux serveur par `::test_test_is_ok_then_explicit_for_an_unreachable_host`.

### S-0008-04 — Un jeton expiré est rafraîchi ; un refus donne « Session expirée »
Plan 0008, critère 4 · Test : `app/e2e/connexions-testables.spec.ts` › `[S-0008-04]` (boucle : deux tests, rafraîchissement accepté puis refusé)
- **Étant donné** le faux Databricks qui délivre des jetons déjà expirés, et refuse ou non le rafraîchissement
- **Quand** je connecte dbx-fr par OAuth
- **Alors** si le rafraîchissement est accepté, la ligne affiche « Connecté », et « Tester » donne « Connexion OK · N ms »
- **Et** s'il est refusé, la ligne affiche « Session expirée » et le bouton « Reconnecter Databricks · dbx-fr »
- Limite : le rafraîchissement lui-même est vérifié par `core/tests/connections/test_connections.py::test_expired_token_is_refreshed` et `::test_refused_refresh_gives_expired`.

### S-0008-05 — Repli par token personnel : champ masqué, vidé, token jamais rendu
Plan 0008, critère 5 · Test : `app/e2e/connexions-testables.spec.ts` › `[S-0008-05]`
- **Étant donné** un espace isolé et le faux Databricks qui refuse l'OAuth ; avant l'échec, aucun champ « Token personnel Databricks »
- **Quand** je clique « Se connecter à Databricks · dbx-fr » (alerte `access_denied`), puis « Utiliser un token personnel », saisis un token factice et clique « Ranger dans le coffre »
- **Alors** le champ est de type `password`, `autocomplete="off"`, et il est vide avant que la réponse du serveur n'arrive ; la requête porte exactement le token
- **Et** la ligne affiche « Connecté · token personnel », y compris après rechargement ; le token n'apparaît ni dans les réponses de `connections` et `connections/dbx-fr/status`, ni dans les réponses relevées pendant le test, ni dans le HTML, les champs, le stockage du navigateur ou `sessionStorage`
- Limite : coffre en mémoire ; le trousseau est vérifié par `core/tests/connections/test_connections.py::test_personal_token_goes_to_the_vault_and_never_comes_back`. Le même repli est rendu en Vitest : `app/src/screens/Connections.test.tsx` › `[S-0008-05]`. C'est une exception assumée à la règle du guide 10.6 (voir plus bas).

### S-0008-07 — Une plateforme non autorisée est refusée à la déclaration
Plan 0008, critère 7 · Test : `app/e2e/connexions-testables.spec.ts` › `[S-0008-07]`
- **Étant donné** un espace isolé dont la gouvernance retire Databricks des plateformes autorisées, par un commit poussé ; l'espace est synchronisé
- **Quand** j'ouvre « Mes connexions », puis déclare par l'API un point d'accès Databricks
- **Alors** la ligne dbx-fr affiche « Plateforme retirée par le référent »
- **Et** l'API répond 422 `invalid_access_point`, avec le problème `platform_not_allowed`
- Limite : la déclaration passe par l'API, le panneau ne proposant plus Databricks (S-0016-06). `core/tests/connections/test_connections.py::test_platform_removed_from_allowed_platforms_cannot_be_used`.

**Plan 0016**

### S-0016-01 — Le tableau reflète les points d'accès et mon accès
Plan 0016, critère 1 · Test : `app/e2e/connexions.spec.ts` › `[S-0016-01]`
- **Étant donné** Groupe Nordis et ses points d'accès dbx-fr, snow-de et snow-es
- **Quand** j'ouvre « Mes connexions »
- **Alors** la ligne `gold.finance` (dbx-fr) affiche « Claire M. », « Quotidienne · 06:10 » et « Jamais connecté » ; la ligne `FIN_GOLD.PUBLIC` affiche « Snowflake » et « nordis-de · SSO »
- **Et** aucun champ dont le libellé parle de token n'existe

### S-0016-02 — Se connecter par OAuth, sans recharger
Plan 0016, critère 2 · Test : `app/e2e/connexions.spec.ts` › `[S-0016-02]`
- **Étant donné** dbx-fr « Jamais connecté »
- **Quand** je clique « Se connecter à Databricks · dbx-fr » et que la fenêtre du faux Databricks affiche « Connexion réussie »
- **Alors** la ligne passe à « Connecté · session OAuth », sans rechargement de la page
- Limite : la fenêtre est une popup du navigateur ; sous Tauri, l'ouverture du navigateur système relève de S-RAF-07 et S-RAF-08.

### S-0016-03 — Tester, puis révoquer
Plan 0016, critère 3 · Test : `app/e2e/connexions.spec.ts` › `[S-0016-03]`
- **Étant donné** dbx-fr « Connecté · session OAuth »
- **Quand** je clique « Tester Databricks · dbx-fr », puis « Révoquer Databricks · dbx-fr »
- **Alors** « Connexion OK · N ms » s'affiche, puis la ligne revient à « Jamais connecté » avec le bouton « Se connecter à Databricks · dbx-fr »
- Limite : l'e2e utilise un coffre en mémoire ; la suppression de l'entrée du trousseau est vérifiée par `core/tests/connections/test_connections.py`.

### S-0016-04 — Changer d'espace change la liste
Plan 0016, critère 4 · Test : `app/e2e/connexions.spec.ts` › `[S-0016-04]`
- **Étant donné** « Mes connexions » de Groupe Nordis, qui liste dbx-fr
- **Quand** je crée un espace vide par le sélecteur, ouvre ses Connexions, puis reviens à Groupe Nordis et à ses Connexions
- **Alors** le nouvel espace affiche « … ne déclare encore aucun point d'accès » et aucun de dbx-fr, snow-de, snow-es
- **Et** le retour à Groupe Nordis retrouve dbx-fr

### S-0016-05 — Aucun token dans le DOM ni le stockage
Plan 0016, critère 5 · Test : `app/e2e/connexions.spec.ts` › `[S-0016-05]`
- **Étant donné** les valeurs `at-secret` et `rt-secret` que rend le faux serveur OAuth
- **Quand** dbx-fr vient d'être connecté, puis révoqué
- **Alors** ni le HTML de la page, ni `localStorage`, ni `sessionStorage` ne les contiennent, à chaque étape

### S-0016-06 — Une plateforme non autorisée n'apparaît pas dans le panneau
Plan 0016, critère 6 · Test : `app/e2e/connexions-testables.spec.ts` › `[S-0016-06]`
- **Étant donné** le même espace isolé, Databricks retiré de la gouvernance (S-0008-07)
- **Quand** je clique « Ajouter un point d'accès »
- **Alors** la liste Plateforme du panneau « Nouveau point d'accès » propose Snowflake, et pas Databricks
- Limite : les plateformes à venir, désactivées, sont vérifiées en Vitest : `app/src/screens/Connections.test.tsx` › `[S-0016-06]`.

**Plan 0018**

### S-0018-02 — Paire de clés avec passphrase
Plan 0018, critère 2 · Test : `app/e2e/connexions.spec.ts` › `[S-0018-02]`
- **Étant donné** le faux Snowflake : SSO automatique pour snow-de, clé chiffrée de `svc_es` pour snow-es
- **Quand** je connecte snow-de par « Ouvrir le SSO » et le teste ; puis, sur snow-es, saisis l'identifiant `svc_es`, le fichier de clé et sa passphrase, clique « Ranger dans le coffre » et teste ; enfin révoque les deux
- **Alors** snow-de passe à « Connecté · session SSO », snow-es à « Connecté · paire de clés », chaque test donne « Connexion OK · N ms »
- **Et** la passphrase n'apparaît ni dans le HTML ni dans les stockages ; la révocation affiche « Accès révoqué, ici et chez Snowflake. » et ramène les deux lignes à « Jamais connecté »
- Limite : « au coffre et nulle part ailleurs » est vérifié par `core/tests/connections/test_snowflake.py::test_key_pair_with_passphrase_only_in_the_vault`.

**Plan 0025**

Les cinq scénarios suivants viennent d'un même test : deux espaces isolés sur le serveur 8793, dont l'adresse déclarée devient `https://github.com/nordis/<espace>.git` ; le dépôt reste local et aucune requête ne part vers github.com. Toutes les réponses de l'API sont relevées.

### S-0025-01 — Un code s'affiche, GitHub s'ouvre, aucun champ de jeton
Plan 0025, critère 1 · Test : `app/e2e/github.spec.ts` › `[S-0025-01]`
- **Étant donné** les connexions du premier espace, région « Dépôt de l'espace »
- **Quand** je clique « Se connecter à GitHub », puis « Ouvrir GitHub »
- **Alors** le groupe « Connexion à GitHub » montre le code (« … code sur GitHub »), la région ne contient aucun champ texte, et une fenêtre s'ouvre sur `http://127.0.0.1:8792/login/device?code=…`

### S-0025-02 — Une fois autorisé, le jeton est au coffre et jamais rendu
Plan 0025, critère 2 · Test : `app/e2e/github.spec.ts` › `[S-0025-02]`
- **Étant donné** un code en attente
- **Quand** je clique « Autoriser » dans la fenêtre du faux GitHub
- **Alors** la région affiche « @julien.h », et l'API annonce `state: connected`, `source: vault`
- **Et** le jeton `gho_jeton-du-device-flow` n'apparaît dans aucune réponse relevée ni dans la page
- Limite : l'e2e utilise un coffre en mémoire ; le trousseau est vérifié par `core/tests/repo/test_github_device.py`.

### S-0025-03 — Le jeton d'un espace ne sert qu'à cet espace
Plan 0025, critère 3 · Test : `app/e2e/github.spec.ts` › `[S-0025-03]`
- **Étant donné** le premier espace connecté à GitHub, le second jamais
- **Quand** j'ouvre les connexions du second
- **Alors** la région affiche « Jamais connecté », et l'API du second annonce `state: absent`

### S-0025-05 — Refus et expiration permettent de recommencer
Plan 0025, critère 5 · Test : `app/e2e/github.spec.ts` › `[S-0025-05]`
- **Étant donné** le premier espace, sans connexion GitHub
- **Quand** je refuse un premier code, laisse expirer le deuxième, puis autorise le troisième
- **Alors** le refus affiche une alerte « … refusée », l'expiration une alerte « … expiré », et « Se connecter à GitHub » redevient actif après chacune
- **Et** le troisième essai aboutit à « @julien.h »

### S-0025-06 — « Déconnecter » retire le jeton du coffre
Plan 0025, critère 6 · Test : `app/e2e/github.spec.ts` › `[S-0025-06]`
- **Étant donné** le premier espace connecté à GitHub
- **Quand** je clique « Déconnecter GitHub »
- **Alors** « Jeton retiré du coffre » s'affiche, et l'API annonce `state: absent`

## Administration

julien.h, seul référent de Groupe Nordis, a son serveur (port 8795) et son dépôt de démonstration ; les requêtes de l'app y sont relayées. Les tests qui écrivent dans le dépôt travaillent sur un espace isolé. Ceux de `app/e2e/depot-testables.spec.ts` le font sur le serveur 8793, où julien.h est aussi seul référent : ils modifient le dépôt par git, du côté du dépôt nu ou du clone, puis cliquent « Synchroniser ».

**Plan 0005**

### S-0005-11 — Une divergence au sync est signalée, sans toucher au clone
Plan 0005, critère 11 · Test : `app/e2e/depot-testables.spec.ts` › `[S-0005-11]`
- **Étant donné** un espace isolé dont le clone porte un commit local, et le dépôt nu un autre commit poussé ailleurs
- **Quand** je clique « Synchroniser » dans Administration
- **Alors** l'alerte de la région « Dépôt Git de l'espace » dit « Le dépôt local a divergé du dépôt distant »
- **Et** le clone garde son commit de tête, sans modification en cours ; le fichier distant n'y est pas, le fichier local est intact
- Limite : le code `sync_conflict` n'est pas lu par l'e2e ; le test Vitest `app/src/screens/Administration.test.tsx` › `[S-0005-11]` simule la réponse 409, et `core/tests/repo/test_catalog_api.py::test_sync_conflict` la vérifie. Ce scénario a révélé un défaut : l'écran n'affichait que la conduite à tenir, sans la cause.

**Plan 0006**

### S-0006-10 — Pas de gouvernance sans référent ; un domaine sans référent est averti
Plan 0006, critère 10 · Test : `app/e2e/administration.spec.ts` › `[S-0006-10]` (deux tests)
- **Étant donné** l'administration de Groupe Nordis par julien.h, seul référent, puis un espace isolé
- **Quand** j'ajoute le domaine Data ; puis, dans l'espace isolé, j'ouvre « Modifier Julien H. »
- **Alors** Marketing, puis Data, affichent « Aucun référent »
- **Et** « Retirer de l'espace » est désactivé pour le dernier référent
- Limite : l'écran empêche de produire une gouvernance sans référent ; le refus par le serveur est vérifié par `core/tests/repo/test_governance.py::test_a_governance_without_referent_is_refused` et `core/tests/repo/test_proposals.py::test_governance_without_referent_is_refused`. L'alerte est aussi rendue en Vitest : `app/src/screens/Administration.test.tsx` › `[S-0006-10]`.

### S-0006-11 — CODEOWNERS suit la gouvernance ; une modification à la main est signalée
Plan 0006, critère 11 · Test : `app/e2e/administration.spec.ts` › `[S-0006-11]` ; `app/e2e/depot-testables.spec.ts` › `[S-0006-11]`
- **Étant donné** un espace isolé sans CODEOWNERS ; puis un autre où un commit poussé écrit `.github/CODEOWNERS` à la main (`* @intrus`)
- **Quand** j'enregistre le renommage d'un domaine, puis l'ajout d'un domaine sans référent ; dans le second espace, je clique « Synchroniser »
- **Alors** le premier enregistrement change exactement `.github/CODEOWNERS` et `governance.yaml` dans la même proposition ; le second ne change que `governance.yaml`, CODEOWNERS étant régénéré à l'identique
- **Et** la synchronisation affiche « CODEOWNERS a été modifié à la main » dans la région « Dépôt Git de l'espace »
- Limite : l'ordre des lignes générées est vérifié par `core/tests/repo/test_governance.py::test_codeowners_is_deterministic_and_ordered`, la détection par `::test_codeowners_drift`.

**Plan 0017**

### S-0017-01 — Une contributrice n'accède ni à l'écran ni à l'API
Plan 0017, critère 1 · Test : `app/e2e/administration.spec.ts` › `[S-0017-01]`
- **Étant donné** anna.k, contributrice de Groupe Nordis
- **Quand** j'ouvre le catalogue, appelle `GET /admin`, puis saisis directement l'adresse `#/w/groupe-nordis/administration`
- **Alors** le lien « Administration » est absent, l'API répond 403, et l'adresse revient au catalogue sans bouton d'enregistrement

### S-0017-02 — Un domaine sans référent affiche l'alerte
Plan 0017, critère 2 · Test : `app/e2e/administration.spec.ts` › `[S-0017-02]`
- **Étant donné** « Administration — Groupe Nordis », où un seul domaine (Marketing) affiche « Aucun référent · N KPI »
- **Quand** je clique « Domaine », saisis le libellé Data (identifiant `data`) et clique « Ajouter le domaine »
- **Alors** deux domaines affichent « Aucun référent »

### S-0017-03 — Un nombre de validateurs à 0 est refusé
Plan 0017, critère 3 · Test : `app/e2e/administration.spec.ts` › `[S-0017-03]`
- **Étant donné** le champ « Canonique (min 1) »
- **Quand** j'y saisis 0, puis 3
- **Alors** à 0, « Au moins 1. » s'affiche et « Enregistrer et fusionner » est désactivé ; à 3, l'enregistrement redevient possible

### S-0017-04 — L'enregistrement ne touche que la gouvernance et CODEOWNERS
Plan 0017, critère 4 · Test : `app/e2e/administration.spec.ts` › `[S-0017-04]`
- **Étant donné** un espace isolé administré par julien.h, et le commit de tête du dépôt distant
- **Quand** j'enregistre le renommage d'un domaine, puis l'ajout d'un nouveau domaine
- **Alors** chaque enregistrement crée une proposition fusionnée (réponse 201) ; le premier change exactement `.github/CODEOWNERS` et `governance.yaml` (le dépôt de démonstration n'a pas encore de CODEOWNERS : il est créé)
- **Et** le second, un domaine sans référent, ne change que `governance.yaml` : CODEOWNERS est régénéré à l'identique

### S-0017-05 — Renommer un domaine ne change que son libellé
Plan 0017, critère 5 · Test : `app/e2e/administration.spec.ts` › `[S-0017-05]`
- **Étant donné** le domaine Supply chain de l'espace isolé
- **Quand** je clique « Modifier le domaine Supply chain », remplace le libellé par Approvisionnement, applique et enregistre
- **Alors** « Paramètres enregistrés : proposition n° N fusionnée » s'affiche, et la gouvernance relue par l'API est identique à l'ancienne, ce libellé mis à part

### S-0017-06 — Aucun champ de token à l'écran
Plan 0017, critère 6 · Test : `app/e2e/administration.spec.ts` › `[S-0017-06]`
- **Étant donné** l'écran d'administration de julien.h
- **Quand** il s'affiche
- **Alors** il ne contient aucun champ `password`
- Limite : l'absence de texte de token n'est pas cherchée dans la page ; le test Vitest `app/src/screens/Administration.test.tsx` › `[S-0017-06]` la vérifie.

### S-0017-07 — « Synchroniser » met à jour la date et réindexe
Plan 0017, critère 7 · Test : `app/e2e/administration.spec.ts` › `[S-0017-07]`
- **Étant donné** la région « Dépôt Git de l'espace »
- **Quand** je clique « Synchroniser »
- **Alors** le statut dit « Synchronisé · index reconstruit. » ou « Déjà à jour avec le dépôt distant. », et la région affiche « à l'instant · index à jour »

### S-0017-08 — Référent seul : bandeau et fusion directe ; deux référents : revue
Plan 0017, critère 8 · Test : `app/e2e/administration.spec.ts` › `[S-0017-08]` (deux tests)
- **Étant donné** julien.h seul référent : « Vous êtes le seul référent de l'espace » et le bouton « Enregistrer et fusionner »
- **Quand** j'enregistre le domaine Data ; puis nomme Claire M. référente de tout l'espace, enregistre, coche la plateforme BigQuery et enregistre de nouveau
- **Alors** le premier enregistrement affiche « Paramètres enregistrés : proposition n° N fusionnée sans revue. », Data est relu sur la branche principale ; le deuxième fusionne aussi sans revue
- **Et** ensuite le bandeau disparaît, « Require review from Code Owners » s'affiche, le bouton devient « Enregistrer et créer la proposition », et le troisième enregistrement ouvre une proposition « Gouvernance de l'espace » qui attend la revue d'un autre référent

**Plan 0020**

### S-0020-01 — Une fusion faite hors d'Atlas est taguée au sync
Plan 0020, critère 1 · Test : `app/e2e/administration.spec.ts` › `[S-0020-01]`
- **Étant donné** un espace isolé avec Revenu net v4, et une branche qui passe Revenu net en v5, fusionnée par git (`--no-ff`) et poussée hors d'Atlas
- **Quand** je clique « Synchroniser » dans Administration
- **Alors** le tag distant `doc/revenu-net/v5` désigne le commit de fusion
- **Et** la fiche affiche « v5 · validée … », et l'onglet « Versions 5 » montre « v5 · courante »

### S-0020-02 — Une version déjà taguée ne produit ni tag ni avertissement
Plan 0020, critère 2 · Test : `app/e2e/administration.spec.ts` › `[S-0020-02]`
- **Étant donné** le même espace, v5 déjà taguée
- **Quand** je clique de nouveau « Synchroniser »
- **Alors** « Déjà à jour avec le dépôt distant. » s'affiche, et la liste des tags du dépôt distant est inchangée
- Limite : le commit sans changement de version est vérifié par `core/tests/repo/test_workspace_repo.py::test_sync_leaves_versions_tagged_by_atlas_alone`.

### S-0020-03 — Une poussée de tag refusée garde le tag local et le signale
Plan 0020, critère 3 · Test : `app/e2e/depot-testables.spec.ts` › `[S-0020-03]`
- **Étant donné** un espace isolé où Revenu net passe en v5 par une fusion git (`--no-ff`) poussée hors d'Atlas ; le dépôt nu refuse les tags (crochet `pre-receive`)
- **Quand** je clique « Synchroniser » dans Administration
- **Alors** la région « Dépôt Git de l'espace » affiche « Les tags n'ont pas pu être poussés »
- **Et** le clone porte `doc/revenu-net/v5` sur le commit de fusion, et le dépôt nu n'a pas ce tag
- Limite : plusieurs avertissements à la fois sont rendus en Vitest : `app/src/screens/Administration.test.tsx` › `[S-0020-03]`.

### S-0020-04 — L'écran affiche l'avertissement du sync
Plan 0020, critère 4 · Test : `app/e2e/administration.spec.ts` › `[S-0020-04]`
- **Étant donné** la v5 fusionnée hors d'Atlas
- **Quand** je clique « Synchroniser »
- **Alors** le statut de la région « Dépôt Git de l'espace » contient « taguée au sync »
- Limite : plusieurs avertissements à la fois sont vérifiés par le test Vitest `app/src/screens/Administration.test.tsx` › `[S-0020-03]`.

**Plan 0023**

### S-0023-01 — Un membre retiré disparaît de `governance.yaml`
Plan 0023, critère 1 · Test : `app/e2e/administration.spec.ts` › `[S-0023-01]`
- **Étant donné** la gouvernance d'un espace isolé
- **Quand** je clique « Modifier Claire M. », puis « Retirer de l'espace », enregistre et recharge
- **Alors** « Modifier Claire M. » a disparu ; ni la gouvernance relue par l'API, ni `governance.yaml` sur la branche principale distante ne contiennent `claire.m`

### S-0023-02 — Le dernier référent ne peut pas être retiré
Plan 0023, critère 2 · Test : `app/e2e/administration.spec.ts` › `[S-0023-02]`
- **Étant donné** julien.h, seul référent de l'espace isolé
- **Quand** je clique « Modifier Julien H. »
- **Alors** « Retirer de l'espace » est désactivé

### S-0023-03 — Un domaine vide se retire, un domaine qui porte des documents non
Plan 0023, critère 3 · Test : `app/e2e/administration.spec.ts` › `[S-0023-03]`
- **Étant donné** Finance, qui porte des documents ; Marketing, vide ; Anna K. avec un rôle limité à Marketing (ajouté en S-0023-04)
- **Quand** j'ouvre « Modifier le domaine Finance », envoie à l'API une gouvernance sans Finance, puis retire Marketing et enregistre
- **Alors** « Retirer le domaine » est désactivé pour Finance, et l'API refuse la gouvernance sans Finance
- **Et** Marketing disparaît, et les rôles d'Anna redeviennent exactement ceux du départ : le rôle limité à Marketing part, aucun autre n'est élargi

### S-0023-04 — Un membre garde plusieurs rôles
Plan 0023, critère 4 · Test : `app/e2e/administration.spec.ts` › `[S-0023-04]`
- **Étant donné** Anna K., contributrice de l'espace isolé
- **Quand** je clique « + Ajouter un rôle », choisis validateur limité à Marketing, applique, enregistre et recharge
- **Alors** « Rôle 1 » vaut contributeur et « Rôle 2 » validateur

## Hors ligne

**Plan 0019**

### S-0019-04 — Hors ligne, ouvrir l'espace, le catalogue et compiler
Plan 0019, critère 4 · Test : `app/e2e/hors-ligne.spec.ts` › `[S-0019-04]`
- **Étant donné** Groupe Nordis déjà rejoint, et toute requête du navigateur hors `localhost` et `127.0.0.1` interrompue
- **Quand** je pars de l'accueil, ouvre Groupe Nordis, Revenu net, « Proposer une modification », puis l'onglet « SQL compilé »
- **Alors** le catalogue et la fiche s'ouvrent, et le SQL Databricks puis le SQL Snowflake contiennent `SELECT`
- Limite : seul le navigateur est coupé du réseau ; le serveur Python ne l'est pas. Le binaire figé hors ligne est vérifié par `core/tests/test_sidecar.py::test_frozen_binary_works_offline`.

## Parcours WebKit

`app/e2e/parcours.webkit.spec.ts` tourne sous WebKit, le moteur de la vue Tauri sous macOS, après Chromium et sur les mêmes serveurs, sans supposer leur état. Chaque test vérifie aussi qu'axe-core ne relève aucune violation sérieuse ou critique.

**Plan 0026**

### S-0026-01 — Créer, ouvrir, basculer entre deux espaces
Plan 0026, critère 1 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-0026-01]`
- **Étant donné** l'accueil « Vos espaces de travail »
- **Quand** je crée un espace « WebKit <horodatage> », puis passe par le sélecteur à Groupe Nordis, puis de nouveau au nouvel espace
- **Alors** chaque étape ouvre le catalogue attendu : `/w/<nouvel espace>/catalogue`, `#/w/groupe-nordis/catalogue`, puis de nouveau le nouvel espace

### S-0026-02 — Recherche avec et sans accents, fiche ouverte au clavier
Plan 0026, critère 2 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-0026-02]`
- **Étant donné** le catalogue de Groupe Nordis
- **Quand** je recherche « reference », puis « référence », vide la recherche, place le focus sur Revenu net, appuie sur flèche bas puis Entrée
- **Alors** les deux recherches ne listent que « Date de référence »
- **Et** flèche bas donne le focus à Taux de service et ouvre son aperçu ; Entrée ouvre `fiche/taux-de-service`

### S-0026-03 — Lire le graphe, parcourir les onglets, afficher le diff
Plan 0026, critère 3 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-0026-03]`
- **Étant donné** la fiche Revenu net
- **Quand** je place le focus sur « Définition », appuie deux fois sur ⌥Tab, puis Entrée, choisis De 3 et À 4 et clique « Afficher les écarts »
- **Alors** le graphe compte sept cartes et aucun champ ; le focus passe à Déclinaisons puis Versions
- **Et** trois écarts s'affichent, et n06 est « ajouté » dans le graphe de la version 4
- WebKit sous macOS ne parcourt les liens avec Tab que si le réglage est actif : le test utilise ⌥Tab, comme Safari.

### S-0026-04 — Sélectionner, déplacer, supprimer puis annuler au clavier
Plan 0026, critère 4 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-0026-04]`
- **Étant donné** un brouillon indépendant de Revenu net (sept nœuds), toutes les cartes dessinées
- **Quand** je clique la deuxième carte, la fais glisser de 48 px vers le bas, clique « Supprimer » dans Propriétés, puis Cmd/Ctrl+Z
- **Alors** Propriétés affiche son identifiant et la carte descend ; la suppression laisse six cartes, et Cmd/Ctrl+Z rend la septième, visible

### S-0026-05 — Sur 200 nœuds, moins de 200 cartes, sélection et déplacement
Plan 0026, critère 5 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-0026-05]`
- **Étant donné** un brouillon de 200 nœuds construit par `longKpi`
- **Quand** je l'ouvre, clique la deuxième carte dessinée et la fais glisser de 48 px vers le bas
- **Alors** plus d'une carte et moins de 200 sont dessinées, Propriétés affiche l'identifiant sélectionné, et la carte descend
- **Et** les durées d'ouverture, de sélection et de déplacement sont écrites dans la console

### S-0026-06 — Une proposition et son diff, sans requête d'écriture
Plan 0026, critère 6 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-0026-06]`
- **Étant donné** la file des propositions, où « Revenu net · nordis-fr » reste ouverte après Chromium ; toute requête vers l'API autre que GET ou OPTIONS est relevée
- **Quand** je sélectionne cette proposition
- **Alors** la région « Proposition sélectionnée », au moins un écart du diff et le graphe canonique s'affichent
- **Et** aucune requête d'écriture n'est partie

### S-0026-07 — Lancer une comparaison et ouvrir le détail FR
Plan 0026, critère 7 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-0026-07]`
- **Étant donné** l'écran Comparaison, KPI Revenu net
- **Quand** je lance la comparaison, puis clique « Revenu net × nordis-fr : 100 % de validation… »
- **Alors** le lancement répond 202, l'adresse porte `id=<n>&variant=…`, et le détail « Revenu net · nordis-fr » montre au moins une ligne

### S-0026-08 — Popup OAuth vers le faux Databricks et retour local
Plan 0026, critère 8 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-0026-08]`
- **Étant donné** le panneau « Nouveau point d'accès », identifiant `webkit-dbx-<horodatage>`, hôte du faux Databricks, warehouse `abc123`, schéma `gold.finance`
- **Quand** je clique « S'authentifier avec OAuth »
- **Alors** la requête `…/oidc/v1/authorize?` est une navigation de la fenêtre ouverte, qui affiche « Connexion réussie » sur `http://localhost:8020/`
- **Et** le panneau affiche « Connecté : le token est rangé dans votre coffre, sous webkit-dbx-… »

### S-0026-09 — Aucune violation axe sérieuse sur les écrans parcourus
Plan 0026, critère 9 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-0026-09]`
- **Étant donné** les écrans des huit parcours WebKit
- **Quand** chacun est affiché (et, pour l'accueil, le dialogue de création ouvert)
- **Alors** axe-core ne relève aucune violation sérieuse ou critique
- L'identifiant est porté par le test de l'accueil ; les sept autres tests du fichier font le même contrôle.

**Vérifications du Reste à faire**

Ces parcours automatisent la partie web des vérifications « Sous Tauri ». Ils ne lancent pas la fenêtre native : le plugin shell qui ouvre le navigateur système, le sidecar empaqueté et le trousseau restent hors de leur preuve (voir S-RAF-01 et S-RAF-09 dans la section finale).

### S-RAF-02 — Création, ouverture et bascule entre deux espaces
Reste à faire, vérification 2 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-RAF-02]`
- **Étant donné** l'accueil sous WebKit
- **Quand** je crée un espace, passe à Groupe Nordis puis reviens par le sélecteur
- **Alors** chaque bascule ouvre le catalogue de l'espace choisi (détail en S-0026-01)
- Limite : vue web sous WebKit, pas la fenêtre Tauri.

### S-RAF-03 — Recherche avec accents et clavier du catalogue
Reste à faire, vérification 3 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-RAF-03]`
- **Étant donné** le catalogue sous WebKit
- **Quand** je recherche « reference » et « référence », puis navigue au clavier
- **Alors** « Date de référence » sort dans les deux cas, et Entrée ouvre la fiche Taux de service (détail en S-0026-02)
- Limite : vue web sous WebKit, pas la fenêtre Tauri.

### S-RAF-04 — Fiche
Reste à faire, vérification 4 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-RAF-04]`
- **Étant donné** la fiche Revenu net sous WebKit
- **Quand** je parcours ses onglets à ⌥Tab et affiche le diff de v3 à v4
- **Alors** le graphe en lecture compte sept cartes, et le diff trois écarts (détail en S-0026-03)
- Limite : vue web sous WebKit, pas la fenêtre Tauri.

### S-RAF-05 — Éditeur, et un graphe d'une centaine de nœuds sous WebKit
Reste à faire, vérification 5 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-RAF-05]` (deux tests : 7 et 200 nœuds)
- **Étant donné** un brouillon de Revenu net, puis un brouillon synthétique de 200 nœuds
- **Quand** j'ouvre chacun, sélectionne et déplace une carte, et, sur le premier, supprime puis annule au clavier
- **Alors** les deux parcours aboutissent (détails en S-0026-04 et S-0026-05)
- Limite : le graphe de 200 nœuds est une chaîne synthétique, pas un graphe métier réel ; vue web sous WebKit, pas la fenêtre Tauri.

### S-RAF-06 — Propositions
Reste à faire, vérification 6 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-RAF-06]`
- **Étant donné** la file des propositions sous WebKit
- **Quand** j'ouvre « Revenu net · nordis-fr »
- **Alors** la proposition et son diff s'affichent sans requête d'écriture (détail en S-0026-06)
- Limite : vue web sous WebKit, pas la fenêtre Tauri.

### S-RAF-07 — Comparaison et ouverture du navigateur
Reste à faire, vérification 7 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-RAF-07]`
- **Étant donné** l'écran Comparaison sous WebKit
- **Quand** je lance une comparaison et ouvre le détail nordis-fr
- **Alors** le lancement répond 202 et le détail s'affiche (détail en S-0026-07)
- Limite : l'ouverture du navigateur système par le plugin shell de Tauri n'est pas exercée ; S-0026-08 couvre une popup du navigateur.

### S-RAF-08 — Retour OAuth
Reste à faire, vérification 8 · Test : `app/e2e/parcours.webkit.spec.ts` › `[S-RAF-08]`
- **Étant donné** le panneau « Nouveau point d'accès » sous WebKit
- **Quand** je m'authentifie par OAuth auprès du faux Databricks
- **Alors** la fenêtre revient sur `localhost:8020` et le panneau affiche « Connecté » (détail en S-0026-08)
- Limite : popup du navigateur, pas le navigateur système ouvert depuis Tauri.

## Sans test front, et pourquoi

Rien, à l'écran, ne montre ces vérifications : elles portent sur un compte réel, la fenêtre native Tauri, la CI de release, une revue produit, ou une logique serveur que l'interface n'expose pas. Le test cité les couvre côté core ou CI ; il ne prouve pas un fonctionnement sur compte réel ni dans la fenêtre native.

| Identifiant | Vérification | Pourquoi sans test front | Couverture |
|---|---|---|---|
| S-0001-11 | Le JSON Schema commité correspond au modèle et rend le même verdict que pydantic | Logique serveur sans écran : fichier publié, qu'aucun écran ne lit | `core/tests/model/test_jsonschema.py` |
| S-0001-12 | `atlas validate` rend 0 ou 1 ; sortie `--format json` conforme | CLI, absente de l'application | `core/tests/model/test_cli.py::test_each_invalid_document_exits_one`, `::test_json_output_lists_errors_in_the_documented_format` |
| S-0001-13 | `import skifer_atlas.model` ne charge ni `pyspark` ni `fastapi` | Graphe d'import Python, sans effet à l'écran | `core/tests/model/test_imports.py::test_model_does_not_import_spark_or_the_server` |
| S-0002-08 | Même empreinte à l'ordre de trois filtres près ; autre empreinte si un filtre traverse une jointure | Logique serveur sans écran : l'empreinte n'est pas affichée (le diff sans écart est S-0003-01) | `core/tests/model/test_fingerprint.py::test_permuting_three_consecutive_filters_keeps_the_fingerprint`, `::test_moving_a_filter_across_a_join_changes_the_fingerprint` |
| S-0002-09 | Renommer identifiants ou libellés ne change pas l'empreinte | Logique serveur sans écran : empreinte non affichée | `core/tests/model/test_fingerprint.py::test_renaming_ids_and_labels_and_reordering_nodes_keeps_the_fingerprint` |
| S-0002-10 | Empreinte identique entre deux exécutions et deux `PYTHONHASHSEED` | Déterminisme entre processus, invisible dans une session | `core/tests/model/test_fingerprint.py::test_fingerprint_is_stable_across_processes_and_hash_seeds` |
| S-0003-09 | Sortie JSON du diff identique à l'octet, conforme à `diff-report.v1` | Rapport JSON de la CLI ; l'écran rend la liste, pas le JSON | `core/tests/model/test_diff.py::test_json_output_is_stable` ; `core/tests/model/test_cli.py::test_diff_reports_match_the_published_schema` |
| S-0003-10 | Codes de sortie 0, 2, 3 et 1 de `atlas diff` | CLI, absente de l'application | `core/tests/model/test_cli.py::test_diff_exit_codes` |
| S-0004-02 | `WHERE pays <> 'FR'` donne un filtre `nulls: drop` et l'info `nulls_inferred` | Logique serveur sans écran : l'onglet Implémentations n'affiche ni les nœuds extraits ni les infos, seulement les résidus et le diff | `core/tests/extract/test_translate.py::test_not_equals_drops_nulls_with_an_info` |
| S-0004-03 | `QUALIFY ROW_NUMBER() … = 1` devient un `deduplicate` avec `keep.order_by` | Même raison : nœuds extraits non affichés | `core/tests/extract/test_translate.py::test_qualify_row_number_is_a_deduplicate` |
| S-0004-04 | `SUM(a)/SUM(b)` et `AVG(a/b)` : décompositions attendues, diff `critical` | Structure des brouillons non affichée ; la fiche ne compare une extraction qu'au canonique, jamais deux extractions | `core/tests/extract/test_translate.py::test_ratio_of_sums_is_aggregate_then_metric_op`, `::test_average_of_ratio_is_compute_then_aggregate` ; `core/tests/extract/test_extract.py::test_ratio_of_sums_against_average_of_ratios_is_critical` |
| S-0004-05 | Le même KPI en Databricks et Snowflake donne la même empreinte après les `TODO` | Empreinte non affichée | `core/tests/extract/test_extract.py::test_same_kpi_in_both_dialects_has_the_same_fingerprint_once_sources_agree` |
| S-0004-07 | Extraction déterministe, même YAML à l'octet | Le YAML extrait n'est pas affiché | `core/tests/extract/test_extract.py::test_extraction_is_deterministic` |
| S-0004-08 | `examples/extraction/` produit les écarts annoncés | Démonstration en ligne de commande | `core/tests/extract/test_extract.py::test_demo_shows_the_announced_differences` |
| S-0005-06 | Supprimer `atlas.duckdb` et relancer redonne le même index | Logique serveur sans écran : aucune commande de l'app ne supprime l'index | `core/tests/repo/test_index.py::test_rebuild_from_scratch_is_identical` |
| S-0005-07 | `versions` et `versions/{n}` restituent le contenu exact de chaque tag | Contenu à l'octet ; la fiche montre la liste et les graphes de deux versions (S-0012-03), pas le fichier | `core/tests/repo/test_workspace_repo.py::test_versions_restore_each_tag` ; `core/tests/repo/test_catalog_api.py::test_document_versions_and_dependencies` |
| S-0005-09 | Espace inconnu ou chemin avec `..` : 404 | Logique serveur sans écran : l'app renvoie à l'accueil un espace absent de la liste, sans appeler la route | `core/tests/repo/test_catalog_api.py::test_unknown_workspace_or_dot_dot_is_404` |
| S-0005-10 | Sans token, le serveur refuse de démarrer ; sans en-tête ou avec un mauvais token, 401 | Démarrage et en-tête posés par Tauri ; les serveurs e2e tournent en mode développement sans token | `core/tests/test_api.py::test_server_refuses_to_start_without_token`, `::test_missing_or_wrong_token_is_refused` ; `core/tests/test_sidecar.py::test_frozen_binary_refuses_to_start_without_token` |
| S-0006-06 | Une proposition invalide n'est jamais poussée | Logique serveur sans écran : l'éditeur bloque la soumission avant (S-0013-04), la route n'est pas atteinte | `core/tests/repo/test_proposals.py::test_an_invalid_proposal_is_never_pushed` |
| S-0006-08 | Le cycle de revue passe sur un vrai dépôt GitHub | Compte réel : compte et dépôt GitHub de test, hors CI | `core/tests/repo/test_githost.py::test_github_cycle` (faux hôte), `::test_real_github_reads` (marqué `github`) |
| S-0006-09 | Le token de l'hébergeur n'est ni dans l'URL distante, ni dans `.git/config`, ni dans les journaux | Fichiers et journaux du poste, hors du DOM | `core/tests/repo/test_githost.py::test_the_token_stays_out_of_urls_config_and_errors` ; `core/tests/repo/test_workspace_repo.py::test_remote_urls_never_carry_credentials` |
| S-0006-13 | Une règle de protection GitHub donne `branch_protected`, sans contournement | Compte réel : règle de protection d'un dépôt GitHub | `core/tests/repo/test_githost.py::test_merge_errors` |
| S-0007-03 | `nulls: keep` contre `nulls: drop` : nombres de lignes attendus | Exécution moteur ; l'éditeur compile sans exécuter | `core/tests/compile/test_compile.py::test_nulls_keep_and_drop_on_not_equals` |
| S-0007-04 | Ratio de sommes contre moyenne de ratios : résultats attendus | Exécution moteur | `core/tests/compile/test_compile.py::test_ratio_of_sums_differs_from_average_of_ratios` |
| S-0007-05 | Commandes du 30 septembre à 23 h UTC dans le bon mois fiscal (`Europe/Paris`) | Exécution moteur | `core/tests/compile/test_compile.py::test_fiscal_month_follows_the_paris_day` |
| S-0007-08 | SQL Databricks et Snowflake analysables par SQLGlot | L'affichage du SQL ne prouve pas son analyse | `core/tests/compile/test_compile.py::test_generated_sql_parses_in_its_dialect` |
| S-0007-09 | Graphe extrait puis recompilé : même résultat DuckDB que le SQL source | Exécution du corpus d'exemples | `core/tests/compile/test_oracle.py::test_recompiled_draft_matches_the_source_sql` |
| S-0008-01 | Après l'OAuth, l'entrée est au trousseau sous `<ws>/<ap>` et nulle part ailleurs | Trousseau système, disque et journaux ; l'e2e utilise un coffre en mémoire | `core/tests/connections/test_connections.py::test_oauth_stores_tokens_in_the_vault_only` |
| S-0008-06 | Au-delà de `max_rows`, refus sans rapatriement | Logique serveur (transport) ; aucun écran ne fixe la limite | `core/tests/connections/test_connections.py::test_too_many_rows_are_refused_without_fetching` ; `core/tests/compare/test_compare.py::test_too_many_rows_fail_the_variant_only` |
| S-0008-08 | Aucune route ne renvoie de secret | Toutes les routes ; le DOM et le stockage sont vérifiés par S-0016-05 | `core/tests/connections/test_connections.py::test_no_route_returns_a_secret` |
| S-0008-09 | Le binaire figé démarre et répond ; sa taille est notée | Binaire PyInstaller ; l'e2e tourne depuis les sources | `core/tests/test_sidecar.py::test_frozen_binary_smoke` |
| S-0009-07 | Aucune table `staging_*` ne reste ; SQL relisibles dans `comparison_runs` | Tables DuckDB que l'écran n'expose pas | `core/tests/compare/test_compare.py::test_sql_is_kept_and_nothing_extracted_remains` |
| S-0009-08 | La base d'un espace ne contient aucune donnée d'un autre | Fichiers séparés ; l'historique affiché (S-0015-07) ne le prouve pas | `core/tests/repo/test_comparisons_api.py::test_spaces_never_share_results` |
| S-0009-09 | Lignes rapatriées par plateforme ≤ cellules du scope | Compteur du connecteur, non affiché | `core/tests/compare/test_compare.py::test_sql_is_kept_and_nothing_extracted_remains` |
| S-0009-10 | Annuler laisse `cancelled` et aucune table temporaire | Les tables temporaires ne s'affichent pas ; l'état annulé est S-0015-05 (Vitest) | `core/tests/compare/test_compare.py::test_cancel_leaves_cancelled_and_nothing_extracted` ; `core/tests/repo/test_comparisons_api.py::test_cancel_through_the_api` |
| S-0010-08 | Aucune couleur ou taille en dur hors `tokens.css` | Contrôle statique des sources : un rendu ne prouve pas l'absence de littéraux | `app/src/tokens.test.ts` |
| S-0018-01 | SSO réel sur un compte de test, `test` puis requête agrégée | Compte réel Snowflake ; le faux SSO est exercé par S-0018-02 | `core/tests/connections/test_snowflake.py::test_real_account` (marqué `snowflake`) |
| S-0018-03 | Revenu net, FR sur Databricks et DE sur Snowflake, s'exécute et se réconcilie | Compte réel sur les deux plateformes ; le faux Databricks ne calcule pas le SQL métier | `core/tests/repo/test_snowflake_compare.py::test_comparison_across_databricks_and_snowflake` (instable dans la suite complète, voir le Reste à faire) |
| S-0018-04 | Le contrôle de cardinalité échoue sur Snowflake avec une table dupliquée | Exécution sur Snowflake | `core/tests/repo/test_snowflake_compare.py::test_cardinality_check_fails_on_snowflake` |
| S-0018-05 | Le binaire figé s'authentifie et exécute ; taille sous 200 Mo | CI de release, binaire PyInstaller | `core/tests/test_sidecar.py::test_frozen_binary_authenticates_and_runs` |
| S-0018-06 | Aucun cache de jeton Snowflake sur le poste | Disque du poste, hors du DOM | `core/tests/connections/test_snowflake.py::test_connection_params_never_cache_tokens`, `::test_sso_stores_the_session_in_the_vault_and_no_token_cache` |
| S-0019-01 | Trois installateurs signés ; notarisation macOS | CI de release, certificats réels | `.github/workflows/release.yml` |
| S-0019-02 | Test de fumée du binaire sur chaque plateforme, `_selftest` compris | CI de release | `core/tests/test_sidecar.py::test_frozen_binary_smoke` ; `core/tests/test_release.py::test_selftest_route_is_protected_and_checks_dynamic_imports` ; `.github/workflows/release.yml` |
| S-0019-03 | L'app release démarre en moins de 10 s et ne laisse aucun serveur après fermeture | Fenêtre native Tauri, mesure sur machine de référence | `core/tests/test_sidecar.py::test_frozen_binary_stops_when_the_app_disappears` ; `core/tests/test_release.py::test_server_stops_when_its_parent_disappears` (le temps de démarrage reste une mesure manuelle) |
| S-0019-05 | Taille rapportée, sous le seuil | Artefacts de release | `.github/workflows/release.yml` |
| S-0019-06 | Versions de l'app, du sidecar et de `skifer_atlas.__version__` identiques | Sources de release | `core/tests/test_release.py::test_one_version_for_app_sidecar_and_package` |
| S-0021-01 | Division par zéro : `NULL` en DuckDB ; division entière et modulo par zéro aussi | Exécution DuckDB, absente du panneau SQL | `core/tests/compile/test_ecarts.py::test_division_by_zero_is_null_on_duckdb`, `::test_integer_division_and_modulo_keep_their_type` |
| S-0021-07 | Les tests existants restent verts ; les SQL de référence changent délibérément | CI et revue de code | `core/tests/compile/test_compile.py` ; `core/tests/compile/test_ecarts.py` (suite complète en CI) |
| S-RAF-01 | Installation sur un poste vierge de chaque OS, puis accueil → catalogue → fiche | Fenêtre native Tauri, installateurs signés, postes vierges ; WebKit ne teste que les vues | `.github/workflows/release.yml` ; `core/tests/test_sidecar.py` ; `core/tests/test_release.py` |
| S-RAF-09 | Keyring et connecteurs figés sous Windows | Poste Windows réel ; l'e2e utilise un coffre en mémoire | `core/tests/test_sidecar.py` ; `core/tests/connections/test_connections.py` ; `core/tests/connections/test_snowflake.py` |
| S-RAF-10 | Extraction d'un vrai script de production anonymisé | Revue produit : le script est à fournir et valider par son propriétaire | `core/tests/extract/test_extract.py` (corpus synthétique) |
| S-RAF-11 | Relecture d'un diff from scratch | Revue produit : jugement métier sur l'appariement ; les badges sont automatisés par S-0003-07 | `core/tests/model/test_diff.py::test_es_from_scratch_is_paired_by_score` ; `app/e2e/diff.spec.ts` › `[S-0003-07]` |

## Sans test front, testable

Il n'en reste aucune : les 31 vérifications qui figuraient ici ont reçu leur test front avec le lot des vérifications testables (plan 0027, mise en œuvre). Une vérification nouvelle s'y inscrit, au format de la section précédente, tant que son test manque.

## Exception à la règle « jamais de champ de token » : S-0008-05

Le guide de style (10.6) demande qu'on se connecte par le flux natif de la plateforme, sans jamais manipuler de secret. Le repli Databricks par token personnel en est une exception assumée (analyse, Q10 ; plan 0008 ; ADR 0020), confirmée le 1er novembre 2026 :
- il ne s'offre qu'après un échec de l'OAuth, et seulement sur une ligne Databricks déclarée ;
- le champ est masqué (`type="password"`, `autocomplete="off"`) et vidé avant même l'envoi ;
- le token va au trousseau de l'OS, par utilisateur et par espace, jamais dans le dépôt Git ; aucune route ne le renvoie.

Le scénario S-0008-05 (`app/e2e/connexions-testables.spec.ts` › `[S-0008-05]`) vérifie ces trois points, avec un coffre en mémoire ; le trousseau relève du test core.
