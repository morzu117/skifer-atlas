"""Schéma `results` de la base DuckDB d'un espace (plan 0009, ADR 0005 et 0012).

Il vit dans le même fichier que l'index (`atlas.duckdb`), mais ne se reconstruit pas :
scope, SQL exécutés et résultats sont conservés sans limite (brief 8.4). Les résultats
rapatriés des plateformes ne sont jamais écrits tels quels : ils restent en mémoire le
temps de la réconciliation, et seules les cellules sont enregistrées.
"""

from __future__ import annotations

import json
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb

SCHEMA_VERSION = 1

DDL = """
CREATE SCHEMA IF NOT EXISTS results;
CREATE TABLE IF NOT EXISTS results.comparisons (
    id INTEGER PRIMARY KEY,
    started_at TIMESTAMP NOT NULL,      -- UTC
    finished_at TIMESTAMP,
    user_account VARCHAR,
    kpi_id VARCHAR NOT NULL,
    kpi_version INTEGER NOT NULL,
    scope_json VARCHAR NOT NULL,
    tolerance_pct DOUBLE NOT NULL,
    status VARCHAR NOT NULL,            -- running | done | partial | failed | cancelled
    error VARCHAR,
    schema_version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS results.comparison_runs (
    comparison_id INTEGER NOT NULL,
    variant_id VARCHAR NOT NULL,
    side VARCHAR NOT NULL,              -- canonical | variant
    platform VARCHAR NOT NULL,
    access_point VARCHAR,               -- NULL en exécution locale
    sql_text VARCHAR NOT NULL,
    sql_sha256 VARCHAR NOT NULL,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    status VARCHAR NOT NULL,            -- done | failed | cancelled | skipped
    error VARCHAR,
    row_count INTEGER
);
CREATE TABLE IF NOT EXISTS results.cells (
    comparison_id INTEGER NOT NULL,
    variant_id VARCHAR NOT NULL,
    dims_json VARCHAR NOT NULL,
    canonical_value DOUBLE,
    variant_value DOUBLE,
    gap_pct DOUBLE,
    within_tolerance BOOLEAN NOT NULL,
    missing VARCHAR                     -- côté absent : canonical | variant
);
CREATE TABLE IF NOT EXISTS results.summaries (
    comparison_id INTEGER NOT NULL,
    variant_id VARCHAR NOT NULL,
    entity VARCHAR NOT NULL,
    variant_version INTEGER NOT NULL,
    platform VARCHAR NOT NULL,
    access_point VARCHAR,
    cell_count INTEGER NOT NULL,
    validation_pct DOUBLE,
    max_gap_pct DOUBLE,
    divergent_node VARCHAR,
    divergent_json VARCHAR,
    bypass_nodes VARCHAR[] NOT NULL,
    differences_json VARCHAR NOT NULL
);
"""

_lock = threading.RLock()  # `connect` le reprend sous `create` et `finish`


def now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def connect(db: Path) -> duckdb.DuckDBPyConnection:
    db.parent.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect(str(db))
    ensure_schema(connection)
    return connection


def ensure_schema(connection: duckdb.DuckDBPyConnection) -> None:
    """Crée le schéma `results` s'il manque. Toujours sous le verrou : deux créations
    simultanées donnent « Catalog write-write conflict »."""
    with _lock:
        connection.execute(DDL)


def _records(cursor: duckdb.DuckDBPyConnection) -> list[dict]:
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]


def create(db: Path, account: str | None, kpi_id: str, kpi_version: int, scope: dict,
           tolerance: float) -> int:
    with _lock:
        connection = connect(db)
        try:
            [(number,)] = connection.execute(
                "SELECT coalesce(max(id), 0) + 1 FROM results.comparisons").fetchall()
            connection.execute(
                "INSERT INTO results.comparisons VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'running', "
                "NULL, ?)", [number, now(), account, kpi_id, kpi_version,
                             json.dumps(scope, ensure_ascii=False), tolerance, SCHEMA_VERSION])
        finally:
            connection.close()
    return number


