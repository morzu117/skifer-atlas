"""Comparaison chiffrée d'un KPI et de ses déclinaisons, historique DuckDB (plan 0009)."""

from .orchestrate import CompareRequest, LocalRunner, Prepared, prepare
from .reconcile import Cell, Summary, divergent_node, gap, reconcile, summarize
from .service import (
    cancel_comparison,
    comparison_matrix,
    comparison_setup,
    get_comparison,
    list_comparisons,
    preview_comparison,
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
    "comparison_setup",
    "divergent_node",
    "gap",
    "get_comparison",
    "list_comparisons",
    "prepare",
    "preview_comparison",
    "reconcile",
    "start_comparison",
    "summarize",
]
