# ADR 0003 — Le modèle des nœuds se développe dans Atlas, puis remonte dans le moteur

Date : 2026-10-30 · Statut : **acceptée** (arbitrage du 30 octobre 2026, voir `docs/analysis.md` §6)

## Contexte

Le format doit être unique pour tous les modules Skifer (ADR 0002), donc il a vocation à vivre dans le moteur `skifer`. Mais le faire évoluer d'abord dans le moteur ralentirait chaque itération : deux dépôts, une release du moteur à chaque ajustement. Les modules du moteur utiles à Atlas (`core/op_catalog`, `core/ir`, `core/sql_compiler`, `analyzer`) s'importent sans pyspark, ce qui a été vérifié sur la v4.0.0.

## Décision

- Le modèle (pydantic), le JSON Schema, la validation, la normalisation et le diff vivent dans `core/src/skifer_atlas/model/` et les modules voisins, en Python pur, sans import Spark ni FastAPI.
- Atlas dépend du moteur `skifer` (sans extra `spark`) pour réutiliser ses catalogues d'opérateurs et son analyseur, plutôt que de les recopier : dépendance épinglée sur un tag du dépôt public du moteur (voir la note de mise en œuvre).
- Quand le schéma sera stable (après le plan 0003), une proposition de remontée dans le moteur est faite sous forme de plan côté `skifer`. Atlas importera alors le modèle depuis le moteur.

## Conséquences

- Le JSON Schema publié porte `schema_version`. Toute évolution passe par une migration explicite.
- PyInstaller doit embarquer `skifer` : à vérifier dès le plan 0001 (import et test de fumée).

## Note de mise en œuvre (30 octobre 2026, plan 0001)

La dépendance par chemin relatif prévue en dev ne fonctionne pas depuis un worktree Git. Atlas épingle le moteur sur `git+https://github.com/morzu117/skifer.git@v4.0.0` en dev comme en release. Le binaire PyInstaller embarque `skifer` sans option particulière (vérifié).
