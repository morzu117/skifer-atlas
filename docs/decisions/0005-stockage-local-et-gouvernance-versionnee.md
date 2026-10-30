# ADR 0005 — Stockage local par espace et gouvernance versionnée dans le dépôt

Date : 2026-10-30 · Statut : **acceptée** (arbitrage du 30 octobre 2026, voir `docs/analysis.md` §6)

## Décision

- **Par espace**, sous `paths.workspace_dir(id)` : le clone Git (`repo/`) et une base DuckDB (`atlas.duckdb`) à deux schémas. Le schéma `index` sert à la recherche et se reconstruit à tout moment depuis le clone. Le schéma `results` conserve les comparaisons et ne se reconstruit pas.
- **Gouvernance** : `governance.yaml` à la racine du dépôt de l'espace (domaines, référents, validateurs, rôles par entité et par domaine, nombre de validateurs, plateformes autorisées). Toute modification passe par une proposition approuvée par un référent.
- **Hébergeur Git** : une interface `GitHost`, implémentée d'abord pour GitHub et pour un « dépôt local nu » (tests, démos hors ligne). Git est piloté par la CLI (ADR 0001). Le token de l'hébergeur vient du coffre via `GIT_ASKPASS`.
- **Validations** : Atlas décompte les approbations de revue de l'hébergeur faites par des comptes qui ont le rôle requis dans `governance.yaml`. L'identité d'un utilisateur est son compte sur l'hébergeur (GitHub en premier).
- **Garde-fou** : Atlas génère `.github/CODEOWNERS` depuis `governance.yaml` (validateurs par domaine, référents sur la gouvernance). Avec la règle de branche « Require review from Code Owners », une fusion faite directement sur GitHub ne contourne pas les validateurs.

## Conséquences

- Aucune donnée de gouvernance n'est locale à un poste : deux utilisateurs d'un même espace voient les mêmes règles.
- Les tokens de plateforme et d'hébergeur ne sont jamais dans le dépôt ni dans DuckDB.
