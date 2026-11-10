# Scénarios de test front

**Règle : chaque vérification a un scénario et un test front.** Une vérification est un critère d'acceptation d'un plan (`docs/plans/00*.md`) ou une vérification à la main du « Reste à faire » de `docs/plans/README.md`. Le test front rend l'écran : parcours Playwright (`app/e2e/*.spec.ts`) ou, à défaut, test de composant Vitest (`app/src/**/*.test.tsx`). Un test core seul ne compte pas. Une vérification sans test front figure dans l'une des deux sections finales, avec la raison et le test qui la couvre malgré tout :

- « Sans test front, et pourquoi » : rien ne l'affiche à l'écran (compte réel, fenêtre native Tauri, CI de release, revue produit, logique serveur sans écran) ;
- « Sans test front, testable » : un écran la montre, mais aucun test ne la vérifie. Ce sont des tests à écrire ; il n'en reste aucun.

## Lancer les tests

- Parcours : `cd app && npm run e2e`. Playwright démarre lui-même les serveurs Python, les faux Databricks, Snowflake et GitHub, et Vite, sur des ports fixes (1420, 8790 à 8799, 8020 pour le retour OAuth). Chromium passe tous les scénarios, puis WebKit les `*.webkit.spec.ts`. Un seul worker, et une seule exécution à la fois sur le poste : deux exécutions se disputeraient les ports. Si un port est pris, la configuration s'arrête avant tout lancement et nomme le port et son processus (`app/e2e/ports.ts`).
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
| 0005 | 13 | 10 | 0 | 3 | 0 |
| 0006 | 13 | 9 | 0 | 4 | 0 |
| 0007 | 9 | 4 | 0 | 5 | 0 |
| 0008 | 10 | 6 | 0 | 4 | 0 |
| 0009 | 13 | 7 | 0 | 6 | 0 |
| 0010 | 13 | 12 | 0 | 1 | 0 |
| 0011 | 7 | 7 | 0 | 0 | 0 |
| 0012 | 8 | 8 | 0 | 0 | 0 |
| 0013 | 34 | 33 | 1 | 0 | 0 |
| 0014 | 10 | 10 | 0 | 0 | 0 |
| 0015 | 13 | 13 | 0 | 0 | 0 |
| 0016 | 12 | 12 | 0 | 0 | 0 |
| 0017 | 13 | 13 | 0 | 0 | 0 |
| 0018 | 7 | 1 | 0 | 6 | 0 |
| 0019 | 9 | 1 | 0 | 8 | 0 |
| 0020 | 4 | 4 | 0 | 0 | 0 |
| 0021 | 7 | 5 | 0 | 2 | 0 |
| 0022 | 6 | 6 | 0 | 0 | 0 |
| 0023 | 5 | 5 | 0 | 0 | 0 |
| 0024 | 5 | 2 | 3 | 0 | 0 |
| 0025 | 7 | 7 | 0 | 0 | 0 |
| 0026 | 9 | 9 | 0 | 0 | 0 |
| 0028 | 3 | 2 | 0 | 1 | 0 |
| 0029 | 4 | 2 | 0 | 2 | 0 |
| 0030 | 4 | 3 | 0 | 1 | 0 |
| 0031 | 4 | 2 | 0 | 2 | 0 |
| 0032 | 2 | 2 | 0 | 0 | 0 |
| 0033 | 12 | 9 | 2 | 1 | 0 |
| 0034 | 10 | 9 | 0 | 1 | 0 |
| 0035 | 12 | 10 | 0 | 2 | 0 |
| RAF | 11 | 7 | 0 | 4 | 0 |
| **Total** | **332** | **259** | **6** | **67** | **0** |

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

