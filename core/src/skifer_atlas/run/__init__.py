"""Exécution locale d'un KPI compilé (plan 0007)."""

from .duckdb_local import MissingData, Result, open_database, run_local

__all__ = ["MissingData", "Result", "open_database", "run_local"]
