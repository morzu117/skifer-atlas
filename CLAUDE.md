# Skifer Atlas — repères pour les agents

- Module de l'écosystème Skifer (moteur : `../skifer`). Le YAML Skifer est le format pivot ; ne pas inventer de nouveau format.
- Source de vérité fonctionnelle : `docs/brief.md`. Toute décision nouvelle se consigne dans `docs/decisions/`.
- Python ≥ 3.11, gestion par `uv`, tests `pytest`, lint `ruff`.
- Les tokens d'accès aux plateformes ne sont jamais écrits dans le dépôt ni sur un serveur : coffre local par utilisateur.
