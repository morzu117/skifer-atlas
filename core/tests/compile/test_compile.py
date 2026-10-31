"""Compilation SQL multi-dialecte (plan 0007) : critères d'acceptation 1 à 8."""

import os
import re
import subprocess
import sys

import duckdb
import pytest
import sqlglot
from compile_support import FIXTURES, NORDIS, catalogue, expected, load, nordis_revenue, run
from hypothesis import given, settings
from hypothesis import strategies as st

from skifer_atlas.compile import (
    DIALECTS,
    CompileError,
    NotCompilable,
    Scope,
    compilability,
    compile_document,
    load_calendars,
    parse_calendar,
    reparse,
)
from skifer_atlas.compile.dialects import check_window
from skifer_atlas.model import validate_data
from skifer_atlas.run import MissingData

GOLDEN = FIXTURES / "golden"
ATLAS = os.path.join(os.path.dirname(sys.executable), "atlas")


def compiled(document, dialect="duckdb", **options):
    return compile_document(document, dialect, **options).sql


def golden(name: str, sql: str) -> None:
    path = GOLDEN / name
    if os.environ.get("ATLAS_UPDATE_GOLDEN"):
        path.parent.mkdir(exist_ok=True)
        path.write_text(sql, encoding="utf-8")
    assert sql == path.read_text(encoding="utf-8"), name


def kpi(nodes: list[dict], output: str, calendar: dict | None = None):
    """KPI construit en Python ; la source n01 est `ventes.clients`."""
    source = {"id": "n01", "type": "source", "platform": "duckdb", "table": "ventes.clients",
              "owner": "claire.m", "columns": [
                  {"name": "id_client", "type": "string"}, {"name": "pays", "type": "string"},
                  {"name": "age", "type": "integer"}, {"name": "actif", "type": "boolean"},
                  {"name": "ouvert_le", "type": "date", "timezone": "Europe/Paris",
                   "format": "yyyy-MM-dd"}]}
    result = validate_data({
        "schema_version": 1, "kind": "kpi",
        "data_product": {"id": "essai", "version": 1, "owner": "claire.m", "domain": "ventes"},
        "label": "Essai",
        "semantics": {"calendar": calendar or {"key": "civil"}, "timezone": "Europe/Paris"},
        "graph": {"nodes": [source, *nodes], "output": output},
    })
    assert result.valid, [i.to_dict() for i in result.issues]
    return result.document


def counted(condition, nulls="drop"):
    return kpi([
        {"id": "n02", "type": "filter", "inputs": ["n01"], "condition": condition,
         "nulls": nulls},
        {"id": "n03", "type": "aggregate", "inputs": ["n02"], "group_by": [],
         "measures": [["*", "lignes", "count"]]},
    ], "n03")


# --- critère 1 : Revenu net ---------------------------------------------------------------

@pytest.mark.parametrize("dialect", DIALECTS)
def test_revenu_net_compiles_in_every_dialect(dialect):
    document, calendars = nordis_revenue()
    golden(f"revenu-net.{dialect}.sql", compiled(document, dialect, calendars=calendars))


def test_revenu_net_duckdb_gives_the_committed_result():
    document, calendars = nordis_revenue()
    folder = FIXTURES / "revenu-net"
    assert run(document, folder, calendars=calendars) == expected(folder / "expected.csv")


@pytest.mark.parametrize("dialect", DIALECTS)
def test_every_node_type_golden_sql(dialect):
    document, library = catalogue()
    golden(f"ventes.{dialect}.sql", compiled(document, dialect, library=library))


def test_every_node_type_runs_on_duckdb():
    document, library = catalogue()
    folder = FIXTURES / "catalogue"
    assert run(document, folder, library=library) == expected(folder / "expected.csv")


def test_referenced_kpi_is_compiled_once_with_a_prefix():
    document, library = catalogue()
    sql = compiled(document, library=library)
    assert sql.count("r_objectifs_mensuels_v2_n01 AS (") == 1
    assert "FROM r_objectifs_mensuels_v2_n02" in sql


# --- critère 2 : cardinalité --------------------------------------------------------------

