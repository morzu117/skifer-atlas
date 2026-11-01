"""Schéma `index` de la base DuckDB d'un espace (plan 0005, ADR 0005).

L'index se reconstruit à tout moment depuis le clone : ce n'est jamais une source de
vérité. Le schéma `results` (comparaisons chiffrées, plan 0009) ne se reconstruit pas
et n'est pas touché ici.
"""

from __future__ import annotations

from pathlib import Path

import duckdb

from ..dbfile import open_db

SCHEMA_VERSION = 1

DDL = """
CREATE SCHEMA "index";
CREATE TABLE "index".documents (
    id VARCHAR NOT NULL,
    kind VARCHAR NOT NULL,          -- concept | kpi | variant
    label VARCHAR NOT NULL,
    domain VARCHAR,
    owner VARCHAR,
    version INTEGER,
    status VARCHAR NOT NULL,        -- validated | draft | needs_curation | invalid
    description VARCHAR,
    synonyms VARCHAR[] NOT NULL,
    fingerprint VARCHAR,
    path VARCHAR NOT NULL,
    issues VARCHAR NOT NULL         -- JSON : [{path, node_id, code, message, severity}]
);
CREATE TABLE "index".variants (
    id VARCHAR NOT NULL,
    kpi_id VARCHAR NOT NULL,
    kpi_version INTEGER,
    entity VARCHAR NOT NULL,
    mode VARCHAR NOT NULL,          -- override | from_scratch
    override_count INTEGER NOT NULL,
    undeclared_count INTEGER NOT NULL
);
CREATE TABLE "index".dependencies (
    from_id VARCHAR NOT NULL,
    to_id VARCHAR NOT NULL,
    to_version INTEGER,             -- NULL pour un concept (référence sans version)
    kind VARCHAR NOT NULL           -- kpi_ref | concept
);
CREATE TABLE "index".index_meta (
    "commit" VARCHAR NOT NULL,
    built_at TIMESTAMP NOT NULL,    -- UTC
    schema_version INTEGER NOT NULL
);
"""


def connect(db: Path) -> duckdb.DuckDBPyConnection:
    return open_db(db)


def index_state(connection: duckdb.DuckDBPyConnection) -> tuple[str, int] | None:
    """(commit, version de schéma) de l'index, ou None s'il n'existe pas."""
    try:
        row = connection.execute(
            'SELECT "commit", schema_version FROM "index".index_meta'
        ).fetchone()
    except duckdb.CatalogException:
        return None
    return (row[0], row[1]) if row else None
