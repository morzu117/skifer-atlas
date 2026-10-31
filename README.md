# Skifer Atlas

> La carte du patrimoine de KPI : définitions canoniques, déclinaisons par entité, comparaison structurelle et chiffrée.

Skifer Atlas est un module de l'écosystème [Skifer](https://github.com/morzu117/skifer). Il tient le **modèle canonique** des concepts métier et des KPI d'une organisation, les **déclinaisons** que chaque entité en fait, et rend les **divergences visibles** pour tendre vers la convergence.

- Les définitions sont des **graphes orientés sans cycle**, à vocabulaire fermé (10 types de nœuds), sérialisés dans le **YAML Skifer**.
- Les définitions canoniques vivent dans **Git** : une sauvegarde depuis l'application crée une pull request, la revue est l'arbitrage des validateurs.
- Les données restent où elles sont : **centralisation logique**, registre des points d'accès, exécution en push-down avec les droits de l'utilisateur, seuls des agrégats sont rapatriés.
- Tout est **local-first** : résultats de comparaison dans DuckDB, tokens dans le coffre personnel, une base par espace de travail.

Le brief complet est dans [`docs/brief.md`](docs/brief.md).

## Architecture

Application de bureau **Tauri** qui lance et supervise un serveur Python local (**sidecar**), consommé par une interface **React** (React Flow pour l'éditeur de graphe).

```
core/              cœur Python `skifer_atlas` + API FastAPI (sidecar)
app/
  src/             interface React + React Flow
  src-tauri/       shell Tauri : port libre, token de session, lancement du sidecar
assets/            logo
docs/              brief de conception, décisions (ADR)
scripts/           build du sidecar (PyInstaller)
```

Au lancement, le shell choisit un port libre, génère un token de session, démarre le serveur sur `127.0.0.1`, attend `/health`, puis affiche l'interface. Le serveur est tué à la fermeture. Aucun Python à installer chez l'utilisateur final.

## Développement

Prérequis : [uv](https://docs.astral.sh/uv/), Node 20+, Rust stable (toolchain Tauri).

```bash
# cœur Python
cd core && uv sync && uv run pytest

# application (lance Vite + Tauri ; en dev, le serveur démarre via `uv run` depuis core/)
cd app && npm install && npm run tauri dev
```

Le serveur refuse de démarrer sans le token que Tauri lui passe. Pour travailler sur l'interface dans un simple navigateur, sans Tauri : `cd core && ATLAS_DEV_NO_TOKEN=1 uv run skifer-atlas-server`, puis `cd app && npm run dev`. Hors Tauri, l'interface appelle `http://127.0.0.1:8765`, ou l'adresse donnée par `VITE_ATLAS_API`.

Tests de l'interface, depuis `app/` :

```bash
npm test                          # Vitest + Testing Library : composants, routes, tokens
npx playwright install chromium webkit   # une fois ; WebKit est le moteur de Tauri sous macOS
npm run e2e                       # Playwright : l'app Vite contre un serveur Python sur un dossier temporaire
```

`npm run e2e` lance lui-même Vite (port 1420) et le serveur de `anna.k` (port 8799, `ATLAS_DEV_NO_TOKEN=1`, `ATLAS_VAULT=memory`, comparaisons locales via `ATLAS_COMPARE_DATA`), plus ceux des validateurs `claire.m` (8798) et `marc.d` (8797) pour les propositions, celui de `julien.h` (8795) pour l'administration, un faux Databricks (8796) pour Mes connexions, dont le retour OAuth arrive sur 8020, et un faux Snowflake (8794) pour le SSO et la paire de clés ; ces ports doivent être libres. Couleurs et tailles passent par `app/src/tokens.css`, copie exacte de `docs/design/tokens.css` : un test refuse toute valeur `#…` ou `…px` ailleurs dans `app/src`. Les routes et un exemple avec `curl` sont dans [`core/README.md`](core/README.md) ; un espace de démonstration est dans [`examples/espace-nordis/`](examples/espace-nordis/), et `examples/depot-nordis.sh <dossier>` en fait un dépôt à rejoindre, avec l'historique de Revenu net (v1 à v4) ; `examples/propositions-nordis.py` y ouvre les cinq propositions de la maquette 10.4, et `examples/points-acces-nordis.py` y déclare les trois points d'accès de la maquette 10.6 (Databricks, Snowflake en SSO, Snowflake par paire de clés). Les tests de bout en bout s'en servent.

## Build d'une version installable

Plan 0019, ADR [0023](docs/decisions/0023-packaging-release.md). Chaque machine construit pour sa propre architecture.

```bash
scripts/build-sidecar.sh          # serveur Python figé (core/skifer-atlas-server.spec) dans app/src-tauri/binaries/
(cd core && uv run pytest -m sidecar)   # test du binaire : /health, _selftest, hors ligne, arrêt avec l'app
cd app && npm run tauri:build    # installateur (config release : sidecar, runtime renforcé macOS)
python3 scripts/size-report.py    # tailles ; échoue au-delà de 250 Mo par installateur
scripts/smoke-app.sh "app/src-tauri/target/release/bundle/macos/Skifer Atlas.app"   # macOS
```

`smoke-app.sh` vérifie que l'app démarre son serveur en moins de 10 s, et qu'aucun processus serveur ne reste après Cmd-Q ou après un `kill -9` de l'app. Le serveur surveille l'app qui l'a lancé (`ATLAS_PARENT_PID`).

Version : une seule, celle de `core/src/skifer_atlas/__init__.py`. `python3 scripts/version.py` vérifie qu'elle est identique partout (package.json et son verrou, Cargo.toml et Cargo.lock ; `tauri.conf.json` lit celle de package.json). `python3 scripts/version.py 0.2.0` la porte partout.

Git doit être installé sur le poste : il n'est pas embarqué dans l'installateur.

CI (`.github/workflows/release.yml`) : macOS arm64, macOS x64 et Windows x64, sur chaque PR qui touche `core/`, `app/` ou `scripts/`, et sur les tags `v*`. Elle construit le sidecar, le teste, produit l'installateur, rapporte sa taille, lance le test de fumée de l'app sous macOS et publie l'installateur en artefact. La signature ne passe que par les secrets du dépôt :
- macOS : `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, et pour la notarisation `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` ;
- Windows : `WINDOWS_CERTIFICATE` et `WINDOWS_CERTIFICATE_PASSWORD`.

Sans ces secrets, l'installateur sort non signé, avec un avertissement. Sur un tag, il est refusé, et le tag doit correspondre à la version.

## Licence

MIT, voir `LICENSE`.
