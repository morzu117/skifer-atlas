"""Forme normalisée d'un graphe (brief 8.2.1, version simple ; plan 0002).

1. Toute suite de filtres consécutifs sur un même flux devient un nœud logique
   `filter_set`, conditions triées.
2. Identifiants, libellés, notes et métadonnées (propriétaire, justification d'un
   contournement) sortent de la forme ; les expressions SQL sont réécrites par SQLGlot.
3. Les nœuds sont renumérotés dans l'ordre topologique, départagés par leur contenu.
4. Les nœuds qui ne mènent pas à la sortie sont ignorés.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from .functions import normalized_sql
from .graph import GraphView

NORMALIZATION = "atlas1"
_METADATA = ("id", "type", "label", "note", "inputs", "owner", "bypass_reason")


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _condition(condition: Any, nulls: str | None = None) -> str:
    text = condition if isinstance(condition, str) else f"expr:{normalized_sql(condition.expr)}"
    return f"{text}|{nulls}" if nulls else text


def _content(node: Any, inputs: list[str], calendar: dict | None) -> dict:
    """Contenu d'un nœud sans identifiants ni métadonnées ; les entrées sont désignées
    par leur position."""
    data = node.model_dump(mode="json", by_alias=True, exclude_none=True)
    content = {key: value for key, value in data.items() if key not in _METADATA}
    if node.type == "compute":
        content["expr"] = normalized_sql(node.expr)
    elif node.type == "metric_op":
        for metric in content["metrics"]:
            metric["expr"] = normalized_sql(metric["expr"])
    elif node.type == "aggregate" and node.having:
        content["having"] = [_condition(c) for c in node.having]
    elif node.type == "union":
        for column in content["columns"]:
            column["from"] = {str(inputs.index(k)): v for k, v in column["from"].items()}
    elif node.type == "temporal" and node.operation == "period" and calendar is not None:
        content["calendar"] = calendar
    return content


@dataclass(frozen=True)
class LogicalNode:
    """Nœud de la forme normalisée, encore désigné par les identifiants du document.

    Une suite de filtres devient un seul `filter_set`, désigné par son dernier filtre ;
    `members` garde les nœuds du document regroupés (un seul hors `filter_set`).
    """

    id: str
    type: str
    content: dict
    inputs: list[str]
    members: tuple[Any, ...]


@dataclass
class LogicalGraph:
    nodes: dict[str, LogicalNode]  # dans l'ordre topologique du document
    output: str
    signature: dict[str, str]  # signature de Merkle : contenu et amont


def logical_graph(document: Any) -> LogicalGraph:
    """Étapes 1, 2 et 4 de la normalisation : suites de filtres regroupées, métadonnées
    retirées, nœuds qui ne mènent pas à la sortie ignorés."""
    view = GraphView(document.graph)
    if not view.is_dag():
        raise ValueError("Le graphe doit être un DAG sans entrée inconnue pour être normalisé.")
    semantics = getattr(document, "semantics", None)
    calendar = None
    if semantics is not None:
        calendar = semantics.calendar
        calendar = calendar if isinstance(calendar, str) else calendar.model_dump(exclude_none=True)
    useful = view.ancestors_of_output()

    # Suites de filtres : chaque filtre rejoint le groupe de son entrée si celle-ci est un
    # filtre qu'il est seul à consommer. Le groupe est désigné par son dernier filtre.
    group_of: dict[str, list[str]] = {}
    for node_id in view.topological_order():
        node = view.by_id[node_id]
        if node.type != "filter":
            continue
        source = node.inputs[0]
        if view.by_id[source].type == "filter" and view.consumers[source] == [node_id]:
            group = group_of.pop(source)
            group.append(node_id)
        else:
            group = [node_id]
        group_of[node_id] = group

    nodes: dict[str, LogicalNode] = {}
    for node_id in view.topological_order():
        if node_id not in useful:
            continue
        node = view.by_id[node_id]
        if node.type == "filter":
            if node_id not in group_of:
                continue  # filtre intérieur d'une suite
            members = tuple(view.by_id[m] for m in group_of[node_id])
            conditions = sorted(_condition(m.condition, m.nulls) for m in members)
            nodes[node_id] = LogicalNode(
                node_id, "filter_set", {"conditions": conditions}, list(members[0].inputs),
                members,
            )
        else:
            inputs = view.inputs(node_id)
            nodes[node_id] = LogicalNode(
                node_id, node.type, _content(node, inputs, calendar), inputs, (node,)
            )

    signature: dict[str, str] = {}
    for node_id, node in nodes.items():
        payload = _canonical_json([node.type, node.content, [signature[i] for i in node.inputs]])
        signature[node_id] = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return LogicalGraph(nodes, view.output, signature)


def normalized_form(document: Any) -> dict:
    graph = logical_graph(document)
    logical = graph.nodes

    # Étape 3 : ordre topologique départagé par (type, contenu, signature) ; renumérotation.
    def rank(node_id: str) -> tuple[str, str, str]:
        node = logical[node_id]
        return node.type, _canonical_json(node.content), graph.signature[node_id]

    remaining = {node_id: set(node.inputs) for node_id, node in logical.items()}
    new_id: dict[str, str] = {}
    while remaining:
        ready = sorted((n for n, deps in remaining.items() if deps <= new_id.keys()), key=rank)
        chosen = ready[0]
        new_id[chosen] = f"n{len(new_id) + 1:02d}"
        del remaining[chosen]

    nodes = []
    for old_id in sorted(new_id, key=new_id.__getitem__):
        node = logical[old_id]
        kind, content, inputs = node.type, node.content, node.inputs
        entry: dict[str, Any] = {"id": new_id[old_id], "type": kind}
        if kind == "join":
            entry["inputs"] = {"left": new_id[inputs[0]], "right": new_id[inputs[1]]}
        elif inputs:
            entry["inputs"] = [new_id[i] for i in inputs]
        if kind == "union":
            content = json.loads(json.dumps(content))
            for column in content["columns"]:
                column["from"] = {new_id[inputs[int(k)]]: v for k, v in column["from"].items()}
        entry.update(content)
        nodes.append(entry)
    return {
        "normalization": NORMALIZATION,
        "graph": {"nodes": nodes, "output": new_id[graph.output]},
    }
