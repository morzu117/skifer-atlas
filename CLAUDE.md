# Skifer Atlas — repères pour les agents

- Module de l'écosystème Skifer (moteur : `../skifer`). Le YAML Skifer est le format pivot ; ne pas inventer de nouveau format.
- Source de vérité fonctionnelle : `docs/brief.md`. Toute décision nouvelle se consigne dans `docs/decisions/`.
- Monorepo : `core/` (Python ≥ 3.11, uv, pytest, ruff) et `app/` (React + Vite + TypeScript, Tauri 2 en Rust).
- Le serveur Python n'écoute que sur 127.0.0.1 et exige le token de session passé par Tauri (`ATLAS_PORT`, `ATLAS_TOKEN`). Ne jamais l'exposer ni retirer le contrôle du token.
- Les tokens d'accès aux plateformes ne sont jamais écrits dans le dépôt ni sur un serveur : coffre local par utilisateur.
- Imports dynamiques côté Python : penser à PyInstaller (voir `scripts/build-sidecar.sh`).
