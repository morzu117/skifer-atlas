# Plan 0026 — Parcours WebKit de bout en bout

## Objectif
Automatiser dans le moteur WebKit les parcours des plans 0010 à 0016 et le graphe volumineux du plan 0024, pour préparer les vérifications sous Tauri macOS.

## Périmètre
**Dedans** : app Vite, vrais serveurs Python de démonstration, faux Databricks, interactions clavier et souris, popup OAuth, accessibilité axe.
**Dehors** : enveloppe native Tauri, services de plateforme réels et validation métier avec un utilisateur.

## Spécification
- Le projet `webkit` exécute les fichiers `*.webkit.spec.ts` après Chromium, sur les mêmes serveurs.
- Les créations portent un identifiant unique ; les brouillons de test sont des copies de Revenu net et sont supprimés après démontage de l'éditeur.
- Les lectures ne dépendent ni du nombre d'espaces, ni du nombre de propositions, ni de l'historique des comparaisons. La proposition FR est consultée sans écriture ; Chromium modifie la proposition DE.
- La comparaison attend l'identifiant rendu par son propre lancement.
- L'OAuth utilise un nouveau point d'accès temporaire, attend `popup`, vérifie sa requête de navigation vers le faux Databricks, puis le retour local réussi.
- `seriousViolations` vérifie chaque écran et les principaux états ouverts. Aucun seuil d'accessibilité n'est assoupli.

## Critères d'acceptation
1. Créer et ouvrir un espace, puis basculer vers Nordis et revenir par le sélecteur d'espace.
2. Obtenir Date de référence avec « reference » et « référence », puis ouvrir une fiche depuis la liste au clavier.
3. Lire le graphe, parcourir les onglets au clavier et afficher le diff v3 → v4.
4. Sélectionner et déplacer un nœud de Revenu net ; supprimer un nœud, puis le retrouver avec Cmd/Ctrl+Z (l'annulation porte sur le document, ADR 0017).
5. Sur 200 nœuds, dessiner moins de 200 cartes, sélectionner et déplacer une carte visible.
6. Ouvrir une proposition et son diff sans requête d'écriture.
7. Lancer une comparaison et ouvrir le détail FR de cette exécution.
8. Ouvrir une popup vers le faux Databricks et constater le retour OAuth réussi.
9. Ne relever aucune violation axe sérieuse ou critique sur les écrans parcourus.

## Tests
`app/e2e/parcours.webkit.spec.ts` : huit scénarios, axe intégré à chacun. Les deux tests de `rendu.webkit.spec.ts` restent en place. `app/e2e/graphe.ts` partage la construction du graphe avec `graphe-volumineux.spec.ts`.

Depuis `app/` : `npx playwright test --project=webkit`, puis `npm run e2e` sans exécutions concurrentes ; `npm test`, `npx tsc --noEmit -p .`, `npm run build`.

## Dépendances
0010–0016, 0024 ; navigateurs Playwright Chromium et WebKit installés, ports 8794–8799, 8020 et 1420 libres.

## Estimation
**S**.

## Mise en œuvre (31 octobre 2026)

- **Écrit par Codex, validé ici.** Les scénarios ont été rédigés par l'agent Codex, dont le bac à sable empêchait de lancer les navigateurs. Le premier passage réel a fait apparaître trois écarts, tous dans les tests :
  - Tab seul ne passe pas par les liens sous WebKit macOS : ⌥Tab pour les onglets de la fiche (ADR 0030) ;
  - ⌘Z n'annule pas un déplacement, par conception (ADR 0017) : le critère 4 vérifie l'annulation d'une suppression ;
  - le retour OAuth arrive sur `localhost:8020`, pas sur `127.0.0.1:8020`.
- La construction de la chaîne de 200 nœuds du plan 0024 est mutualisée (`app/e2e/graphe.ts`).
- Aucun changement de l'application ni du serveur Python ; aucun `skip` ni `fixme`.
- **Résultats** : `npm run e2e`, 44 tests réussis (36 sous Chromium, 8 nouveaux et 2 anciens sous WebKit) ; `npx playwright test --project=webkit` seul : 10 réussis. Temps notés sous WebKit (Vite, poste de développement ; la seconde valeur avec la suite Python en parallèle) :
  - 7 nœuds, 7 cartes dessinées : ouverture 379 / 899 ms, sélection 15 / 36 ms, déplacement 69 / 48 ms ;
  - 200 nœuds, 12 cartes dessinées : ouverture 377 / 896 ms, sélection 23 / 20 ms, déplacement 51 / 54 ms.
- **Constat d'accessibilité** : dans l'app (WKWebView), les onglets de la fiche ne s'atteignent qu'avec ⌥Tab, sauf réglage macOS. Reporté au « Reste à faire ».
- **Hors Tauri** : fenêtre native, plugin shell, sidecar empaqueté et trousseau système restent à vérifier dans l'app installée.
