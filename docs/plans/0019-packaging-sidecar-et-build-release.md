# Plan 0019 — Packaging du sidecar et build release

## Objectif
Une commande de CI produit, pour macOS (arm64 et x64) et Windows x64, un installateur signé de Skifer Atlas qui démarre son serveur figé, passe le test de fumée et fonctionne hors ligne (hors connexions aux plateformes).

## Périmètre
**Dedans** : `scripts/build-sidecar.sh` complété (imports cachés recensés par les plans 0001 à 0018) ; spec PyInstaller commitée ; build Tauri release (`tauri.release.conf.json`) ; signature et notarisation macOS, signature Windows ; CI GitHub Actions par plateforme ; test de fumée du binaire et de l'app ; mesure de taille avec seuil ; numéro de version unique (app, sidecar, `__version__`).
**Dehors** : mise à jour automatique ; Linux (à décider) ; distribution (canal à définir).

## Références
ADR 0001 ; `scripts/build-sidecar.sh`, `app/src-tauri/{tauri.conf.json,tauri.release.conf.json,src/lib.rs}`, `core/sidecar.py` ; analyse §5 risques 4 et 5.

## Spécification
- Fichier `core/skifer-atlas-server.spec` qui remplace les options en ligne de commande : `collect_all` pour duckdb et sqlglot, imports cachés explicites (backends keyring par OS, `databricks.sql`, `snowflake.connector`, `skifer.core.op_catalog`, `skifer.analyzer`) ; exclusion de `pyspark`, `mlflow`, `matplotlib`, `tkinter`.
- Test de fumée du binaire (CI) : lancement avec `ATLAS_PORT` et `ATLAS_TOKEN`, `/health` à 200, une route protégée à 401 sans token, extraction et compilation d'une fixture via une route de diagnostic `GET /api/_selftest` (protégée par le token) qui importe chaque module dynamique.
- Test de fumée de l'app : démarrage de l'app release en CI (macOS), vérification que le sidecar est lancé puis tué à la fermeture (aucun processus orphelin).
- Signature : secrets de CI (certificats Apple Developer ID, Windows) ; notarisation macOS ; aucun secret dans le dépôt.
- Taille : rapport par build ; échec au-delà de 250 Mo pour l'installateur.

## Critères d'acceptation
1. La CI produit trois installateurs signés ; macOS passe la notarisation.
2. Le test de fumée du binaire passe sur chaque plateforme, `_selftest` compris.
3. L'app release démarre en moins de 10 s sur une machine de référence, et ne laisse aucun processus serveur après sa fermeture.
4. Hors ligne, l'app ouvre un espace local, affiche le catalogue et compile un graphe.
5. La taille est rapportée, sous le seuil.
6. Les versions de l'app, du sidecar et de `skifer_atlas.__version__` sont identiques.

## Tests
- CI : matrice macOS arm64, macOS x64, Windows x64.
- À la main : installer sur un poste vierge de chaque OS, puis parcourir accueil → catalogue → fiche.

## Dépendances
0008 et 0018 (pour l'inventaire complet des imports). Le test de fumée du binaire est introduit plus tôt, dès 0008.

## Estimation
**M**. Incertitudes : certificats de signature (à obtenir) ; comportement de keyring et des connecteurs figés sous Windows.
