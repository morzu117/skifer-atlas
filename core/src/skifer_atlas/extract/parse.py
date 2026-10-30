"""Lecture des scripts (plan 0004) : découpage par le moteur, analyse par SQLGlot.

Le découpage (`.sql`, notebooks `.py` et `.ipynb`) vient de `skifer.analyzer.frontends`.
L'analyse se fait instruction par instruction : une instruction illisible devient un
résidu bloquant sans empêcher les autres d'être extraites.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import sqlglot
from skifer.analyzer.frontends import split_ipynb_notebook, split_py_notebook, split_sql_file

from .residues import Residue, residue

DIALECTS = ("databricks", "snowflake")
SUFFIXES = (".sql", ".py", ".ipynb")


@dataclass(frozen=True)
class ParsedStatement:
    line: int
    text: str
    ast: Any | None  # None : instruction illisible
    residues: tuple[Residue, ...] = ()


def read_statements(path: Path, dialect: str) -> tuple[list[ParsedStatement], list[Residue]]:
    """Instructions d'un script, et résidus propres au fichier (cellules illisibles)."""
    if path.suffix == ".sql":
        raws, unreadable = split_sql_file(path), []
    elif path.suffix == ".py":
        raws, unreadable = split_py_notebook(path)
    elif path.suffix == ".ipynb":
        raws, unreadable = split_ipynb_notebook(path)
    else:
        raise ValueError(f"Extension non prise en charge : {path.suffix} ({', '.join(SUFFIXES)}).")
    statements = []
    for raw in raws:
        try:
            ast = sqlglot.parse_one(raw.text, dialect=dialect)
        except sqlglot.errors.SqlglotError as error:
            kind = type(error).__name__
            statements.append(ParsedStatement(raw.line, raw.text, None,
                                              (residue("parse_error", raw.text, kind),)))
            continue
        statements.append(ParsedStatement(raw.line, raw.text, ast))
    return statements, [residue("notebook_cell_unreadable") for _ in unreadable]
