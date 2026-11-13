# ADR 0058 — CI de tests sur chaque PR

Date : 14 novembre 2026 · Statut : **acceptée**

## Contexte

Le workflow de release vérifie le binaire et le démarrage de l'application, mais les suites Python, front et de bout en bout ne sont pas exécutées sur chaque PR.

## Décision

Le workflow `tests.yml` lance Ruff et pytest sur Linux et macOS, Vitest et TypeScript sur Linux, ainsi que Playwright sous Chromium et WebKit sur Linux, pour chaque PR vers main, chaque push sur main et à la demande. Chromium est réparti en trois partitions par fichier ; les scénarios d'un même fichier restent séquentiels. Les services et dépôts de test sont locaux et aucun secret n'est requis.

La suite Python tourne aussi sous Windows à titre informatif : ses échecs ne bloquent pas la PR pendant la découverte des incompatibilités. La couverture Python utilise le moteur `sysmon` de Python 3.12 pour limiter le surcoût sur le test de performance. Les rapports de couverture Python et front sont publiés dans le résumé du job sans seuil, afin d'établir une référence avant de fixer des objectifs. Les rapports Playwright sont conservés sept jours en cas d'échec.

## Conséquences

Les régressions sont détectées aux trois niveaux avant fusion, au prix de temps de calcul supplémentaires. La couverture mesure les parties exercées sans garantir à elle seule la qualité des assertions. Le job Windows devra être rendu bloquant après correction des incompatibilités découvertes.
