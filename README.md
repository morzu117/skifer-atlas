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

## Build d'une version installable

```bash
scripts/build-sidecar.sh          # empaquette le serveur Python en binaire autonome
cd app && npm run tauri build     # produit le .dmg / .msi / .AppImage
```
