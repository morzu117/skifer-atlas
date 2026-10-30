"""Contrôles structurels d'un graphe (plan 0002) : entrées, cycles, branches, niveau
d'agrégation, références entre KPI, sémantique figée.

Un graphe qui a une entrée inconnue ou un cycle n'est pas un DAG : les contrôles qui
suivent l'ordre topologique (colonnes, agrégation) ne s'appliquent pas tant qu'il ne
l'est pas.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from .document import ConceptDocument, KpiDocument
from .errors import Issue, pointer
from .nodes import Graph

KpiKey = tuple[str, int]


def node_inputs(node: Any) -> list[str]:
    if node.type in ("source", "kpi_ref"):
        return []
    if node.type == "join":
        return [node.inputs.left, node.inputs.right]
    return list(node.inputs)


class GraphView:
    """Index d'un graphe : nœuds par identifiant, consommateurs, ordre topologique."""

    def __init__(self, graph: Graph):
        self.graph = graph
        self.output = graph.output
        self.index: dict[str, int] = {}
        for position, node in enumerate(graph.nodes):
            self.index.setdefault(node.id, position)
        self.by_id = {node.id: node for node in reversed(graph.nodes)}
        self.consumers: dict[str, list[str]] = {node_id: [] for node_id in self.index}
        for node in graph.nodes:
            for source in node_inputs(node):
                if source in self.consumers and node.id not in self.consumers[source]:
                    self.consumers[source].append(node.id)

    def path(self, node_id: str, *parts: str | int) -> str:
        return pointer(["graph", "nodes", self.index[node_id], *parts])

    def inputs(self, node_id: str) -> list[str]:
        return node_inputs(self.by_id[node_id])

    def unknown_inputs(self) -> list[tuple[str, int | str, str]]:
        """(nœud, position ou côté, entrée inconnue)."""
        found = []
        for node in self.graph.nodes:
            if node.type == "join":
                pairs: Iterable = (("left", node.inputs.left), ("right", node.inputs.right))
            else:
                pairs = enumerate(node_inputs(node))
            found.extend((node.id, where, ref) for where, ref in pairs if ref not in self.index)
        return found

    def cycles(self) -> list[list[str]]:
        """Cycles élémentaires trouvés par parcours en profondeur, dans l'ordre du document."""
        state: dict[str, int] = {}
        stack: list[str] = []
        found: list[list[str]] = []

        def visit(node_id: str) -> None:
            state[node_id] = 1
            stack.append(node_id)
            for source in self.inputs(node_id):
                if source not in self.index:
                    continue
                if state.get(source) == 1:
                    cycle = stack[stack.index(source):]
                    found.append(list(reversed(cycle)))
                elif source not in state:
                    visit(source)
            stack.pop()
            state[node_id] = 2

        for node in self.graph.nodes:
            if node.id not in state:
                visit(node.id)
        return found

    def topological_order(self) -> list[str]:
        """Entrées avant consommateurs ; à n'appeler que sur un DAG sans entrée inconnue."""
        order: list[str] = []
        seen: set[str] = set()

        def visit(node_id: str) -> None:
            if node_id in seen:
                return
            seen.add(node_id)
            for source in self.inputs(node_id):
                visit(source)
            order.append(node_id)

        for node in self.graph.nodes:
            visit(node.id)
        return order

    def ancestors_of_output(self) -> set[str]:
        """Nœuds dont la sortie atteint `output` (output compris)."""
        reached: set[str] = set()
        pending = [self.output] if self.output in self.index else []
        while pending:
            node_id = pending.pop()
            if node_id in reached:
                continue
            reached.add(node_id)
            pending.extend(s for s in self.inputs(node_id) if s in self.index)
        return reached

    def is_dag(self) -> bool:
        return not self.unknown_inputs() and not self.cycles()


class Library:
    """Documents connus, pour résoudre `kpi_ref` et trouver le canonique d'une variante.

    Le plan 0005 la remplira depuis le dépôt de l'espace ; ici on la construit à la main.
    """

    def __init__(self, documents: Iterable[Any] = ()):
        self._kpis: dict[KpiKey, KpiDocument] = {}
        for document in documents:
            self.add(document)

    def add(self, document: Any) -> None:
        if isinstance(document, KpiDocument):
            self._kpis[(document.data_product.id, document.data_product.version)] = document

    def kpi(self, kpi_id: str, version: int) -> KpiDocument | None:
        return self._kpis.get((kpi_id, version))


def is_aggregated(view: GraphView) -> dict[str, bool]:
    """Niveau de chaque nœud : True si ses lignes sont déjà agrégées."""
    level: dict[str, bool] = {}
    for node_id in view.topological_order():
        node = view.by_id[node_id]
        inputs = [level[s] for s in view.inputs(node_id)]
        if node.type in ("aggregate", "kpi_ref", "metric_op"):
            level[node_id] = True
        elif node.type == "source":
            level[node_id] = False
        else:
            level[node_id] = all(inputs)
    return level


def _grain(view: GraphView, node_id: str) -> set[str] | None:
    """Colonnes de regroupement d'un flux agrégé, quand on les connaît."""
    node = view.by_id[node_id]
    if node.type == "aggregate":
        return set(node.group_by)
    if node.type in ("filter", "compute", "temporal", "deduplicate"):
        return _grain(view, view.inputs(node_id)[0])
    return None


