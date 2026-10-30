"""Restriction d'un KPI à un scope : période, périmètre, granularité (plan 0007).

- **Période** : bornes ISO incluses (`2025-10-01..2025-12-31`) ou nom d'une période du
  calendrier du KPI. Elle filtre la date de référence : la colonne découpée par l'unique
  nœud `period` qui mène à la sortie.
- **Périmètre** : conditions Skifer sur des attributs de concept (`entite:in:FR,DE`).
  Chaque source rattachée par `binding` à cet attribut est filtrée sur sa colonne.
- **Granularité** : dimensions qui remplacent le `group_by` de l'agrégation de sortie ;
  une dimension est une colonne en entrée de cette agrégation, ou un attribut de concept
  rattaché à l'une d'elles.

Toute dimension introuvable donne `scope_dimension_unavailable`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from pydantic import TypeAdapter, ValidationError

from ..model.columns import propagate
from ..model.graph import GraphView, Library
from ..model.nodes import ConditionText
from .calendar import CIVIL, Calendar
from .errors import CompileError, compile_error

_CONDITION = TypeAdapter(ConditionText)


@dataclass(frozen=True)
class Scope:
    period: str | None = None
    perimeter: tuple[str, ...] = ()
    granularity: tuple[str, ...] | None = None


def period_bounds(scope: Scope, calendar: Calendar | None, calendar_key: str) -> tuple[date, date]:
    text = (scope.period or "").strip()
    if ".." in text:
        start, _, end = text.partition("..")
        try:
            bounds = date.fromisoformat(start.strip()), date.fromisoformat(end.strip())
        except ValueError:
            raise compile_error("scope_invalid_period", f"Période « {text} » : bornes "
                                "AAAA-MM-JJ..AAAA-MM-JJ attendues.") from None
        if bounds[1] < bounds[0]:
            raise compile_error("scope_invalid_period", f"Période « {text} » : la fin précède "
                                "le début.")
        return bounds
    found = calendar.period(text) if calendar is not None else None
    if found is None:
        where = "le calendrier civil n'a pas de périodes nommées" if calendar_key == CIVIL \
            else f"le calendrier « {calendar_key} » ne la connaît pas"
        raise compile_error("scope_unknown_period", f"Période « {text} » inconnue : {where}.")
    return found.start, found.end


def reference_period(view: GraphView) -> str:
    """Le nœud `period` qui fixe la date de référence du KPI."""
    useful = view.ancestors_of_output()
    found = [n.id for n in view.graph.nodes if n.id in useful and n.type == "temporal"
             and n.operation == "period"]
    if not found:
        raise compile_error("scope_no_reference_date", "Aucun découpage en périodes ne mène à "
                            "la sortie : le KPI n'a pas de date de référence à filtrer.")
    if len(found) > 1:
        raise compile_error("scope_ambiguous_reference_date", "Plusieurs découpages en "
                            f"périodes mènent à la sortie ({', '.join(found)}) : la date de "
                            "référence est ambiguë.")
    return found[0]


def _attribute_columns(view: GraphView) -> dict[str, list[tuple[str, str]]]:
    """Attribut de concept → [(source, colonne)] d'après les `binding`."""
    found: dict[str, list[tuple[str, str]]] = {}
    useful = view.ancestors_of_output()
    for node in view.graph.nodes:
        if node.type == "source" and node.id in useful:
            for column, attribute in (node.binding or {}).items():
                found.setdefault(attribute, []).append((node.id, column))
    return found


def perimeter_filters(view: GraphView, scope: Scope) -> dict[str, list[str]]:
    """Conditions à ajouter par source, la colonne de la source à la place de l'attribut."""
    attributes = _attribute_columns(view)
    filters: dict[str, list[str]] = {}
    for text in scope.perimeter:
        try:
            condition = _CONDITION.validate_python(text)
        except ValidationError as error:
            raise compile_error("scope_invalid_perimeter", f"Périmètre « {text} » : "
                                f"{error.errors()[0]['msg']}") from None
        attribute, _, rest = condition.partition(":")
        if attribute not in attributes:
            raise compile_error("scope_dimension_unavailable", f"Périmètre : aucune source "
                                f"n'est rattachée à l'attribut « {attribute} ».")
        for source, column in attributes[attribute]:
            filters.setdefault(source, []).append(f"{column}:{rest}")
    return filters


def _output_aggregate(view: GraphView) -> str:
    node_id = view.output
    while True:
        node = view.by_id[node_id]
        if node.type == "aggregate" or (node.type == "metric_op" and node.order == "rows_first"):
            return node_id
        if node.type in ("filter", "compute", "temporal", "deduplicate") or (
                node.type == "metric_op"):
            node_id = view.inputs(node_id)[0]
            continue
        raise compile_error("scope_granularity_unsupported", f"La sortie passe par {node_id} "
                            f"({node.type}) avant toute agrégation : la granularité ne se "
                            "change que sur une agrégation de sortie unique.", node_id)


def apply_granularity(document: Any, scope: Scope, library: Library | None) -> Any:
    """Copie du document dont l'agrégation de sortie regroupe par les dimensions du scope."""
    if scope.granularity is None:
        return document
    view = GraphView(document.graph)
    target = _output_aggregate(view)
    schemas, _ = propagate(document, library)
    available = schemas.get(view.inputs(target)[0]) or {}
    attributes = _attribute_columns(view)
    group_by = []
    for name in scope.granularity:
        if name in available:
            group_by.append(name)
            continue
        bound = [column for _, column in attributes.get(name, []) if column in available]
        if not bound:
            raise compile_error("scope_dimension_unavailable", f"Dimension « {name} » "
                                f"indisponible en entrée de {target}.", target)
        group_by.append(bound[0])
    nodes = []
    for node in document.graph.nodes:
        if node.id == target and node.type == "aggregate":
            node = node.model_copy(update={"group_by": group_by})
        elif node.id == target:
            node = node.model_copy(update={
                "aggregate": node.aggregate.model_copy(update={"group_by": group_by})})
        nodes.append(node)
    rewritten = document.model_copy(update={
        "graph": document.graph.model_copy(update={"nodes": nodes})})
    _, issues = propagate(rewritten, library)
    if issues:
        raise CompileError([issue.__class__(issue.path, issue.node_id,
                                            "scope_dimension_unavailable",
                                            f"Avec cette granularité : {issue.message}")
                            for issue in issues])
    return rewritten
