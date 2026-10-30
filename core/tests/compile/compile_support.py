"""Outils des tests de compilation : fixtures, exécution DuckDB, comparaison de résultats."""

import csv
import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from skifer_atlas.compile import compile_document, load_calendars
from skifer_atlas.model import load_document
from skifer_atlas.model.graph import Library
from skifer_atlas.run import run_local

FIXTURES = Path(__file__).parents[1] / "fixtures" / "compile"
NORDIS = Path(__file__).parents[3] / "examples" / "espace-nordis"


def load(path: Path):
    return load_document(path)


def nordis_revenue():
    return load(NORDIS / "kpis" / "revenu-net.yaml"), load_calendars(NORDIS / "calendars")


def catalogue():
    """KPI à un nœud de chaque type, et la bibliothèque du KPI qu'il référence."""
    folder = FIXTURES / "catalogue"
    return load(folder / "ventes.yaml"), Library([load(folder / "objectifs.yaml")])


def cell(value) -> str:
    """Valeur comparable d'un moteur à l'autre : nombres sans zéros superflus, arrondis à
    1e-9 près, dates ISO, NULL en chaîne vide."""
    if value is None or value == "":
        return ""
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, float):
        value = round(value, 9)
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        return str(value)
    if not number.is_finite():
        return str(value)
    number = round(number, 9).normalize()
    return format(number, "f") if number != 0 else "0"


def rows(columns, values) -> list[dict[str, str]]:
    found = [{c: cell(v) for c, v in zip(columns, row, strict=True)} for row in values]
    return sorted(found, key=lambda r: [r[c] for c in columns])


def expected(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        columns = next(reader)
        return rows(columns, list(reader))


def run(document, data: Path, **options):
    result = run_local(compile_document(document, "duckdb", **options), data)
    return rows(result.columns, result.rows)