def test_duplicate_key_on_the_one_side_fails_citing_the_join():
    document = load(FIXTURES / "cardinalite" / "kpi.yaml")
    with pytest.raises(duckdb.Error, match="cardinalité N:1 non respectée en n03"):
        run(document, FIXTURES / "cardinalite")


def test_bypass_runs_and_leaves_a_comment():
    document = load(FIXTURES / "cardinalite" / "kpi.yaml")
    nodes = [n.model_copy(update={"check": "bypass", "bypass_reason": "accepté"})
             if n.id == "n03" else n for n in document.graph.nodes]
    bypassed = document.model_copy(update={
        "graph": document.graph.model_copy(update={"nodes": nodes})})
    sql = compiled(bypassed)
    assert "-- atlas: cardinality bypass n03" in sql
    assert "chk_" not in sql and "atlas_guard" not in sql
    result = run(bypassed, FIXTURES / "cardinalite")
    # K2 en double côté clients : la facture F2 compte deux fois, ce que le contrôle évitait.
    assert {r["pays"]: r["ca"] for r in result} == {"FR": "130", "DE": "50", "AT": "50"}


@pytest.mark.parametrize(("cardinality", "sides"), [
    ("N:1", ["right"]), ("1:N", ["left"]), ("1:1", ["left", "right"]),
])
def test_checked_side_follows_the_cardinality(cardinality, sides):
    document = load(FIXTURES / "cardinalite" / "kpi.yaml")
    nodes = [n.model_copy(update={"cardinality": cardinality}) if n.id == "n03" else n
             for n in document.graph.nodes]
    sql = compiled(document.model_copy(update={
        "graph": document.graph.model_copy(update={"nodes": nodes})}))
    assert [s for s in ("left", "right") if f"chk_n03_{s} AS" in sql] == sides


@pytest.mark.parametrize(("dialect", "failure"), [
    ("databricks", "RAISE_ERROR("), ("duckdb", "ERROR("), ("snowflake", "AS INT)"),
])
def test_failure_mechanism_per_dialect(dialect, failure):
    sql = compiled(load(FIXTURES / "cardinalite" / "kpi.yaml"), dialect)
    assert failure in sql
    assert "non respectée en n03" in sql


def test_todo_cardinality_does_not_compile():
    document = load(FIXTURES / "cardinalite" / "kpi.yaml")
    nodes = [n.model_copy(update={"cardinality": "TODO"}) if n.id == "n03" else n
             for n in document.graph.nodes]
    with pytest.raises(CompileError) as error:
        compiled(document.model_copy(update={
            "graph": document.graph.model_copy(update={"nodes": nodes})}))
    assert error.value.issues[0].node_id == "n03"


# --- critère 3 : nulls keep / drop --------------------------------------------------------

def test_nulls_keep_and_drop_on_not_equals():
    document = load(FIXTURES / "nulls" / "kpi.yaml")
    folder = FIXTURES / "nulls"
    keep_nodes = [n.model_copy(update={"nulls": "keep"}) if n.id == "n02" else n
                  for n in document.graph.nodes]
    keep = document.model_copy(update={
        "graph": document.graph.model_copy(update={"nodes": keep_nodes})})
    # FR, DE, NULL, BE, NULL : drop garde DE et BE ; keep y ajoute les deux pays inconnus.
    assert run(document, folder) == [{"clients": "2"}]
    assert run(keep, folder) == [{"clients": "4"}]
    assert "pays IS NULL" in compiled(keep) and "IS NULL" not in compiled(document).split(
        "n03 AS")[0]


# --- critère 4 : ratio de sommes contre moyenne de ratios ---------------------------------

def test_ratio_of_sums_differs_from_average_of_ratios():
    folder = FIXTURES / "ratios"
    sums = run(load(folder / "ratio-de-sommes.yaml"), folder)
    average = run(load(folder / "moyenne-de-ratios.yaml"), folder)
    # (10 + 90) / (100 + 300) contre (10/100 + 90/300) / 2.
    assert sums == [{"marge": "100", "ca": "400", "taux": "0.25"}]
    assert average == [{"taux": "0.2"}]


# --- critère 5 : calendrier fiscal et fuseau ----------------------------------------------

