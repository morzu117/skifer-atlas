"""Recette BigQuery réelle, hors CI, sur des données minuscules."""
import datetime
import os
import sys
import tempfile
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
import bigquery_recette
from compile_support import FIXTURES, catalogue, expected, load, nordis_revenue, rows, run
from test_compile import FILTERS, kpi

pytestmark = pytest.mark.bigquery
PROJECT = os.environ.get("ATLAS_BIGQUERY_PROJECT")
TOKEN = os.environ.get("ATLAS_BIGQUERY_TOKEN")
LOCATION = os.environ.get("ATLAS_BIGQUERY_LOCATION")
if not all((PROJECT, TOKEN)):
    pytest.skip("Recette BigQuery : ATLAS_BIGQUERY_PROJECT et ATLAS_BIGQUERY_TOKEN requis",
                allow_module_level=True)


def connector(project=PROJECT, token=TOKEN):
    return bigquery_recette.connector(project, token, LOCATION)


@pytest.fixture(scope="session")
def warehouse():
    return connector()


@pytest.fixture(scope="session")
def namespace(warehouse):
    folder = tempfile.mkdtemp(prefix="atlas-bigquery-")
    recette = bigquery_recette.Recette(warehouse, os.environ.get("ATLAS_BIGQUERY_DATASET")
                                       or "atlas_recette", Path(folder) / "etat.json", TOKEN)
    print(f"État de la recette BigQuery : {recette.path}", flush=True)
    try:
        recette.setup()
        yield recette
    finally:
        recette.drop()
        Path(folder).rmdir()


def load_tables(warehouse, namespace, compiled, folder):
    namespace.names = namespace.load(compiled.sources, folder)


def renamed_sql(compiled, namespace):
    names = namespace.names
    tree = sqlglot.parse_one(compiled.sql, read="bigquery")
    seen = set()
    for table in tree.find_all(exp.Table):
        name = ".".join(part.name for part in table.parts)
        if name in names:
            table.replace(sqlglot.parse_one(names[name], into=exp.Table, read="bigquery"))
            seen.add(name)
    assert seen == set(names), (seen, set(names))
    return tree.sql(dialect="bigquery")


def execute(warehouse, namespace, document, folder, **options):
    compiled = compile_document(document, "bigquery", **options)
    load_tables(warehouse, namespace, compiled, folder)
    result = warehouse.run_aggregate(renamed_sql(compiled, namespace))
    actual = rows(result.columns, result.rows)
    assert actual == run(document, folder, **options)
    if (folder / "expected.csv").exists():
        assert actual == expected(folder / "expected.csv")
    return actual


def test_connexion(warehouse):
    warehouse.test()


def test_jeton_invalide():
    with pytest.raises(AuthRejected) as error:
        connector(token="jeton-invalide").test()
    if TOKEN in str(error.value) or "jeton-invalide" in str(error.value):
        pytest.fail("Un jeton apparaît dans une erreur.", pytrace=False)


def test_projet_inconnu():
    with pytest.raises(RepoError) as error:
        connector(project="atlas-projet-inexistant-000000000000000").test()
    assert error.value.code == "platform_not_found"
    if TOKEN in str(error.value):
        pytest.fail("Un jeton apparaît dans une erreur.", pytrace=False)


@pytest.mark.parametrize(("kind", "expression", "value"), [
    ("int64", "INT64 '42'", 42), ("float64", "FLOAT64 '1.5'", 1.5),
    ("numeric", "NUMERIC '12.50'", Decimal("12.50")),
    ("bignumeric", "BIGNUMERIC '12.50'", Decimal("12.50")),
    ("bool", "TRUE", True), ("string", "'été'", "été"),
    ("date", "DATE '2026-11-28'", datetime.date(2026, 11, 28)),
    ("datetime", "DATETIME '2026-11-28 10:11:12'", datetime.datetime(2026, 11, 28, 10, 11, 12)),
    ("datetime", "DATETIME '2026-11-28 10:11:12.123456'", datetime.datetime(2026, 11, 28, 10, 11, 12, 123456)),
    ("timestamp", "TIMESTAMP '2026-11-28 10:11:12.123456+00'", datetime.datetime(2026, 11, 28, 10, 11, 12, 123456, tzinfo=datetime.UTC)),
])
def test_types(warehouse, kind, expression, value):
    result = warehouse.run_aggregate(f"SELECT {expression} AS valeur, CAST(NULL AS {kind.upper()}) AS nul")
    assert result.types == [kind, kind]
    assert type(result.rows[0][0]) is type(value)
    assert result.rows == [(value, None)]


@pytest.mark.parametrize("expression", ["[1, 2]", "STRUCT(1 AS x)", "b'abc'", "TIME '12:00:00'", "JSON '{}'", "ST_GEOGPOINT(0, 0)"])
def test_types_refuses(warehouse, expression):
    with pytest.raises(RepoError) as error:
        warehouse.run_aggregate(f"SELECT {expression} AS colonne_refusee")
    assert error.value.code == "query_failed" and "colonne_refusee" in str(error.value)
    if TOKEN in str(error.value):
        pytest.fail("Un jeton apparaît dans une erreur.", pytrace=False)


