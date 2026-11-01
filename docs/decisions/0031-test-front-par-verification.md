# ADR 0031 — Un scénario et un test front par vérification

Date : 2026-11-01 · Statut : **acceptée** (mise en œuvre du plan 0027)

## Contexte

Les critères d'acceptation des plans étaient vérifiés à des niveaux différents : pytest, Vitest, Playwright, ou à la main. Rien ne disait quel test couvrait quel critère, ni ce qui restait vérifié seulement à la main. Le « Reste à faire » accumulait les vérifications « sous Tauri ».

## Décision

- **Chaque vérification a un scénario écrit et un test front.** Une vérification est un critère d'acceptation d'un plan, ou une vérification à la main du « Reste à faire ».
  - Le test front rend l'écran : un parcours Playwright, ou à défaut un test de composant Vitest.
  - Un test core seul ne suffit pas.
- **Catalogue unique : `docs/tests/scenarios.md`.** Les scénarios y sont classés par écran, au format « Étant donné / Quand / Alors ». Chacun décrit ce que le test vérifie réellement, avec une ligne « Limite » quand le test vérifie moins que le critère.
- **Identifiants `S-<plan>-<critère>` et `S-RAF-<nn>`.**
  - Le titre d'un test commence par les identifiants qu'il couvre, entre crochets.
  - Un test se cite par son fichier et son identifiant, jamais par le reste de son titre.
- **Deux sections finales pour les vérifications sans test front :**
  - « Sans test front, et pourquoi » : rien ne l'affiche à l'écran (compte réel, fenêtre native, CI de release, revue produit, logique sans écran). La ligne donne la raison et le test qui la couvre malgré tout.
  - « Sans test front, testable » : un écran la montre, mais aucun test ne la vérifie encore. C'est une dette à résorber.
- **Chaque plan livre ses scénarios et ses tests front.** Les tests front sont écrits par un agent distinct de celui qui code la fonctionnalité (Codex), puis lancés et validés avant la PR.
- **Une nouvelle spec qui modifie un dépôt travaille sur sa propre copie de la démonstration** (`app/e2e/isolation.ts`), pour ne pas changer ce que voient les autres. La copie est jointe au serveur du compte que joue le test, 8793 le plus souvent. Les identifiants créés sont uniques.
  - Depuis le lot testables du 1er novembre 2026, `propositions.spec.ts` et `editor.spec.ts` utilisent une copie par test ; `isolation.ts`, après chaque test et même en échec, retire les espaces isolés du registre de chaque serveur et supprime leurs dossiers temporaires.
  - `accueil`, `catalogue`, `comparaison`, `connexions` et `administration` conservent des séquences en série. Les serveurs restent ceux configurés pour le compte du parcours (8799 pour Anna, 8798 et 8797 pour les relecteurs, 8795 et 8793 pour Julien, 8793 pour les parcours OAuth).

## Conséquences

- La couverture se lit dans le tableau de synthèse du catalogue.
- Écrire les scénarios a révélé deux défauts, corrigés avec le plan 0027 :
  - l'éditeur plantait sur un type de nœud inconnu ;
  - l'historique des comparaisons répondait 500 au premier accès simultané.
- Nouveaux serveurs de test : 8791 (accueil isolé), 8792 (faux GitHub), 8793 (sans `ATLAS_COMPARE_DATA`, pour l'OAuth à la comparaison et les dépôts isolés). Les ports e2e sont 1420, 8020 et 8791 à 8799.