def test_fiscal_month_follows_the_paris_day():
    folder = FIXTURES / "fuseau"
    calendars = load_calendars(folder / "calendars")
    result = run(load(folder / "kpi.yaml"), folder, calendars=calendars)
    # C1 (21 h UTC = 23 h à Paris) reste en P12 ; C2 (23 h UTC = 1 h le 1er octobre) passe
    # en P01 ; C3 et C4 encadrent la fin de P01, le 4 novembre à minuit, heure de Paris.
    assert result == [
        {"mois_fiscal": "2025-09-01", "commandes": "1"},
        {"mois_fiscal": "2025-10-01", "commandes": "2"},
        {"mois_fiscal": "2025-11-05", "commandes": "1"},
    ]


def test_dates_outside_the_calendar_fail(tmp_path):
    folder = FIXTURES / "fuseau"
    data = tmp_path / "data"
    data.mkdir()
    (data / "ventes.commandes.csv").write_text(
        "commande_id,passee_le\nC9,2026-01-15 12:00:00\n", encoding="utf-8")
    with pytest.raises(duckdb.Error, match="hors du calendrier fiscal-test 2026.1 en n03"):
        run(load(folder / "kpi.yaml"), data, calendars=load_calendars(folder / "calendars"))


def test_calendar_version_must_match():
    document, calendars = nordis_revenue()
    older = {k: v.__class__(v.key, "2025.4", v.periods) for k, v in calendars.items()}
    with pytest.raises(CompileError) as error:
        compiled(document, calendars=older)
    assert error.value.issues[0].code == "calendar_version_mismatch"


def test_missing_calendar_is_a_compile_error():
    document, _ = nordis_revenue()
    with pytest.raises(CompileError) as error:
        compiled(document, calendars={})
    assert error.value.issues[0].code == "unknown_calendar"


def test_grain_coarser_than_the_calendar_or_misaligned_does_not_compile():
    calendars = load_calendars(FIXTURES / "fuseau" / "calendars")
    for grain in ("quarter", "week"):
        document = kpi([
            {"id": "n02", "type": "temporal", "inputs": ["n01"], "operation": "period",
             "column": "ouvert_le", "target": "periode", "grain": grain},
            {"id": "n03", "type": "aggregate", "inputs": ["n02"], "group_by": ["periode"],
             "measures": [["*", "lignes", "count"]]},
        ], "n03", {"key": "fiscal-test", "version": "2026.1"})
        with pytest.raises(CompileError) as error:
            compiled(document, calendars=calendars)
        assert error.value.issues[0].code == "calendar_grain_unsupported", grain


def test_calendar_parsing_rejects_overlaps():
    with pytest.raises(CompileError) as error:
        parse_calendar("key: x\nversion: '1'\nperiods:\n"
                       "  - {name: A, start: '2025-01-01', end: '2025-01-31'}\n"
                       "  - {name: B, start: '2025-01-31', end: '2025-02-28'}\n")
    assert "se chevauchent" in error.value.issues[0].message


# --- scope --------------------------------------------------------------------------------

def test_scope_period_perimeter_and_granularity():
    document, calendars = nordis_revenue()
    folder = FIXTURES / "revenu-net"
    scope = Scope(period="FY2026_Q1", perimeter=("entite:in:FR",), granularity=("entite",))
    assert run(document, folder, scope=scope, calendars=calendars) == [
        {"entite": "FR", "revenu_net": "290"}]
    dates = Scope(period="2025-11-01..2025-12-31")
    result = run(document, folder, scope=dates, calendars=calendars)
    assert {r["mois_fiscal"] for r in result} == {"2025-11-01", "2025-12-01"}


def test_granularity_through_a_concept_attribute():
    document, calendars = nordis_revenue()
    sql = compiled(document, calendars=calendars, scope=Scope(granularity=("commande_id",)))
    assert "GROUP BY\n    commande_id\n" in sql