def test_borne(warehouse):
    assert len(warehouse.run_aggregate("SELECT x FROM UNNEST(GENERATE_ARRAY(1, 4)) x", max_rows=4).rows) == 4
    with pytest.raises(RepoError) as error:
        warehouse.run_aggregate("SELECT x FROM UNNEST(GENERATE_ARRAY(1, 5)) x", max_rows=4)
    assert error.value.code == "result_too_large"
    if TOKEN in str(error.value):
        pytest.fail("Un jeton apparaît dans une erreur.", pytrace=False)


def test_revenu_net(warehouse, namespace):
    document, calendars = nordis_revenue()
    execute(warehouse, namespace, document, FIXTURES / "revenu-net", calendars=calendars)


def test_revenu_net_scope(warehouse, namespace):
    document, calendars = nordis_revenue()
    scope = Scope(period="FY2026_Q1", perimeter=("entite:in:FR",), granularity=("entite",))
    # expected.csv décrit le résultat sans scope.
    compiled = compile_document(document, "bigquery", calendars=calendars, scope=scope)
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
    compiled = compile_document(document, "bigquery")
    load_tables(warehouse, namespace, compiled, folder)
    with pytest.raises(RepoError) as error:
        warehouse.run_aggregate(renamed_sql(compiled, namespace))
    assert error.value.code == "query_failed"
    assert "n03" in str(error.value)
    if TOKEN in str(error.value):
        pytest.fail("Un jeton apparaît dans une erreur.", pytrace=False)
    nodes = [n.model_copy(update={"check": "bypass", "bypass_reason": "accepté"})
             if n.id == "n03" else n for n in document.graph.nodes]
    bypass = document.model_copy(update={"graph": document.graph.model_copy(update={"nodes": nodes})})
    compiled = compile_document(bypass, "bigquery")
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


def test_division(warehouse):
    result = warehouse.run_aggregate("SELECT CAST(1 AS FLOAT64) / NULLIF(3, 0), "
                                     "CAST(1 AS FLOAT64) / NULLIF(0, 0), "
                                     "DIV(7, NULLIF(3, 0)), MOD(7, NULLIF(3, 0))")
    assert result.rows[0] == (1 / 3, None, 2, 1)


def test_semaines(warehouse):
    result = warehouse.run_aggregate("SELECT d, CAST(DATE_TRUNC(d, WEEK(MONDAY)) AS DATE) "
                                    "FROM UNNEST(GENERATE_DATE_ARRAY('2026-01-01', '2026-12-31')) d", max_rows=366)
    assert len(result.rows) == 365
    assert all(start == day - datetime.timedelta(days=day.weekday()) for day, start in result.rows)


def test_fenetre_nulls(warehouse):
    result = warehouse.run_aggregate("SELECT x, SUM(v) OVER (ORDER BY x IS NULL ASC, x ASC "
                                     "ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) "
                                     "FROM UNNEST([STRUCT(1 AS x, 1 AS v), (NULL, 2)]) "
                                     "ORDER BY x IS NULL, x")
    assert result.rows == [(1, 1), (None, 3)]


def test_decimal(warehouse, record_property):
    result = warehouse.run_aggregate("SELECT ROUND(CAST('1.125' AS NUMERIC), 2), "
                                     "ROUND(CAST('-1.125' AS NUMERIC), 2), "
                                     "ROUND(CAST('9999.999' AS NUMERIC), 2)")
    record_property("depassement_decimal_5_2", str(result.rows[0][2]))
    print(f"Dépassement décimal 5,2 : {result.rows[0][2]}")
    assert result.rows[0][:2] == (Decimal('1.13'), Decimal('-1.13')), str(result.rows)


def test_heure_murale_timestamp(warehouse):
    result = warehouse.run_aggregate("SELECT DATETIME(t, 'Europe/Paris') FROM "
                                    "(SELECT TIMESTAMP '2026-03-29 01:30:00+00' AS t)")
    assert result.rows == [(datetime.datetime(2026, 3, 29, 3, 30),)]


@pytest.mark.parametrize("expression", ["DATETIME '2026-03-29 03:30:00'", "'2026-03-29 03:30:00'"])
def test_heure_murale_types(warehouse, expression, record_property):
    try:
        result = warehouse.run_aggregate(f"SELECT DATETIME(c, 'Europe/Paris') FROM (SELECT {expression} AS c)")
    except RepoError as error:
        record_property("comportement", str(error))
        print(f"Heure murale {expression} : {error}")
        if TOKEN in str(error):
            pytest.fail("Un jeton apparaît dans une erreur.", pytrace=False)
    else:
        record_property("comportement", repr(result.rows))
        print(f"Heure murale {expression} : {result.rows!r}")


@pytest.mark.parametrize("expression", ["TIMESTAMP '2026-03-29 01:30:00+00'",
                                       "DATETIME '2026-03-29 03:30:00'", "'2026-03-29 03:30:00'"])
def test_piste_heure_murale(warehouse, expression, record_property):
    try:
        result = warehouse.run_aggregate("SELECT DATETIME(TIMESTAMP(CAST(c AS STRING), "
                                         f"'Europe/Paris'), 'Europe/Paris') FROM (SELECT {expression} AS c)")
        record_property("resultat", repr(result.rows))
        print(f"Piste heure murale {expression} : {result.rows!r}")
    except RepoError as error:
        record_property("erreur", str(error))
        print(f"Piste heure murale {expression} : {error}")
        if TOKEN in str(error):
            pytest.fail("Un jeton apparaît dans une erreur.", pytrace=False)
