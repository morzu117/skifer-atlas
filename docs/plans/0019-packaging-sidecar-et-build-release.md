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

## Mise en œuvre (31 octobre 2026)

Décisions : [ADR 0023](../decisions/0023-packaging-release.md).

- **Cœur** (`core/`) :
  - `skifer-atlas-server.spec` (nouveau) :
    - `collect_all` pour duckdb, sqlglot et `snowflake.connector` ;
    - métadonnées de keyring, du connecteur Snowflake, de skifer et de skifer-atlas ;
    - imports cachés : backends keyring, `skifer.core.op_catalog`, `skifer.analyzer.frontends`, uvicorn ;
    - exclusions : pyspark, mlflow, matplotlib, tkinter, outils de test ;
  - `src/skifer_atlas/selftest.py` (nouveau) et `GET /api/_selftest` (token exigé) : imports à la demande, keyring, extraction et compilation Databricks et Snowflake, exécution DuckDB, `zoneinfo`, présence de git ;
  - `src/skifer_atlas/lifeline.py` (nouveau) et `server.py` :
    - arrêt quand le processus `ATLAS_PARENT_PID` disparaît, avec une échéance de 5 s ;
    - le message d'arrêt ne peut plus bloquer l'arrêt quand la sortie n'a plus de lecteur ;
  - `pyproject.toml` : version dynamique, lue dans `skifer_atlas/__init__.py`.
- **App** (`app/src-tauri/`) :
  - `lib.rs` :
    - passe `ATLAS_PARENT_PID` ;
    - relaie la sortie du serveur au lieu de fermer ses tubes ;
  - `tauri.conf.json` : la version vient de `package.json` ;
  - `tauri.release.conf.json` : runtime renforcé, `entitlements.plist` (nouveau) et macOS 11 minimum ; horodatage SHA-256 sous Windows.
- **Scripts** :
  - `build-sidecar.sh` : réécrit autour du spec, `.exe` sous Windows ;
  - `version.py` : vérifie la version, ou la porte partout ;
  - `size-report.py` : tableau des tailles, échec au-delà de 250 Mo ;
  - `smoke-app.sh` : test de fumée de l'app release sous macOS.
- **CI** : `.github/workflows/release.yml`.
  - Matrice : macOS arm64 (`macos-15`), macOS x64 (`macos-15-intel`), Windows x64.
  - Étapes : version, sidecar, tests du binaire, installateur, taille, fumée de l'app, vérification de signature, artefacts.
  - Signature par les secrets seulement. Elle est obligatoire sur un tag ; sans secret, un avertissement suffit.
- **Tests** :
  - `core/tests/test_release.py` (8 tests) ;
  - `core/tests/test_sidecar.py`, marqué `sidecar` (5 tests) : hors ligne sous `sandbox-exec`, et arrêt du binaire quand le chargeur puis l'app sont tués ;
  - `app/src/offline.test.ts` (3 tests) : aucune ressource distante, polices embarquées.
- **État des critères** :
  1. Installateurs produits par la CI. La signature et la notarisation attendent les certificats : à vérifier au premier tag.
  2. Test du binaire et `_selftest` vérifiés localement sous macOS arm64 ; sur les trois plateformes, par la CI.
  3. App release : `/health` en 2 s. Aucun serveur ne reste après Cmd-Q ni après `kill -9` (`smoke-app.sh`).
  4. Hors ligne : espace local, catalogue et compilation par le binaire sous `sandbox-exec` ; aucune ressource distante dans l'interface.
  5. Tailles locales : sidecar 52 Mo, dmg 58,9 Mo (seuil 250 Mo).
  6. Une seule version, vérifiée par `version.py`, par les tests et par la CI.
- **Reste à faire** :
  - obtenir les certificats Apple Developer ID et Windows, puis les poser en secrets ;
  - parcours manuel sur un poste vierge de chaque OS ;
  - Linux, mise à jour automatique et canal de distribution, hors périmètre.

### Suivi de la revue globale (#151, 6 novembre 2026)

La revue de `b6af799` a relevé cinq défauts sur la coque, le sidecar et la sécurité. Décisions : [ADR 0041](../decisions/0041-sonde-authentifiee-et-csp.md).

- **Sonde authentifiée** (P2) :
  - `GET /alive?nonce=…` (seule route ouverte) rend `HMAC-SHA256(token, "skifer-atlas-alive:" || nonce)` ;
  - `wait_alive` (`lib.rs`) envoie un nonce neuf à chaque essai, n'accepte qu'un 200 portant la bonne preuve et ne transmet jamais le token ;
  - la sonde lit l'état du processus enfant : arrêt du serveur, échec immédiat avec le code de sortie, jusqu'à 3 essais sur d'autres ports ;
  - `ServerInfo` devient un état renseigné par `setup`, avant la fenêtre ;
  - `sha2` entre dans `Cargo.toml` (déjà dans le verrou).
- **Routes fermées** (P3) : `/docs`, `/redoc`, `/openapi.json` répondent 404, sauf en mode dev sans token ; `/health` exige le token (l'interface l'envoie déjà).
- **Fumée de l'app** : `scripts/smoke-app.sh` attend la ligne `[atlas] serveur vérifié, port N`, écrite par `lib.rs` une fois la preuve acceptée (sans token ni preuve), et mesure `SMOKE_LIMIT_SECONDS` jusqu'à elle. Il vérifie ensuite `/alive` et que `/health` répond 401 sans token, et échoue si l'app se ferme avant la ligne.
- **CSP** (P3) : `default-src 'self'`, `connect-src` limité au serveur local et à `ipc:`, `style-src 'unsafe-inline'` (CodeMirror, attributs `style`), `img-src data:`. Une `devCsp` ajoute l'origine de Vite. Vérifiée par `vite preview` avec la même CSP en en-tête ; non vérifiée dans la vraie fenêtre Tauri (voir l'ADR).
- **Repli sans token** (P3) : `serverInfo` ne retient `{ token: "" }` que hors Tauri ; sous Tauri, trois essais, puis `ServerInfoError` (bandeau « Serveur local injoignable ») sans rien mettre en cache.
- **Adresse mal encodée** (P3) : `router.parse` replie sur l'accueil au lieu de lever `URIError`.
- **Tests** :
  - Rust : 14 tests dans `lib.rs` (HMAC, réponse de sonde, faux serveurs, preuve fausse jamais « prête », ligne de prêt) ;
  - core : routes de documentation, `/alive`, `/health` (`test_api.py`) ;
  - Vitest : `api.test.ts`, `csp.test.ts`, adresses invalides dans `format.test.ts` ;
  - Playwright : `accueil.spec.ts` › `[S-0010-11]`.
  - Scénarios : S-0010-11, S-0010-12 et S-0019-07 à S-0019-09.
- **Reste à faire** : vérifier la CSP et la sonde dans la vraie fenêtre Tauri sur les trois plateformes (console du webview ouverte, aucune ligne « Content Security Policy »), au prochain essai de l'app.
