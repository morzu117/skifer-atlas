"""Alignement de deux graphes logiques (plan 0003).

On apparie d'abord par identifiant (deux versions d'un document, canonique et surcharge),
puis, pour les nœuds restants ou pour deux graphes sans lien, glouton par score
décroissant. Le score vaut 0 si les types diffèrent ; sinon :
- +3 par attribut de concept commun aux colonnes touchées (une colonne liée par un
  `binding` compte pour l'attribut du concept ; sinon pour son propre nom) ; +3 si deux
  sources sont rattachées au même concept ;
- +2 si la profondeur (nombre d'opérations structurantes en amont) est la même ;
- +1 par colonne commune en sortie ;
- +1 si les entrées sont déjà appariées entre elles.
Un score sous `SCORE_THRESHOLD` ne produit aucun appariement ; sous `LOW_SCORE`,
l'appariement est jugé incertain.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import sqlglot

from ..model.columns import propagate
from ..model.functions import parse_sql, referenced_columns
from ..model.graph import Library
from ..model.normalize import LogicalGraph, LogicalNode, logical_graph

STRUCTURING = {
    "source", "join", "union", "deduplicate", "aggregate", "temporal", "kpi_ref", "metric_op",
}
SCORE_THRESHOLD = 3
LOW_SCORE = 5


@dataclass(frozen=True)
class Pair:
    base: str
    other: str
    score: int | None  # None : apparié par identifiant


def type_key(node: LogicalNode) -> str:
    """Type comparé : un nœud temporel n'est comparable qu'à la même opération."""
    if node.type == "temporal":
        return f"temporal:{node.content['operation']}"
    return node.type


def _sql_columns(text: str) -> list[str]:
    try:
        return referenced_columns(parse_sql(text))
    except sqlglot.errors.SqlglotError:
        return []


def _condition_columns(condition: Any) -> list[str]:
    if isinstance(condition, str):
        return [condition.split(":", 1)[0]]
    return _sql_columns(condition.expr)


def _measure_columns(measures: list) -> list[str]:
    return [source for source, _target, _function in measures if source != "*"]


def node_columns(node: Any) -> list[str]:
    """Colonnes touchées (lues) par un nœud du document."""
    kind = node.type
    if kind == "filter":
        return _condition_columns(node.condition)
    if kind == "compute":
        return _sql_columns(node.expr)
    if kind == "aggregate":
        columns = [*node.group_by, *_measure_columns(node.measures)]
        for condition in node.having or []:
            columns.extend(_condition_columns(condition))
        return columns
    if kind == "join":
        return [column for pair in node.keys for column in pair]
    if kind == "deduplicate":
        return [*node.keys, *(column for column, _ in node.keep.order_by)]
    if kind == "temporal":
        columns = [node.column]
        if node.operation == "window":
            columns.extend(column for column, _ in node.order_by)
            columns.extend(node.partition_by or [])
        return columns
    if kind == "union":
        return [name for column in node.columns for name in column.source.values()]
    if kind == "metric_op":
        columns = [name for metric in node.metrics for name in _sql_columns(metric.expr)]
        if node.aggregate is not None:
            columns.extend(node.aggregate.group_by)
            columns.extend(_measure_columns(node.aggregate.measures))
        return columns
    if kind == "kpi_ref":
        return list(node.columns or [])
    return []


class Side:
    """Un graphe à comparer, avec ce qu'il faut pour l'appariement par score."""

    def __init__(self, document: Any, library: Library | None = None):
        self.document = document
        self.graph: LogicalGraph = logical_graph(document)
        self.order = list(self.graph.nodes)
        self.position = {node_id: index for index, node_id in enumerate(self.order)}
        self.schemas = propagate(document, library)[0]
        self.binding: dict[str, str] = {}
        for node in document.graph.nodes:
            if node.type == "source" and node.binding:
                self.binding.update(node.binding)
        self.depth: dict[str, int] = {}
        self.ancestors: dict[str, set[str]] = {}
        for node_id, node in self.graph.nodes.items():
            self.depth[node_id] = max(
                (self.depth[i] + (self.graph.nodes[i].type in STRUCTURING) for i in node.inputs),
                default=0,
            )
            self.ancestors[node_id] = set(node.inputs).union(
                *(self.ancestors[i] for i in node.inputs)
            )

    def node(self, node_id: str) -> LogicalNode:
        return self.graph.nodes[node_id]

    def concept(self, column: str) -> str:
        return self.binding.get(column, column)

    def touched(self, node_id: str) -> set[str]:
        return {
            self.concept(column)
            for member in self.node(node_id).members
            for column in node_columns(member)
        }

    def outputs(self, node_id: str) -> set[str]:
        schema = self.schemas.get(node_id) or {}
        return {self.concept(name) for name in schema}

    def source_concept(self, node_id: str) -> str | None:
        member = self.node(node_id).members[0]
        return member.concept if member.type == "source" else None


def score(base: Side, other: Side, base_id: str, other_id: str, mapped: dict[str, str]) -> int:
    b, o = base.node(base_id), other.node(other_id)
    if type_key(b) != type_key(o):
        return 0
    value = 3 * len(base.touched(base_id) & other.touched(other_id))
    concept = base.source_concept(base_id)
    if concept is not None and concept == other.source_concept(other_id):
        value += 3
    if base.depth[base_id] == other.depth[other_id]:
        value += 2
    value += len(base.outputs(base_id) & other.outputs(other_id))
    if b.inputs and [mapped.get(i) for i in b.inputs] == o.inputs:
        value += 1
    return value


def align(base: Side, other: Side, by_id: bool) -> list[Pair]:
    """Paires (base, other), dans l'ordre topologique de `base`."""
    mapped: dict[str, str] = {}
    scores: dict[str, int | None] = {}
    taken: set[str] = set()

    if by_id:
        # Une suite de filtres est appariée par n'importe lequel de ses membres.
        other_of_member = {
            member.id: node_id
            for node_id, node in other.graph.nodes.items()
            for member in node.members
        }
        for base_id, node in base.graph.nodes.items():
            for member in node.members:
                other_id = other_of_member.get(member.id)
                if (
                    other_id is not None and other_id not in taken
                    and type_key(node) == type_key(other.node(other_id))
                ):
                    mapped[base_id], scores[base_id] = other_id, None
                    taken.add(other_id)
                    break

    while True:
        best: tuple[int, int, int] | None = None
        for base_id in base.order:
            if base_id in mapped:
                continue
            for other_id in other.order:
                if other_id in taken:
                    continue
                value = score(base, other, base_id, other_id, mapped)
                if value < SCORE_THRESHOLD:
                    continue
                # Départage : score, puis ordre topologique de base, puis d'other.
                key = (-value, base.position[base_id], other.position[other_id])
                if best is None or key < best:
                    best = key
        if best is None:
            break
        base_id, other_id = base.order[best[1]], other.order[best[2]]
        mapped[base_id], scores[base_id] = other_id, -best[0]
        taken.add(other_id)

    return [Pair(b, mapped[b], scores[b]) for b in base.order if b in mapped]
