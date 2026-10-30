"""Disposition d'un graphe en lecture (plan 0012) : couches de l'ordre topologique et
cartes des nœuds.

La couche d'un nœud est la longueur du plus long chemin depuis une entrée : une source
est en couche 0, un nœud est une couche après la plus haute de ses entrées. Dans une
couche, les nœuds sont rangés par identifiant. La disposition ne dépend donc que du
graphe : elle est la même d'un poste à l'autre, et un même nœud garde sa place d'une
version à l'autre tant que ses entrées ne changent pas (diff, plans 0012 et 0014).
"""

from __future__ import annotations

from typing import Any

from .graph import GraphView

FAMILIES = {
    "source": "source", "kpi_ref": "ref",
    "filter": "rows", "deduplicate": "rows", "compute": "rows", "temporal": "rows",
    "join": "combine", "union": "combine",
    "aggregate": "result", "metric_op": "result",
}
TYPE_LABELS = {
    "source": "Source", "kpi_ref": "Référence à un KPI", "filter": "Filtre",
    "deduplicate": "Dédoublonnage", "compute": "Calcul", "temporal": "Temporel",
    "join": "Jointure", "union": "Union", "aggregate": "Agrégation",
    "metric_op": "Opération entre métriques",
}
OPERATOR_LABELS = {
    "equals": "=", "not_equals": "≠", "greater_than": ">", "less_than": "<",
    "greater_than_equal": "≥", "less_than_equal": "≤", "in": "dans", "not_in": "hors de",
    "between": "entre", "not_between": "hors de", "is_null": "est nul",
    "is_not_null": "n'est pas nul", "contains": "contient", "not_contains": "ne contient pas",
    "starts_with": "commence par", "ends_with": "finit par", "like": "comme",
    "not_like": "pas comme",
}
_GRAINS = {"day": "jour", "week": "semaine", "month": "mois", "quarter": "trimestre",
           "year": "année"}


def condition_text(condition: Any) -> str:
    """`statut:equals:validée` → `statut = validée` ; une condition SQL telle quelle."""
    if not isinstance(condition, str):
        return condition.expr
    column, operator, *value = condition.split(":", 2)
    return " ".join([column, OPERATOR_LABELS.get(operator, operator.replace("_", " ")),
                     *(v.replace(",", ", ") for v in value)])


def _measure(measure: Any) -> str:
    source, _name, function = measure
    return f"{function.upper()}({source})"


def _temporal(node: Any) -> str:
    if node.operation == "period":
        return f"{_GRAINS[node.grain]} de {node.column} → {node.target}"
    if node.operation == "to_date":
        return f"date de {node.column} ({node.timezone}) → {node.target}"
    if node.operation == "convert_timezone":
        return f"{node.column} vers {node.to} → {node.target}"
    return f"{node.function.upper()} {node.frame} → {node.target}"


def _summary(node: Any) -> tuple[str, str]:
    """(titre à défaut de libellé, ligne de détail) d'une carte."""
    kind = node.type
    if kind == "source":
        return node.table.rsplit(".", 1)[-1], node.table
    if kind == "kpi_ref":
        return node.kpi, f"{node.kpi} v{node.version}"
    if kind == "filter":
        text = condition_text(node.condition)
        return text, f"{text} · nulls {'gardés' if node.nulls == 'keep' else 'exclus'}"
    if kind == "compute":
        return node.column, f"{node.column} = {node.expr}"
    if kind == "temporal":
        return node.target, _temporal(node)
    if kind == "deduplicate":
        return "dédoublonnage", f"clé : {', '.join(node.keys)}"
    if kind == "join":
        keys = ", ".join(f"{left} = {right}" for left, right in node.keys)
        return f"jointure {node.how}", " · ".join(x for x in (node.how, node.cardinality, keys) if x)
    if kind == "union":
        return f"union {node.mode}", f"{len(node.inputs)} entrées · {node.mode}"
    if kind == "aggregate":
        measures = ", ".join(_measure(m) for m in node.measures)
        by = f"par {', '.join(node.group_by)}" if node.group_by else "sans regroupement"
        return measures, f"{measures} {by}"
    metrics = ", ".join(f"{m.name} = {m.expr}" for m in node.metrics)
    return ", ".join(m.name for m in node.metrics), metrics


def layout(document: Any) -> dict:
    """Cartes et arêtes du graphe d'un document valide ; `layer` et `rank` placent les
    cartes (colonne, rang dans la colonne)."""
    view = GraphView(document.graph)
    points = set(getattr(document, "variation_points", None) or [])
    layers: dict[str, int] = {}
    for node_id in view.topological_order():
        layers[node_id] = 1 + max((layers[s] for s in view.inputs(node_id)), default=-1)
    ranks: dict[str, int] = {}
    for layer in set(layers.values()):
        for rank, node_id in enumerate(sorted(n for n, x in layers.items() if x == layer)):
            ranks[node_id] = rank
    nodes, edges = [], []
    for node in document.graph.nodes:
        title, detail = _summary(node)
        nodes.append({
            "id": node.id, "type": node.type, "type_label": TYPE_LABELS[node.type],
            "family": FAMILIES[node.type], "title": node.label or title, "detail": detail,
            "variation": node.id in points, "output": node.id == view.output,
            "layer": layers[node.id], "rank": ranks[node.id],
        })
        if node.type == "join":
            sides = [("left", node.inputs.left), ("right", node.inputs.right)]
        else:
            sides = [(None, source) for source in view.inputs(node.id)]
        edges.extend({"id": f"{source}-{node.id}" + (f"-{side}" if side else ""),
                      "source": source, "target": node.id, "side": side}
                     for side, source in sides)
    return {"output": view.output, "nodes": nodes, "edges": edges}
