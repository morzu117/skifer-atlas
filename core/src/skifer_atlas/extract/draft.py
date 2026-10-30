"""Brouillon de document à partir d'une instruction SQL (plan 0004, ADR 0006).

Le brouillon est un document Atlas ordinaire, `status: draft`, dont les valeurs que le
SQL ne donne pas valent `TODO`. Il est contrôlé comme un document curé : ce qui échoue
devient un résidu `invalid_draft`, et tout résidu bloquant le passe en `needs_curation`.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..model.check import check_document
from ..model.document import validate_data
from ..model.graph import GraphView, is_aggregated
from ..model.io import dump_data, dump_document
from ..model.nodes import TODO, Graph
from .parse import ParsedStatement
from .residues import Residue, residue
from .translate import Translator


@dataclass
class Draft:
    source_file: str
    line: int
    data: dict[str, Any]
    residues: list[Residue] = field(default_factory=list)
    document: Any | None = None  # le document validé, quand le brouillon passe le contrôle

    @property
    def id(self) -> str:
        return self.data["data_product"]["id"]

    @property
    def status(self) -> str:
        return self.data["status"]

    def text(self) -> str:
        return dump_document(self.document) if self.document is not None else dump_data(self.data)


def slug(text: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    value = value if re.match(r"^[a-z0-9]", value) else f"x-{value}"
    return (value if len(value) >= 2 else f"{value}-x")[:64].rstrip("-")


def _aggregated(nodes: list[dict[str, Any]], output: str) -> bool:
    try:
        graph = Graph.model_validate({"nodes": [_finish(n) for n in nodes], "output": output})
    except ValueError:
        # Graphe incomplet : on s'en tient au type des nœuds.
        return any(n["type"] in ("aggregate", "metric_op", "kpi_ref") for n in nodes)
    view = GraphView(graph)
    return bool(view.is_dag() and is_aggregated(view)[output])


def build_draft(
    path: Path, statement: ParsedStatement, dialect: str, index: int | None = None,
) -> Draft:
    """Brouillon d'une instruction ; `index` distingue les instructions d'un même fichier."""
    translator = Translator(dialect)
    rel, target = (None, None)
    if statement.ast is not None:
        rel, target = translator.statement(statement.ast)
    residues = [*statement.residues, *translator.residues]
    nodes = translator.nodes
    stem = slug(path.stem)
    draft_id = slug(f"{stem}-{index}") if index is not None else stem

    data: dict[str, Any] = {"schema_version": 1}
    if not nodes:
        # Rien de traduit : un concept vide, à reprendre entièrement.
        kind, output = "concept", None
    else:
        output = rel.node if rel is not None else nodes[-1]["id"]
        kind = "kpi" if _aggregated(nodes, output) else "concept"
    data["kind"] = kind
    data["status"] = "draft"
    data["data_product"] = {"id": draft_id, "version": 1, "owner": TODO, "domain": TODO}
    data["label"] = target or path.stem
    if kind == "kpi":
        data["semantics"] = {"calendar": TODO, "timezone": TODO}
    else:
        data["entity"] = TODO
    if nodes:
        data["graph"] = {"nodes": [_finish(node) for node in nodes], "output": output}
    data["extraction"] = {
        "source_file": path.name,
        "line": statement.line,
        "dialect": dialect,
        "sql_sha256": hashlib.sha256(statement.text.encode("utf-8")).hexdigest(),
        "residues": [],
    }

    for problem in _problems(data):
        found = residue("invalid_draft", detail=problem)
        if found not in residues:
            residues.append(found)
    data["extraction"]["residues"] = [r.to_dict() for r in residues]
    document = None
    if any(r.blocking for r in residues):
        data["status"] = "needs_curation"
    else:
        document = validate_data(data).document
    return Draft(path.name, statement.line, data, residues, document)


def _finish(node: dict[str, Any]) -> dict[str, Any]:
    """Nœud prêt à écrire : colonnes de source typées `TODO`, au moins une colonne."""
    if node["type"] != "source":
        return dict(node)
    columns = [{"name": name, "type": TODO} for name in node["columns"]]
    return {**node, "columns": columns or [{"name": TODO, "type": TODO}]}


def _problems(data: dict[str, Any]) -> list[str]:
    """Code (et nœud) de chaque erreur du brouillon, hors valeurs à compléter."""
    result = validate_data(data)
    problems = [
        f"{issue.code} ({issue.node_id})" if issue.node_id else issue.code
        for issue in result.issues if issue.severity == "error" and issue.code != "todo"
    ]
    document = result.document
    if document is not None and document.graph is not None:
        problems += [
            f"{issue.code} ({issue.node_id})" if issue.node_id else issue.code
            for issue in check_document(document) if issue.severity == "error"
        ]
    return list(dict.fromkeys(problems))
