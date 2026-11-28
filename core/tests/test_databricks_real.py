"""Recette hors CI sur un SQL warehouse Databricks, avec des données minuscules."""

import datetime
import os
import sys
import uuid
from decimal import Decimal
from pathlib import Path

import pytest
import sqlglot
from sqlglot import exp

from skifer_atlas.compile import Scope, compile_document, load_calendars
from skifer_atlas.connectors.base import AuthRejected
from skifer_atlas.repo.git import RepoError

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / "compile"))
import databricks_recette
from compile_support import FIXTURES, catalogue, expected, load, nordis_revenue, rows, run
from databricks_recette import load_sources, quote
from test_compile import FILTERS, kpi

pytestmark = pytest.mark.databricks
HOST = os.environ.get("ATLAS_DATABRICKS_HOST")
WAREHOUSE = os.environ.get("ATLAS_DATABRICKS_WAREHOUSE")
TOKEN = os.environ.get("ATLAS_DATABRICKS_TOKEN")
if not all((HOST, WAREHOUSE, TOKEN)):
    pytest.skip("Recette Databricks : ATLAS_DATABRICKS_HOST, ATLAS_DATABRICKS_WAREHOUSE "
                "et ATLAS_DATABRICKS_TOKEN sont requis", allow_module_level=True)


def connector(warehouse=WAREHOUSE, token=TOKEN):
    return databricks_recette.connector(HOST, warehouse, token)


def target(catalog, schema, table):
    return ".".join(map(quote, (catalog, schema, table.replace(".", "__"))))


@pytest.fixture(scope="session")
def warehouse():
    return connector()


@pytest.fixture(scope="session")
def namespace(warehouse, request):
    catalog = os.environ.get("ATLAS_DATABRICKS_CATALOG") or "atlas_recette"
    schema = "r_" + uuid.uuid4().hex
    warehouse.run_aggregate(f"CREATE CATALOG IF NOT EXISTS {quote(catalog)}")
    # Enregistrer le nettoyage avant la création, même si sa réponse est perdue.
    request.addfinalizer(lambda: warehouse.run_aggregate(
        f"DROP SCHEMA IF EXISTS {quote(catalog)}.{quote(schema)} CASCADE"))
    warehouse.run_aggregate(f"CREATE SCHEMA {quote(catalog)}.{quote(schema)}")
    return catalog, schema


def load_tables(warehouse, namespace, compiled, folder):
    catalog, schema = namespace
    load_sources(warehouse, compiled.sources, folder,
                 lambda table: target(catalog, schema, table))


def renamed_sql(compiled, namespace):
    catalog, schema = namespace
    names = {source.table: target(catalog, schema, source.table) for source in compiled.sources}
    tree = sqlglot.parse_one(compiled.sql, read="databricks")
    seen = set()
    for table in tree.find_all(exp.Table):
        name = ".".join(part.name for part in table.parts)
        if name in names:
            replacement = sqlglot.parse_one(names[name], into=exp.Table, read="databricks")
            table.set("this", replacement.this)
            table.set("db", replacement.args["db"])
            table.set("catalog", replacement.args["catalog"])
            seen.add(name)
    assert seen == set(names), (seen, set(names))
    return tree.sql(dialect="databricks")


def execute(warehouse, namespace, document, folder, **options):
    compiled = compile_document(document, "databricks", **options)
    load_tables(warehouse, namespace, compiled, folder)
    result = warehouse.run_aggregate(renamed_sql(compiled, namespace))
    actual = rows(result.columns, result.rows)
    assert actual == run(document, folder, **options)
    expected_file = folder / "expected.csv"
    if expected_file.exists():
        assert actual == expected(expected_file)
    return actual


@pytest.mark.parametrize(("expression", "kind", "value"), [
    ("1", "int", 1),
    ("CAST(9007199254740993 AS BIGINT)", "long", 9007199254740993),
    ("CAST(12.50 AS DECIMAL(10,2))", "decimal", Decimal("12.50")),
    ("CAST(1.5 AS DOUBLE)", "double", 1.5),
    ("true", "boolean", True),
    ("DATE'2026-11-26'", "date", datetime.date(2026, 11, 26)),
    ("TIMESTAMP'2026-11-26 10:11:12.345'", "timestamp",
     datetime.datetime(2026, 11, 26, 10, 11, 12, 345000, tzinfo=datetime.UTC)),
    ("TIMESTAMP_NTZ'2026-11-26 10:11:12'", "timestamp_ntz",
     datetime.datetime(2026, 11, 26, 10, 11, 12)),
    ("'été'", "string", "été"),
    ("CAST(NULL AS INT)", "int", None),
    ("X'CAFE'", "binary", "yv4="),
    ("array(1,2)", "array", '["1","2"]'),
])
def test_types_et_valeurs(warehouse, expression, kind, value):
    result = warehouse.run_aggregate(f"SELECT {expression} AS valeur")
    assert result.columns == ["valeur"]
    assert result.types == [kind]
    actual = result.rows[0][0]
    assert type(actual) is type(value)
    assert actual == value
    if kind == "timestamp":
        assert actual.tzinfo is not None and actual.utcoffset() == datetime.timedelta(0)
    if kind == "timestamp_ntz":
        assert actual.tzinfo is None


