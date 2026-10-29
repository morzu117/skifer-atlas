# ADR 0001 — Application de bureau Tauri avec serveur Python en sidecar

Date : 2026-10-29 · Statut : acceptée

## Contexte

Le brief impose un fonctionnement local-first (DuckDB, coffre de secrets personnel, tokens sur le poste), un cœur Python (SQLGlot, DuckDB, moteur Skifer) et un éditeur de graphe exigeant côté interface. L'utilisateur attend une application qui, au lancement, démarre tout elle-même.

## Décision

- **Cœur** : librairie Python `skifer_atlas` + API FastAPI, exposée uniquement sur `127.0.0.1` avec un token de session.
- **Interface** : React + React Flow.
- **Shell** : Tauri 2. Il choisit un port libre, génère le token, lance le serveur (sidecar PyInstaller en release, `uv run` en dev), attend `/health`, affiche l'UI, tue le serveur à la fermeture.
- **Secrets** : trousseau de l'OS via `keyring`, rangés par espace de travail (à implémenter).
- **Git** : piloté par la CLI git, pas de GitPython.

## Conséquences

- Un toolchain Rust est nécessaire pour builder (quelques dizaines de lignes de Rust à maintenir).
- Le sidecar pèse ~100–150 Mo avec DuckDB, SQLGlot et les connecteurs. Accepté.
- API et UI restent découplées : l'UI pourrait être servie autrement si le besoin apparaît.
