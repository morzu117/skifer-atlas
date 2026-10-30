"""Mode extraction (plan 0004) : SQL Databricks ou Snowflake existant vers brouillon Atlas.

`extract_file` découpe un script, traduit chaque requête en graphe, produit un brouillon
par requête et le confronte au SQL source (oracle de fidélité). Ce qui n'est pas une
requête (instruction `UPDATE`, cellule de notebook illisible) est signalé au niveau du
fichier, sans brouillon.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .draft import Draft, build_draft
from .oracle import Roundtrip, roundtrip
from .parse import DIALECTS, SUFFIXES, read_statements
from .residues import CODES, Residue, residue
from .translate import query_of

__all__ = [
    "CODES", "DIALECTS", "SUFFIXES", "Extraction", "FileExtraction", "Residue", "extract_file",
    "report_dict", "report_json", "report_text",
]

NULLS_INFERRED = "nulls_inferred"


@dataclass
class Extraction:
    draft: Draft
    roundtrip: Roundtrip
    infos: list[dict[str, Any]]

    @property
    def blocking(self) -> bool:
        return any(r.blocking for r in self.draft.residues)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.draft.id,
            "line": self.draft.line,
            "kind": self.draft.data["kind"],
            "status": self.draft.status,
            "roundtrip": self.roundtrip.to_dict(),
            "residues": [r.to_dict() for r in self.draft.residues],
            "infos": self.infos,
        }


@dataclass
class FileExtraction:
    file: str
    extractions: list[Extraction] = field(default_factory=list)
    residues: list[tuple[int | None, Residue]] = field(default_factory=list)  # (ligne, résidu)

    @property
    def drafts(self) -> list[Draft]:
        return [extraction.draft for extraction in self.extractions]

    def to_dict(self) -> dict[str, Any]:
        return {
            "file": self.file,
            "residues": [{"line": line, **found.to_dict()} if line else found.to_dict()
                         for line, found in self.residues],
            "statements": [extraction.to_dict() for extraction in self.extractions],
        }


def _infos(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"code": NULLS_INFERRED, "node_id": node["id"],
         "message": f"nulls: {node['nulls']} déduit du SQL : à confirmer."}
        for node in nodes if node["type"] == "filter"
    ]


def extract_file(path: Path, dialect: str, name: str | None = None) -> FileExtraction:
    """Brouillons d'un script ; `name` est le nom du fichier dans le rapport."""
    if dialect not in DIALECTS:
        raise ValueError(f"Dialecte inconnu : {dialect} ({', '.join(DIALECTS)}).")
    statements, unreadable = read_statements(path, dialect)
    result = FileExtraction(name or path.name, residues=[(None, r) for r in unreadable])
    queries = []
    for statement in statements:
        if statement.ast is not None and query_of(statement.ast) is None:
            result.residues.append((statement.line, residue(
                "unsupported_statement", statement.text, statement.ast.key.upper(),
            )))
        else:
            queries.append(statement)
    for index, statement in enumerate(queries, start=1):
        draft = build_draft(path, statement, dialect, index if len(queries) > 1 else None)
        nodes = draft.data.get("graph", {}).get("nodes", [])
        check = roundtrip(statement.ast, nodes, any(r.blocking for r in draft.residues))
        result.extractions.append(Extraction(draft, check, _infos(nodes)))
    return result


def report_dict(results: list[FileExtraction]) -> list[dict[str, Any]]:
    return [result.to_dict() for result in results]


def report_json(results: list[FileExtraction]) -> str:
    return json.dumps(report_dict(results), indent=2, ensure_ascii=False) + "\n"


def report_text(results: list[FileExtraction]) -> str:
    lines = []
    for result in results:
        if not result.extractions:
            lines.append(f"{result.file} : aucune requête")
        for line, found in result.residues:
            where = f"{result.file}:{line}" if line else result.file
            lines.append(f"{where} [{found.code}] {found.message}")
        for extraction in result.extractions:
            draft = extraction.draft
            check = extraction.roundtrip
            fidelity = check.status + (f" ({', '.join(check.differs)})" if check.differs else "")
            lines.append(
                f"{result.file}:{draft.line} → {draft.id} ({draft.data['kind']}, "
                f"{draft.status}), fidélité {fidelity}"
            )
            for found in draft.residues:
                marker = "bloquant" if found.blocking else "à revoir"
                lines.append(f"  {marker:<9} [{found.code}] {found.message}")
            for info in extraction.infos:
                lines.append(f"  info      {info['node_id']} [{info['code']}] {info['message']}")
    return "\n".join(lines) + "\n"
