"""Lecture de l'index : catalogue, fiche d'un document, dépendances (plan 0005)."""

from __future__ import annotations

import json

import duckdb

CATALOG_KINDS = ("concept", "kpi")

_NORMALIZE = "lower(strip_accents({}))"
_SYNONYMS = "array_to_string(synonyms, chr(31))"  # séparateur : pas de correspondance à cheval


def _records(cursor: duckdb.DuckDBPyConnection) -> list[dict]:
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]


def _convergence(kind: str, variant_count: int) -> str | None:
    """Sans résultat de comparaison (plan 0009), un KPI à variantes n'a jamais été
    comparé ; un KPI sans variante converge par construction."""
    if kind != "kpi":
        return None
    return "converged" if variant_count == 0 else "never_compared"


def catalog(connection: duckdb.DuckDBPyConnection, q: str | None = None,
            domain: str | None = None, owner: str | None = None, status: str | None = None,
            kind: str | None = None) -> list[dict]:
    """Concepts et KPI, filtrés et classés : libellé ou identifiant, puis synonymes, puis
    description. Sans recherche, l'ordre est alphabétique."""
    needle = _NORMALIZE.format("?")
    label, ident = _NORMALIZE.format("d.label"), _NORMALIZE.format("d.id")
    synonyms, description = _NORMALIZE.format(_SYNONYMS), _NORMALIZE.format("d.description")
    conditions, parameters = ["d.kind IN ('concept', 'kpi')"], []
    rank = "0"
    if q and q.strip():
        term = q.strip()
        rank = (f"CASE WHEN contains({label}, {needle}) OR contains({ident}, {needle}) THEN 0 "
                f"WHEN contains({synonyms}, {needle}) THEN 1 ELSE 2 END")
        conditions.append(f"(contains({label}, {needle}) OR contains({ident}, {needle}) "
                          f"OR contains({synonyms}, {needle}) "
                          f"OR contains(coalesce({description}, ''), {needle}))")
        parameters = [term] * 3 + [term] * 4
    for column, value in (("domain", domain), ("owner", owner), ("status", status),
                          ("kind", kind)):
        if value:
            conditions.append(f"d.{column} = ?")
            parameters.append(value)
    rows = _records(connection.execute(f"""
        SELECT d.id, d.kind, d.label, d.domain, d.owner, d.version, d.status, d.description,
               d.synonyms, coalesce(v.n, 0) AS variant_count, {rank} AS rank
        FROM "index".documents d
        LEFT JOIN (SELECT kpi_id, count(*) AS n FROM "index".variants GROUP BY kpi_id) v
               ON v.kpi_id = d.id AND d.kind = 'kpi'
        WHERE {" AND ".join(conditions)}
        ORDER BY rank, {label}, d.id
    """, parameters))
    for row in rows:
        del row["rank"]
        row["convergence"] = _convergence(row["kind"], row["variant_count"])
    return rows


def document(connection: duckdb.DuckDBPyConnection, document_id: str) -> dict | None:
    """Ligne d'index d'un document, avec ses diagnostics et, pour un KPI, ses variantes."""
    found = _records(connection.execute(
        'SELECT * FROM "index".documents WHERE id = ?', [document_id]))
    if not found:
        return None
    row = found[0]
    row["issues"] = json.loads(row["issues"])
    if row["kind"] == "kpi":
        row["variants"] = _records(connection.execute("""
            SELECT v.id, v.entity, v.mode, v.kpi_version, v.override_count, v.undeclared_count,
                   d.version, d.owner, d.status
            FROM "index".variants v JOIN "index".documents d ON d.id = v.id
            WHERE v.kpi_id = ? ORDER BY v.entity
        """, [document_id]))
    if row["kind"] == "variant":
        [variant] = _records(connection.execute(
            'SELECT kpi_id, kpi_version, entity, mode, override_count, undeclared_count '
            'FROM "index".variants WHERE id = ?', [document_id]))
        row["variant"] = variant
    return row


def dependencies(connection: duckdb.DuckDBPyConnection, document_id: str) -> dict:
    """Références directes, référencés directs, et impact : nombre de documents qui en
    dépendent, directement ou non."""
    references = _records(connection.execute("""
        SELECT dep.to_id AS id, dep.kind, dep.to_version AS version, d.kind AS document_kind,
               d.label, d.status, d.id IS NOT NULL AS found
        FROM "index".dependencies dep LEFT JOIN "index".documents d ON d.id = dep.to_id
        WHERE dep.from_id = ? ORDER BY dep.to_id, dep.kind
    """, [document_id]))
    referenced_by = _records(connection.execute("""
        SELECT dep.from_id AS id, dep.kind, dep.to_version AS version,
               d.kind AS document_kind, d.label, d.status, d.version AS document_version
        FROM "index".dependencies dep JOIN "index".documents d ON d.id = dep.from_id
        WHERE dep.to_id = ? ORDER BY dep.from_id, dep.kind
    """, [document_id]))
    [(impact,)] = connection.execute("""
        WITH RECURSIVE upstream(id) AS (
            SELECT from_id FROM "index".dependencies WHERE to_id = ?
            UNION
            SELECT dep.from_id FROM "index".dependencies dep JOIN upstream u ON dep.to_id = u.id
        )
        SELECT count(DISTINCT id) FROM upstream WHERE id <> ?
    """, [document_id, document_id]).fetchall()
    return {"references": references, "referenced_by": referenced_by, "impact": impact}
