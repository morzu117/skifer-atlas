# Skifer Atlas

> La carte du patrimoine de KPI : définitions canoniques, déclinaisons par entité, comparaison structurelle et chiffrée.

Skifer Atlas est un module de l'écosystème [Skifer](https://github.com/morzu117/skifer). Il tient le **modèle canonique** des concepts métier et des KPI d'une organisation, les **déclinaisons** que chaque entité en fait, et rend les **divergences visibles** pour tendre vers la convergence.

- Les définitions sont des **graphes orientés sans cycle**, à vocabulaire fermé (10 types de nœuds), sérialisés dans le **YAML Skifer**.
- Les définitions canoniques vivent dans **Git** : une sauvegarde depuis l'application crée une pull request, la revue est l'arbitrage des validateurs.
- Les données restent où elles sont : **centralisation logique**, registre des points d'accès, exécution en push-down avec les droits de l'utilisateur, seuls des agrégats sont rapatriés.
- Les résultats de comparaison sont stockés en local dans **DuckDB**, une base par espace de travail.

## Statut

Conception initiale terminée. Le brief complet est dans [`docs/brief.md`](docs/brief.md) ; les maquettes des écrans sont dans Claude Design.

## Démarrage

```bash
uv sync
uv run pytest
```

## Structure

```
src/skifer_atlas/   cœur du module (modèle, YAML, comparaison)
docs/               brief de conception et décisions
tests/
```
