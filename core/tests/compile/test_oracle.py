"""Oracle de fidélité (plan 0007, critère 9) : un brouillon extrait au plan 0004, complété
puis recompilé, donne sur DuckDB le même résultat que le SQL source traduit vers DuckDB."""

import copy
from pathlib import Path

import pytest
import sqlglot
import yaml
from compile_support import FIXTURES, rows
from sqlglot import exp

from skifer_atlas.compile import compile_document
from skifer_atlas.model import validate_data
from skifer_atlas.model.nodes import TODO
from skifer_atlas.run import open_database

CORPUS = Path(__file__).parents[1] / "fixtures"
ORACLE = FIXTURES / "oracle"
SCHEMA = yaml.safe_load((ORACLE / "schema.yaml").read_text(encoding="utf-8"))
# 04 et 06 portent des jointures de cardinalité `TODO` : complétées en N:1, conforme aux
# données de l'oracle. 07 et 08 ont des résidus bloquants et ne se compilent pas.
DRAFTS = ["01-stg-orders", "02-stg-customers", "03-stg-refunds",
          "04-silver-orders-enriched", "05-silver-customers-geo", "06-gold-margin-v1"]


def completed(name: str):
    data = yaml.safe_load((CORPUS / "extract" / f"{name}.yaml").read_text(encoding="utf-8"))
    source_file = data["extraction"]["source_file"]
    data = copy.deepcopy(data)
    data.pop("status")
    data.pop("extraction")
    data["data_product"].update(owner="claire.m", domain="finance")
    if data.get("entity") == TODO:
        data["entity"] = {"key": ["id"], "attributes": [{"name": "id", "type": "string"}]}
    for node in data["graph"]["nodes"]:
        if node["type"] == "source":
            node["owner"] = "claire.m"
            for column in node["columns"]:
                column["type"] = SCHEMA[node["table"]][column["name"]]
        if node.get("cardinality") == TODO:
            node["cardinality"] = "N:1"
    result = validate_data(data)
    assert result.valid, [i.to_dict() for i in result.issues]
    return result.document, CORPUS / "sql" / source_file


def source_query(path: Path) -> str:
    """Le SELECT du script source (sans le CREATE TABLE), traduit vers DuckDB."""
    [statement] = [s for s in sqlglot.parse(path.read_text(encoding="utf-8"),
                                            read="databricks") if s is not None]
    if isinstance(statement, exp.Create):
        statement = statement.expression
    return statement.sql(dialect="duckdb")


@pytest.mark.parametrize("name", DRAFTS)
def test_recompiled_draft_matches_the_source_sql(name):
    document, path = completed(name)
    compiled = compile_document(document, "duckdb")
    connection = open_database(compiled.sources, ORACLE)
    try:
        cursor = connection.execute(source_query(path))
        columns = [d[0] for d in cursor.description]
        reference = rows(columns, cursor.fetchall())
        cursor = connection.execute(compiled.sql)
        found = cursor.fetchall()
        names = [d[0] for d in cursor.description]
    finally:
        connection.close()
    assert reference, f"{name} : l'oracle ne rend aucune ligne, le test ne prouve rien"
    # Le brouillon garde les colonnes intermédiaires : on compare celles du SQL source.
    assert set(columns) <= set(names), (columns, names)
    projected = [[row[names.index(c)] for c in columns] for row in found]
    assert rows(columns, projected) == reference