def test_borne_max_rows(warehouse):
    assert len(warehouse.run_aggregate("SELECT * FROM range(3)", max_rows=4).rows) == 3
    with pytest.raises(RepoError) as error:
        warehouse.run_aggregate("SELECT * FROM range(5)", max_rows=4)
    assert error.value.code == "result_too_large"
    assert TOKEN not in str(error.value)


def test_warehouse_inexistant():
    with pytest.raises(RepoError) as error:
        connector(warehouse="0000000000000000").test()
    assert error.value.code == "platform_not_found"
    assert TOKEN not in str(error.value)


def test_requete_invalide(warehouse, namespace):
    catalog, schema = namespace
    with pytest.raises(RepoError) as error:
        warehouse.run_aggregate(f"SELECT * FROM {target(catalog, schema, 'table_absente')}")
    assert error.value.code == "query_failed"
    assert TOKEN not in str(error.value)


def test_jeton_invalide():
    invalid = "dapi-invalide"
    with pytest.raises(AuthRejected) as error:
        connector(token=invalid).test()
    assert invalid not in str(error.value) and TOKEN not in str(error.value)


def test_connexion(warehouse):
    warehouse.test()


def test_revenu_net(warehouse, namespace):
    document, calendars = nordis_revenue()
    execute(warehouse, namespace, document, FIXTURES / "revenu-net", calendars=calendars)


def test_revenu_net_scope(warehouse, namespace):
    document, calendars = nordis_revenue()
    scope = Scope(period="FY2026_Q1", perimeter=("entite:in:FR",), granularity=("entite",))
    # expected.csv décrit le résultat sans scope.
    compiled = compile_document(document, "databricks", calendars=calendars, scope=scope)
    folder = FIXTURES / "revenu-net"
    load_tables(warehouse, namespace, compiled, folder)
    result = warehouse.run_aggregate(renamed_sql(compiled, namespace))
    assert rows(result.columns, result.rows) == run(document, folder, calendars=calendars, scope=scope)


def test_catalogue(warehouse, namespace):
    document, library = catalogue()
    execute(warehouse, namespace, document, FIXTURES / "catalogue", library=library)


def test_cardinalite_et_bypass(warehouse, namespace):
    folder = FIXTURES / "cardinalite"
    document = load(folder / "kpi.yaml")
    compiled = compile_document(document, "databricks")
    load_tables(warehouse, namespace, compiled, folder)
    with pytest.raises(RepoError) as error:
        warehouse.run_aggregate(renamed_sql(compiled, namespace))
    assert error.value.code == "query_failed"
    assert "n03" in str(error.value) and TOKEN not in str(error.value)
    nodes = [n.model_copy(update={"check": "bypass", "bypass_reason": "accepté"})
             if n.id == "n03" else n for n in document.graph.nodes]
    bypass = document.model_copy(update={"graph": document.graph.model_copy(update={"nodes": nodes})})
    compiled = compile_document(bypass, "databricks")
    assert "-- atlas: cardinality bypass n03" in compiled.sql
    result = warehouse.run_aggregate(renamed_sql(compiled, namespace))
    assert rows(result.columns, result.rows) == run(bypass, folder)


@pytest.mark.parametrize("keep", [False, True])
def test_nulls(warehouse, namespace, keep):
    folder = FIXTURES / "nulls"
    document = load(folder / "kpi.yaml")
    if keep:
        nodes = [n.model_copy(update={"nulls": "keep"}) if n.id == "n02" else n
                 for n in document.graph.nodes]
        document = document.model_copy(update={"graph": document.graph.model_copy(update={"nodes": nodes})})
    execute(warehouse, namespace, document, folder)


@pytest.mark.parametrize("name", ["ratio-de-sommes", "moyenne-de-ratios"])
def test_ratios(warehouse, namespace, name):
    folder = FIXTURES / "ratios"
    execute(warehouse, namespace, load(folder / f"{name}.yaml"), folder)


def test_fuseau_et_mois_fiscal(warehouse, namespace):
    folder = FIXTURES / "fuseau"
    execute(warehouse, namespace, load(folder / "kpi.yaml"), folder,
            calendars=load_calendars(folder / "calendars"))


def test_filtres(warehouse, namespace):
    nodes = [{"id": f"n0{i + 2}", "type": "filter", "inputs": [f"n0{i + 1}"],
              "condition": condition, "nulls": nulls}
             for i, (condition, nulls) in enumerate(FILTERS)]
    nodes.append({"id": "n06", "type": "aggregate", "inputs": ["n05"],
                  "group_by": ["id_client"], "measures": [["*", "lignes", "count"]]})
    execute(warehouse, namespace, kpi(nodes, "n06"), FIXTURES / "filtres")
