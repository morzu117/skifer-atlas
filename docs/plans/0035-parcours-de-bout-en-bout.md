# Plan 0035 — Parcours de bout en bout

## Objectif

Une seconde couche de tests, au-dessus des specs par écran : des histoires que des personnes vivent vraiment, d'un écran à l'autre et à plusieurs comptes (créer une équipe, relire un KPI, le faire évoluer, comparer, se faire refuser une fusion, perdre le réseau). Chaque histoire est contrôlée deux fois à chaque étape clé : ce que la personne voit, et ce que le dépôt contient vraiment. L'équipe ne fait pas de recette à la main : ce qui tourne sur les faux services se teste ici.

## Périmètre

**Dedans** : un fichier de parcours, `app/e2e/bout-en-bout.spec.ts`, dix tests (un par critère) ; des comptes distincts, chacun sur son serveur Atlas ; des dépôts nus locaux isolés par test ; les faux Databricks et Snowflake ; axe-core aux étapes clés. Les écarts constatés (voir « Constats ») sont consignés ici, non contournés dans les tests.

**Dehors** : tout code applicatif (core et app) ; un compte réel GitHub, Databricks ou Snowflake ; la fenêtre native Tauri et le trousseau réel ; la corrélation des chiffres de comparaison avec une plateforme (ils viennent de fichiers locaux lus par DuckDB) ; les parcours qui ne feraient que rejouer un écran déjà couvert (l'extraction SQL, par exemple : S-0004-01 et S-0012-04).

## Références

Brief §4 à §10 ; plans 0005 (espaces), 0006 et 0014 (propositions, revues), 0008, 0016 et 0018 (connexions), 0009 et 0015 (comparaison), 0011 à 0013 (catalogue, fiche, éditeur), 0017 (administration), 0019 (hors ligne), 0032 à 0034 (déclinaisons, rattachement, réinitialisation) ; ADR 0008 (seul habilité), 0035 (un fetch à la fois par clone). Fichiers : `app/e2e/bout-en-bout.spec.ts`, `app/e2e/isolation.ts`, `app/e2e/demo.ts`, `app/playwright.config.ts`, `docs/tests/scenarios.md`.

## Spécification

### Comptes et isolation

- Un compte, un serveur Atlas, comme un poste par personne (`playwright.config.ts`) : anna.k sur le serveur principal (contributrice de Groupe Nordis, référente des espaces qu'elle crée), claire.m (référente Finance), marc.d (validateur Finance) et julien.h (référent de l'espace) sur les leurs. Une page supplémentaire du même contexte de navigateur, dont les appels vers le serveur principal sont relayés vers le serveur du compte (`relay`, `app/e2e/isolation.ts`), joue ce compte. Chaque compte rejoint le dépôt de l'espace comme sur son poste (`POST …/workspaces/join`).
- Chaque test crée ses espaces et ses dépôts : la copie de démonstration isolée (`isolatedDemo`, cinq propositions ouvertes et trois points d'accès) ou un espace créé depuis l'interface (`trackWorkspace`). À la fin, la fixture retire les espaces du registre de tous les serveurs et supprime les dossiers. Aucun test ne lit l'état laissé par un autre ni ne dépend de l'ordre.
- Aucun test ne touche au vrai dossier de données ni au vrai trousseau (`ATLAS_DATA_DIR`, `ATLAS_VAULT=memory`).

### Double contrôle

Chaque étape clé vérifie l'écran (titre, bouton, message, ligne de tableau) et l'effet réel : fichier de la branche principale du dépôt nu, message de fusion (`Atlas-Proposal`, `Atlas-Review`), tag `doc/<id>/v<n>`, absence de commit quand une fusion échoue, état du serveur d'un autre compte. Les écritures faites « comme un collègue » (commit poussé sur la branche d'une proposition, entité ajoutée au dépôt, hook qui refuse la branche principale) se font avec git sur le dépôt nu, jamais en contournant l'API d'Atlas pour ce qui est l'objet du test.

### Les dix parcours

1. **Une équipe s'installe.** anna.k crée l'espace « Perrault », le rattache à un dépôt vide, ajoute le domaine Finance, invite claire.m (référente du domaine) et marc.d (validateur), exige deux validations pour le canonique, autorise Databricks, crée et fusionne le point d'accès Databricks (seule référente d'espace : fusion sans revue), puis propose son premier KPI. Claire et Marc, chacun chez eux, l'approuvent ; Anna le fusionne. Écrans : création d'espace, Administration, Connexions, éditeur, Propositions, catalogue, fiche. Rôles : référente d'espace, référente et validateur de domaine.
2. **Un KPI relu à deux.** Anna propose un KPI Finance. Claire demande des changements ; Anna répond dans le fil et corrige la branche avec git ; Marc approuve la nouvelle version ; la demande de Claire bloque encore la fusion ; Claire approuve à son tour et fusionne. Écrans : éditeur, Propositions (fil, revues), fiche, catalogue. Rôles : contributrice, référente, validateur.
3. **Revenu net passe de v4 à v5.** Anna change le libellé d'un filtre ; Marc et Claire relisent ; Claire fusionne. Le dépôt n'a changé que pour Revenu net, ses déclinaisons et ses dépendants restent inchangés ; la fiche montre la v5, l'écart « Sans effet » et les dépendants. Écrans : fiche, éditeur, Propositions, Versions, Dépendances.
4. **Une règle locale.** Anna crée la déclinaison nordis-it de Revenu net et remplace un filtre hors des points déclarés : la validation canonique (deux comptes) s'applique, annoncée dès le récapitulatif. Marc approuve (insuffisant), Claire approuve et fusionne. Écrans : fiche, éditeur, récapitulatif, Propositions, Déclinaisons, diff au canonique.
5. **Se connecter, puis comparer.** Anna se connecte aux trois points d'accès (OAuth, SSO, paire de clés), compare Revenu net sur trois entités, ouvre le détail et le nœud divergent, retrouve le résultat dans le catalogue et l'historique. Écrans : Connexions, catalogue, Comparaison, fiche (diff), historique.
6. **La session expire.** julien.h se connecte, obtient une session aussitôt expirée, voit « Session expirée », se heurte à « Connexion requise » dans la comparaison, se reconnecte ; le lancement mémorisé part seul. Écrans : Connexions, Comparaison.
7. **Des fusions contrariées.** Une proposition devenue périmée (une autre fusion est passée avant) est refusée sans toucher à la branche ; une branche protégée fait refuser une fusion prête ; une fois le blocage levé, la même fusion passe. Écrans : Propositions (alertes), dépôt.
8. **Hors ligne puis retour.** Le dépôt distant disparaît : la lecture reste possible, le brouillon est gardé, l'envoi est refusé en le disant et ne crée rien ; au retour, le même envoi réussit. Écrans : fiche, catalogue, éditeur, récapitulatif, Propositions.
9. **Deux espaces sur le même poste.** Anna est contributrice dans l'un, lectrice dans l'autre ; filtre, revues, connexions, brouillons et droits ne passent pas de l'un à l'autre. Écrans : accueil (sélecteur), catalogue, Propositions, Connexions, fiche, éditeur.
10. **Après la fusion d'une collègue.** Claire fusionne depuis son poste ; Anna retrouve la v5 dans son catalogue et sa fiche, et sa prochaine modification s'ouvre en v6.