### S-0010-11 — Une adresse mal encodée ouvre l'accueil
Plan 0010, suivi de la revue globale (#151) · Test : `app/e2e/accueil.spec.ts` › `[S-0010-11]`
- **Étant donné** le registre vide du serveur de l'accueil
- **Quand** j'ouvre `#/w/%E0%A4%A/catalogue`, une séquence `%` invalide
- **Alors** l'accueil s'affiche (« Vos espaces de travail », « Aucun espace pour l'instant »), sans écran blanc ni erreur de page
- Limite : l'analyse de plusieurs adresses invalides (espace, fiche, `%` isolé) est rendue sans navigateur par `app/src/format.test.ts` › `[S-0010-11]`.

### S-0010-12 — Sous Tauri, l'échec de `get_server_info` ne laisse pas de repli sans token
Plan 0010, suivi de la revue globale (#151) · Tests : `app/e2e/serveur-tauri.spec.ts` › `[S-0010-12]` ; Vitest : `app/src/api.test.ts` › `[S-0010-12]` (six tests)
- **Étant donné** un pont Tauri simulé dans la page (`window.__TAURI_INTERNALS__`) dont la commande `get_server_info` échoue, l'horloge de la page avançant à la main (`page.clock`), et le vrai serveur derrière
- **Quand** j'ouvre l'accueil, puis laisse le démarrage épuiser ses essais
- **Alors** le bandeau « Serveur local injoignable » s'affiche, `invoke` a été réessayé (au moins trois appels) et aucune requête n'est partie vers le serveur
- **Quand** l'application devient prête et que je clique « Réessayer »
- **Alors** rien n'avait été retenu : `invoke` est interrogé de nouveau, le bandeau disparaît, l'accueil liste Groupe Nordis, toutes les requêtes portent `Authorization: Bearer` avec le token fourni, et axe-core ne relève aucune violation sérieuse, sur l'écran de démarrage avec son bandeau comme après la reprise
- Limite : le pont est une simulation ; le vrai `invoke` n'existe que dans la fenêtre Tauri. Vitest couvre en plus le repli sans token hors Tauri, un token vide rendu par l'application et le message « Relancez Skifer Atlas ».

### S-0010-13 — Le compte de propositions à relire se voit sur la carte et dans la navigation
Plan 0010, critère 1 (compteurs de revue) · Test : `app/e2e/accueil-revue.spec.ts` › `[S-0010-13]` (deux tests : claire.m, anna.k)
- **Étant donné** la copie isolée de la démonstration sur trois serveurs : claire.m, validatrice Finance, a plusieurs propositions à relire (l'API `for_me` en donne le nombre) ; anna.k, contributrice et autrice de la surcharge DE, n'en a aucune
- **Quand** claire.m ouvre l'accueil, puis l'espace, puis approuve la surcharge DE dans Propositions
- **Alors** la carte de l'espace affiche « N propositions en attente » (`count-warn`) et l'entrée « Propositions » de la navigation « N en attente de votre revue » ; après l'approbation, les deux comptes baissent d'une unité, la carte relue au retour à l'accueil
- **Et** pour anna.k la carte affiche « Aucune proposition » sans `count-warn`, et la navigation n'a aucun compteur

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
- **Étant donné** la réponse de `GET /api/workspaces/groupe-nordis` (l'espace que lit la coque depuis la PR #122, plus la liste des espaces) réécrite par interception pour donner le rôle Lecteur
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

**Plan 0028**

Ces deux tests (`app/e2e/base-occupee.spec.ts`) travaillent sur une copie isolée de Nordis, jointe au serveur de julien.h (8793). Un processus Python lancé à côté ouvre la base `atlas.duckdb` de la copie, comme le ferait la CLI, et la garde quelques secondes ; il est tué en fin de test, même en échec.

### S-0028-01 — La base tenue quelques secondes : le catalogue attend, puis se charge
Plan 0028, critère 1 · Test : `app/e2e/base-occupee.spec.ts` › `[S-0028-01]`
- **Étant donné** l'index de la copie déjà construit, et un autre processus qui tient sa base pendant 3 s
- **Quand** j'ouvre le catalogue de la copie
- **Alors** tant que le processus tient la base, « Revenu net » n'est pas affiché : l'écran attend
- **Et** une fois la base libérée, « Revenu net » s'affiche, le tableau n'est plus occupé (`aria-busy="false"`), et « Base de l'espace occupée » n'apparaît nulle part

### S-0028-02 — La base tenue plus de 10 s : le catalogue l'explique, puis se recharge
Plan 0028, critère 2 · Test : `app/e2e/base-occupee.spec.ts` › `[S-0028-02]`
- **Étant donné** un autre processus qui tient la base de la copie pendant 15 s
- **Quand** j'ouvre le catalogue
- **Alors** au bout de 10 s, une alerte « Base de l'espace occupée » s'affiche avec « Réessayez quand il aura fini », alors que le processus tient encore la base ; le catalogue n'est pas affiché
- **Et** après la fin du processus, un rechargement affiche « Revenu net », sans l'alerte
- Limite : le catalogue n'a pas de bouton « Réessayer » ; le test recharge la page. L'attente côte à côte des requêtes et la liste des espaces sans attente sont vérifiées par `core/tests/repo/test_catalog_api.py::test_requests_waiting_for_a_busy_base_wait_side_by_side`, `::test_a_busy_base_does_not_delay_the_workspace_list`.

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

### S-0005-09 — Un espace absent du registre renvoie à l'accueil
Plan 0005, critère 9 · Test : `app/e2e/ouverture.spec.ts` › `[S-0005-09]`
- **Étant donné** un registre local qui ne contient pas l'espace « espace-inconnu »
- **Quand** j'ouvre `#/w/espace-inconnu/catalogue`
- **Alors** l'accueil « Vos espaces de travail » s'affiche, avec le message « L'espace « espace-inconnu » n'est pas dans votre registre local. », sans violation d'accessibilité sérieuse
- **Et** le message disparaît dès que j'ouvre un espace du registre
- Limite : le refus 404 du serveur (espace absent, chemin avec `..`) est vérifié par `core/tests/repo/test_catalog_api.py::test_unknown_workspace_or_dot_dot_is_404`.

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
- **Alors** l'adresse porte `tab=versions&base=3&other=4` ; trois écarts, tous « Divergence critique » à bordure rouge (`--atlas-bad`), n04 en premier avec `date_facture → date_comptable` (changer la colonne d'entrée d'un nœud temporel est critique depuis la PR #126, plan 0003 ; c'était « À examiner » avant) ; le résumé dit « 3 écarts : 3 critiques, 0 à surveiller, 0 sans effet. »
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

### S-0012-08 — Une fiche inexistante dit « Fiche introuvable »
Plan 0012, état d'erreur de la spécification · Test : `app/e2e/ouverture.spec.ts` › `[S-0012-08]` ; `app/src/screens/Fiche.test.tsx` (composant)
- **Étant donné** l'espace de démonstration, sans document « document-inexistant »
- **Quand** j'ouvre `#/w/groupe-nordis/fiche/document-inexistant`
- **Alors** le titre « Fiche introuvable » s'affiche avec une alerte qui ne montre ni trace, ni JSON brut, ni `undefined`, et le lien « Catalogue » est présent
- **Et** aucune erreur de page n'est levée, et axe-core ne relève aucune violation sérieuse

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

**Plan 0032**

### S-0032-01 — Créer une surcharge depuis la fiche du KPI
Plan 0032, critère 1 · Test : `app/e2e/editor.spec.ts` › `[S-0032-01]`
- **Étant donné** un espace isolé où l'entité `nordis-it` n'a pas de déclinaison de Revenu net
- **Quand** j'ouvre l'onglet Déclinaisons, choisis cette entité, le mode Surcharge du canonique et sa justification, puis crée le brouillon
- **Alors** l'éditeur ouvre `revenu-net--nordis-it` en v1, lié au canonique v4 et dont les surcharges sont vides
- Limite : les refus d'entité inconnue, de doublon dans le dépôt et de brouillon local sont vérifiés par `core/tests/repo/test_editor_api.py`.

### S-0032-02 — Commencer un graphe indépendant
Plan 0032, critère 2 · Test : `app/e2e/editor.spec.ts` › `[S-0032-02]`
- **Étant donné** le même espace, avec l'entité libre `nordis-pt`
- **Quand** je choisis Graphe indépendant, crée le brouillon et ajoute une source depuis la palette
- **Alors** le premier nœud est `n01`, devient la sortie et le brouillon local l'enregistre

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

### S-0013-12 — Après une modification, la soumission attend la validation de ce document
Plan 0013, critère 12 · Test : `app/e2e/editor.spec.ts` › `[S-0013-12]` ; Vitest : `app/src/screens/Editor.test.tsx` › `[S-0013-12]`
- **Étant donné** un brouillon indépendant de Revenu net, « Compilable Databricks, Snowflake »
- **Quand** les réponses de `editor/check` sont retenues par le test (`page.route`), que je saisis une description dans Propriétés et clique « Soumettre la proposition » aussitôt, puis que je relâche les réponses
- **Alors** l'alerte « Validation lancée : réessayer dans un instant. » (ou « Validation en cours : … » si la temporisation de 300 ms est déjà écoulée) s'affiche, sans le mot « échoué », la fenêtre de soumission ne s'ouvre pas, puis le statut redevient « Compilable Databricks, Snowflake »
- **Quand** je saisis une autre description, attends que la validation de ce document soit en vol, puis clique « Soumettre la proposition »
- **Alors** le bouton est `aria-disabled`, l'alerte « Validation en cours : réessayer dans un instant. » s'affiche et la fenêtre de soumission ne s'ouvre pas
- **Quand** la validation répond, que j'ouvre la fenêtre, saisis la justification et clique « Soumettre »
- **Alors** la requête `POST /proposals` porte un `document_yaml` qui contient la description saisie, et « Proposition n° N créée » s'affiche
- **Et** la liste des propositions de l'API contient le document
- Limite : le test e2e accepte « lancée » ou « en cours » pour ne pas dépendre de la vitesse du poste ; la phrase exacte « Validation lancée : réessayer dans un instant. » est vérifiée par Vitest : `app/src/screens/Editor.test.tsx` › `[S-0013-12]`.

### S-0013-13 — Une validation indisponible s'affiche, bloque la soumission et se relance au clic
Plan 0013, critère 13 · Test : `app/e2e/editor.spec.ts` › `[S-0013-13]` ; Vitest : `app/src/screens/Editor.test.tsx` › `[S-0013-13]` (deux tests)
- **Étant donné** un brouillon indépendant de Revenu net, « Compilable Databricks, Snowflake », dont `editor/check` répond 503 (`page.route`)
- **Quand** je saisis une description dans Propriétés
- **Alors** l'alerte « L'opération a échoué : Validation indisponible. » s'affiche, le bouton est `aria-disabled`, le contrôle axe ne relève rien de sérieux et le brouillon relu par l'API contient la description
- **Quand** je clique « Soumettre la proposition » sans modifier le document, la réponse de la nouvelle validation étant retenue
- **Alors** l'alerte « La validation a échoué : nouvelle tentative lancée. » s'affiche (jamais « Validation en cours »), une requête `editor/check` de plus est partie et la fenêtre de soumission ne s'ouvre pas
- **Quand** la réponse arrive en 503
- **Alors** l'alerte « L'opération a échoué : Validation indisponible. » revient
- **Quand** la validation redevient disponible et que je clique de nouveau, toujours sans modifier le document
- **Alors** le statut devient « Compilable Databricks, Snowflake », le bouton n'est plus `aria-disabled` et le clic suivant ouvre la fenêtre de soumission

### S-0013-14 — Quitter l'éditeur, masquer la page ou fermer la fenêtre ne perd rien
Plan 0013, critère 14 · Tests : `app/e2e/editor.spec.ts` › `[S-0013-14]` (deux tests) ; Vitest : `app/src/screens/Editor.test.tsx` › `[S-0013-14]` (quatre tests)
- **Étant donné** un brouillon indépendant de Revenu net, « Compilable Databricks, Snowflake »
- **Quand** je saisis une description puis clique aussitôt le lien « Catalogue », avant le délai d'enregistrement de 800 ms, puis reviens en arrière
- **Alors** le brouillon relu par l'API contient la description, et Propriétés la montre à la réouverture
- **Quand** j'ouvre « Éditer en YAML », ajoute `label: [ouvert` en tête du texte, puis clique « Catalogue » et reviens en arrière
- **Alors** le champ `yaml_text` du brouillon contient `label: [ouvert`, et la vue YAML se rouvre avec ce texte inachevé
- **Quand** (second test, Chromium) je saisis une description et que la page reçoit un vrai évènement `pagehide`, avant le délai d'enregistrement
- **Alors** une requête `PUT` du brouillon part aussitôt avec la description, et l'API la relit
- Limite : le test `pagehide` vérifie la requête, pas son option `keepalive`, qu'un test navigateur ne voit pas ; Vitest l'établit (`[S-0013-14] [S-0013-21]`). Le passage à `hidden` (`visibilitychange`) et la fermeture de la fenêtre Tauri (`onCloseRequested`, attente d'au plus deux secondes puis `destroy`) ne sont couverts que par Vitest (`[S-0013-14] [S-0013-20] [S-0013-21]`, `[S-0013-20]`) ; une vérification dans la vraie fenêtre Tauri reste à faire (ADR 0040). Le champ `yaml_text` côté serveur : `core/tests/repo/test_editor_api.py::test_draft_keeps_the_unfinished_yaml_text_and_stays_valid_without_it`.

### S-0013-15 — « Repartir de la vN » demande confirmation, au clavier
Plan 0013, critère 15 · Test : `app/e2e/editor.spec.ts` › `[S-0013-15]` ; Vitest : `app/src/screens/Editor.test.tsx` › `[S-0013-15]`
- **Étant donné** un brouillon local repris de Revenu net, au libellé « Revenu net (brouillon repris) », et la bannière « Brouillon local repris »
- **Quand** je clique « Repartir de la v4 »
- **Alors** la confirmation « Repartir de la v4 ? » s'ouvre, le focus est sur « Annuler » et le contrôle axe ne relève rien de sérieux
- **Quand** j'appuie sur Échap, puis rouvre la confirmation et clique « Annuler »
- **Alors** la confirmation se ferme chaque fois, le focus revient sur « Repartir de la v4 » et le brouillon relu par l'API reste celui du libellé modifié
- **Quand** la suppression du brouillon échoue (500, `page.route`) et que je clique « Supprimer le brouillon »
- **Alors** l'alerte « L'opération a échoué : Suppression impossible. » s'affiche, la session garde son titre, « Repartir de la v4 » reste proposé et le brouillon de l'API est intact
- **Quand** je confirme avec une suppression retenue par le test (`page.route`)
- **Alors** « Reprise en cours : l'édition est suspendue. » s'affiche, une zone est `aria-busy`, « Annuler », « Supprimer le brouillon », « Soumettre la proposition » et « Éditer en YAML » sont désactivés
- **Quand** la suppression est relâchée
- **Alors** le titre devient « Revenu net : v5 · brouillon », la bannière, la notice et `aria-busy` disparaissent et l'API ne rend plus de brouillon

### S-0013-16 — Une erreur à l'entrée ou à la sortie de la vue YAML s'affiche
Plan 0013, critère 16 · Test : `app/e2e/editor.spec.ts` › `[S-0013-16]` ; Vitest : `app/src/screens/Editor.test.tsx` › `[S-0013-16]`
- **Étant donné** un brouillon indépendant de Revenu net, « Compilable Databricks, Snowflake »
- **Quand** `editor/check` répond 503 et que je clique « Éditer en YAML »
- **Alors** l'alerte « L'opération a échoué : Validation indisponible. » s'affiche et l'éditeur reste sur le canevas, avec « Éditer en YAML » proposé
- **Quand** la validation revient, que j'ouvre la vue YAML puis que `editor/parse` est refusé en connexion (`page.route`, `abort`) et que je clique « Revenir au canevas »
- **Alors** l'alerte « Serveur local injoignable : Réessayez dans un instant. » s'affiche et la vue YAML reste ouverte
- **Quand** l'analyse répond de nouveau et que je clique « Revenir au canevas »
- **Alors** le canevas revient (« schéma 1 · 7 nœuds ») et le contrôle axe ne relève rien de sérieux

### S-0013-17 — Catalogue en échec au premier chargement : état sobre ou bandeau, puis reprise
Plan 0013, critère 17 · Test : `app/e2e/catalogue.spec.ts` › `[S-0013-17]` ; Vitest : `app/src/screens/Catalogue.test.tsx` › `[S-0013-17]` (deux tests)
- **Étant donné** l'espace Groupe Nordis, dont les requêtes du catalogue et de ses facettes sont refusées en connexion (`page.route`, `abort`) au premier chargement
- **Quand** j'ouvre le catalogue
- **Alors** « Catalogue indisponible. » s'affiche, sans bandeau dans la page ; `getByRole("alert")` ne trouve qu'une alerte (celle de la coque) et un seul bouton « Réessayer »
- **Et** le tableau n'est plus `aria-busy`, « Chargement du catalogue… » a disparu et le contrôle axe ne relève rien de sérieux
- **Quand** les requêtes aboutissent de nouveau et que je clique ce « Réessayer »
- **Alors** le tableau reprend les sept lignes du catalogue (huit avec l'en-tête), et ni alerte, ni « Catalogue indisponible. », ni squelette ne restent affichés
- **Quand** les requêtes répondent ensuite 500 (« Index illisible. ») et que je recharge la page
- **Alors** le bandeau de la page affiche l'erreur et son « Réessayer », sans le texte « Catalogue indisponible. » ni squelette, et le filtre Domaine n'a pas ses options
- **Quand** les requêtes aboutissent et que je clique le « Réessayer » du bandeau
- **Alors** le tableau reprend ses huit lignes, l'alerte disparaît et le filtre Domaine propose « Finance »

### S-0013-18 — Un brouillon YAML illisible se reprend en vue YAML et s'écarte sans le réparer
Plan 0013, critère 18 · Test : `app/e2e/editor.spec.ts` › `[S-0013-18]` ; Vitest : `app/src/screens/Editor.test.tsx` › `[S-0013-18]`
- **Étant donné** un brouillon de Revenu net enregistré avec `yaml_text` = `label: [ouvert` (YAML illisible) et sa version de base
- **Quand** j'ouvre l'éditeur
- **Alors** la vue YAML s'ouvre avec ce texte exactement, la bannière « Brouillon local repris » et « Repartir de la v4 » sont visibles
- **Quand** j'ouvre la confirmation, appuie sur Échap, puis la rouvre et clique « Annuler »
- **Alors** le focus est sur « Annuler » à l'ouverture, revient sur « Repartir de la v4 » à chaque fermeture, et le brouillon de l'API garde son `yaml_text`
- **Quand** je confirme « Supprimer le brouillon »
- **Alors** le titre devient « Revenu net : v5 · brouillon », la région Graphe s'affiche, la vue YAML et la bannière ont disparu, l'API ne rend plus de brouillon et le contrôle axe ne relève rien de sérieux (le texte illisible n'a pas été analysé ni réparé)
- Limite : le contrôle axe n'est pas fait dans la vue YAML, où CodeMirror signale `scrollable-region-focusable` (hors périmètre du correctif).

### S-0013-19 — Une sauvegarde tardive ne recrée pas un brouillon supprimé
Plan 0013, critère 19 · Tests : `app/e2e/editor.spec.ts` › `[S-0013-19]` (deux tests : soumission, puis « Repartir ») ; Vitest : `app/src/screens/Editor.test.tsx` › `[S-0013-19]` (deux tests)
- **Étant donné** un brouillon, une description modifiée et une écriture de brouillon lancée par un vrai évènement `pagehide`, dont la réponse est retenue par le test (`page.route`)
- **Quand** je soumets la proposition (« Proposition n° … créée »), ou confirme « Repartir de la v4 » (« Reprise en cours : l'édition est suspendue. »)
- **Alors** la suppression du brouillon n'est pas envoyée tant que l'écriture n'a pas fini ; seule la liste des méthodes `PUT` puis `DELETE` est vue
- **Quand** l'écriture retenue échoue (`abort`)
- **Alors** la suppression part, l'API ne rend plus de brouillon, aucun autre `PUT` ne part (ni Ctrl/Cmd+Z, ni un nouveau `pagehide`, ni après 1,2 s) ; après « Repartir », le titre redevient « Revenu net : v5 · brouillon » et la session reste modifiable : une nouvelle description est enregistrée
- Limite : le test e2e retient et fait échouer une vraie requête, mais le graphe retrouvé après Ctrl/Cmd+Z (nombre de nœuds) n'est vérifié que par Vitest, où la promesse d'écriture est maîtrisée.

### S-0013-20 — Fermer la fenêtre Tauri attend la sauvegarde, au plus deux secondes
Plan 0013, critère 20 · Test : `app/src/screens/Editor.test.tsx` › `[S-0013-20]` (Vitest, deux tests : succès, délai dépassé ; le passage à `hidden` est aussi dans `[S-0013-14] [S-0013-20] [S-0013-21]`)
- **Étant donné** l'éditeur sous Tauri (API de fenêtre simulée) et une écriture en attente ou lancée
- **Quand** la fenêtre demande à se fermer
- **Alors** la fermeture est d'abord empêchée, la sauvegarde est attendue (au plus deux secondes), puis la fenêtre est détruite une seule fois ; quitter l'écran retire l'écouteur
- Limite : Vitest seulement, sans fenêtre native. Un pont Tauri simulé dans la page ne prouverait rien de plus que l'API de fenêtre simulée de Vitest : `onCloseRequested` et `destroy` n'ont d'effet à l'écran que dans la vraie fenêtre. Le départ de page (`pagehide`) du navigateur est vu en e2e par S-0013-14. Le cycle réel de fermeture de la WebView reste une vérification dans l'application Tauri (ADR 0040).

### S-0013-21 — `keepalive` seulement sous 60 Kio
Plan 0013, critère 21 · Tests : `app/e2e/editor.spec.ts` › `[S-0013-21]` ; Vitest : `app/src/screens/Editor.test.tsx` › `[S-0013-21]` (deux tests : `pagehide` d'un petit brouillon, `visibilitychange` d'un corps de plus de 60 Kio en UTF-8) et sa frontière à 61 439 et 61 440 octets (même fichier, `[S-0013-21]`)
- **Étant donné** l'éditeur ouvert, l'appel `fetch` de la page enveloppé par le test (le navigateur n'expose pas `keepalive` à Playwright) pour relever l'option et la taille en octets de chaque `PUT` du brouillon
- **Quand** la page reçoit `pagehide` avec une petite modification, puis, dans la vue YAML, avec un texte de 31 000 « é » (moins de 60 000 caractères, plus de 60 Kio en UTF-8)
- **Alors** le premier `PUT` (moins de 60 Kio) part avec `keepalive`, ceux de plus de 60 Kio sans
- Limite : `visibilitychange` et la frontière exacte des 60 Kio ne sont vérifiés qu'en Vitest ; l'e2e relève l'appel à `fetch`, pas le comportement du navigateur à la fermeture.

### S-0013-22 — Saisir du YAML ne désactive pas « Revenir au canevas »
Plan 0013, critère 22 · Tests : `app/e2e/editor.spec.ts` › `[S-0013-22]` ; Vitest : `app/src/screens/Editor.test.tsx` › `[S-0013-22]` (deux tests)
- **Étant donné** la vue « Éditer en YAML » d'un brouillon valide, dont les analyses (`/editor/parse`) sont retenues par le test
- **Quand** je saisis du YAML pendant la validation
- **Alors** « Revenir au canevas » n'est pas `aria-disabled` et se clique sans `force`
- **Quand** je saisis un autre texte pendant que l'analyse du retour est en cours, puis qu'elle aboutit
- **Alors** la vue YAML reste, avec le dernier texte et l'avis « Le YAML a changé pendant l'analyse » ; axe-core ne relève aucune violation sérieuse
- **Quand** le remplacement du canevas est refusé (Vitest)
- **Alors** la vue YAML, le texte saisi et l'avis « Remplacement refusé. » restent affichés
- Limite : le refus du remplacement (`OpError`) ne se fabrique pas depuis l'écran avec un YAML que le serveur accepte : Vitest seulement. Les parcours e2e qui attendent l'état stable du bouton `aria-disabled` (analyse en échec, cause affichée) cliquent avec `force` : `[S-0013-06]` et `[S-0001-10]`.

### S-0013-23 — Une suppression de brouillon refusée après la soumission s'annonce sans bloquer
Plan 0013, critère 23 · Test : `app/e2e/creation.spec.ts` › `[S-0013-23]`
- **Étant donné** le brouillon v5 de Revenu net dont la description est modifiée, « Compilable Databricks, Snowflake », « Enregistré … (local) », et la suppression du brouillon refusée par le serveur (500, `page.route`)
- **Quand** je soumets la proposition avec la justification « Description de Revenu net précisée. »
- **Alors** « Proposition n° N créée » s'affiche, avec l'avis « La proposition est créée, mais le brouillon local n'a pas pu être supprimé. »
- **Et** le lien « Voir les propositions » mène à `#/w/<espace>/propositions`, « Retour à la fiche » à `#/w/<espace>/fiche/revenu-net`, et le contrôle axe ne relève rien de sérieux
- **Et** aucune requête `PUT` de brouillon ne part dans la seconde et demie qui suit, et « Voir les propositions » ouvre la file

### S-0013-24 — Le formulaire « Nouveau concept ou KPI » refuse lisiblement, déduit l'identifiant et s'annule sans rien créer
Plan 0013, critère 24 · Test : `app/e2e/creation.spec.ts` › `[S-0013-24]`
- **Étant donné** le catalogue de Groupe Nordis, compte anna.k (contributrice), et le formulaire ouvert par « Nouveau concept ou KPI » : le type KPI est coché et le propriétaire vaut `anna.k`
- **Quand** je clique « Créer et ouvrir l'éditeur » sans rien saisir
- **Alors** « Donner un libellé. » et « De 2 à 64 caractères : minuscules, chiffres et tirets, en commençant par une lettre ou un chiffre, sans double tiret. » s'affichent, et Libellé et Identifiant sont `aria-invalid`
- **Quand** je choisis « Choisir… » dans Domaine, remplace le propriétaire par des espaces et valide
- **Alors** « Choisir un domaine. » et « Indiquer le propriétaire. » s'affichent, et le contrôle axe ne relève rien de sérieux
- **Quand** je saisis le libellé « Taux de conversion été »
- **Alors** l'identifiant vaut `taux-de-conversion-ete`
- **Quand** je saisis l'identifiant `Taux_Conversion` et valide, puis `revenu-net` (déjà pris) et valide
- **Alors** le format est refusé sur le champ, puis « « revenu-net » existe déjà dans l'espace » s'affiche sur Identifiant, `aria-invalid`
- **Quand** je saisis l'identifiant `a` (un seul caractère), puis un identifiant de 65 caractères, et valide chaque fois
- **Alors** Identifiant est `aria-invalid` avec le même message de format, et le formulaire reste ouvert
- **Quand** je saisis l'identifiant `ab--cd` (deux tirets de suite, réservés aux déclinaisons) et valide
- **Alors** Identifiant est `aria-invalid` avec le même message de format, et le formulaire reste ouvert
- **Quand** je clique le lien « Catalogue » du formulaire
- **Alors** l'adresse redevient `#/w/<espace>/catalogue` et l'API ne connaît aucun brouillon `taux-de-conversion-ete`, `taux_conversion`, `a`, `ab--cd` ni l'identifiant de 65 caractères
- **Quand** je recommence en choisissant le type Concept, le libellé « Taux de conversion été », le domaine Finance
- **Alors** l'éditeur affiche « Taux de conversion été : v1 · brouillon » et le brouillon relu par l'API est un concept `taux-de-conversion-ete` v1, propriétaire `anna.k`, domaine `finance`

### S-0013-25 — La sémantique d'un KPI se déclare (calendrier civil puis fiscal, fuseau, devise, synonymes) et se retrouve sur la fiche après la fusion par le référent seul
Plan 0013, critère 25 · Test : `app/e2e/creation.spec.ts` › `[S-0013-25]`
- **Étant donné** un espace isolé que le compte julien.h (référent de l'espace) a rejoint : il est le seul compte habilité sur le domaine Marketing
- **Quand** je crée le KPI « Visites par mois » (`visites-par-mois`, domaine Marketing, propriétaire par défaut `julien.h`), saisis une description, les synonymes « trafic mensuel » et « monthly visits », la devise EUR, le calendrier `civil` et le fuseau Europe/Paris, puis construis une source (`jour_visite` de type date), une opération temporelle `period` au grain mois et une agrégation `count` par `mois` et `canal`
- **Alors** le brouillon relu par l'API porte `calendar: {key: civil}`, le fuseau et la devise, et le statut est « Compilable Databricks, Snowflake » sans erreur
- **Quand** je désélectionne le nœud et choisis le calendrier `fiscal-nordis@2026.1`
- **Alors** le brouillon porte `{key: fiscal-nordis, version: "2026.1"}` et le statut reste « Compilable Databricks, Snowflake »
- **Quand** je saisis le fuseau `Mars/Phobos`, puis la devise `euro`
- **Alors** « Schéma invalide » s'affiche et une erreur apparaît ; une fois le fuseau Europe/Paris et la devise EUR rétablis, « Schéma valide » et « Compilable Databricks, Snowflake » reviennent
- **Et** le YAML relu par `/editor/check` contient `synonyms: [trafic mensuel, monthly visits]`, `calendar: {key: fiscal-nordis, version: '2026.1'}`, `timezone: Europe/Paris` et `currency: EUR`, et le contrôle axe ne relève rien de sérieux
- **Quand** je soumets avec la justification « Visites par mois, sur le calendrier fiscal. », ouvre la proposition dans la file et clique « Fusionner »
- **Alors** « Fusionnée sans revue : aucun autre compte habilité » s'affiche avant la fusion, « Proposition n° N fusionnée » après, et `kpis/visites-par-mois.yaml` du dépôt contient `domain: marketing`
- **Et** le catalogue liste le KPI au domaine Marketing, et sa fiche montre « Synonymes : trafic mensuel, monthly visits », le calendrier « fiscal-nordis 2026.1 », le fuseau d'évaluation Europe/Paris et la devise EUR

### S-0013-26 — Les nœuds Source, Filtre, Dédoublonnage, Calcul de colonne et Agrégation produisent un YAML et un SQL compilables
Plan 0013, critère 26 · Test : `app/e2e/creation.spec.ts` › `[S-0013-26]`
- **Étant donné** un nouveau KPI civil, fuseau Europe/Paris, de l'espace de démonstration
- **Quand** j'ajoute depuis la palette, chacun relié au précédent : n01 Source (six colonnes dont `date_facture` de type date), n02 Filtre `statut:equals:validée` nulls exclus, n03 Filtre en Expression SQL `montant_ttc > 0` nulls gardés, n04 Dédoublonnage (clé `facture_id`, ligne gardée la première selon `date_facture` décroissant), n05 Calcul de colonne `montant_ht = montant_ttc - montant_taxes` (decimal) et n06 Agrégation (`sum` de `montant_ht` en `revenu_ht`, `count` de `*` en `nb_factures`, par `entite`)
- **Alors** la barre d'état affiche « schéma 1 · 6 nœuds · 5 arêtes », aucune erreur, « Compilable Databricks, Snowflake », et le contrôle axe ne relève rien de sérieux
- **Et** le brouillon relu par l'API porte les six nœuds avec leurs entrées, conditions, clés, mesures et la sortie n06, et son YAML contient chaque `type:` et `condition: statut:equals:validée`
- **Et** « YAML du nœud » de n04 montre `order_by`, et « SQL compilé » montre `montant_ht` pour Databricks puis pour Snowflake

### S-0013-27 — Les quatre opérations temporelles s'enchaînent jusqu'à une agrégation compilable
Plan 0013, critère 27 · Test : `app/e2e/creation.spec.ts` › `[S-0013-27]`
- **Étant donné** un nouveau KPI civil, fuseau Europe/Paris, et une source de colonnes `jour` (texte), `horodatage` (timestamp, UTC) et `montant`
- **Quand** j'ajoute n02 `to_date` (`jour` → `date_jour`, fuseau Europe/Paris, format `yyyy-MM-dd`), n03 `convert_timezone` (`horodatage` → `horodatage_paris`, vers Europe/Paris), n04 `period` (`date_jour` → `mois`, grain mois), n05 `window` (`sum` de `montant` en `montant_glissant`, cadre `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`, ordre `horodatage_paris` croissant) et n06 Agrégation (`max` de `montant_glissant` en `total_glissant`, par `mois`)
- **Alors** « schéma 1 · 6 nœuds · 5 arêtes », aucune erreur, « Compilable Databricks, Snowflake », et aucune violation axe sérieuse
- **Et** le brouillon relu par l'API porte les quatre opérations avec leurs champs propres, et son YAML contient `operation: to_date`, `convert_timezone`, `period` et `window`
- **Quand** je sélectionne n05, lis l'aide du champ « Fenêtre » (« Ex. ROWS BETWEEN 2 PRECEDING AND CURRENT ROW ») et saisis un cadre illisible, `3 rows preceding`
- **Alors** une erreur nomme n05 et aucune alerte « Serveur local injoignable » n'apparaît
- **Quand** je rétablis le cadre `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`
- **Alors** il n'y a plus d'erreur et le statut redevient « Compilable Databricks, Snowflake »

### S-0013-28 — Une jointure se câble par ses entrées gauche et droite, ses clés et sa cardinalité ; contourner le contrôle exige une raison
Plan 0013, critère 28 · Test : `app/e2e/creation.spec.ts` › `[S-0013-28]`
- **Étant donné** un nouveau KPI civil avec deux sources : n01 (`vente_id`, `client_id`, `montant`) et n02 (`client_id`, `segment`)
- **Quand** je sélectionne n01, ajoute une Jointure n03, ouvre l'onglet Entrées, choisis n02 comme entrée droite, puis dans Propriétés le type `inner`, la paire de clés `client_id` = `client_id`, la cardinalité N:1 et le contrôle « requis », puis ajoute n04 Agrégation (`sum` de `montant` en `ca`, par `segment`)
- **Alors** l'entrée gauche proposée est n01 (reliée par l'ajout), « schéma 1 · 4 nœuds · 3 arêtes », aucune erreur, « Compilable Databricks, Snowflake »
- **Et** le brouillon porte `inputs: {left: n01, right: n02}`, `how: inner`, `keys: [[client_id, client_id]]`, `cardinality: N:1`, `check: required`, la sortie est n04, et « YAML du nœud » de n03 montre `inputs: {left: n01, right: n02}` et `cardinality: N:1`
- **Quand** je sélectionne n03 et coche « contourné »
- **Alors** une erreur apparaît (la raison manque) ; après la saisie de la raison « Les clients sont dédoublonnés en amont, par la plateforme. », il n'y a plus d'erreur, un message INFO « Contrôle de cardinalité contourné » apparaît et le statut reste « Compilable Databricks, Snowflake »

### S-0013-29 — Une union ordonne ses entrées, fait correspondre ses colonnes et passe en mode sans doublons
Plan 0013, critère 29 · Test : `app/e2e/creation.spec.ts` › `[S-0013-29]`
- **Étant donné** un nouveau KPI civil avec deux sources : n01 (`commande_id`, `canal`, `montant`) et n02 (`id`, `canal_web`, `montant_web`)
- **Quand** je sélectionne n01, ajoute une Union n03, ajoute l'entrée n02 dans l'onglet Entrées, choisis le mode « toutes les lignes (all) », trois colonnes produites (`commande_id` ← `commande_id`/`id`, `canal` ← `canal`/`canal_web`, `montant` ← `montant`/`montant_web`), puis une Agrégation n04 (`sum` de `montant` en `ca`, par `canal`)
- **Alors** « schéma 1 · 4 nœuds · 3 arêtes », aucune erreur, « Compilable Databricks, Snowflake », et le brouillon porte `inputs: [n01, n02]`, `mode: all` et la correspondance des trois colonnes, la sortie étant n04
- **Quand** je choisis le mode « sans doublons (distinct) » et clique « Descendre l'entrée n01 »
- **Alors** le brouillon porte `mode: distinct` et `inputs: [n02, n01]`, le statut reste « Compilable Databricks, Snowflake » et le YAML contient `mode: distinct` et `inputs: [n02, n01]`

### S-0013-30 — La référence à un KPI et l'opération entre métriques compilent ; une version introuvable est signalée puis corrigée
Plan 0013, critère 30 · Test : `app/e2e/creation.spec.ts` › `[S-0013-30]`
- **Étant donné** un nouveau KPI civil de l'espace de démonstration, où Revenu net existe en v4
- **Quand** j'ajoute n01 Référence à un KPI (`revenu-net`, version 4) puis n02 Opération entre métriques (métrique `revenu_net_milliers = revenu_net / 1000`, « agréger puis calculer »)
- **Alors** « schéma 1 · 2 nœuds · 1 arête », aucune erreur, « Compilable Databricks, Snowflake », et le brouillon porte `kpi: revenu-net`, `version: 4`, `order: aggregate_first`, la sortie étant n02
- **Quand** je saisis la version 99 sur n01
- **Alors** une erreur « introuvable » nomme `revenu-net` et n01, et « Aller au nœud n01 » sélectionne n01 sur le canevas
- **Quand** je rétablis la version 4
- **Alors** il n'y a plus d'erreur et le statut redevient « Compilable Databricks, Snowflake »

### S-0013-31 — Un concept se crée et se fusionne, puis un KPI s'y rattache et la fiche le liste
Plan 0013, critère 31 · Test : `app/e2e/creation.spec.ts` › `[S-0013-31]`
- **Étant donné** un espace isolé que julien.h a rejoint (seul habilité sur Marketing)
- **Quand** je crée le concept « Visiteur » (`visiteur`, domaine Marketing), saisis une description, déclare l'entité, deux attributs (`visiteur_id`, `canal`, texte) et la clé `visiteur_id`
- **Alors** il n'y a aucune erreur, « Schéma valide » s'affiche, le brouillon porte `entity.key: [visiteur_id]` et ses deux attributs, le contrôle axe ne relève rien de sérieux
- **Et** un concept valide sans graphe n'est pas annoncé « Non compilable »
- **Quand** je soumets et fusionne la proposition (« Fusionnée sans revue : aucun autre compte habilité »)
- **Alors** le catalogue liste « Visiteur » au domaine Marketing, et sa fiche montre l'attribut `visiteur_id`
- **Quand** je crée le KPI « Sessions par canal » (`sessions-par-canal`, Marketing, civil), une source dont « Concept rattaché » vaut `visiteur-inconnu` et une agrégation `count` par `canal`
- **Alors** une erreur nomme `visiteur-inconnu` et n01, et « Soumettre la proposition » affiche « Soumission bloquée : N erreur(s) à corriger »
- **Quand** je remplace le concept rattaché par `visiteur`, puis soumets et fusionne
- **Alors** le brouillon porte `concept: visiteur` sur n01, « YAML du nœud » de n01 contient `concept: visiteur`, aucune erreur, « Compilable Databricks, Snowflake »
- **Et** la fiche du KPI liste « Visiteur » dans ses Références, et celle du concept liste « Sessions par canal » dans « Référencé par »

### S-0013-32 — Une erreur de construction se lit, mène au nœud, bloque la soumission et se corrige
Plan 0013, critère 32 · Test : `app/e2e/creation.spec.ts` › `[S-0013-32]`
- **Étant donné** un nouveau KPI civil avec une source dont `passee_le` est un timestamp, un nœud `period` (grain jour) lisant `passee_le` directement, et une agrégation `sum` par `jour`
- **Alors** une erreur « fuseau explicite » nomme n02, le statut affiche « Non compilable »
- **Quand** je clique « Soumettre la proposition » puis « Aller au nœud n02 » depuis le problème
- **Alors** l'alerte « Soumission bloquée : N erreur(s) à corriger » s'affiche, Propriétés montre l'Opération temporelle et n02 est sélectionné ; le contrôle axe ne relève rien de sérieux
- **Quand** j'ajoute depuis n01 un nœud n04 `convert_timezone` (`passee_le` → `passee_locale`, vers Europe/Paris), relie n04 à l'entrée de n02 par l'onglet Entrées et choisis `passee_locale` comme colonne source de n02
- **Alors** il n'y a plus d'erreur, le statut est « Compilable Databricks, Snowflake », le brouillon porte `inputs: [n04]` sur n02 et la sortie n03, et « Soumettre la proposition » ouvre la fenêtre de soumission

### S-0013-33 — On quitte un brouillon de création et on le retrouve ; le même identifiant ne se recrée pas
Plan 0013, critère 33 · Test : `app/e2e/creation.spec.ts` › `[S-0013-33]`
- **Étant donné** un nouveau KPI « Stock moyen » (`stock-moyen`) avec calendrier civil, devise EUR et une source n01 de deux colonnes, « Enregistré … (local) »
- **Alors** aucune bannière « Brouillon local repris » n'est affichée : le brouillon vient d'être créé, il n'est pas repris (assertion `soft` : en développement, StrictMode relance l'effet d'ouverture et la bannière s'affiche à tort, défaut signalé)
- **Quand** je clique le lien « Catalogue » de l'éditeur
- **Alors** le catalogue s'affiche sans ligne « Stock moyen » (le brouillon n'est pas un document de l'espace)
- **Quand** je rouvre « Nouveau concept ou KPI » avec le même libellé et le domaine Finance
- **Alors** « Un brouillon local de « stock-moyen » existe déjà : le reprendre ou l'abandonner dans « Mes brouillons » du catalogue » s'affiche sur Identifiant, `aria-invalid`, avec un lien « Reprendre le brouillon »
- **Quand** je clique « Reprendre le brouillon »
- **Alors** l'adresse devient `#/w/<espace>/editeur?from=stock-moyen`, la bannière « Brouillon local repris » (« Enregistré … sur ce poste ») s'affiche et l'éditeur affiche « Stock moyen : v1 · brouillon », n01, « schéma 1 · 1 nœud · 0 arête », la table et la seconde colonne de n01, le calendrier `civil` et la devise EUR
- **Quand** je recharge la page
- **Alors** le même brouillon revient, et le contrôle axe ne relève rien de sérieux
- **Et** de retour au catalogue, la région « Mes brouillons » liste « Stock moyen » avec un lien « Reprendre » et un bouton « Abandonner », sans violation axe sérieuse
- **Quand** je clique « Reprendre »
- **Alors** l'éditeur rouvre « Stock moyen : v1 · brouillon » avec n01
- **Quand** je reviens au catalogue, où un brouillon illisible `orphelin` (type inconnu, écrit par l'API) est aussi listé
- **Alors** `orphelin` figure dans « Mes brouillons » avec un bouton « Abandonner » et sans lien « Reprendre »
- **Quand** je clique « Abandonner » sur « Stock moyen »
- **Alors** la boîte « Abandonner le brouillon ? » (rôle `alertdialog`) s'ouvre avec « Le brouillon local « Stock moyen » sera supprimé. » et le focus sur « Annuler »
- **Quand** j'appuie sur Tab, Tab, puis Maj+Tab
- **Alors** le focus va à « Abandonner », revient à « Annuler » puis repart à « Abandonner » : il ne sort pas de la boîte
- **Quand** j'appuie sur Échap
- **Alors** la boîte se ferme, le focus revient sur le bouton « Abandonner » de « Stock moyen », le brouillon est toujours listé et l'API le connaît encore
- **Quand** je rouvre la boîte et clique « Annuler »
- **Alors** la boîte se ferme et le brouillon est toujours listé ; l'API relit ses positions (dessin du graphe) avec n01
- **Quand** je rouvre la boîte et clique « Abandonner »
- **Alors** « Stock moyen » quitte « Mes brouillons », le focus passe au bouton « Abandonner » de `orphelin`, et le brouillon répond 404
- **Quand** j'abandonne aussi `orphelin`
- **Alors** la région « Mes brouillons » disparaît et le focus revient sur le titre « Catalogue »
- **Et** l'identifiant `stock-moyen` peut être recréé par le formulaire, et son dessin de graphe est vide : l'abandon a supprimé les positions de l'ancien brouillon

### S-0013-34 — Un nouveau KPI revu par deux validateurs se fusionne, puis le catalogue et la fiche l'affichent
Plan 0013, critère 34 · Test : `app/e2e/creation.spec.ts` › `[S-0013-34]`
- **Étant donné** un nouveau KPI « Chiffre d'affaires annuel » (`chiffre-affaires-annuel`, Finance, civil) construit par anna.k : source de deux colonnes et agrégation `sum` de `montant_ttc` en `chiffre_affaires` par `entite`, « Compilable Databricks, Snowflake »
- **Quand** je soumets avec la justification « Premier chiffre d'affaires annuel de Finance. »
- **Alors** « Proposition n° N créée » s'affiche et le brouillon répond 404
- **Quand** j'ouvre la proposition dans la file (domaine « tous »)
- **Alors** elle est sélectionnée, « Validations : 0 / 2 » et le titre « Nouveau document : Chiffre d'affaires annuel » s'affichent, « Approuver (0 / 2) » est `aria-disabled` et son infobulle dit « Vous êtes l'auteur de cette proposition : un autre compte doit l'approuver. »
- **Quand** claire.m et marc.d approuvent depuis leur poste (API de leur serveur) et que je recharge
- **Alors** « Validations : 2 / 2 » et « prête à fusionner » s'affichent
- **Quand** je clique « Fusionner »
- **Alors** « Proposition n° N fusionnée » s'affiche, et le dépôt contient `kpis/chiffre-affaires-annuel.yaml` avec `domain: finance`
- **Et** le dessin du graphe (positions n01 et n02) est encore lu par l'API : la soumission supprime le brouillon, pas le dessin
- **Et** le catalogue liste le KPI au domaine Finance, sa fiche affiche « v1 · validée le … » et « Validateurs : 2 requis (canonique) », et aucun de ces écrans ne montre de violation axe sérieuse

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

**Plan 0030**

Les trois scénarios partent du même test (`app/e2e/fuseau-de-session.spec.ts`). Le brouillon est le KPI `fuseau` construit par `orders('Europe/Paris', …)` de `core/tests/compile/test_ecarts.py` : colonne `passee_le` déclarée `Europe/Paris`, plus un filtre n05 sur `passee_le:greater_than:2025-01-01 00:00:00`. Il est déposé sur `groupe-nordis`, puis supprimé en fin de test. J'ouvre l'onglet « SQL compilé ».

### S-0030-01 — En Databricks, une colonne `timestamp` est lue en heure murale de son fuseau
Plan 0030, critère 1 · Test : `app/e2e/fuseau-de-session.spec.ts` › `[S-0030-01]`
- **Quand** j'affiche le SQL Databricks
- **Alors** la source lit `passee_le` par `WHEN TYPEOF(passee_le) = 'timestamp'`, `THEN CONVERT_TIMEZONE('UTC', 'Europe/Paris', DATE_ADD(MICROSECOND, UNIX_MICROS(CAST(passee_le AS TIMESTAMP)), …))` et `ELSE CAST(passee_le AS TIMESTAMP_NTZ)`
- Limite : la relecture par SQLGlot et le fuseau `UTC` sont vérifiés par `core/tests/compile/test_ecarts.py::test_databricks_reads_a_source_timestamp_as_wall_clock_of_its_zone`.

### S-0030-02 — Aucun cast d'horodatage ne dépend de la session
Plan 0030, critère 2 · Test : `app/e2e/fuseau-de-session.spec.ts` › `[S-0030-02]`
- **Quand** j'affiche le SQL Databricks, puis Snowflake
- **Alors** le littéral du filtre s'écrit `CAST('2025-01-01 00:00:00' AS TIMESTAMP_NTZ)` en Databricks, `… AS TIMESTAMPNTZ)` en Snowflake
- **Et** aucun des deux ne contient `AS TIMESTAMP)`, hormis `UNIX_MICROS(CAST(<colonne> AS TIMESTAMP))` dans la branche instant de Databricks (cast d'un instant vers lui-même)
- Limite : la conversion vers le même fuseau et le `NULL` typé d'une union sont vérifiés par `core/tests/compile/test_ecarts.py::test_no_timestamp_cast_depends_on_the_session`, les références SQL par `test_no_reference_sql_casts_to_a_session_timestamp`.

### S-0030-04 — Le panneau SQL montre la lecture en heure murale
Plan 0030, critère 4 · Test : `app/e2e/fuseau-de-session.spec.ts` › `[S-0030-04]`
- **Étant donné** et **Quand** : ceux de S-0030-01
- **Alors** le panneau SQL de l'éditeur affiche, en Databricks, la lecture de S-0030-01, telle que l'exécuterait une comparaison

**Plan 0031**

Même test et même brouillon que pour le plan 0030 (`app/e2e/fuseau-de-session.spec.ts`) : colonne `passee_le` déclarée `Europe/Paris`, onglet « SQL compilé ».

### S-0031-01 — En Snowflake, une colonne `timestamp` est lue en heure murale de son fuseau
Plan 0031, critère 1 · Test : `app/e2e/fuseau-de-session.spec.ts` › `[S-0031-01]`
- **Quand** j'affiche le SQL Snowflake
- **Alors** la source lit `passee_le` par `WHEN TYPEOF(CAST(passee_le AS VARIANT)) IN ('TIMESTAMP_LTZ', 'TIMESTAMP_TZ')`, `THEN CAST(CONVERT_TIMEZONE('Europe/Paris', CAST(passee_le AS TIMESTAMPTZ)) AS TIMESTAMPNTZ)` et `ELSE CAST(passee_le AS TIMESTAMPNTZ)`
- Limite : la relecture par SQLGlot et le fuseau `UTC` sont vérifiés par `core/tests/compile/test_ecarts.py::test_snowflake_reads_a_source_timestamp_as_wall_clock_of_its_zone`.

### S-0031-04 — Le panneau SQL montre la lecture Snowflake en heure murale
Plan 0031, critère 4 · Test : `app/e2e/fuseau-de-session.spec.ts` › `[S-0031-04]`
- **Étant donné** et **Quand** : ceux de S-0031-01
- **Alors** le panneau SQL de l'éditeur affiche, en Snowflake, la lecture de S-0031-01, telle que l'exécuterait une comparaison

**Plan 0024**

### S-0024-01 — Déplacer un nœud ne redessine que sa carte
Plan 0024, critère 1 · Test : `app/src/editor/Canvas.test.tsx` › `[S-0024-01]` (Vitest)
- **Étant donné** le composant Canvas rendu avec une chaîne de cinquante nœuds (`LARGE_GRAPH`), toutes les cartes dessinées
- **Quand** la position de n007 passe à (600, 600)
- **Alors** seule la carte n007 est redessinée (compteur : les appels à `summary`, un par rendu de carte)
- Limite : Vitest seulement. Le compte de rendus d'une carte (les appels à `summary`) n'a aucune trace à l'écran : un parcours Playwright ne verrait que des cartes identiques, redessinées ou non. Le coût du rendu est vu en e2e à 200 nœuds par S-0024-03 et S-0024-04.

### S-0024-02 — Une modification ou une sélection ne redessine que les cartes concernées
Plan 0024, critère 2 · Test : `app/src/editor/Canvas.test.tsx` › `[S-0024-02]` (Vitest, deux tests)
- **Étant donné** le même Canvas de cinquante nœuds
- **Quand** la sélection passe de n003 à n004 ; puis, dans un autre rendu, l'expression de n010 devient `a + b`
- **Alors** seules n003 et n004 sont redessinées ; puis seule n010
- Limite : Vitest seulement, pour la même raison que S-0024-01 : redessiner une carte inchangée ne se voit pas à l'écran.

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

### S-0024-05 — Un rendu abandonné ne défait pas la stabilité des nœuds
Plan 0024, ADR 0028 (complément, issue #48) · Test : `app/src/stable.test.tsx` › `[S-0024-05]` (Vitest)
- **Étant donné** `useStable` rendu avec une liste de nœuds, seul ou sous StrictMode
- **Quand** la liste revient recopiée à l'identique, ou avec un seul nœud modifié, ou après un rendu abandonné
- **Alors** les nœuds inchangés gardent leur objet, le tableau aussi si rien n'a changé, et un rendu abandonné n'entre pas dans le cache
- Limite : Vitest seulement. `useStable` est un hook interne (cache d'objets, rendus abandonnés sous StrictMode) : il n'a pas de surface à l'écran, et l'identité des objets de nœuds ne s'observe pas depuis le navigateur ; la conséquence visible (cartes non redessinées) est S-0024-01 et S-0024-02.

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
- Limite : la proposition vient du script de démonstration (la création depuis l'éditeur est S-0013-10) ; les commentaires sont S-0014-10, et seules les requêtes du navigateur restent locales. Le cycle complet, commentaire compris, est vérifié par `core/tests/repo/test_proposals.py::test_full_cycle`.

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

### S-0014-08 — Un refus de fusion dit ce qui s'est passé et quoi faire
Plan 0014, critère 8 · Test : `app/e2e/propositions-testables.spec.ts` › `[S-0014-08]` ; `app/e2e/propositions-revue.spec.ts` › `[S-0014-08]` (deux tests : `merge_refused`, `not_open`) ; `app/src/messages.test.ts` › `[S-0014-08]` (un cas par code) ; `app/src/screens/Proposals.test.tsx` › `[S-0014-08]` (trois tests)
- **Étant donné** DE approuvée par claire.m et marc.d, ouverte chez claire.m avec « Fusionner »
- **Quand** la fusion répond `merge_conflict` avec le texte brut de GitHub (« Pull Request is not mergeable ») ; puis un commit arrive sur la branche de la proposition et claire.m clique de nouveau « Fusionner »
- **Alors** le premier refus s'affiche sous le titre « La fusion provoque un conflit » avec sa consigne (demander à l'auteur de reproposer), sans le texte de GitHub ni « L'opération a échoué » ; le second sous « La proposition ne remplit plus les conditions de fusion » (`not_ready`), avec la raison du serveur (« 0 validation(s) sur 2. ») avant la consigne
- **Et** l'écran se relit sans perdre le message : « Validations : 0 / 2 », plus de « Fusionner », « Approuver (0 / 2) », et la branche principale du dépôt n'a pas bougé
- **Et** un `pre-receive` posé dans le dépôt nu refuse le push de la fusion : « Le dépôt a refusé la fusion » s'affiche avec sa consigne (relire, puis réessayer), sans le texte émis par le dépôt, la proposition reste dans la file et la branche principale n'a pas bougé (`merge_refused`)
- **Et** une proposition fusionnée depuis un autre poste pendant que l'écran de claire.m est resté ouvert : « Fusionner » donne « La proposition n'est plus ouverte » et sa consigne (`not_open`)
- Les huit codes (`merge_conflict`, `merge_refused`, `branch_protected`, `head_changed`, `not_ready`, `not_open`, `cannot_review_own`, `comment_required`) ont chacun un titre et une consigne vérifiés par Vitest. `merge_conflict`, `merge_refused`, `not_ready` et `not_open` sont aussi provoqués à l'écran ; `head_changed` relit aussi l'écran en Vitest.
- Limite : `branch_protected` ne peut pas être produit de bout en bout (il vient d'une règle de GitHub : voir S-0006-13) ; sa traduction est vérifiée par le test de `messages.ts`.

### S-0014-09 — Changer de statut ne laisse pas la file du statut précédent
Plan 0014, critère 9 · Test : `app/e2e/propositions-testables.spec.ts` › `[S-0014-09]` ; `app/src/screens/Proposals.test.tsx` › `[S-0014-09]`
- **Étant donné** la file des propositions ouvertes affichée
- **Quand** je choisis « Fusionnées » alors que la réponse tarde ; puis « Fermées » alors que le serveur est injoignable
- **Alors** « Chargement des propositions… » remplace la liste, qui n'est pas affichée sous le filtre choisi, et le filtre reste sur le statut demandé
- **Et** la réponse tardive d'un ancien filtre n'écrase pas la file du filtre courant (Vitest)

### S-0014-10 — Un commentaire entre dans le fil ; une demande de changements part avec son texte
Plan 0014, critère 5 (envoi), critère 4 (le décompte ne bouge pas) · Test : `app/e2e/propositions-revue.spec.ts` › `[S-0014-10]`
- **Étant donné** claire.m sur la proposition DE, dont le fil porte déjà son commentaire de la démonstration, à « Validations : 0 / 2 »
- **Quand** j'envoie « Répondre » sans rien écrire ; puis un commentaire ; puis « Demander des changements » avec un texte
- **Alors** le premier envoi affiche « Écrire un commentaire avant d'envoyer. » sans aucune requête POST ; le commentaire entre dans le fil sous « Claire M. », le champ se vide
- **Et** la demande de changements ferme le formulaire et ajoute « Claire M. demande des changements » avec son texte ; « Validations : 0 / 2 » et « Approuver (0 / 2) » restent inchangés
- **Et** après rechargement le fil affiche les trois entrées, dans l'ordre

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
Plan 0009, critère 5 · Tests : `app/e2e/comparaison-bypass.spec.ts` › `[S-0009-05]` ; Vitest : `app/src/screens/Comparison.test.tsx` › `[S-0009-05]`
- **Étant donné** un espace isolé dont le KPI canonique Revenu net porte une jointure au contrôle de cardinalité contourné (n07, `check: bypass` avec sa raison), poussé puis synchronisé
- **Quand** j'ouvre l'écran Comparaison, sans lancer
- **Alors** l'alerte « Contrôle de cardinalité contourné » s'affiche avec « nordis-fr : contrôle de cardinalité contourné (n07). », l'aperçu a été demandé pour le scope déclaré et pour nordis-fr, et aucune demande de lancement n'est partie
- Limite : l'e2e tourne sur le serveur sans données locales de comparaison (celui de l'OAuth) : seul l'aperçu est exercé, pas un lancement. Vitest rend la même alerte contre un faux serveur qui signale nordis-de. `bypass_nodes` du résultat est vérifié par `core/tests/compare/test_compare.py::test_bypassed_join_is_reported`.

### S-0009-06 — Sans accès valide, la comparaison demande une connexion
Plan 0009, critère 6 · Test : `app/e2e/comparaison-auth.spec.ts` › `[S-0009-06]`
- **Étant donné** un espace isolé sur le serveur 8793, sans données locales ni accès à dbx-fr
- **Quand** je décoche nordis-es et nordis-de, puis lance la comparaison
- **Alors** « Connexion requise » s'affiche, avec le bouton « Se connecter à dbx-fr »
- Limite : l'absence d'exécution partielle est vérifiée par `core/tests/repo/test_comparisons_api.py::test_needs_auth_before_any_execution`.

### S-0009-13 — La comparaison déjà en cours est refusée, le message est traduit
Plan 0009, critère 13 · Test : `app/e2e/comparaison.spec.ts` › `[S-0009-13]`
- **Étant donné** l'écran Comparaison de Revenu net, prêt à lancer, et un serveur qui répond au lancement par un refus 409 `comparison_running`
- **Quand** je clique « Lancer la comparaison »
- **Alors** la bannière « Comparaison déjà en cours » s'affiche avec « Attendez sa fin avant de relancer cette comparaison. », sans barre de progression
- **Et** le bouton de lancement reste utilisable, une seule demande est partie, et axe-core ne relève aucune violation sérieuse
- Limite : le refus est simulé. Le refus réel d'une seconde demande identique, sans nouvelle exécution, est vérifié par `core/tests/compare/test_compare.py::test_identical_running_comparison_is_refused` et `core/tests/repo/test_comparisons_api.py::test_running_duplicate_then_distinct_tolerance_and_retry`.

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
Plan 0015, critère 3 · Tests : `app/e2e/comparaison-bypass.spec.ts` › `[S-0015-03]` ; Vitest : `app/src/screens/Comparison.test.tsx` › `[S-0015-03]`
- **Étant donné** l'espace isolé de S-0009-05 (jointure n07 au contrôle contourné)
- **Quand** l'écran se charge, puis je choisis la granularité « Mois fiscal » et passe la tolérance à 2
- **Alors** le bandeau « Contrôle de cardinalité contourné » s'affiche sans qu'aucun lancement soit parti, et reste affiché après les deux changements ; la tolérance affichée est « Tolérance : 2 % »
- **Et** le premier aperçu porte le scope déclaré `fy2026-mois-entite`, le dernier un scope ad hoc (granularité `mois_fiscal`) et la tolérance 2
- Limite : la déclinaison non comparable (nordis-es désactivée, décochée et décrite par « Non comparable : … ») n'est vérifiée que par Vitest pour ce critère ; l'e2e la voit pour ses autres causes en S-0022-02 à S-0022-05.

### S-0015-04 — Sans accès, s'authentifier puis reprendre le lancement
Plan 0015, critère 4 · Test : `app/e2e/comparaison-auth.spec.ts` › `[S-0015-04]`
- **Étant donné** un espace isolé sur le serveur 8793, nordis-fr seule cochée, « Connexion requise » affichée après un premier lancement
- **Quand** je clique « Se connecter à dbx-fr » et termine l'OAuth dans la fenêtre du faux Databricks (« Connexion réussie »)
- **Alors** un nouveau lancement est accepté (HTTP 202) sans nouveau clic sur « Lancer », et le bouton de connexion disparaît
- Limite : le faux Databricks ne calcule pas le SQL métier ; le scénario s'arrête à la reprise.

### S-0015-05 — Annuler arrête la progression
Plan 0015, critère 5 · Tests : `app/e2e/comparaison.spec.ts` › `[S-0015-05]` ; Vitest : `app/src/screens/Comparison.test.tsx` › `[S-0015-05]`
- **Étant donné** l'écran Comparaison prêt à lancer et un serveur qui accepte le lancement (exécution n° 9001), la suit à 40 % (barre « Databricks · nordis-de, nordis-fr », « En cours · 40 % ») puis, une fois l'annulation reçue, la rend « annulée »
- **Quand** je lance la comparaison, puis clique « Annuler »
- **Alors** la demande d'annulation de l'exécution 9001 part, « Comparaison n° 9001 annulée. » s'affiche, le bouton « Annuler » disparaît, le statut « Annulé » s'affiche, l'adresse porte `id=9001` et le bouton de lancement redevient utilisable ; axe-core ne relève aucune violation sérieuse
- Limite : le serveur est simulé (`page.route`) : une exécution locale dans DuckDB finit avant qu'on puisse l'annuler. L'arrêt réel et le nettoyage sont vérifiés par `core/tests/repo/test_comparisons_api.py::test_cancel_through_the_api` et `core/tests/compare/test_compare.py::test_cancel_leaves_cancelled_and_nothing_extracted`.

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

### S-0015-08 — Un double clic sur le lancement n'envoie qu'une seule demande
Plan 0015, critère 8 · Test : `app/e2e/comparaison.spec.ts` › `[S-0015-08]`
- **Étant donné** l'écran Comparaison de Revenu net, prêt à lancer, et un serveur qui retient la réponse au lancement
- **Quand** je double-clique « Lancer la comparaison », puis la réponse arrive
- **Alors** pendant l'attente le bouton est marqué occupé et inactif ; ensuite la progression « Databricks · nordis-de, nordis-fr » s'affiche et le bouton n'est plus occupé
- **Et** une seule demande de lancement est partie, et axe-core ne relève aucune violation sérieuse
- Limite : le serveur est simulé. Les tests Vitest `app/src/screens/Comparison.test.tsx` › `[S-0015-08]` couvrent le double clic et deux clics dans le même tick sans navigateur.

### S-0015-09 — Un suivi en échec ou une exécution inconnue passent en échec ; le lancement redevient possible
Plan 0015, critère 9 · Test : `app/e2e/comparaison.spec.ts` › `[S-0015-09]`
- **Étant donné** l'écran Comparaison prêt à lancer, un premier lancement dont le suivi répond toujours par une erreur 500 (« Suivi impossible »), et un second dont le suivi répond 404 (« Comparaison introuvable »)
- **Quand** je lance la comparaison, attends l'échec, puis la lance de nouveau
- **Alors** le suivi s'arrête après exactement cinq lectures de la première exécution : « Suivi impossible » s'affiche, la progression disparaît et le bouton de lancement est utilisable
- **Et** le second lancement est accepté ; au premier 404 (une seule lecture), « Comparaison introuvable » remplace la première erreur, la progression disparaît et le bouton redevient utilisable ; axe-core ne relève aucune violation sérieuse
- Limite : le serveur est simulé. Les tests Vitest `app/src/screens/Comparison.test.tsx` › `[S-0015-09]` couvrent chaque cas séparément, avec une horloge simulée pour les délais de reprise progressifs.

### S-0015-10 — L'échec de l'annulation est affiché
Plan 0015, critère 10 · Test : `app/e2e/comparaison.spec.ts` › `[S-0015-10]`
- **Étant donné** une comparaison en cours suivie à l'écran et un serveur qui refuse l'annulation (500, « Annulation impossible »)
- **Quand** je clique « Annuler »
- **Alors** « Annulation impossible » s'affiche et la demande d'annulation de cette exécution est partie
- **Et** le bouton « Annuler » et la barre « Databricks · nordis-de, nordis-fr » restent affichés, l'exécution étant toujours suivie ; axe-core ne relève aucune violation sérieuse
- Limite : le serveur est simulé ; l'annulation réussie est S-0015-05. Les tests Vitest `app/src/screens/Comparison.test.tsx` › `[S-0015-10]` couvrent aussi l'effacement de l'erreur en fin de suivi et le cas `not_running`.

### S-0015-11 — Une tolérance de 8 % règle le curseur sur 8 et la comparaison l'utilise
Plan 0015, critère 11 · Test : `app/e2e/comparaison.spec.ts` › `[S-0015-11]`
- **Étant donné** l'écran Comparaison de Revenu net, dont le KPI et l'aperçu annoncent une tolérance de 8 %
- **Quand** je lis le curseur de tolérance, le recule d'un cran au clavier, puis le ramène à sa butée haute (touche Fin), et lance la comparaison
- **Alors** le curseur indique 8 (butée haute 8, intitulé « Tolérance : 8 % »), passe à 7,9 puis revient à 8 et non à 5
- **Et** la demande de lancement porte `tolerance: 8` ; axe-core ne relève aucune violation sérieuse
- Limite : le setup et l'aperçu sont les vraies réponses du serveur, modifiées pour annoncer 8 % ; le suivi et le lancement sont simulés. Les tests Vitest `app/src/screens/Comparison.test.tsx` › `[S-0015-11]` couvrent aussi la borne haute pour une tolérance de 7,25 % et l'envoi de la valeur choisie.

### S-0015-12 — Un accès perdu pendant le lancement est expliqué et mène à la reconnexion
Plan 0015, critère 12 · Tests : `app/e2e/comparaison.spec.ts` › `[S-0015-12]` ; Vitest : `app/src/screens/Comparison.test.tsx` › `[S-0015-12]`
- **Étant donné** l'écran Comparaison prêt à lancer, dont le lancement est refusé par le serveur avec `access_expired` (409, texte brut « Accès expiré : texte brut du serveur. »), l'accès ayant expiré entre l'aperçu et le clic ; l'aperçu relu ensuite signale l'accès manquant à dbx-fr
- **Quand** je clique « Lancer la comparaison »
- **Alors** l'alerte « Accès expiré » donne la consigne (« Reconnectez-vous depuis Mes connexions, puis réessayez. ») sans recopier le texte brut du serveur, et son lien « Reconnecter dans Mes connexions » pointe vers `#/w/groupe-nordis/connexions`
- **Et** l'aperçu est relu : le bandeau « Connexion requise » et son bouton « Se connecter à dbx-fr » (le mécanisme de S-0015-04) apparaissent, sans second lancement ; le lien ouvre Mes connexions ; axe-core ne relève aucune violation sérieuse
- Limite : le lancement et l'aperçu sont simulés (`page.route`) ; le parcours réel d'une connexion perdue est S-0016-08, sur l'écran Mes connexions.

### S-0015-13 — Deux clics rapides sur « Se connecter à… » ne lancent qu'une autorisation
Plan 0015, critère 13 · Tests : `app/e2e/comparaison-auth.spec.ts` › `[S-0015-13]` (deux tests) ; Vitest : `app/src/screens/Comparison.test.tsx` › `[S-0015-13]` (deux tests)
- **Étant donné** un espace isolé dont seule nordis-fr est cochée : « Connexion requise » demande dbx-fr (faux Databricks), et la demande d'autorisation du serveur tarde de 700 ms
- **Quand** je double-clique « Se connecter à dbx-fr »
- **Alors** une seule demande d'autorisation part et une seule fenêtre s'ouvre, le bouton est désactivé pendant le lancement puis devient « En attente de dbx-fr… » (désactivé), aucun « Connexion échouée » ne s'affiche ; la fenêtre revient sur « Connexion réussie » et la demande de connexion disparaît d'elle-même
- **Étant donné** une page d'autorisation abandonnée (la requête vers le faux Databricks est interrompue)
- **Quand** j'attends, puis clique « Recommencer la connexion à dbx-fr »
- **Alors** le bouton d'attente reste désactivé et dit « Terminer la connexion dans le navigateur » ; le clic relance l'autorisation (deux demandes au total), la seconde fenêtre aboutit, et aucun échec ne s'affiche
- Limite : le même garde-fou sur l'écran Mes connexions est S-0016-07. Le remplacement du premier flux côté serveur, dont le retour tardif refusé, est couvert par `core/tests/connections/test_connections.py::test_relaunching_replaces_the_flow_still_listening` et `::test_a_replaced_flow_cannot_connect_late`.

**Plan 0022**

### S-0022-01 — ES à 75 %, DE à 94 %, FR à 100 %
Plan 0022, critère 1 · Test : `app/e2e/comparaison.spec.ts` › `[S-0022-01]` (deux tests : la matrice, le détail nordis-es)
- **Étant donné** l'écran Comparaison de Revenu net, nordis-es cochée
- **Quand** je lance la comparaison et attends « Relancer »
- **Alors** la matrice affiche « Revenu net × nordis-es : 75 % de validation, écart max 2,9 % », nordis-de à 94 % et nordis-fr à 100 %
- **Et** le détail de nordis-es compte huit lignes, dont exactement deux hors tolérance : juin 2026 à −2,9 % (valeur exacte −2,857…) et juillet 2026 à +2,9 % (valeur exacte 2,926…), la facture du 30 juin, clôturée après minuit à Madrid, comptant en juillet
- Limite : l'interface arrondit à 2,9 % et le titre de la cellule porte la valeur exacte ; les valeurs des six autres cellules sont vérifiées par `core/tests/compare/test_compare.py::test_from_scratch_es_compares_with_fr_and_de`.

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
- Limite : le refus est vérifié par `core/tests/compare/test_compare.py::test_a_variant_sharing_no_concept_is_refused`. La source commune d'une déclinaison comparable s'affiche depuis le plan 0029 (S-0029-01, S-0029-02).

### S-0022-06 — nordis-es proposée, cochée, et à 75 % dans la matrice
Plan 0022, critère 6 · Test : `app/e2e/comparaison.spec.ts` › `[S-0022-06]`
- **Étant donné** l'écran Comparaison de Revenu net
- **Quand** je lis le panneau de lancement, puis lance la comparaison
- **Alors** nordis-es est active et cochée avant le lancement
- **Et** la matrice l'affiche à 75 %

**Plan 0029**

nordis-es, déclinaison from scratch de Revenu net, garde n06 · Jours comptables (`gold.finance.dim_date`) du canonique, lue sur Snowflake des deux côtés.

### S-0029-01 — L'aperçu annonce la source commune, en information, sans rien lancer
Plan 0029, critère 1 · Test : `app/e2e/sources-communes.spec.ts` › `[S-0029-01]`
- **Étant donné** l'écran Comparaison de Revenu net (`groupe-nordis`)
- **Quand** je coche successivement les trois déclinaisons, nordis-de et nordis-fr, nordis-es seule, puis nordis-de et nordis-es, en attendant chaque fois l'aperçu de la sélection
- **Alors** avec nordis-es, un seul bandeau « Source commune » s'affiche, en `role="status"` (ton info, jamais `alert`), avec « nordis-es : n06 · Jours comptables (gold.finance.dim_date) n'a pas d'équivalent dans la déclinaison ; la table du canonique est lue sur snowflake, des deux côtés. »
- **Et** sans nordis-es, aucun bandeau ; aucune violation axe sérieuse ; aucune progression ni `POST …/comparisons`

### S-0029-02 — Le détail du résultat nordis-es nomme ses sources communes
Plan 0029, critère 2 · Test : `app/e2e/sources-communes.spec.ts` › `[S-0029-02]`
- **Étant donné** un espace isolé, comparé en local dans DuckDB, nordis-es seule cochée
- **Quand** je lance la comparaison, attends « Relancer », puis ouvre « Revenu net × nordis-es : 75 % »
- **Alors** le détail affiche « Sources communes, lues sur snowflake des deux côtés : n06 · Jours comptables (gold.finance.dim_date). », sans violation axe sérieuse
- **Et** après un rechargement, la ligne est toujours là, relue depuis la base

## Connexions

Les tests de `app/e2e/connexions.spec.ts` se suivent sur Groupe Nordis (anna.k, coffre en mémoire). dbx-fr pointe vers le faux Databricks, dont l'OAuth s'ouvre dans une fenêtre du navigateur et revient sur le serveur local (port 8020) ; snow-de (SSO) et snow-es (paire de clés) vers le faux Snowflake. `app/e2e/github.spec.ts` utilise le serveur 8793 et un faux GitHub (port 8792).

Les tests de `app/e2e/connexions-testables.spec.ts` travaillent chacun sur un espace isolé du serveur 8793 (julien.h). Ils pilotent le faux Databricks par sa route de test `/__test__/configure` (OAuth refusé, jeton expiré, rafraîchissement refusé, erreur qui recopie le jeton reçu), remise à zéro après chaque test.

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
- **Alors** le statut de la ligne affiche « Hôte injoignable » et la consigne « Vérifiez l'adresse et la connexion réseau » (S-0016-09)
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

### S-0008-10 — Un jeton recopié par la plateforme dans son erreur n'arrive jamais à l'écran
Plan 0008, critère 10 · Test : `app/e2e/connexions-testables.spec.ts` › `[S-0008-10]`
- **Étant donné** un espace isolé, un token personnel factice rangé par l'API, et le faux Databricks réglé pour répondre 403 en recopiant le jeton reçu (`echo_token` de `/__test__/configure`)
- **Quand** je clique « Tester Databricks · dbx-fr »
- **Alors** le statut de la ligne affiche « Accès refusé par Databricks » et `***` à la place du jeton
- **Et** le jeton n'apparaît ni dans le HTML ni dans aucune réponse de l'API relevée pendant le test
- Limite : un seul canal est visible à l'écran (l'erreur 403 du test). Le message d'une réponse d'erreur, le corps brut hors JSON, une requête terminée en échec et un jeton coupé par la troncature (300 et 500 caractères) sont vérifiés par `core/tests/connections/test_connections.py::test_a_token_echoed_by_databricks_is_masked` et `::test_an_echoed_token_does_not_reach_the_test_route` ; `message_of`, le masquage et l'échange du code OAuth par `core/tests/connections/test_connector_security.py` ; Snowflake est à S-0018-07 ; l'hébergeur GitHub (message d'erreur de l'API, `device_code` du flux de connexion) par `core/tests/repo/test_githost.py::test_a_token_echoed_by_github_is_masked` et `core/tests/repo/test_github_device.py::test_a_device_code_echoed_by_github_is_masked`.

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

### S-0016-07 — Un double clic sur « Se connecter » ne lance qu'un flux OAuth
Plan 0016, critère 7 · Test : `app/e2e/connexions-testables.spec.ts` › `[S-0016-07]`
- **Étant donné** un espace isolé, dbx-fr jamais connecté, et une autorisation dont la réponse est retardée de 700 ms
- **Quand** je double-clique « Se connecter à Databricks · dbx-fr »
- **Alors** une seule demande d'autorisation part et une seule fenêtre s'ouvre ; la ligne affiche « Terminez la connexion dans le navigateur… » puis « Connecté · session OAuth »
- **Et** aucune alerte d'échec (ni `oauth_port_busy`) ne s'affiche
- **Et** si la page d'autorisation est abandonnée (premier flux lancé, jamais terminé), « Annuler » arrête le flux côté serveur : la page tardive ne connecte rien (après rechargement, la ligne reste « Jamais connecté »), puis « Se connecter » relance sans `oauth_port_busy` et la ligne passe à « Connecté · session OAuth »
- Limite : les clics dans le même tick, les boutons désactivés pendant le lancement, le panneau « Nouveau point d'accès » et le code `oauth_port_busy` traduit (titre et consigne) sont rendus en Vitest : `app/src/screens/Connections.test.tsx` › `[S-0016-07]` (l'abandon appelle la route d'annulation, y compris pour le brouillon du panneau, son échec est affiché, après l'annulation la ligne montre l'état du coffre (connecté si le navigateur a abouti avant, ligne ou brouillon du panneau), le brouillon du panneau est verrouillé dès le lancement et le temps de la connexion ; la relance y est aussi vérifiée). L'annulation côté serveur, le retour tardif sans effet et la réponse 410 de la page de retour sont couverts par `core/tests/connections/test_connections.py` (`test_cancelling_stops_the_flow_and_a_late_callback_connects_nothing`, `test_a_callback_for_a_flow_no_longer_pending_answers_410_and_stores_nothing`, `test_a_replaced_flow_cannot_connect_late`, `test_cancelling_requires_the_session_token`, `test_cancelling_while_the_callback_is_registering_waits_and_the_vault_holds_the_access`, `test_a_start_during_a_cancellation_finds_the_port_free`, `test_cancelling_stops_the_pending_flow_and_ignores_an_old_one_of_the_same_id`, `test_cancelling_without_a_pending_flow_is_harmless`) et, pour le SSO Snowflake, par `test_cancelled_sso_flow_registers_nothing_when_the_browser_finishes_late` et `test_cancelling_an_sso_flow_that_just_registered_reports_connected` (l'annulation attend l'enregistrement).

### S-0016-08 — Un test refusé pour accès expiré est expliqué, et « Reconnecter » ramène à la connexion
Plan 0016, critère 8 · Test : `app/e2e/connexions-testables.spec.ts` › `[S-0016-08]`
- **Étant donné** un espace isolé et un token personnel que le faux Databricks ne reconnaît pas
- **Quand** je clique « Tester Databricks · dbx-fr »
- **Alors** le statut de la ligne dit « Accès expiré. » et donne la consigne (se reconnecter depuis Mes connexions), la cellule passe à « Token expiré » et le bouton « Reconnecter Databricks · dbx-fr » apparaît sans recharger
- **Et** « Reconnecter » mène à l'OAuth : la ligne revient à « Connecté · session OAuth » et « Tester » donne « Connexion OK · N ms »
- Limite : le test d'un accès retiré ailleurs (`not_connected`) est e2e en S-0016-09 ; un brouillon jamais connecté et un code du serveur non traduit, qui garde son message, sont rendus en Vitest : `app/src/screens/Connections.test.tsx` › `[S-0016-08]`.

### S-0016-09 — Chaque code des connecteurs et du coffre a un titre et une consigne
Plan 0016, critère 9 · Tests : `app/e2e/connexions-testables.spec.ts` › `[S-0016-09]` (cinq tests, dont `[S-0008-03] [S-0016-09]` et `[S-0016-08] [S-0016-09]`) ; Vitest : `app/src/messages.test.ts` › `[S-0016-09]`
- **Étant donné** un espace isolé, le faux Databricks et, selon le code, un accès retiré pendant que la page reste ouverte, un hôte local qui ne répond pas, un hôte local qui répond HTTP 500 avec un texte brut, un token refusé par la plateforme, ou le port de retour OAuth 8020 tenu par une autre application
- **Quand** je clique « Tester Databricks · dbx-fr » (ou « Se connecter à Databricks · dbx-fr » pour le port occupé)
- **Alors** chaque code donne son titre et sa consigne, et jamais le texte brut du serveur : `not_connected` « Pas encore connecté » et « Connectez-vous depuis Mes connexions, puis réessayez. » ; `access_expired` « Accès expiré. » et « Reconnectez-vous depuis Mes connexions, puis réessayez. » ; `host_unreachable` « Hôte injoignable » et « Vérifiez l'adresse et la connexion réseau » ; `query_failed` « La plateforme a refusé la requête » et « Vérifiez vos droits sur le schéma et l'entrepôt » ; `oauth_port_busy` « Une connexion OAuth est déjà en cours » et « Terminez-la ou fermez-la, puis réessayez. »
- **Et** le port libéré, la connexion aboutit ; Vitest garantit que seuls `not_connected` et `access_expired` portent l'action de reconnexion
- Limite : les trois autres codes restent en Vitest. `vault_unavailable` : le coffre des tests est en mémoire, un trousseau verrouillé ne se fabrique pas. `query_timeout` : la requête de test attend 60 s avant d'abandonner (un test de plus d'une minute pour une consigne déjà vue en Vitest). `host_rejected` : propre aux propositions GitHub, que le faux GitHub ne refuse pas en 422. Le texte propre au rattachement d'un dépôt (`host_unreachable` : « Dépôt injoignable ») reste prioritaire dans le formulaire de rattachement : `app/src/screens/Rattachement.test.tsx` › `[S-0033-02]`. Les autres codes émis par les routes de connexion (`platform_forbidden`, `platform_not_found`, `oauth_unavailable`, `oauth_failed`, les clés Snowflake) gardent le message du serveur, qui dit déjà la cause et la suite.

### S-0016-10 — Une autorisation sans réponse échoue au bout de 5 minutes, et « Se connecter » repart
Plan 0016, critère 2 (délai de l'OAuth) · Test : `app/e2e/connexions-etats.spec.ts` › `[S-0016-10]`
- **Étant donné** un espace isolé, l'horloge de la page avançant à la main (`page.clock`), et la page d'autorisation du faux Databricks interrompue au niveau du contexte : la fenêtre s'ouvre, personne ne répond
- **Quand** je clique « Se connecter à Databricks · dbx-fr », laisse passer 4 minutes, puis 61 secondes de plus
- **Alors** après 4 minutes la ligne n'a pas d'alerte ; après 5 minutes l'alerte « Délai dépassé : La connexion n'a pas abouti en 5 minutes : réessayer. » s'affiche
- **Et** une fois la page d'autorisation rétablie, « Se connecter » ouvre une seconde fenêtre, la connexion aboutit (« Connecté · session OAuth ») et l'alerte disparaît

### S-0016-11 — Sans plateforme autorisée, ou en simple lecteur, rien ne permet d'ajouter un point d'accès
Plan 0016, critère 6 (cas limite) · Tests : `app/e2e/connexions-etats.spec.ts` › `[S-0016-11]` (deux tests : les états, l'accessibilité)
- **Étant donné** un espace isolé dont `allowed_platforms` est vide (commit poussé, sync fait), julien.h référent de l'espace
- **Quand** j'ouvre « Mes connexions »
- **Alors** l'aside « Aucune plateforme connectable autorisée » dit qu'un référent de l'espace doit autoriser Databricks ou Snowflake dans l'administration, avec le lien « Configurer les plateformes » ; ni bouton « Ajouter un point d'accès », ni panneau « Nouveau point d'accès » ; le point existant reste listé avec « Plateforme retirée par le référent »
- **Et** si l'espace est lu en rôle `lecteur` (réponse de `GET /api/workspaces/{id}` réécrite), ni l'avis, ni le bouton, ni le panneau ne sont affichés, et le tableau reste lisible
- **Et** l'écran sans plateforme autorisée n'a aucune violation d'accessibilité sérieuse
- Limite : le second test est rouge tant que le conteneur de défilement `.table-wrap` (scroll horizontal dès que l'aside tient à côté du tableau) n'est pas focalisable au clavier, règle axe `scrollable-region-focusable`.

### S-0016-12 — Un identifiant déjà déclaré est refusé pour se connecter ou tester, avec la consigne
Plan 0016, critère 9 (code `access_point_exists`) · Test : `app/e2e/connexions-etats.spec.ts` › `[S-0016-12]`
- **Étant donné** le panneau « Nouveau point d'accès » rempli avec l'identifiant `dbx-fr`, déjà déclaré
- **Quand** je clique « Tester la connexion », puis « S'authentifier avec OAuth »
- **Alors** une alerte dit « « dbx-fr » est déjà déclaré : s'y connecter depuis la liste. », sans trace ni code brut, aucun test n'est rendu, aucune fenêtre ne s'ouvre et rien n'est rangé dans le coffre
- **Et** avec un identifiant libre, l'alerte disparaît
- Limite : le code n'a pas de titre dans `messages.ts` : l'écran montre le message du serveur, qui dit déjà la cause et la suite.

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

### S-0025-07 — Une coupure brève pendant la connexion ne perd pas le code
Plan 0025, suivi de la revue globale (#146) · Test : `app/e2e/github.spec.ts` › `[S-0025-07]`
- **Étant donné** une connexion GitHub en attente de l'autorisation (le code est affiché)
- **Quand** deux sondages de suite échouent (coupure brève), puis le troisième aboutit
- **Alors** le code reste affiché, aucune alerte ne paraît, et la connexion se termine
- **Et** au troisième échec de suite, l'alerte apparaît et « Se connecter à GitHub » revient ; un statut inconnu donne « La connexion à GitHub a échoué : recommencer. » plutôt qu'un message vide
- Limite : les sondages en échec sont simulés par `page.route` (503 renvoyé à l'app, le serveur n'est pas touché) ; le statut inconnu est lui aussi une réponse simulée. Le test finit par la connexion réussie, car elle retire le bouton. Les mêmes cas sont rendus en Vitest : `app/src/screens/GitHub.test.tsx` › `[S-0025-07]`.

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

### S-0005-12 — Liste des espaces ou dépôt tenus par un autre processus : l'app dit quoi faire
Plan 0005, suivi de la revue globale (#146, ADR 0039) · Test : `app/e2e/accueil.spec.ts` › `[S-0005-12]`
- **Étant donné** que l'app et la ligne de commande modifient en même temps le registre des espaces ou le clone d'un espace, et que l'un tient son verrou au-delà du délai ; le test fait répondre 503 aux requêtes de création et d'adhésion (`page.route`)
- **Quand** je crée un espace (`registry_busy`), puis j'en rejoins un (`clone_busy`)
- **Alors** le panneau affiche « Liste des espaces occupée » avec « Réessayez dans un instant », puis « Espace en cours d'utilisation » avec « Réessayez quand elle aura fini »
- **Et** le bouton d'envoi redevient actif : le panneau reste utilisable
- Limite : la réponse 503 est simulée ; le verrou réellement tenu par un autre processus, l'attente bornée et le statut 503 sont vérifiés par `core/tests/test_registry_lock.py` et `core/tests/repo/test_clone_lock.py`. Le message seul est aussi vérifié en Vitest : `app/src/messages.test.ts` › `[S-0005-12]`.

### S-0005-13 — Le panneau de création ou d'adhésion ne se ferme pas pendant l'envoi
Plan 0005, suivi de la revue globale (#146) · Test : `app/e2e/accueil.spec.ts` › `[S-0005-13]` (deux tests)
- **Étant donné** le panneau « Créer un espace » (ou « Rejoindre un espace ») dont l'envoi est en vol : « Création… » désactivé (ou « Clonage du dépôt… »)
- **Quand** j'appuie sur Échap ou je clique « Fermer »
- **Alors** le panneau reste ouvert, « Fermer » est inactif (`aria-disabled`) mais garde le focus dans le panneau, Tab ne l'en fait pas sortir, et la réponse du serveur ouvre l'espace comme prévu
- **Et** hors envoi, ou après un échec de l'envoi, Échap et « Fermer » ferment le panneau
- Limite : la requête est retenue par `page.route` puis résolue à la main avec un espace qui existe déjà, pour ne rien créer sur le serveur partagé ; le dernier « Et » est vérifié en Vitest : `app/src/screens/EnvoiEnCours.test.tsx` › `[S-0005-13]`.

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

### S-0017-09 — Quitter l'Administration avec un brouillon non enregistré demande confirmation
Plan 0017, critère 9 · Test : `app/e2e/administration.spec.ts` › `[S-0017-09]` (deux tests) ; `app/src/screens/Administration.test.tsx` › `[S-0017-09]` (cinq tests : lien, navigation par le code, Annuler / Quitter, formulaire de domaine, formulaire de membre)
- **Étant donné** julien.h dans l'Administration, avec une plateforme cochée et non enregistrée
- **Quand** je clique « Propositions » dans la navigation de l'espace
- **Alors** la question « Quitter l'Administration ? » s'ouvre (focus sur « Annuler », axe-core sans violation sérieuse) et l'adresse ne change pas
- **Et** « Annuler » ferme la question, garde le brouillon et rend le focus au lien cliqué ; « Quitter sans enregistrer » ouvre Propositions
- **Et** une saisie pas encore appliquée dans le formulaire d'un domaine (libellé modifié) ou d'un nouveau membre (nom saisi) retient aussi la sortie ; un formulaire intact ou abandonné par « Annuler » ne retient rien (second test e2e)
- Limite : le retour arrière du navigateur et la fermeture de la fenêtre Tauri ne sont pas retenus (ADR 0043). L'avertissement `beforeunload` du navigateur est vérifié en Vitest.

### S-0017-10 — Sans brouillon à enregistrer, aucune confirmation
Plan 0017, critère 10 · Test : `app/e2e/administration.spec.ts` › `[S-0017-10]` ; `app/src/screens/Administration.test.tsx` › `[S-0017-10]` (deux tests)
- **Étant donné** julien.h dans l'Administration, sans modification ; ou avec une modification annulée par « Annuler » ; ou dont la proposition vient d'être créée (Vitest)
- **Quand** je clique un onglet de la navigation
- **Alors** la vue s'ouvre aussitôt, sans question

### S-0017-11 — Une gouvernance modifiée ailleurs refuse l'enregistrement ; « Relire les paramètres » efface le brouillon
Plan 0017, critère 8 (base périmée) · Test : `app/e2e/administration-etats.spec.ts` › `[S-0017-11]`
- **Étant donné** julien.h dans l'Administration d'une copie isolée, avec BigQuery cochée, puis un commit poussé qui change `governance.yaml` (le libellé de Marketing) et un sync fait
- **Quand** je clique « Enregistrer et … »
- **Alors** une alerte avec « Relire les paramètres » s'affiche, sans trace ni code brut, aucune proposition n'est créée et la branche principale du dépôt n'a pas bougé
- **Et** « Relire les paramètres » ferme l'alerte, décoche BigQuery, affiche le libellé « Marketing et communication » et désactive de nouveau « Enregistrer »

### S-0017-12 — Inviter un membre : compte mal formé ou déjà membre refusé, puis ajouté à governance.yaml
Plan 0017, critère 4 (membres) · Test : `app/e2e/administration-etats.spec.ts` › `[S-0017-12]`
- **Étant donné** julien.h, seul référent, dans l'Administration d'une copie isolée
- **Quand** je clique « Inviter », saisis « Léa M. », puis le compte « léa m », puis « anna.k », puis « lea.m », en cliquant « Ajouter le membre » à chaque fois, et enfin « Enregistrer et fusionner »
- **Alors** le champ du compte est décrit par « Le compte de la personne sur l'hébergeur (lettres, chiffres, . _ -). » puis « Ce compte est déjà membre de l'espace. » ; le rappel « l'accès au dépôt se donne sur l'hébergeur » est affiché
- **Et** le membre « Léa M. » apparaît, l'enregistrement est « fusionné sans revue », `governance.yaml` du dépôt porte `account: lea.m`, et l'API la donne contributrice sans domaine

### S-0017-13 — Une référente de domaine n'a ni lien d'administration, ni accès à l'écran, ni à l'API
Plan 0017, critère 1 (référent de domaine) · Test : `app/e2e/administration-etats.spec.ts` › `[S-0017-13]` ; `app/src/App.test.tsx` (composant)
- **Étant donné** claire.m, référente du seul domaine Finance, sur son serveur et la copie isolée de la démonstration
- **Quand** j'ouvre le catalogue, puis `administration`
- **Alors** la navigation n'a pas de lien « Administration », `GET /admin` répond 403, et l'adresse `administration` retombe sur le catalogue

**Plan 0020**

### S-0020-01 — Une fusion faite hors d'Atlas est taguée au sync
Plan 0020, critère 1 · Test : `app/e2e/administration.spec.ts` › `[S-0020-01]`
- **Étant donné** un espace isolé avec Revenu net v4, et une branche qui passe Revenu net en v5, fusionnée par git (`--no-ff`) et poussée hors d'Atlas
- **Quand** je clique « Synchroniser » dans Administration
- **Alors** le tag distant `doc/revenu-net/v5` désigne le commit de fusion
- **Et** la fiche affiche « v5 · validée … », et l'onglet « Versions 5 » montre « v5 · courante »

### S-0020-02 — Une version déjà taguée ne produit ni tag ni avertissement
Plan 0020, critère 2 · Tests : `app/e2e/administration.spec.ts` › `[S-0020-02]` ; `app/e2e/depot-testables.spec.ts` › `[S-0020-02]`
- **Étant donné** le même espace, v5 déjà taguée
- **Quand** je clique de nouveau « Synchroniser »
- **Alors** « Déjà à jour avec le dépôt distant. » s'affiche, et la liste des tags du dépôt distant est inchangée
- **Et** un commit poussé qui ne change que le libellé de Revenu net, sans changer sa version, puis « Synchroniser », ne produit ni avertissement ni tag, ni dans le dépôt nu ni dans le clone
- Limite : le détail de la règle est vérifié par `core/tests/repo/test_workspace_repo.py::test_sync_leaves_versions_tagged_by_atlas_alone`.

### S-0020-03 — Une poussée de tag refusée garde le tag local et le signale
Plan 0020, critère 3 · Test : `app/e2e/depot-testables.spec.ts` › `[S-0020-03]`
- **Étant donné** un espace isolé où Revenu net passe en v5 par une fusion git (`--no-ff`) poussée hors d'Atlas ; le dépôt nu refuse les tags (crochet `pre-receive`)
- **Quand** je clique « Synchroniser » dans Administration
- **Alors** la région « Dépôt Git de l'espace » affiche « Les tags n'ont pas pu être poussés »
- **Et** le même statut affiche aussi « taguée au sync » (les deux avertissements arrivent ensemble), le clone porte `doc/revenu-net/v5` sur le commit de fusion, et le dépôt nu n'a pas ce tag
- **Et** quand le crochet est retiré, le « Synchroniser » suivant publie le tag sur le commit de fusion dans le dépôt nu et l'avertissement disparaît
- Limite : le rendu de plusieurs avertissements à la fois est aussi couvert en Vitest : `app/src/screens/Administration.test.tsx` › `[S-0020-03]`.

### S-0020-04 — L'écran affiche l'avertissement du sync
Plan 0020, critère 4 · Test : `app/e2e/administration.spec.ts` › `[S-0020-04]`
- **Étant donné** la v5 fusionnée hors d'Atlas
- **Quand** je clique « Synchroniser »
- **Alors** le statut de la région « Dépôt Git de l'espace » contient « taguée au sync »
- Limite : l'affichage simultané de « taguée au sync » et de l'échec de poussée des tags est vérifié en e2e par S-0020-03.

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

### S-0023-05 — Les formulaires de retrait disent pourquoi un retrait est impossible ou ce qu'il entraîne
Plan 0023, spécification des consignes · Test : `app/e2e/administration-etats.spec.ts` › `[S-0023-05]`
- **Étant donné** julien.h, seul référent, dans l'Administration d'une copie isolée
- **Quand** j'ouvre successivement Julien H., le domaine Finance, puis Anna K. avec un deuxième rôle « contributeur » ; puis je nomme Claire M. référente de l'espace, rouvre Julien H. et Anna K. et retire Anna K.
- **Alors** Julien H. porte « Seul référent de l'espace : nommez-en un autre avant de le retirer. » et son retrait est désactivé ; Finance porte « N documents rattachés : les rattacher à un autre domaine avant de le retirer. » et son retrait est désactivé ; le rôle en double est décrit par « Ce rôle figure déjà : regroupez ses domaines. » et le formulaire reste ouvert
- **Et** avec deux référents, le retrait de Julien H. est actif et dit « Vous retirer vous ôtera l'administration de l'espace une fois la proposition fusionnée. » ; celui d'Anna K. dit « L'accès au dépôt se retire sur l'hébergeur. » et ouvre une proposition à relire dont le texte contient « Anna K. (anna.k) retiré. »

**Plan 0033**

Les scénarios 1 à 4 passent par le formulaire « Rattacher un dépôt distant » de l'Administration, le 5 par le panneau de création ; ils partagent quatre tests e2e dans `app/e2e/rattachement.spec.ts`, dont le dernier est le parcours complet du scénario 10. Les dépôts sont des dépôts nus locaux ; les adresses `https://github.com/e2e-atlas/…` sont redirigées vers eux par `url.<dossier>.insteadOf`, et le faux GitHub (serveur 8790) répond au device flow, à `/user` et à `/repos/…`.

### S-0033-01 — Un dépôt vide reçoit l'espace
Plan 0033, critère 1 · Test : `app/e2e/rattachement.spec.ts` › `[S-0033-01]`
- **Étant donné** un espace créé sans adresse, dont Connexions dit « Cet espace n'a pas encore de dépôt distant » et renvoie à l'Administration, où « Enregistrer » est désactivé avec « Rattachez d'abord un dépôt distant pour enregistrer. »
- **Quand** je saisis le chemin d'un dépôt nu vide dans « Adresse du dépôt vide » et clique « Rattacher le dépôt »
- **Alors** la région « Dépôt Git de l'espace » affiche « Dépôt rattaché : l'espace est publié sur <adresse>, sous le compte anna.k. » et le bouton « Synchroniser » ; le groupe de rattachement a disparu
- **Et** le dépôt nu a pour seul commit « Création de l'espace … », le clone a `origin`, et l'API rend `git_remote`, `account: anna.k` et `role: referent`
- Limite : un push vers un vrai GitHub n'est pas exercé (S-0033-09). Le même parcours est rendu en Vitest : `app/src/screens/Rattachement.test.tsx` › `[S-0033-01]`.

### S-0033-02 — Chaque refus dit pourquoi, et il ne reste rien
Plan 0033, critère 2 · Test : `app/e2e/rattachement.spec.ts` › `[S-0033-02]`
- **Étant donné** un espace sans dépôt distant ; sur le serveur local : une adresse invalide, un chemin absent, un dépôt avec un commit, un dépôt qui n'a plus qu'un tag ; sur le faux GitHub : un dépôt introuvable, un dépôt en lecture seule, un dépôt archivé, un dépôt avec un commit
- **Quand** je tente de rattacher chacun
- **Alors** une alerte nomme la cause (« Adresse de dépôt invalide », « Dépôt introuvable », « Ce dépôt n'est pas vide », « Pas de droit d'écriture sur ce dépôt ») ; le bouton reste actif, la région indique toujours « Pas encore de dépôt distant », et aucune alerte ne contient de jeton
- **Et** le clone n'a pas de remote et son `HEAD` n'a pas bougé ; le dépôt plein garde sa branche, les dépôts en lecture seule et archivé n'ont aucune référence ; l'API rend toujours `git_remote` vide
- Limite : chaque code est testé en Vitest (`app/src/screens/Rattachement.test.tsx` › `[S-0033-02]`) et par `core/tests/repo/test_set_remote.py` ; un push refusé par un hook ou une règle de branche réelle n'est exercé que par le core. Les codes `origin_conflict` (adresse trouvée, identifiant masqué) et `attach_incomplete` (dépôt publié, un nouvel essai termine) sont rendus en Vitest, dont le second essai ; les étapes qui échouent après le push, l'équivalence des écritures d'`origin` et l'absence d'appel réseau avant `origin_conflict` sont des tests core (`core/tests/repo/test_set_remote.py`).

### S-0033-03 — Une adresse GitHub demande d'abord la connexion
Plan 0033, critère 3 · Test : `app/e2e/rattachement.spec.ts` › `[S-0033-03]`
- **Étant donné** un espace sans dépôt distant, sans connexion GitHub, sur le serveur 8790
- **Quand** je saisis une adresse `https://github.com/…`
- **Alors** le groupe dit « Atlas se sert de votre compte GitHub » et « Rattacher le dépôt » est désactivé
- **Quand** je clique « Se connecter à GitHub », « Ouvrir GitHub » et « Autoriser » dans la fenêtre du faux GitHub
- **Alors** le groupe affiche « Connecté à GitHub en tant que @julien.h. » et « Rattacher le dépôt » s'active ; axe-core ne relève aucune violation sérieuse ou critique
- Limite : une adresse hors GitHub ne demande aucune connexion, et un jeton refusé pendant le rattachement fait proposer la reconnexion : ces deux cas ne sont rendus qu'en Vitest (`app/src/screens/Rattachement.test.tsx` › `[S-0033-03]`).

### S-0033-04 — Le créateur reste référent sous son compte GitHub
Plan 0033, critère 4 · Test : `app/e2e/rattachement.spec.ts` › `[S-0033-04]`
- **Étant donné** un espace créé par anna.k, connecté à GitHub en tant que julien.h, et un dépôt vide
- **Quand** je rattache l'adresse du dépôt vide
- **Alors** la région affiche « sous le compte julien.h. » ; la barre latérale montre julien.h, « Référent d'annuaire », et le tableau « Utilisateurs et rôles » ne contient plus anna.k
- **Et** le dépôt a deux commits, « Identité du créateur : anna.k devient julien.h » puis « Création de l'espace … » ; son `governance.yaml` contient `account: julien.h` ; le clone est propre ; l'API rend `account: julien.h`, `role: referent`, `space_referent: true`
- **Et** après un rechargement de la page, le rôle de référent est conservé
- Limite : `core/tests/repo/test_set_remote.py` vérifie en plus les référents et validateurs de domaine et le rôle relu par `open_context`.

### S-0033-05 — Une adresse refusée à la création se rattache dans le panneau
Plan 0033, critère 5 · Test : `app/e2e/rattachement.spec.ts` › `[S-0033-05]`
- **Étant donné** le dialogue « Créer un espace » rempli avec l'adresse d'un dépôt vide de GitHub, sans connexion GitHub
- **Quand** je valide la création
- **Alors** le panneau dit « Espace créé, dépôt distant non rattaché » et montre le groupe de rattachement, adresse préremplie ; le dépôt n'a reçu aucune référence
- **Quand** je me connecte à GitHub dans le panneau, puis clique « Rattacher le dépôt »
- **Alors** le catalogue de l'espace s'ouvre, la barre latérale montre julien.h et « Référent d'annuaire », et le dépôt a deux commits
- Limite : le rendu seul est vérifié en Vitest : `app/src/screens/Home.test.tsx` › `[S-0033-05]`.

### S-0033-06 — Une fois rattaché, l'enregistrement de la gouvernance passe
Plan 0033, critère 6 · Test : `app/e2e/rattachement.spec.ts` › `[S-0033-06]`
- **Étant donné** l'espace rattaché de S-0033-01, dont je suis le seul référent
- **Quand** je coche « Databricks » et clique « Enregistrer et fusionner »
- **Alors** l'écran affiche « Paramètres enregistrés : proposition n° … fusionnée sans revue. » et `governance.yaml` sur la branche principale du dépôt contient `- databricks`
- Limite : sur le faux GitHub, qui n'a ni pull request ni fusion, l'enregistrement n'est pas parcouru ; le rôle sous l'identité GitHub est vérifié par S-0033-04 et par `core/tests/repo/test_set_remote.py`.

### S-0033-07 — Les connexions deviennent utilisables
Plan 0033, critère 7 · Test : `app/e2e/rattachement.spec.ts` › `[S-0033-07]`
- **Étant donné** la plateforme Databricks autorisée sur l'espace rattaché de S-0033-06
- **Quand** j'ouvre Connexions, clique « Ajouter un point d'accès », saisis identifiant, hôte, SQL warehouse et schéma, m'authentifie avec OAuth, teste, saisis une justification et clique « Proposer le point d'accès »
- **Alors** la zone « Configurer les plateformes » n'est plus proposée, la plateforme et l'entité sont préremplies, « Connecté : le token est rangé dans votre coffre, sous dbx-perrault. », « Connexion OK · … ms » et « Proposition n° … ouverte. » s'affichent
- **Et** aucun jeton n'apparaît dans la page ni dans le stockage du navigateur, et le dépôt a une branche `prop/…`

### S-0033-08 — Les modifications non enregistrées survivent au rattachement
Plan 0033, critère 8 · Test : `app/e2e/rattachement.spec.ts` › `[S-0033-08]`
- **Étant donné** l'Administration d'un espace sans dépôt distant, où j'ai coché « Databricks » sans pouvoir enregistrer
- **Quand** je rattache un dépôt vide
- **Alors** la case « Databricks » est toujours cochée et « Enregistrer et fusionner » est actif, sans avertissement de perte
- **Et** l'enregistrement fusionne `- databricks` dans `governance.yaml` (c'est le pas de S-0033-06)
- **Étant donné** en Vitest seulement, un domaine ou un membre en cours de modification
- **Alors** « Rattacher le dépôt » est désactivé (Entrée n'envoie rien) avec « Validez ou annulez la modification en cours avant de rattacher le dépôt. », et se réactive après « Annuler »
- **Alors** pendant la requête, les cases, niveaux, boutons « Modifier » et « Domaine », « Annuler » et « Enregistrer » sont désactivés ; le brouillon conservé est celui d'où la requête est partie ; le gel dure jusqu'à la fin du rechargement de l'administration ; si la relecture échoue, il reste gelé avec une bannière et « Réessayer », qui le dégèle en gardant le brouillon
- **Étant donné** en Vitest seulement, un brouillon qui a déjà ajouté un membre au compte du login GitHub
- **Alors** après le rattachement, le brouillon est abandonné, l'avertissement « Vos modifications non enregistrées n'ont pas été reprises : le compte <login> figurait déjà dans le brouillon. Refaites-les à partir de la gouvernance du dépôt. » s'affiche, et le créateur est référent sous le login GitHub, sans rien à enregistrer
- Limite : le compte du créateur réécrit dans le brouillon, la valeur des validateurs et la base relue envoyée à l'enregistrement sont vérifiés en Vitest, comme la suspension ci-dessus : `app/src/screens/Rattachement.test.tsx` › `[S-0033-08]` (cinq tests). Les refus `workspace_dirty` (gouvernance modifiée dans le clone, y compris quand elle retire le compte local) et `wrong_branch` (autre branche extraite), hors écran, sont des tests core : `core/tests/repo/test_set_remote.py::test_another_checked_out_branch_is_refused_before_any_remote_write`. Le refus `workspace_dirty` (gouvernance modifiée dans le clone, hors écran) est un test core : `core/tests/repo/test_set_remote.py::test_unsaved_changes_to_the_governance_are_refused_before_any_remote_write`.

### S-0033-10 — Un espace neuf publie son premier KPI
Plan 0033, critère 10 · Test : `app/e2e/rattachement.spec.ts` › `[S-0033-10]`
- **Étant donné** un espace créé sans adresse, rattaché à un dépôt nu vide (pas de S-0033-01), dont je suis le seul référent ; il n'a ni domaine ni fichier de calendrier
- **Quand** j'ajoute le domaine « Finance » dans l'Administration et clique « Enregistrer et fusionner »
- **Alors** « Paramètres enregistrés : proposition n° … fusionnée sans revue. » s'affiche et `governance.yaml` du dépôt contient `id: finance`
- **Quand** j'ouvre « Nouveau concept ou KPI » depuis le catalogue, sans recharger l'app
- **Alors** le menu « Domaine » propose `finance` ; je crée le KPI « Chiffre d'affaires » dans ce domaine, propriétaire anna.k
- **Quand** je déclare un calendrier civil, le fuseau Europe/Paris, une source Databricks à deux colonnes et une agrégation (somme par entité)
- **Alors** le panneau de validation dit « Compilable Databricks, Snowflake », sans erreur ; la proposition se soumet
- **Quand** j'ouvre « Voir les propositions » et clique « Fusionner »
- **Alors** la mention « Fusionnée sans revue : aucun autre compte habilité » est affichée, `kpis/chiffre-affaires.yaml` est sur la branche principale du dépôt nu, avec `domain: finance`
- **Et** le catalogue liste le KPI avec « Finance », et sa fiche s'ouvre avec ce domaine et son propriétaire ; axe-core ne relève aucune violation sérieuse ou critique aux étapes clés
- Limite : les enregistrements de gouvernance sans dépôt distant (issue 160) ne sont pas couverts.

### S-0033-11 — Calendrier civil intégré dans l’éditeur
Plan 0033, critère 11 · Test : `app/src/editor/Properties.test.tsx` › `[S-0033-11]`
- **Étant donné** un KPI dans un espace sans fichier de calendrier
- **Alors** le menu propose « civil » et sa sélection écrit une référence sans version
- **Et** une référence civile existante est relue, un fichier homonyme ne crée pas de doublon, les autres calendriers gardent leur version et un nœud temporel affiche « civil ».

### S-0033-12 — Relecture de l’espace après une fusion
Plan 0033, critère 12 · Test : `app/src/screens/WorkspaceShell.test.tsx` › `[S-0033-12]`
- **Étant donné** une fusion réussie depuis l’Administration ou les propositions, y compris un KPI
- **Alors** la coque relit l’espace et les domaines actualisés sont proposés dans l’éditeur
- **Et** la relecture ne déplace pas le focus pendant une saisie.
- Limite : `app/src/screens/Administration.test.tsx` vérifie l'appel après fusion de gouvernance et son absence pour une proposition ouverte ; `app/src/screens/Proposals.test.tsx` vérifie l'appel après fusion d'un KPI et son absence en cas d'échec.

**Plan 0034**

Les scénarios passent par le groupe « Rattacher un dépôt distant » de l'Administration, dont la bannière d'erreur propose « Réinitialiser le rattachement ». Les états résiduels d'un rattachement interrompu sont fabriqués avec git dans le clone de l'espace, sur le serveur principal (compte anna.k, dépôts nus locaux). Les scénarios 1 à 4 et 8 partagent deux tests e2e dans `app/e2e/reinitialisation.spec.ts`, le scénario 10 (espace rouvert) a le sien ; les scénarios 5 à 7 n'ont que des tests Vitest (`app/src/screens/Reinitialisation.test.tsx`), qui rendent aussi les scénarios 1 à 4.

### S-0034-01 — Seuls les trois refus d'un reste local proposent la réinitialisation
Plan 0034, critère 1 · Test : `app/e2e/reinitialisation.spec.ts` › `[S-0034-01]`
- **Étant donné** un espace sans dépôt distant dont le clone garde un `origin` d'une autre adresse, avec deux adresses d'envoi
- **Quand** je rattache un autre dépôt vide
- **Alors** l'alerte dit « Adresse origin différente », sans jeton, et propose le bouton « Réinitialiser le rattachement » ; axe-core ne relève aucune violation sérieuse ou critique
- **Étant donné** une publication d'Atlas déjà fusionnée en local (second test)
- **Alors** l'alerte « Rattachement interrompu » propose aussi le bouton
- Limite : les trois codes (`origin_conflict`, `remote_partial`, `attach_incomplete`) proposent le bouton, et aucun autre refus ne le propose (dépôt non vide, droits, adresse, jeton, `workspace_dirty`, `wrong_branch`) : cas rendus en Vitest, `app/src/screens/Reinitialisation.test.tsx` › `[S-0034-01]`.

### S-0034-02 — Une confirmation explicite, et rien n'est envoyé avant
Plan 0034, critère 2 · Test : `app/e2e/reinitialisation.spec.ts` › `[S-0034-02]`
- **Étant donné** l'alerte de S-0034-01
- **Quand** je clique « Réinitialiser le rattachement »
- **Alors** une confirmation « Réinitialiser le rattachement ? » (`alertdialog`) dit que seule la copie locale est réinitialisée, que le dépôt distant n'est pas modifié et qu'il faudra peut-être le vider avant de le réutiliser ; le focus est sur « Annuler » et Tab mène à « Confirmer la réinitialisation »
- **Quand** j'appuie sur Échap, puis rouvre la confirmation et clique « Annuler »
- **Alors** la confirmation se ferme, le focus revient au bouton d'origine, aucune requête `…/remote/reset` n'est partie et le clone a toujours son `origin`
- Limite : le rendu de la confirmation (rôle, description, focus) est aussi vérifié en Vitest : `app/src/screens/Reinitialisation.test.tsx` › `[S-0034-02]`.

### S-0034-03 — Confirmée, l'espace redevient neuf et le dépôt distant n'a pas bougé
Plan 0034, critère 3 · Test : `app/e2e/reinitialisation.spec.ts` › `[S-0034-03]`
- **Étant donné** la confirmation ouverte de S-0034-02
- **Quand** je clique « Confirmer la réinitialisation »
- **Alors** « Rattachement réinitialisé. Seule la copie locale a changé : le dépôt distant n'a pas été modifié. » s'affiche, la confirmation et l'alerte disparaissent, le champ d'adresse est vide et focalisé, la région « Dépôt Git de l'espace » dit « Pas encore de dépôt distant » ; axe-core ne relève aucune violation sérieuse ou critique
- **Et** le clone n'a plus de remote ni de section `remote.origin`, son `HEAD` n'a pas bougé, les références des trois dépôts nus sont identiques avant et après, et l'API rend `git_remote` vide, `account: anna.k`, `role: referent`
- Limite : « rien à faire » (second appel, clone déjà neuf) est un succès dit comme tel, rendu en Vitest (`app/src/screens/Reinitialisation.test.tsx` › `[S-0034-03]`) ; l'idempotence et l'absence de réseau sont des tests core (`core/tests/repo/test_reset_remote.py`).

### S-0034-04 — Un commit d'identité déjà fusionné est défait, le créateur reste référent
Plan 0034, critère 4 · Test : `app/e2e/reinitialisation.spec.ts` › `[S-0034-04]`
- **Étant donné** une publication d'Atlas sous le login « claire-m » fusionnée en local (la gouvernance locale désigne claire-m, le registre garde anna.k), le rattachement ayant échoué ensuite
- **Quand** je rattache ce dépôt, lis « Rattachement interrompu », puis réinitialise
- **Alors** la gouvernance est relue : le tableau « Utilisateurs et rôles » montre anna.k Référent, claire-m n'y figure plus, la barre latérale dit « Référent d'annuaire »
- **Et** un commit « Identité du créateur : claire-m redevient anna.k » ramène l'arbre d'avant l'identité (historique non réécrit), le clone est propre, sans `origin` ni référence distante ; la publication reste intacte sur le dépôt distant ; l'API rend `role: referent`, `space_referent: true`
- Limite : le commit de retour (commits de l'utilisateur au-dessus), les modifications d'autres fichiers conservées, le commit retrouvé au-delà de 200 commits de gouvernance, le refus `identity_not_found` (commit non reconnu, autre référent) et la reprise après un essai interrompu sont des tests core (`core/tests/repo/test_reset_remote.py`), avec la provenance (un renommage manuel sous un autre message n'est pas défait) et l'index des autres fichiers conservé ; l'écran relit la gouvernance (toujours, même pour « rien à faire »), garde le brouillon sans renommage d'identité et ne le jette, avec la bannière « Modifications non reprises », que si le compte local y figure déjà ou si la gouvernance lue a changé : Vitest, `app/src/screens/Reinitialisation.test.tsx` › `[S-0034-04]`.

### S-0034-05 — Un refus de la réinitialisation s'explique dans la confirmation
Plan 0034, critère 5 · Tests : `app/e2e/reinitialisation.spec.ts` › `[S-0034-05]` ; Vitest : `app/src/screens/Reinitialisation.test.tsx` › `[S-0034-05]` (deux tests)
- **Étant donné** un espace dont le clone a un `origin` d'une autre adresse (refus « Adresse origin différente » au rattachement) et la confirmation de réinitialisation ouverte
- **Quand** je confirme, le serveur de test répondant d'abord `remote_exists`, puis `reset_incomplete`, puis (réponse réelle) `workspace_dirty` parce que `governance.yaml` du clone porte une modification non enregistrée
- **Alors** chaque fois « La réinitialisation n'a pas abouti » s'affiche dans la confirmation, qui reste ouverte : le message du serveur pour `remote_exists` (« Atlas ne le détache pas »), la consigne traduite pour `reset_incomplete` (« Réinitialisation interrompue », « Relancez la réinitialisation »), et pour `workspace_dirty` le message du serveur nommant `governance.yaml` ; jamais de sortie de git ni de secret
- **Et** la bannière d'origine et son bouton restent derrière la confirmation, le clone garde son `origin`, axe-core ne relève aucune violation sérieuse ; la modification annulée, un nouvel essai réussit, ferme la confirmation et le clone n'a plus de remote
- Limite : `remote_exists` et `reset_incomplete` sont simulés (`page.route`), faute de pouvoir les fabriquer depuis l'écran ; seul `workspace_dirty` vient du serveur. Les gardes avant écriture (gouvernance dans l'index, conflit, `MERGE_HEAD`, autre branche, `HEAD` détachée) et le refus d'un espace rattaché sont des tests core : `core/tests/repo/test_reset_remote.py`. Le refus d'un espace rattaché est aussi vérifié par S-0034-08.

### S-0034-06 — Le formulaire est gelé pendant la réinitialisation
Plan 0034, critère 6 · Tests : `app/e2e/reinitialisation.spec.ts` › `[S-0034-06]` ; Vitest : `app/src/screens/Reinitialisation.test.tsx` › `[S-0034-06]` (deux tests)
- **Étant donné** l'Administration d'un espace dont le rattachement est refusé (origin différent)
- **Quand** j'ouvre la modification d'un membre
- **Alors** « Réinitialiser le rattachement » est désactivé ; il redevient actif quand j'annule la modification
- **Quand** je confirme la réinitialisation, la requête étant retenue par le test (`page.route`)
- **Alors** « Réinitialisation de la copie locale… » s'affiche ; « Confirmer la réinitialisation », « Annuler », la case « Databricks », le champ d'adresse et « Rattacher le dépôt » sont désactivés, Échap ne ferme pas la confirmation, et axe-core ne relève aucune violation sérieuse
- **Et** la requête relâchée, le message de succès s'affiche, la confirmation disparaît, les champs redeviennent actifs et une seule demande de réinitialisation est partie
- Limite : le verrou du clone (attente d'un rattachement en cours) est un test core (`core/tests/repo/test_reset_remote.py`).

### S-0034-07 — Le panneau de création propose aussi la réinitialisation
Plan 0034, critère 7 · Tests : `app/e2e/reinitialisation.spec.ts` › `[S-0034-07]` ; Vitest : `app/src/screens/Reinitialisation.test.tsx` › `[S-0034-07]`
- **Étant donné** le panneau « Créer un espace » avec une adresse de dépôt vide, où un `origin` d'une autre adresse est glissé dans le clone entre sa création et le rattachement (le test le pose dans le gestionnaire de la requête de rattachement)
- **Quand** je crée l'espace
- **Alors** le panneau dit « Espace créé, dépôt distant non rattaché » ; « Adresse origin différente » n'est détaillé qu'une fois, dans le groupe, avec son bouton « Réinitialiser le rattachement » ; axe-core ne relève aucune violation sérieuse
- **Quand** j'ouvre la confirmation puis appuie sur Échap
- **Alors** la confirmation se ferme sans fermer le panneau, et le focus revient au bouton
- **Quand** je confirme
- **Alors** le champ d'adresse est vide, le panneau dit « Rattachement réinitialisé. » et « Le rattachement a été réinitialisé. », l'ancienne erreur a disparu, le clone n'a plus de remote et les dépôts nus du test n'ont pas bougé

### S-0034-08 — Juste après, un autre dépôt vide se rattache ; un espace rattaché n'est pas réinitialisable
Plan 0034, critère 8 · Test : `app/e2e/reinitialisation.spec.ts` › `[S-0034-08]`
- **Étant donné** l'espace réinitialisé de S-0034-03
- **Quand** je rattache un autre dépôt vide
- **Alors** la région affiche « Dépôt rattaché : l'espace est publié sur <adresse>, sous le compte anna.k. », le dépôt n'a que le commit « Création de l'espace … », et le premier dépôt, abandonné, est intact
- **Quand** j'appelle la route de réinitialisation sur cet espace rattaché
- **Alors** la réponse est 409 `remote_exists` et le clone garde son `origin`
- Le second test fait de même après le scénario S-0034-04 : le dépôt reçoit le commit d'avant l'identité et le créateur reste référent.

### S-0034-10 — Un espace à moitié rattaché rouvert se répare depuis la coque, sans l'Administration
Plan 0034, critère 10 · Test : `app/e2e/reinitialisation.spec.ts` › `[S-0034-10]`
- **Étant donné** une publication d'Atlas sous le login « claire-m » fusionnée en local (la gouvernance locale désigne claire-m, le registre garde anna.k) : l'API rend `attachment: "interrupted"`, `space_referent: false`, et l'Administration répond 403
- **Quand** je rouvre l'espace (retour à l'accueil, puis catalogue)
- **Alors** la bannière « Le rattachement de cet espace à un dépôt a été interrompu. » s'affiche ; la navigation n'a pas « Administration » ni le lien « Reprendre le rattachement » ; axe-core ne relève aucune violation sérieuse ou critique
- **Quand** je place le focus sur « Réinitialiser le rattachement » et appuie sur Entrée
- **Alors** la confirmation s'ouvre avec le focus sur « Annuler » ; Échap la ferme et rend le focus au bouton
- **Quand** je rouvre la confirmation et clique « Confirmer la réinitialisation »
- **Alors** « Rattachement réinitialisé. Seule la copie locale a changé : le dépôt distant n'a pas été modifié. » s'affiche, la bannière disparaît, la barre latérale dit « Référent d'annuaire » et le lien « Administration » est de retour
- **Et** l'API rend `attachment: null`, `space_referent: true`, l'Administration répond 200, le clone n'a plus de remote, son arbre est celui d'avant l'identité et le dépôt distant est intact ; après rechargement, la bannière ne revient pas
- Limite : la bannière pour un lecteur, le lien « Reprendre le rattachement » réservé au référent et l'absence de bannière sans reste sont rendus en Vitest (`app/src/screens/Reinitialisation.test.tsx` › `[S-0034-10]`). L'indicateur dans chacun de ses états (origin résiduel, identité fusionnée, espace rattaché, gouvernance inexpliquée, clone tenu par une opération) et la route de réinitialisation sans rôle de référent sont des tests core (`core/tests/repo/test_reset_remote.py`).

## Hors ligne

**Plan 0019**

### S-0019-04 — Hors ligne, ouvrir l'espace, le catalogue et compiler
Plan 0019, critère 4 · Test : `app/e2e/hors-ligne.spec.ts` › `[S-0019-04]`
- **Étant donné** Groupe Nordis déjà rejoint, et toute requête du navigateur hors `localhost` et `127.0.0.1` interrompue
- **Quand** je pars de l'accueil, ouvre Groupe Nordis, Revenu net, « Proposer une modification », puis l'onglet « SQL compilé »
- **Alors** le catalogue et la fiche s'ouvrent, et le SQL Databricks puis le SQL Snowflake contiennent `SELECT`
- Limite : seul le navigateur est coupé du réseau ; le serveur Python ne l'est pas. Le binaire figé hors ligne est vérifié par `core/tests/test_sidecar.py::test_frozen_binary_works_offline`.

## Parcours de bout en bout

`app/e2e/bout-en-bout.spec.ts` : des histoires qui traversent plusieurs écrans et plusieurs comptes, sur les faux services. Chaque compte a son serveur (anna.k sur le serveur principal, claire.m, marc.d et julien.h sur les leurs) ; une page de plus du même contexte, dont les appels sont relayés vers le serveur du compte, joue ce compte. Chaque test a ses espaces et ses dépôts nus, sans ordre ni état partagé. Chaque étape se contrôle deux fois, à l'écran et dans le dépôt (fichiers, messages de fusion, tags), et axe-core ne relève aucune violation sérieuse ou critique aux étapes clés.

**Plan 0035**

### S-0035-01 — Une équipe s'installe : du dépôt vide au premier KPI relu à deux
Plan 0035, critère 1 · Test : `app/e2e/bout-en-bout.spec.ts` › `[S-0035-01]`
- **Étant donné** anna.k, qui crée l'espace « Perrault » (entités perrault-fr et perrault-it) et un dépôt nu vide ; claire.m et marc.d ont chacun leur serveur
- **Quand** elle rattache le dépôt, ajoute le domaine Finance, invite Claire M. (référente du domaine) et Marc D. (validateur du domaine), fixe deux validations pour le canonique, autorise Databricks et enregistre
- **Alors** « Paramètres enregistrés : proposition n° N fusionnée sans revue. » s'affiche et `governance.yaml` du dépôt porte le domaine, les deux comptes et la plateforme
- **Quand** elle crée, authentifie par OAuth, teste et propose le point d'accès `dbx-perrault`, puis le fusionne
- **Alors** la proposition se fusionne « sans revue : aucun autre compte habilité », le message de fusion dit `Atlas-Review: none (no other eligible approver)`, le dépôt contient le point d'accès et la page ne garde aucun jeton
- **Quand** Claire et Marc rejoignent le dépôt depuis leur poste
- **Alors** leurs rôles viennent de la gouvernance publiée : claire.m « référent » sans être référente d'espace, marc.d « validateur »
- **Quand** Anna propose le KPI « Chiffre d'affaires » (domaine Finance), puis que Claire et Marc l'approuvent chacun depuis leur écran
- **Alors** la barre latérale de Claire annonce une proposition « en attente de votre revue », la file d'Anna dit « Validations : 2 / 2 · prête à fusionner », et sa fusion écrit `kpis/chiffre-affaires.yaml`, le message `Atlas-Proposal: N` et `Atlas-Review: approved by claire.m, marc.d`, et le tag `doc/chiffre-affaires/v1`
- **Et** le catalogue d'Anna montre le KPI sous Finance, et sa fiche dit « v1 · validée le … »
- Limite : le même parcours avec un vrai dépôt GitHub (S-0035-11) ne peut pas tourner : le faux GitHub n'a pas d'API de pull request. Le rattachement GitHub seul est S-0033-03 et S-0033-04. Après la fusion, ce que Claire et Marc voient de la v1 dans leur catalogue dépend de la synchronisation d'un compte qui n'a pas fusionné : S-0035-10.

### S-0035-02 — Un KPI relu à deux : changements demandés, réponse, correction, nouvelle approbation, fusion
Plan 0035, critère 2 · Test : `app/e2e/bout-en-bout.spec.ts` › `[S-0035-02]`
- **Étant donné** Groupe Nordis isolé, Claire et Marc ayant rejoint le dépôt, et Anna qui a proposé le KPI Finance « Taux de recouvrement »
- **Quand** Claire demande des changements en disant lesquels
- **Alors** son écran et celui d'Anna montrent « Claire M. demande des changements » et « Changements demandés par claire.m. », avec le commentaire
- **Quand** Anna répond dans le fil, corrige la définition sur la branche de la proposition (commit poussé avec git) et que Marc approuve la nouvelle version
- **Alors** la file dit « Validations : 1 / 2 », le blocage de Claire demeure, la fusion demandée à l'API est refusée (409 `not_ready`) et la branche principale n'a pas bougé
- **Quand** Claire approuve à son tour la nouvelle version
- **Alors** sa demande est remplacée, la proposition est prête, elle la fusionne : le dépôt a la définition corrigée, le message `Atlas-Review: approved by claire.m, marc.d` et le tag `doc/taux-de-recouvrement/v1`
- **Et** chez Claire, qui a fusionné, le catalogue dit v1 et la fiche montre la définition corrigée ; chez Anna, la proposition figure parmi les fusionnées
- Limite : l'écran n'a pas de route pour réviser ou fermer une proposition (« Reste à faire » du plan 0006) : la correction passe par un commit poussé à la main sur la branche. Les approbations données avant ce commit ne comptent plus (S-0006-03).

### S-0035-03 — Revenu net de v4 à v5, avec deux KPI qui s'y appuient
Plan 0035, critère 3 · Test : `app/e2e/bout-en-bout.spec.ts` › `[S-0035-03]`
- **Étant donné** Groupe Nordis isolé, dont Marge brute et Panier moyen référencent Revenu net v4
- **Quand** Anna ouvre la fiche (« Une nouvelle version touchera 2 documents. »), choisit « Proposer une modification », change le libellé du filtre n02 et soumet
- **Alors** la proposition apparaît à côté de celle de julien.h (même titre, auteure « Anna K. »), son diff montre un seul écart « Sans effet »
- **Quand** Marc puis Claire approuvent et que Claire fusionne
- **Alors** le dépôt a `version: 5` et le nouveau libellé, le tag `doc/revenu-net/v5`, la trace des deux revues, et aucun changement dans `kpis/marge-brute.yaml`, `kpis/panier-moyen.yaml` ni `variants/`
- **Et** chez Claire, le catalogue dit v5 pour Revenu net et v2 pour Marge brute, l'onglet Versions compte 5 versions dont la v5 courante, le diff de v4 à v5 est un écart « Sans effet » et le graphe de la v5 porte le nouveau libellé, et « Référencé par » liste toujours Panier moyen et Marge brute
- Limite : les références restent épinglées sur la v4 : l'écran n'indique pas qu'elles sont en retard sur la v5 (constat, pas un test).

### S-0035-04 — Une règle locale : déclinaison nordis-it en surcharge hors points déclarés
Plan 0035, critère 4 · Test : `app/e2e/bout-en-bout.spec.ts` › `[S-0035-04]`
- **Étant donné** Groupe Nordis isolé, une entité nordis-it ajoutée au dépôt puis synchronisée
- **Quand** Anna crée la déclinaison depuis la fiche de Revenu net, remplace le filtre n02 (hors points déclarés) avec sa justification et soumet
- **Alors** le récapitulatif annonce « Hors points déclarés : la validation canonique s'appliquera » et les validations requises ; la file montre le badge « Hors points déclarés » et « Validations : 0 / 2 (canonique requis) »
- **Quand** Marc approuve
- **Alors** « Validations : 1 / 2 (canonique requis) », pas de bouton « Fusionner » pour Anna, la fusion demandée à l'API est refusée (409) et le dépôt n'a pas de fichier nordis-it
- **Quand** Claire approuve à son tour et fusionne
- **Alors** le dépôt a `variants/revenu-net/nordis-it.yaml` avec la surcharge de n02 et `Atlas-Review: approved by claire.m, marc.d`
- **Et** la fiche de Revenu net compte 4 déclinaisons dont nordis-it en surcharge, et le diff au canonique de nordis-it montre le nœud n02
- Limite : pas de comparaison chiffrée pour nordis-it : les fichiers de données locaux (`core/tests/fixtures/compare/revenu-net`) ne couvrent que nordis-de, nordis-fr et nordis-es.

### S-0035-05 — Se connecter aux trois plateformes, puis comparer les entités
Plan 0035, critère 5 · Test : `app/e2e/bout-en-bout.spec.ts` › `[S-0035-05]`
- **Étant donné** Groupe Nordis isolé, qu'Anna n'a jamais comparé ni connecté
- **Quand** elle se connecte à dbx-fr (OAuth), snow-de (SSO) et snow-es (paire de clés) depuis Mes connexions, et teste dbx-fr
- **Alors** chaque ligne dit « Connecté » avec son mode, « Connexion OK · N ms » s'affiche, la page ne garde aucun jeton ni passphrase, et le catalogue dit « Jamais comparé » pour Revenu net
- **Quand** elle lance la comparaison de Revenu net sur les trois entités
- **Alors** le lancement est accepté (202), puis la matrice : nordis-de 94 % (écart max 6,1 %), nordis-fr 100 %, nordis-es 75 % (écart max 2,9 %)
- **Quand** elle ouvre le détail allemand puis le nœud divergent n02
- **Alors** Sept. 2026 est « +6,1 % hors tolérance » et la fiche de nordis-de s'ouvre sur le diff au canonique avec n02 sélectionné
- **Et** le catalogue ne dit plus « Jamais comparé » (« N divergences »), l'aperçu donne la dernière comparaison, et l'historique la liste avec « nordis-de 94 % · nordis-es 75 % · nordis-fr 100 % »
- Limite : les chiffres viennent des fichiers locaux lus par DuckDB (`ATLAS_COMPARE_DATA`), pas des faux Databricks et Snowflake, qui n'exécutent pas le SQL : les connexions sont réelles pour le coffre et l'écran, pas pour le calcul ; la progression par plateforme n'est pas attendue ici (le calcul local est trop rapide), elle est vérifiée en S-0009-01.

### S-0035-06 — La session OAuth expire : la comparaison attend la reconnexion
Plan 0035, critère 6 · Test : `app/e2e/bout-en-bout.spec.ts` › `[S-0035-06]`
- **Étant donné** un faux Databricks qui rend des jetons périmés et refuse le rafraîchissement
- **Quand** julien.h se connecte à dbx-fr depuis Mes connexions
- **Alors** la ligne dit « Session expirée » et propose « Reconnecter Databricks · dbx-fr »
- **Quand** il prépare la comparaison de nordis-fr et clique le lancement
- **Alors** « Connexion requise » s'affiche avec « Se connecter à dbx-fr », le bouton est marqué indisponible et aucune requête de lancement n'est partie
- **Quand** le faux rend de nouveau des jetons valides et qu'il se reconnecte depuis la comparaison
- **Alors** la fenêtre OAuth confirme, le lancement mémorisé part tout seul (réponse 202, une seule requête), la bannière disparaît et Mes connexions dit « Connecté · session OAuth », sans aucun jeton dans la page
- Limite : le faux Databricks ne calcule pas le SQL : seule la reprise du lancement est vérifiée, pas son résultat (S-0015-04, S-0008-04).

### S-0035-07 — Fusions contrariées : base avancée, branche protégée, puis fusion réussie
Plan 0035, critère 7 · Test : `app/e2e/bout-en-bout.spec.ts` › `[S-0035-07]`
- **Étant donné** Groupe Nordis isolé : la v5 de julien.h déjà approuvée par Marc, et celle d'Anna qu'elle vient de proposer à côté
- **Quand** Claire approuve et fusionne celle de julien.h, puis que Marc et Claire approuvent celle d'Anna
- **Alors** la file d'Anna la dit « prête à fusionner », mais « Fusionner » est refusé (409 `stale_base`) : une alerte « La version de départ a changé » donne le message du serveur (le fichier du KPI a changé depuis la proposition), la branche principale est celle de la fusion de julien.h et la proposition reste ouverte
- **Quand** le dépôt refuse toute écriture sur sa branche principale et qu'Anna fusionne « Taux de service · canonique v3 » (prête)
- **Alors** une alerte « Le dépôt a refusé la fusion » s'affiche, la branche principale n'a pas bougé, Taux de service est toujours en v2 et la proposition reste dans la file
- **Quand** le blocage est levé et qu'elle réessaie
- **Alors** « Proposition n° 2 fusionnée », le dépôt a la v3, le message `Atlas-Proposal: N` et le tag `doc/taux-de-service/v3`
- Limite : la branche protégée est simulée par un hook `pre-receive` du dépôt nu qui refuse `refs/heads/main` ; la règle d'un hébergeur (GitHub, `branch_protected`) n'est pas reproduite.

### S-0035-08 — Hors ligne puis retour : lire, brouillonner, échouer proprement, renvoyer
Plan 0035, critère 8 · Test : `app/e2e/bout-en-bout.spec.ts` › `[S-0035-08]`
- **Étant donné** Groupe Nordis isolé, dont le dépôt distant devient injoignable (le dossier du dépôt nu est déplacé)
- **Quand** Anna recharge la fiche, ouvre le catalogue, puis « Proposer une modification » et saisit une description
- **Alors** la fiche et le catalogue s'affichent depuis la copie locale, l'éditeur enregistre le brouillon « (local) »
- **Quand** elle soumet la proposition
- **Alors** une alerte s'affiche dans le récapitulatif, aucune proposition n'est créée et le dépôt n'a pas de branche de plus
- **Quand** elle ouvre la file des propositions
- **Alors** une alerte « Le dépôt est inaccessible » invite à vérifier le réseau ou l'accès au dépôt, puis à réessayer
- **Quand** le dépôt revient et qu'elle rouvre l'éditeur
- **Alors** la file se relit (5 propositions), le brouillon est intact, le même envoi réussit et le dépôt a une branche de proposition de plus
- Limite : la panne est celle du dépôt distant seul, le navigateur et le serveur local restent en ligne (la coupure réseau du navigateur est S-0019-04).

### S-0035-09 — Deux espaces sur le même poste : rien ne passe de l'un à l'autre
Plan 0035, critère 9 · Test : `app/e2e/bout-en-bout.spec.ts` › `[S-0035-09]`
- **Étant donné** deux espaces issus de la démonstration, « Alpha » où Anna est contributrice et « Bêta » où elle n'est que lectrice, et une approbation de Claire sur une proposition d'Alpha seulement
- **Quand** Anna filtre le catalogue d'Alpha, lit sa file, se connecte à dbx-fr et laisse un brouillon dans l'éditeur
- **Alors** Alpha montre « Validations : 1 / 2 » pour la proposition approuvée, « Connecté · session OAuth » et son brouillon
- **Quand** elle passe à Bêta par le sélecteur d'espaces
- **Alors** le champ de recherche est vide, les 7 documents sont là, la file dit « Validations : 0 / 2 », dbx-fr est « Jamais connecté », ni « Nouveau concept ou KPI » ni « Proposer une modification » ne s'offrent, et l'éditeur d'un document renvoie vers l'écran de lecture
- **Quand** elle revient à Alpha
- **Alors** la connexion et le brouillon sont toujours là ; l'API de Bêta n'a aucun brouillon pour ce document
- Limite : le sélecteur d'espaces mène d'un espace à l'autre sans recharger la page : ce que le test contrôle est qu'aucun état de l'écran, du coffre ou des brouillons ne fuit entre espaces.

### S-0035-10 — Après la fusion d'une collègue, repartir de la version courante
Plan 0035, critère 10 · Test : `app/e2e/bout-en-bout.spec.ts` › `[S-0035-10]`
- **Étant donné** Groupe Nordis isolé, et Claire qui approuve puis fusionne depuis son poste la v5 de julien.h (Marc l'a déjà approuvée)
- **Quand** Anna, contributrice, rouvre le catalogue et la fiche de Revenu net
- **Alors** le catalogue dit v5, la fiche dit « v5 · validée le … » avec 5 versions
- **Quand** elle choisit « Proposer une modification »
- **Alors** le brouillon s'ouvre en « Revenu net : v6 · brouillon »
- Limite : la synchronisation automatique d'un espace (ADR 0049) relit le dépôt à l'ouverture de l'espace et aux changements d'écran, au plus une fois toutes les 30 s : le test s'appuie sur ce comportement sans bouton « Synchroniser ».

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
- **Quand** je place le focus sur « Définition », appuie deux fois sur Tab, puis Entrée, choisis De 3 et À 4 et clique « Afficher les écarts »
- **Alors** le graphe compte sept cartes et aucun champ ; le focus passe à Déclinaisons puis Versions
- **Et** trois écarts s'affichent, et n06 est « ajouté » dans le graphe de la version 4
- Limite : les onglets sont des boutons à `tabIndex={0}` explicite (`app/src/screens/Fiche.tsx`, ADR 0030, révisé) : Tab et Entrée suffisent, sans ⌥Tab, aussi bien sous Chromium (où tout bouton est tabulable) que sous WebKit macOS (où Tab seul sauterait des liens). Le test ne tourne que sous WebKit, le seul moteur où la différence existait ; la note de ⌥Tab dans la « Mise en œuvre » du plan 0026 date d'avant le passage aux boutons. Vue web sous WebKit, pas la fenêtre Tauri.

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
- **Quand** je parcours ses onglets avec Tab et affiche le diff de v3 à v4
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
| S-0009-10 | Annuler laisse `cancelled` et aucune table temporaire | Les tables temporaires ne s'affichent pas ; l'état annulé à l'écran est S-0015-05 | `core/tests/compare/test_compare.py::test_cancel_leaves_cancelled_and_nothing_extracted` ; `core/tests/repo/test_comparisons_api.py::test_cancel_through_the_api` |
| S-0009-11 | À tolérance nulle, deux entiers consécutifs au-delà de 2⁵³ et deux décimaux distincts au-delà de la précision d'un double sont hors tolérance | Calcul de réconciliation : l'écran ne reçoit et n'affiche que des écarts en pourcentage déjà arrondis, jamais les entiers ou décimaux exacts | `core/tests/compare/test_compare.py::test_exact_numeric_reconciliation` |
| S-0009-12 | Deux dimensions décimales distinctes qui donneraient le même double restent deux cellules ; deux représentations de la même valeur se rejoignent | Appariement des cellules côté serveur : l'écran affiche les cellules qu'on lui renvoie, sans refaire l'appariement | `core/tests/compare/test_compare.py::test_precise_decimal_dimensions_do_not_collapse` |
| S-0010-08 | Aucune couleur ou taille en dur hors `tokens.css` | Contrôle statique des sources : un rendu ne prouve pas l'absence de littéraux | `app/src/tokens.test.ts` |
| S-0018-01 | SSO réel sur un compte de test, `test` puis requête agrégée | Compte réel Snowflake ; le faux SSO est exercé par S-0018-02 | `core/tests/connections/test_snowflake.py::test_real_account` (marqué `snowflake`) |
| S-0018-03 | Revenu net, FR sur Databricks et DE sur Snowflake, s'exécute et se réconcilie | Compte réel sur les deux plateformes ; le faux Databricks ne calcule pas le SQL métier | `core/tests/repo/test_snowflake_compare.py::test_comparison_across_databricks_and_snowflake` (instable dans la suite complète, voir le Reste à faire) |
| S-0018-04 | Le contrôle de cardinalité échoue sur Snowflake avec une table dupliquée | Exécution sur Snowflake | `core/tests/repo/test_snowflake_compare.py::test_cardinality_check_fails_on_snowflake` |
| S-0018-05 | Le binaire figé s'authentifie et exécute ; taille sous 200 Mo | CI de release, binaire PyInstaller | `core/tests/test_sidecar.py::test_frozen_binary_authenticates_and_runs` |
| S-0018-06 | Aucun cache de jeton Snowflake sur le poste | Disque du poste, hors du DOM | `core/tests/connections/test_snowflake.py::test_connection_params_never_cache_tokens`, `::test_sso_stores_the_session_in_the_vault_and_no_token_cache` |
| S-0018-07 | Un jeton de session Snowflake recopié par une erreur du connecteur n'est jamais restitué, même coupé par la troncature | Le faux Snowflake ne recopie pas les jetons ; aucun écran ne montre ce canal (le Databricks l'est par S-0008-10) | `core/tests/connections/test_snowflake.py::test_session_tokens_echoed_in_an_error_are_masked`, `::test_connector_translates_with_its_session_tokens` |
| S-0019-01 | Trois installateurs signés ; notarisation macOS | CI de release, certificats réels | `.github/workflows/release.yml` |
| S-0019-02 | Test de fumée du binaire sur chaque plateforme, `_selftest` compris | CI de release | `core/tests/test_sidecar.py::test_frozen_binary_smoke` ; `core/tests/test_release.py::test_selftest_route_is_protected_and_checks_dynamic_imports` ; `.github/workflows/release.yml` |
| S-0019-03 | L'app release démarre en moins de 10 s et ne laisse aucun serveur après fermeture | Fenêtre native Tauri, mesure sur machine de référence | `core/tests/test_sidecar.py::test_frozen_binary_stops_when_the_app_disappears` ; `core/tests/test_release.py::test_server_stops_when_its_parent_disappears` (le temps de démarrage reste une mesure manuelle) |
| S-0019-05 | Taille rapportée, sous le seuil | Artefacts de release | `.github/workflows/release.yml` |
| S-0019-06 | Versions de l'app, du sidecar et de `skifer_atlas.__version__` identiques | Sources de release | `core/tests/test_release.py::test_one_version_for_app_sidecar_and_package` |
| S-0019-07 | La sonde de démarrage n'accepte que le serveur qui prouve connaître le token (HMAC d'un nonce) ; un serveur qui répond 200 à tout est refusé ; un processus arrêté fait échouer vite | Fenêtre native Tauri : la sonde tourne dans la coque Rust, avant l'ouverture de la fenêtre | `app/src-tauri/src/lib.rs` (`cargo test` : vecteurs RFC 4231, vecteur partagé avec le serveur, faux serveurs locaux) ; `core/tests/test_api.py::test_alive_proves_the_token_without_revealing_it`, `::test_alive_proof_matches_the_vector_checked_by_the_shell`, `::test_alive_refuses_a_missing_or_malformed_nonce` ; `scripts/smoke-app.sh` (CI de release) |
| S-0019-08 | `/docs`, `/redoc`, `/openapi.json` répondent 404 ; `/health` exige le token | Logique serveur sans écran : l'interface n'appelle ni l'un ni l'autre sans token (`/health` avec token est exercé par tous les démarrages, S-0010-05) | `core/tests/test_api.py::test_documentation_routes_are_closed`, `::test_documentation_is_served_in_explicit_dev_mode_only`, `::test_health_needs_the_token_and_shows_the_version_only_with_it` ; `core/tests/test_sidecar.py::test_frozen_binary_smoke` |
| S-0019-09 | La CSP de la fenêtre n'autorise que l'application, le serveur local (`127.0.0.1`) et le canal de Tauri | Fenêtre native Tauri : Vite en développement n'envoie aucune CSP, seule la vraie fenêtre l'applique (vérifiée aussi par `vite preview` avec la même CSP en en-tête, voir l'ADR 0041) | `app/src/csp.test.ts` › `[S-0019-09]` |
| S-0021-01 | Division par zéro : `NULL` en DuckDB ; division entière et modulo par zéro aussi | Exécution DuckDB, absente du panneau SQL | `core/tests/compile/test_ecarts.py::test_division_by_zero_is_null_on_duckdb`, `::test_integer_division_and_modulo_keep_their_type` |
| S-0021-07 | Les tests existants restent verts ; les SQL de référence changent délibérément | CI et revue de code | `core/tests/compile/test_compile.py` ; `core/tests/compile/test_ecarts.py` (suite complète en CI) |
| S-0028-03 | Une autre erreur d'ouverture de la base (dossier absent) remonte sans attente | Logique serveur sans écran : aucune action de l'app ne mène à un dossier de base absent | `core/tests/test_dbfile.py::test_other_io_errors_are_not_retried` |
| S-0029-03 | Une base créée avant le plan 0029 s'ouvre ; ses anciennes synthèses n'ont aucune source commune | Logique serveur sans écran : l'app ne crée pas de base ancienne | `core/tests/compare/test_compare.py::test_a_base_from_before_plan_0029_is_migrated` |
| S-0029-04 | `atlas compare … --variants nordis-es` nomme la source commune | Sortie de la CLI, sans écran | `core/tests/compare/test_compare.py::test_cli_compare_lists_common_sources` |
| S-0030-03 | La lecture d'un instant ne dépend pas du fuseau de session ; les trois dialectes rendent les mêmes jours locaux | Exécution sous plusieurs fuseaux de session : l'écran ne fait que montrer le SQL | `core/tests/compile/test_ecarts.py::test_an_instant_is_read_without_the_session_zone`, `::test_the_paris_day_does_not_depend_on_the_session_zone` |
| S-0031-02 | La branche instant Snowflake ne dépend pas du fuseau de session, heure doublée et autre décalage compris | Exécution sous plusieurs fuseaux de session : l'écran ne fait que montrer le SQL | `core/tests/compile/test_ecarts.py::test_a_snowflake_instant_is_read_without_the_session_zone` |
| S-0031-03 | Les trois dialectes rendent les mêmes jours locaux ; aucun SQL Snowflake ne contient `AS TIMESTAMP)` | Exécution DuckDB et SQL de référence, sans écran | `core/tests/compile/test_ecarts.py::test_the_paris_day_does_not_depend_on_the_session_zone`, `::test_no_timestamp_cast_depends_on_the_session`, `::test_no_reference_sql_casts_to_a_session_timestamp` |
| S-0033-09 | Avec un compte GitHub réel, un dépôt vide créé sans README reçoit l'espace ; le créateur y reste référent | Compte GitHub réel : le faux GitHub reproduit la forme documentée de `/user` et de `/repos/…`, pas les droits réels (`permissions`), le SSO d'organisation ni les règles de branche | `core/tests/repo/test_set_remote.py` ; `app/e2e/rattachement.spec.ts` › `[S-0033-04]` |
| S-0034-09 | Avec un compte GitHub réel, la réinitialisation laisse la publication partielle sur le dépôt, qui se vide ou se supprime sur l'hébergeur avant de le réutiliser | Compte GitHub réel : ce que garde l'hébergeur après une publication partielle (branche, historique) et la façon de le vider ne se voient qu'avec un compte réel | `core/tests/repo/test_reset_remote.py` (références du dépôt distant identiques avant et après) ; `app/e2e/reinitialisation.spec.ts` › `[S-0034-03]` |
| S-0035-11 | Le parcours d'une équipe sur un dépôt GitHub réel : rattachement, domaine et membres, premier KPI proposé en pull request, relu à deux comptes GitHub et fusionné | Compte GitHub réel : les pull requests, les revues, les droits d'écriture, la fusion et la protection de branche sont ceux de l'hébergeur. Le faux GitHub (`core/tests/connections/fake_github.py`) ne sert que le device flow, `/user` et la lecture d'un dépôt : sans API de pull request, la suite d'un rattachement GitHub (proposition, revue, fusion) n'a rien à qui parler | `app/e2e/bout-en-bout.spec.ts` › `[S-0035-01]` (même parcours sur dépôts nus locaux) ; `app/e2e/rattachement.spec.ts` › `[S-0033-03]`, `[S-0033-04]` (rattachement GitHub) ; `core/tests/repo/test_githost.py` (hébergeur GitHub simulé) |
| S-0035-12 | Le parcours d'une analyste sur ses vraies plateformes : connexion Databricks et Snowflake réelles, comparaison chiffrée sur des tables de production, dans la fenêtre native Tauri avec le vrai trousseau | Comptes Databricks et Snowflake réels, fenêtre native Tauri, navigateur du système pour l'OAuth et vrai trousseau : l'e2e tourne dans un navigateur de test contre des faux qui n'exécutent pas le SQL, avec un coffre en mémoire | `app/e2e/bout-en-bout.spec.ts` › `[S-0035-05]`, `[S-0035-06]` (mêmes écrans, faux services) ; `core/tests/test_sidecar.py` |
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