@pytest.mark.parametrize(("scope", "code"), [
    (Scope(granularity=("pays",)), "scope_dimension_unavailable"),
    (Scope(perimeter=("pays:equals:FR",)), "scope_dimension_unavailable"),
    (Scope(perimeter=("entite:sorcier:FR",)), "scope_invalid_perimeter"),
    (Scope(period="FY2030_Q9"), "scope_unknown_period"),
    (Scope(period="2025-12-31..2025-01-01"), "scope_invalid_period"),
])
def test_scope_errors(scope, code):
    document, calendars = nordis_revenue()
    with pytest.raises(CompileError) as error:
        compiled(document, calendars=calendars, scope=scope)
    assert error.value.issues[0].code == code


# --- filtres ------------------------------------------------------------------------------

@pytest.mark.parametrize(("condition", "fragment"), [
    ("age:greater_than:18", "age > 18"),
    ("age:between:18,65", "age >= 18 AND age <= 65"),
    ("age:not_between:18,65", "(age < 18 OR age > 65)"),
    ("actif:equals:true", "actif = TRUE"),
    ("ouvert_le:less_than:2025-01-01", "ouvert_le < CAST('2025-01-01' AS DATE)"),
    ("pays:in:FR,DE", "pays IN ('FR', 'DE')"),
    ("pays:not_in:FR,DE", "NOT pays IN ('FR', 'DE')"),
    ("id_client:contains:50%_x", "id_client LIKE '%50\\%\\_x%' ESCAPE '\\'"),
    ("id_client:starts_with:K", "id_client LIKE 'K%' ESCAPE '\\'"),
    ("id_client:not_contains:K", "NOT (id_client LIKE '%K%' ESCAPE '\\')"),
    ("id_client:like:K_1", "id_client LIKE 'K_1'"),
    ("pays:is_null", "pays IS NULL"),
    ("pays:is_not_null", "NOT pays IS NULL"),
    ({"expr": "age > 18 AND pays = 'FR'"}, "age > 18 AND pays = 'FR'"),
])
def test_filter_operators(condition, fragment):
    sql = compiled(counted(condition))
    where = sql.split("n02 AS")[1].split("n03 AS")[0]
    flat = re.sub(r"\s+\)", ")", re.sub(r"\(\s+", "(", " ".join(where.split())))
    assert fragment in flat, flat


def test_string_literals_are_escaped():
    sql = compiled(counted("pays:equals:l'île"))
    assert "pays = 'l''île'" in sql


def test_numeric_literal_on_a_numeric_column_is_checked():
    with pytest.raises(CompileError) as error:
        compiled(counted("age:greater_than:dix"))
    assert error.value.issues[0].node_id == "n02"


FILTERS = [
    ("pays:not_equals:FR", "keep"),
    ("pays:in:DE,BE,FR", "keep"),
    ("id_client:not_equals:K4", "keep"),
    ("id_client:starts_with:K", "drop"),
]


@settings(max_examples=12, deadline=None)
@given(st.permutations(FILTERS))
def test_filter_order_does_not_change_the_result(order):
    nodes = [{"id": f"n0{index + 2}", "type": "filter", "inputs": [f"n0{index + 1}"],
              "condition": condition, "nulls": nulls}
             for index, (condition, nulls) in enumerate(order)]
    nodes.append({"id": "n06", "type": "aggregate", "inputs": ["n05"],
                  "group_by": ["id_client"], "measures": [["*", "lignes", "count"]]})
    document = kpi(nodes, "n06")
    folder = FIXTURES / "filtres"
    assert run(document, folder) == expected(folder / "expected.csv")


# --- critère 6 : déterminisme -------------------------------------------------------------

@pytest.mark.parametrize("dialect", DIALECTS)
def test_repeated_compilation_is_byte_identical(dialect):
    document, library = catalogue()
    first = compiled(document, dialect, library=library)
    assert all(compiled(document, dialect, library=library) == first for _ in range(3))


def test_compilation_is_identical_across_processes():
    path = NORDIS / "kpis" / "revenu-net.yaml"
    outputs = {subprocess.run([ATLAS, "compile", str(path), "--dialect", "snowflake"],
                              capture_output=True, text=True, check=True,
                              env={**os.environ, "PYTHONHASHSEED": seed}).stdout
               for seed in ("1", "2", "3")}
    assert len(outputs) == 1


# --- critère 7 : compilabilité par dialecte -----------------------------------------------

