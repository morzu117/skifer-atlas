# Corpus SQL des tests d'extraction (plan 0004)

- `01_…` à `08_…` : copie à l'identique du corpus du moteur Skifer v4.0.0,
  `examples/24_project_analyzer/legacy_sql/`. Rapport et brouillons « golden » dans
  `../extract/` (régénérer avec `ATLAS_UPDATE_GOLDEN=1`).
- `revenu_net.databricks.sql`, `revenu_net.snowflake.sql` : le même KPI écrit avec les
  fonctions de date de chaque plateforme (critère 5).
- `sentinelles.sql` : constructions non traduites semées de valeurs sentinelles (critère 6).
- `notebook.py`, `notebook_jupyter.ipynb` : notebooks Databricks et Jupyter.
