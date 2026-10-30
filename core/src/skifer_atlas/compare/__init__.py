"""Comparaison chiffrée d'un KPI et de ses déclinaisons, historique DuckDB (plan 0009)."""

from .orchestrate import CompareRequest, LocalRunner, Prepared, prepare
from .reconcile import Cell, Summary, divergent_node, gap, reconcile, summarize
from .service import (
    cancel_comparison,
    comparison_matrix,
    get_comparison,
    list_comparisons,
    start_comparison,
)

__all__ = [
    "Cell",
    "CompareRequest",
    "LocalRunner",
    "Prepared",
    "Summary",
    "cancel_comparison",
    "comparison_matrix",
    "divergent_node",
    "gap",
    "get_comparison",
    "list_comparisons",
    "prepare",
    "reconcile",
    "start_comparison",
    "summarize",
]