### Parcours écartés

- **Le parcours d'une équipe sur un dépôt GitHub réel** (S-0035-11) : rattachement GitHub, domaine, membres, premier KPI en pull request, revues de deux comptes GitHub, fusion. Le faux GitHub (`core/tests/connections/fake_github.py`) ne sert que le device flow, `/user` et la lecture d'un dépôt ; il n'a ni pull request, ni revue, ni fusion, et les autres serveurs de test n'ont pas de jeton GitHub. Le même parcours sur des dépôts nus est le parcours 1 ; le rattachement GitHub seul est S-0033-03 et S-0033-04.
- **Le parcours sur de vrais comptes Databricks et Snowflake, dans la fenêtre Tauri** (S-0035-12) : les faux n'exécutent pas le SQL, l'e2e tourne dans un navigateur de test avec un coffre en mémoire. Les parcours 5 et 6 couvrent les mêmes écrans.
- **L'extraction d'un script SQL vers un graphe, puis le diff** : rejouerait S-0004-01 et S-0012-04 sans traverser d'autre écran ni d'autre compte.

### Constats

Écarts relevés en concevant les parcours. Ils ne sont pas contournés dans les tests.

1. **Un compte qui n'a pas fusionné ne suivait pas la branche principale** (parcours 10 : le catalogue d'Anna disait « v4 » alors que le dépôt était en v5). Cause : les routes de lecture indexaient `head(repo)`, le commit de la copie locale, que seuls « Synchroniser » (référent d'espace), la création et la fusion d'une proposition avançaient. Corrigé par l'issue 169 (ADR 0049 : synchronisation automatique à l'ouverture d'un espace et aux changements d'écran, au plus une fois toutes les 30 s par espace). Le parcours 10 passe.
2. **`stale_base` et `fetch_failed` n'avaient pas de traduction** : l'alerte portait le titre générique et le texte brut du serveur. Corrigé par l'issue 170 (`app/src/messages.ts`) : « La version de départ a changé » et « Le dépôt est inaccessible ». Les parcours 7 et 8 vérifient ces messages.
3. **Une proposition ne se révise ni ne se ferme depuis l'écran** (« Reste à faire » du plan 0006) : après des changements demandés, l'auteur ne peut que pousser un commit sur la branche avec git (parcours 2).
4. **Une référence épinglée en retard n'est pas signalée** : après la v5 de Revenu net, Panier moyen et Marge brute pointent toujours la v4 sans indication à l'écran (parcours 3). C'est le comportement voulu des références épinglées ; seul le signal manque.