def try_cast(column: str):
    return kpi([
        {"id": "n02", "type": "compute", "inputs": ["n01"], "column": "age_texte",
         "expr": f"TRY_CAST({column} AS DECIMAL(10, 2))"},
        {"id": "n03", "type": "aggregate", "inputs": ["n02"], "group_by": [],
         "measures": [["age_texte", "total", "sum"]]},
    ], "n03")


def test_try_cast_of_a_number_is_not_compilable_in_snowflake():
    found = compilability(try_cast("age"))
    assert found["databricks"] == {"status": "ok"}
    assert found["duckdb"] == {"status": "ok"}
    assert found["snowflake"]["status"] == "not_compilable"
    assert found["snowflake"]["node_id"] == "n02"
    assert "TRY_CAST" in found["snowflake"]["reason"]


def test_try_cast_of_a_string_stays_try_cast_in_snowflake():
    assert compilability(try_cast("pays"))["snowflake"] == {"status": "ok"}
    assert "TRY_CAST(pays AS DECIMAL(10, 2))" in compiled(try_cast("pays"), "snowflake")


def test_decimal_without_precision_is_not_compilable_anywhere():
    document = kpi([
        {"id": "n02", "type": "compute", "inputs": ["n01"], "column": "age_decimal",
         "expr": "CAST(age AS DECIMAL)"},
        {"id": "n03", "type": "aggregate", "inputs": ["n02"], "group_by": [],
         "measures": [["age_decimal", "total", "sum"]]},
    ], "n03")
    assert all(v["status"] == "not_compilable" for v in compilability(document).values())


@pytest.mark.parametrize(("dialect", "allowed"), [
    ("databricks", False), ("snowflake", False), ("duckdb", True),
])
def test_distinct_window_functions(dialect, allowed):
    if allowed:
        check_window("count_distinct", "n02", dialect)
    else:
        with pytest.raises(NotCompilable):
            check_window("count_distinct", "n02", dialect)


# --- critère 8 : re-parse -----------------------------------------------------------------

@pytest.mark.parametrize("dialect", DIALECTS)
def test_generated_sql_parses_in_its_dialect(dialect):
    document, library = catalogue()
    revenue, calendars = nordis_revenue()
    for sql in (compiled(document, dialect, library=library),
                compiled(revenue, dialect, calendars=calendars)):
        tree = reparse(sql, dialect)
        # Avec des contrôles, la requête finale est une union (garde évaluée, plan 0021).
        assert isinstance(tree, sqlglot.exp.Query)
        assert tree.sql(dialect=dialect)


# --- CLI ----------------------------------------------------------------------------------

def atlas(*args):
    return subprocess.run([ATLAS, *map(str, args)], capture_output=True, text=True,
                          check=False)


def test_cli_compile_finds_the_space_calendars():
    result = atlas("compile", NORDIS / "kpis" / "revenu-net.yaml", "--dialect", "duckdb",
                   "--period", "FY2026_Q1", "--by", "entite")
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("-- atlas: revenu-net v4, duckdb\n")


def test_cli_run_prints_csv():
    folder = FIXTURES / "nulls"
    result = atlas("run", folder / "kpi.yaml", "--data", folder)
    assert (result.returncode, result.stdout) == (0, "clients\n2\n"), result.stderr


def test_cli_run_reports_the_cardinality_failure():
    folder = FIXTURES / "cardinalite"
    result = atlas("run", folder / "kpi.yaml", "--data", folder)
    assert result.returncode == 1
    assert "non respectée en n03" in result.stderr


def test_cli_compilability_exit_code():
    folder = FIXTURES / "nulls"
    result = atlas("compile", folder / "kpi.yaml", "--compilability")
    assert result.returncode == 0
    assert '"snowflake": {\n    "status": "ok"' in result.stdout


def test_cli_compile_error_is_explained(tmp_path):
    result = atlas("compile", NORDIS / "kpis" / "revenu-net.yaml", "--calendars", tmp_path)
    assert result.returncode == 1
    assert "unknown_calendar" in result.stderr


def test_missing_data_names_the_table(tmp_path):
    with pytest.raises(MissingData, match="ventes.clients"):
        run(load(FIXTURES / "nulls" / "kpi.yaml"), tmp_path)
