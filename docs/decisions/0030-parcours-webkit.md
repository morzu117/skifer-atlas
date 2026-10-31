# ADR 0030 — Parcours WebKit de bout en bout

Date : 2026-10-31 · Statut : **acceptée** (mise en œuvre du plan 0026)

## Contexte

La vue de Tauri sous macOS est WKWebView, donc WebKit. Jusqu'ici, le projet Playwright `webkit` ne vérifiait que deux rendus (`rendu.webkit.spec.ts`). Les parcours des plans 0010 à 0016 et le graphe de 200 nœuds du plan 0024 ne tournaient que sous Chromium. Les vérifications « sous Tauri » du registre des plans restaient donc entièrement manuelles.

## Décision

- **Mêmes serveurs, après Chromium.** Le projet `webkit` réutilise les serveurs de démonstration lancés pour Chromium (`playwright.config.ts`) et passe après lui. Ses scénarios ne supposent aucun état initial :
  - les espaces, brouillons et points d'accès créés portent un identifiant unique ;
  - les brouillons sont supprimés après le démontage de l'éditeur ;
  - la proposition FR est seulement lue (Chromium modifie la DE) ;
  - la comparaison suit l'identifiant rendu par son propre lancement.
- **axe sur chaque écran parcouru**, avec le même seuil que sous Chromium (`seriousViolations` : violations sérieuses ou critiques).
- **Tab et liens sous WebKit.** Sous macOS, Safari et WKWebView ne passent pas d'un lien à l'autre avec Tab seul, sauf réglage de l'utilisateur ; ⌥Tab les parcourt. Les scénarios clavier utilisent donc ⌥Tab pour les onglets de la fiche, qui sont des liens.
- **L'annulation porte sur le document.** Comme le dit l'ADR 0017, ⌘Z défait des opérations sur le document (ajout, suppression, connexion, champ), pas des déplacements de cartes. Le scénario d'édition vérifie ⌘Z sur une suppression de nœud.

## Conséquences

- Les parcours de l'accueil, du catalogue, de la fiche, de l'éditeur (7 et 200 nœuds), des propositions, de la comparaison et de la popup OAuth sont vérifiés dans le moteur de Tauri à chaque `npm run e2e`.
- Restent manuels :
  - la fenêtre native ;
  - le plugin shell qui ouvre le navigateur système (la popup vérifie la branche navigateur de `openExternal`) ;
  - le démarrage et l'arrêt du sidecar empaqueté ;
  - le trousseau système (coffre mémoire ici).
- Dans l'app, un utilisateur au clavier n'atteint les onglets de la fiche qu'avec ⌥Tab, ou s'il a activé la navigation clavier complète dans macOS. C'est à trancher, voir le « Reste à faire » du registre des plans. Deux pistes : des boutons à la place des liens, ou l'option WKWebView qui fait passer Tab par les liens.
- Tests : `app/e2e/parcours.webkit.spec.ts` (8 scénarios) ; `app/e2e/graphe.ts` partage la chaîne de 200 nœuds avec `graphe-volumineux.spec.ts`.
