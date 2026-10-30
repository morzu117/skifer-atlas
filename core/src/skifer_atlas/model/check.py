"""Contrôle complet d'un document : structure du graphe, puis colonnes (plan 0002)."""

from __future__ import annotations

from typing import Any

from .columns import propagate
from .errors import Issue
from .graph import GraphView, Library, structure_issues


def check_document(document: Any, library: Library | None = None) -> list[Issue]:
    """Contrôle un concept ou un KPI ; une variante se contrôle après `resolve`."""
    if getattr(document, "kind", None) == "variant":
        raise TypeError("Une variante se contrôle une fois résolue sur son canonique.")
    if document.graph is None:
        return []
    issues = structure_issues(document, library)
    if GraphView(document.graph).is_dag():
        issues.extend(propagate(document, library)[1])
    return issues


def has_errors(issues: list[Issue]) -> bool:
    return any(issue.severity == "error" for issue in issues)
