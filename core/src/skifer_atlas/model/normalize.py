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


def normalized_form(document: Any) -> dict:
    view = GraphView(document.graph)
    if not view.is_dag():
        raise ValueError("Le graphe doit être un DAG sans entrée inconnue pour être normalisé.")
    semantics = getattr(document, "semantics", None)
    calendar = semantics.calendar.model_dump(exclude_none=True) if semantics else None
    useful = view.ancestors_of_output()

    # 1. Suites de filtres : chaque filtre rejoint le groupe de son entrée si celle-ci est un
    #    filtre qu'il est seul à consommer. Le groupe est désigné par son dernier filtre.
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

    logical: dict[str, tuple[str, dict, list[str]]] = {}  # id → (type, contenu, entrées)
    for node_id in view.topological_order():
        if node_id not in useful:
            continue
        node = view.by_id[node_id]
        if node.type == "filter":
            if node_id not in group_of:
                continue  # filtre intérieur d'une suite
            members = [view.by_id[m] for m in group_of[node_id]]
            conditions = sorted(_condition(m.condition, m.nulls) for m in members)
            logical[node_id] = ("filter_set", {"conditions": conditions}, list(members[0].inputs))
        else:
            inputs = view.inputs(node_id)
            logical[node_id] = (node.type, _content(node, inputs, calendar), inputs)

    # 2. Signature de Merkle : type, contenu et signatures des entrées, dans l'ordre.
    signature: dict[str, str] = {}
    for node_id in view.topological_order():
        if node_id in logical:
            kind, content, inputs = logical[node_id]
            payload = _canonical_json([kind, content, [signature[i] for i in inputs]])
            signature[node_id] = hashlib.sha256(payload.encode("utf-8")).hexdigest()

    # 3. Ordre topologique départagé par (type, contenu, signature) ; renumérotation.
    def rank(node_id: str) -> tuple[str, str, str]:
        kind, content, _ = logical[node_id]
        return kind, _canonical_json(content), signature[node_id]

    remaining = {node_id: set(inputs) for node_id, (_, _, inputs) in logical.items()}
    new_id: dict[str, str] = {}
    while remaining:
        ready = sorted((n for n, deps in remaining.items() if deps <= new_id.keys()), key=rank)
        chosen = ready[0]
        new_id[chosen] = f"n{len(new_id) + 1:02d}"
        del remaining[chosen]

    nodes = []
    for old_id in sorted(new_id, key=new_id.__getitem__):
        kind, content, inputs = logical[old_id]
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
        "graph": {"nodes": nodes, "output": new_id[view.output]},
    }