## Critères d'acceptation

1. Une équipe part d'un espace neuf et d'un dépôt vide : domaine, membres, point d'accès, puis premier KPI relu et fusionné par trois comptes, avec le fichier, les messages de fusion et le tag dans le dépôt.
2. Une demande de changements bloque la fusion jusqu'à ce que son auteure approuve de nouveau ; le fil, la correction poussée sur la branche et les approbations se suivent à l'écran de chaque compte, et la fusion laisse la trace des deux revues.
3. Une v5 de Revenu net, fusionnée par deux relectures, change le canonique et rien d'autre dans le dépôt ; la fiche montre la v5, l'écart et les dépendants.
4. Une déclinaison locale hors points déclarés exige la validation canonique, annoncée avant l'envoi ; une validation ne suffit pas, deux fusionnent, et la fiche compte la nouvelle déclinaison.
5. Une personne connectée aux trois points d'accès compare Revenu net : matrice, détail, nœud divergent, catalogue et historique racontent la même comparaison.
6. Une session expirée est dite telle, bloque la comparaison avec « Connexion requise », et la reconnexion reprend le lancement mémorisé, une seule fois.
7. Une proposition périmée et une fusion refusée par le dépôt sont dites sans rien fusionner et restent ouvertes ; la fusion passe quand le blocage est levé.
8. Dépôt injoignable : la lecture et le brouillon restent, l'envoi échoue en le disant sans créer de proposition ; au retour, le même envoi réussit.
9. Deux espaces sur un poste ne partagent ni filtre, ni revue, ni connexion, ni brouillon ; les droits sont ceux de chaque espace.
10. Après la fusion d'une collègue, le catalogue et la fiche d'une contributrice montrent la version courante et sa prochaine modification s'ouvre sur cette version.

## Tests

- Parcours : `app/e2e/bout-en-bout.spec.ts` (10 tests, scénarios S-0035-01 à S-0035-10, un par critère). Chaque test a ses espaces et ses dépôts, retirés à la fin ; il se lance seul.
- Non automatisés, avec leur raison : S-0035-11 (compte GitHub réel : pull requests, revues, fusion) et S-0035-12 (comptes Databricks et Snowflake réels, fenêtre Tauri), dans « Sans test front, et pourquoi » de `docs/tests/scenarios.md`.
- Les limites de chaque parcours (hook `pre-receive` qui simule la branche protégée, chiffres de comparaison locaux, correction poussée avec git) sont dites dans leur scénario.

## Dépendances

0005 à 0034, surtout 0006, 0014 (revues), 0008, 0016, 0018 (connexions), 0015 (comparaison), 0017 (administration), 0032, 0033.

## Estimation

**M**. La difficulté est dans l'orchestration : plusieurs comptes sur des serveurs distincts, des états de dépôt à préparer à la main et des attentes d'écran longues (créer un KPI dans l'éditeur, relire à deux).