def structure_issues(document: Any, library: Library | None = None) -> list[Issue]:
    view = GraphView(document.graph)
    issues: list[Issue] = []

    for node_id, where, ref in view.unknown_inputs():
        issues.append(Issue(
            view.path(node_id, "inputs", where), node_id, "unknown_input",
            f"L'entrée « {ref} » ne désigne aucun nœud du graphe.",
        ))
    for cycle in view.cycles():
        chain = " → ".join([*cycle, cycle[0]])
        issues.append(Issue(
            view.path(cycle[0], "inputs"), cycle[0], "cycle",
            f"Le graphe contient un cycle : {chain}.",
        ))
    if issues:
        return issues

    useful = view.ancestors_of_output()
    for node in document.graph.nodes:
        if node.id not in useful:
            issues.append(Issue(
                view.path(node.id), node.id, "orphan_node",
                f"Le nœud {node.id} ne mène pas à la sortie {view.output} : il est ignoré.",
                "warning",
            ))
        consumers = view.consumers[node.id]
        if len(consumers) > 1 and node.id in useful:
            dead = [c for c in consumers if c not in useful]
            if dead:
                issues.append(Issue(
                    view.path(node.id), node.id, "branch_not_merged",
                    f"La sortie de {node.id} part vers {', '.join(consumers)} ; la branche "
                    f"{', '.join(dead)} ne rejoint pas les autres par une jointure ou une union.",
                ))

    level = is_aggregated(view)
    for node in document.graph.nodes:
        if node.type == "metric_op" and not level[view.inputs(node.id)[0]]:
            issues.append(Issue(
                view.path(node.id, "inputs"), node.id, "metric_op_on_rows",
                "Une opération entre métriques s'applique à des valeurs agrégées : placer une "
                "agrégation, une référence à un KPI ou une jointure de KPI en amont.",
            ))
        if node.type == "aggregate" and level[view.inputs(node.id)[0]]:
            grain = _grain(view, view.inputs(node.id)[0])
            if grain is None or not set(node.group_by) <= grain:
                issues.append(Issue(
                    view.path(node.id, "group_by"), node.id, "reaggregation",
                    "Agrégation d'un flux déjà agrégé : vérifier que le regroupement est "
                    "compatible (une moyenne de moyennes n'est pas une moyenne).",
                    "warning",
                ))
        if node.type == "join" and node.check == "bypass":
            issues.append(Issue(
                view.path(node.id, "check"), node.id, "cardinality_bypass",
                f"Contrôle de cardinalité contourné : {node.bypass_reason}",
                "info",
            ))

    output = view.output
    if isinstance(document, KpiDocument) and not level[output]:
        issues.append(Issue(
            "/graph/output", output, "kpi_output_not_aggregated",
            f"La sortie d'un KPI doit être agrégée ; {output} produit des lignes.",
        ))
    if isinstance(document, ConceptDocument) and level[output]:
        issues.append(Issue(
            "/graph/output", output, "concept_output_aggregated",
            f"La sortie d'un concept décrit des lignes ; {output} est agrégée.",
        ))

    calendar = getattr(getattr(document, "semantics", None), "calendar", None)
    for node in document.graph.nodes:
        if node.type == "temporal" and node.operation == "period" and calendar is None:
            issues.append(Issue(
                view.path(node.id, "operation"), node.id, "missing_calendar",
                "Un découpage en périodes suppose un calendrier déclaré (semantics.calendar).",
            ))

    issues.extend(_kpi_ref_issues(document, view, library or Library()))
    return issues


def _references(document: Any) -> list[tuple[str, KpiKey]]:
    graph = getattr(document, "graph", None)
    if graph is None:
        return []
    return [(n.id, (n.kpi, n.version)) for n in graph.nodes if n.type == "kpi_ref"]


def _kpi_ref_issues(document: Any, view: GraphView, library: Library) -> list[Issue]:
    issues: list[Issue] = []
    self_key = (document.data_product.id, document.data_product.version)

    def lookup(key: KpiKey) -> Any:
        return document if key == self_key else library.kpi(*key)

    def leads_back(key: KpiKey, seen: set[KpiKey]) -> list[KpiKey] | None:
        if key == self_key:
            return [key]
        if key in seen:
            return None
        seen.add(key)
        target = lookup(key)
        for _, next_key in _references(target) if target is not None else []:
            chain = leads_back(next_key, seen)
            if chain is not None:
                return [key, *chain]
        return None

    for node_id, key in _references(document):
        if lookup(key) is None:
            issues.append(Issue(
                view.path(node_id, "kpi"), node_id, "unknown_kpi_ref",
                f"KPI « {key[0]} » en version {key[1]} introuvable.",
            ))
            continue
        chain = leads_back(key, set())
        if chain is not None:
            names = " → ".join(f"{k[0]} v{k[1]}" for k in [self_key, *chain])
            issues.append(Issue(
                view.path(node_id, "kpi"), node_id, "kpi_ref_cycle",
                f"Références circulaires entre KPI : {names}.",
            ))
    return issues
