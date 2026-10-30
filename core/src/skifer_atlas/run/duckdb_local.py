"""Exécute le SQL DuckDB d'un KPI sur des fichiers locaux (plan 0007).

Chaque source `catalogue.schéma.table` se lit dans `<données>/catalogue.schéma.table.csv`
(ou `.parquet`). La table est créée avec les types déclarés par la source ; une colonne
au type encore à compléter se charge en texte. Les dates et horodatages des CSV sont au
format ISO. Rien n'est écrit sur disque : la base est en mémoire.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import duckdb

from ..compile import Compiled, SourceTable

_TYPES = {"string": "VARCHAR", "integer": "BIGINT", "decimal": "DECIMAL(38, 10)",
          "double": "DOUBLE", "boolean": "BOOLEAN", "date": "DATE", "timestamp": "TIMESTAMP"}


class MissingData(Exception):
    def __init__(self, table: str, folder: Path):
        super().__init__(f"Données introuvables pour {table} : {folder / table}.csv "
                         "ou .parquet attendu.")
        self.table = table


@dataclass
class Result:
    columns: list[str]
    rows: list[tuple[Any, ...]]


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _data_file(table: str, folder: Path) -> Path:
    for suffix in (".csv", ".parquet"):
        path = folder / f"{table}{suffix}"
        if path.is_file():
            return path
    raise MissingData(table, folder)


def _load(connection: duckdb.DuckDBPyConnection, table: str,
          columns: tuple[tuple[str, str | None], ...], path: Path) -> None:
    parts = table.split(".")
    if len(parts) == 3 and parts[0] not in {row[0] for row in connection.execute(
            "SELECT database_name FROM duckdb_databases()").fetchall()}:
        connection.execute(f"ATTACH ':memory:' AS {_quote(parts[0])}")
    if len(parts) >= 2:
        connection.execute(f"CREATE SCHEMA IF NOT EXISTS {'.'.join(map(_quote, parts[:-1]))}")
    target = ".".join(map(_quote, parts))
    typed = ", ".join(f"CAST({_quote(n)} AS {_TYPES.get(t or '', 'VARCHAR')}) AS {_quote(n)}"
                      for n, t in columns)
    if path.suffix == ".csv":
        reader = "read_csv(?, header = true, all_varchar = true)"
    else:
        reader = "read_parquet(?)"
    connection.execute(f"CREATE TABLE {target} AS SELECT {typed} FROM {reader}", [str(path)])


def open_database(sources: list[SourceTable], data: Path) -> duckdb.DuckDBPyConnection:
    """Base DuckDB en mémoire où chaque source est chargée depuis `data`."""
    connection = duckdb.connect(":memory:")
    try:
        connection.execute("SET TimeZone = 'UTC'")
        for source in sources:
            _load(connection, source.table, source.columns, _data_file(source.table, data))
    except BaseException:
        connection.close()
        raise
    return connection


def run_local(compiled: Compiled, data: Path) -> Result:
    """Charge les sources depuis `data` puis exécute la requête compilée pour DuckDB."""
    if compiled.dialect != "duckdb":
        raise ValueError("L'exécution locale suppose une compilation pour DuckDB.")
    connection = open_database(compiled.sources, data)
    try:
        cursor = connection.execute(compiled.sql)
        return Result([d[0] for d in cursor.description], cursor.fetchall())
    finally:
        connection.close()
