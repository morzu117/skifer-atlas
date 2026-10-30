"""Aperçu d'un document pour le catalogue (plan 0011) : l'index (plan 0005), la
gouvernance (plan 0006) et la dernière comparaison chiffrée (plan 0009).

Chaque partie est facultative : un champ qu'on ne sait pas remplir reste vide, l'aperçu
s'affiche quand même.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import duckdb

from ..model.io import read_yaml
from ..repo.layout import read_governance
from .search import _records, dependencies, document


def _mapping(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _variation_points(repo: Path, path: str) -> list[dict]:
    """Nœuds déclarés comme points de variation, avec leur libellé, dans l'ordre du YAML."""
    try:
        raw, issues = read_yaml((repo / path).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        return []
    if issues:
        return []
    raw = _mapping(raw)
    nodes = {_mapping(n).get("id"): _mapping(n) for n in
             _mapping(raw.get("graph")).get("nodes") or [] if isinstance(n, dict)}
    points = raw.get("variation_points")
    return [{"node_id": node_id, "label": nodes.get(node_id, {}).get("label")}
            for node_id in (points if isinstance(points, list) else [])
            if isinstance(node_id, str)]


def _last_comparison(connection: duckdb.DuckDBPyConnection, kpi_id: str,
                     version: int | None) -> dict | None:
    """Dernière comparaison terminée du KPI ; son taux de validation est la part des
    cellules dans la tolérance, toutes déclinaisons confondues."""
    from ..compare.store import DDL  # import tardif : `compare` lit l'index

    connection.execute(DDL)
    found = _records(connection.execute("""
        SELECT c.id, c.finished_at, c.kpi_version, c.status,
               sum(s.validation_pct * s.cell_count) / nullif(sum(s.cell_count), 0)
                   AS validation_pct
        FROM results.comparisons c JOIN results.summaries s ON s.comparison_id = c.id
        WHERE c.kpi_id = ? AND c.status IN ('done', 'partial')
        GROUP BY c.id, c.finished_at, c.kpi_version, c.status
        ORDER BY c.id DESC LIMIT 1
    """, [kpi_id]))
    if not found:
        return None
    [last] = found
    last["stale"] = last["kpi_version"] != version
    return last


def summary(connection: duckdb.DuckDBPyConnection, repo: Path,
            document_id: str) -> dict | None:
    row = document(connection, document_id)
    if row is None:
        return None
    governance = read_governance(repo)
    domains = {d.id: d.label for d in governance.domains} if governance else {}
    members = {m.account: m.name for m in governance.members} if governance else {}
    referenced_by: dict[str, dict] = {}
    for found in dependencies(connection, document_id)["referenced_by"]:
        if found["id"] != document_id:
            referenced_by.setdefault(found["id"], {"id": found["id"], "label": found["label"],
                                                   "kind": found["document_kind"]})
    kpi = row["kind"] == "kpi"
    return {
        **{key: row[key] for key in ("id", "kind", "label", "domain", "owner", "version",
                                     "status", "description", "synonyms")},
        "domain_label": domains.get(row["domain"]),
        "owner_name": members.get(row["owner"]),
        "variation_points": _variation_points(repo, row["path"]) if kpi else [],
        "variants": [{key: v[key] for key in ("id", "entity", "mode")}
                     for v in row.get("variants", [])],
        "referenced_by": sorted(referenced_by.values(), key=lambda r: (r["label"], r["id"])),
        "last_comparison": _last_comparison(connection, document_id, row["version"])
        if kpi else None,
    }