def finish(db: Path, number: int, status: str, error: str | None, runs: list[dict],
           cells: list[tuple], summaries: list[dict]) -> None:
    """Tout le résultat d'une comparaison, en une transaction."""
    with _lock:
        connection = connect(db)
        try:
            connection.execute("BEGIN TRANSACTION")
            if runs:
                connection.executemany(
                    "INSERT INTO results.comparison_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "
                    "?, ?)", [[number, r["variant_id"], r["side"], r["platform"],
                               r["access_point"], r["sql_text"], r["sql_sha256"],
                               r["started_at"], r["finished_at"], r["status"], r["error"],
                               r["row_count"]] for r in runs])
            if cells:
                connection.executemany(
                    "INSERT INTO results.cells VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [[number, *cell] for cell in cells])
            if summaries:
                connection.executemany(
                    "INSERT INTO results.summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "
                    "?)", [[number, s["variant_id"], s["entity"], s["variant_version"],
                            s["platform"], s["access_point"], s["cell_count"],
                            s["validation_pct"], s["max_gap_pct"], s["divergent_node"],
                            json.dumps(s["divergent"], ensure_ascii=False),
                            s["bypass_nodes"],
                            json.dumps(s["differences"], ensure_ascii=False)]
                           for s in summaries])
            connection.execute(
                "UPDATE results.comparisons SET status = ?, error = ?, finished_at = ? "
                "WHERE id = ?", [status, error, now(), number])
            connection.execute("COMMIT")
        except BaseException:
            connection.execute("ROLLBACK")
            raise
        finally:
            connection.close()


def _comparison(row: dict) -> dict:
    row["scope"] = json.loads(row.pop("scope_json"))
    row.pop("schema_version", None)
    return row


def _summary(row: dict) -> dict:
    row["divergent"] = json.loads(row.pop("divergent_json") or "null")
    row["differences"] = json.loads(row.pop("differences_json"))
    row.pop("comparison_id", None)
    return row


def get(db: Path, number: int) -> dict | None:
    if not db.exists():
        return None
    connection = connect(db)
    try:
        found = _records(connection.execute(
            "SELECT * FROM results.comparisons WHERE id = ?", [number]))
        if not found:
            return None
        comparison = _comparison(found[0])
        runs = _records(connection.execute(
            "SELECT * EXCLUDE (comparison_id) FROM results.comparison_runs "
            "WHERE comparison_id = ? ORDER BY variant_id, side", [number]))
        summaries = [_summary(s) for s in _records(connection.execute(
            "SELECT * FROM results.summaries WHERE comparison_id = ? ORDER BY entity",
            [number]))]
        cells = _records(connection.execute(
            "SELECT variant_id, dims_json, canonical_value, variant_value, gap_pct, "
            "within_tolerance, missing FROM results.cells WHERE comparison_id = ? "
            "ORDER BY variant_id, dims_json", [number]))
    finally:
        connection.close()
    by_variant: dict[str, list[dict]] = {}
    for cell in cells:
        cell["dims"] = json.loads(cell.pop("dims_json"))
        by_variant.setdefault(cell.pop("variant_id"), []).append(cell)
    for summary in summaries:
        summary["cells"] = by_variant.get(summary["variant_id"], [])
    comparison["runs"] = runs
    comparison["results"] = summaries
    return comparison


def history(db: Path, kpi_id: str | None = None, limit: int = 50) -> list[dict]:
    """Comparaisons les plus récentes d'abord, avec leurs synthèses (sans les cellules)."""
    if not db.exists():
        return []
    connection = connect(db)
    try:
        condition, parameters = ("WHERE kpi_id = ?", [kpi_id]) if kpi_id else ("", [])
        found = [_comparison(row) for row in _records(connection.execute(
            f"SELECT * FROM results.comparisons {condition} ORDER BY id DESC LIMIT ?",
            [*parameters, limit]))]
        for comparison in found:
            comparison["results"] = _records(connection.execute(
                "SELECT variant_id, entity, validation_pct, max_gap_pct, divergent_node "
                "FROM results.summaries WHERE comparison_id = ? ORDER BY entity",
                [comparison["id"]]))
    finally:
        connection.close()
    return found


LATEST = """
    SELECT c.kpi_id, c.kpi_version, s.variant_id, s.entity, s.variant_version,
           s.validation_pct, s.max_gap_pct, s.divergent_node, c.id AS comparison_id,
           c.finished_at, c.tolerance_pct
    FROM results.summaries s JOIN results.comparisons c ON c.id = s.comparison_id
    WHERE c.status IN ('done', 'partial')
    QUALIFY row_number() OVER (PARTITION BY c.kpi_id, s.variant_id ORDER BY c.id DESC) = 1
"""


def latest(connection: duckdb.DuckDBPyConnection) -> list[dict]:
    """Dernier résultat par KPI × déclinaison. `connection` est celle de l'index."""
    ensure_schema(connection)
    return _records(connection.execute(LATEST + " ORDER BY kpi_id, entity"))


def matrix(connection: duckdb.DuckDBPyConnection, domain: str | None = None) -> list[dict]:
    """Synthèse 10.5 : une ligne par KPI de l'index (filtré par domaine), et la dernière
    comparaison de chacune de ses déclinaisons à sa version courante."""
    ensure_schema(connection)
    condition, parameters = ("AND d.domain = ?", [domain]) if domain else ("", [])
    kpis = _records(connection.execute(f"""
        SELECT d.id AS kpi_id, d.label, d.domain, d.version
        FROM "index".documents d WHERE d.kind = 'kpi' {condition} ORDER BY d.label, d.id
    """, parameters))
    variants = _records(connection.execute(
        'SELECT v.id AS variant_id, v.kpi_id, v.entity FROM "index".variants v '
        "ORDER BY v.entity"))
    results = {(r["kpi_id"], r["variant_id"]): r for r in latest(connection)}
    for kpi in kpis:
        kpi["variants"] = []
        for variant in (v for v in variants if v["kpi_id"] == kpi["kpi_id"]):
            found: dict[str, Any] | None = results.get((kpi["kpi_id"], variant["variant_id"]))
            cell = {"variant_id": variant["variant_id"], "entity": variant["entity"],
                    "compared": found is not None}
            if found is not None:
                cell.update({k: found[k] for k in ("comparison_id", "kpi_version",
                                                    "validation_pct", "max_gap_pct",
                                                    "divergent_node", "finished_at")})
                cell["stale"] = found["kpi_version"] != kpi["version"]
            kpi["variants"].append(cell)
    return kpis
