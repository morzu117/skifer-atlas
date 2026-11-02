"""Écarts de compilation entre moteurs (plan 0021, ADR 0025) : critères 1 à 6. Horodatages
indépendants de la session (plan 0030, ADR 0034) : critères 1 à 3.

Le SQL DuckDB est exécuté ; celui de Databricks et de Snowflake est vérifié dans sa forme
et relu par SQLGlot, faute de compte réel."""

import copy
import datetime
import re

import duckdb
import pytest
import sqlglot
import yaml
from compile_support import FIXTURES, run
from sqlglot import exp

from skifer_atlas.compile import DIALECTS, compile_document, reparse
from skifer_atlas.compile.dialects import wall_clock, week_start
from skifer_atlas.model import validate_data
from skifer_atlas.model.functions import infer_type, parse_sql
from skifer_atlas.run import open_database

MESURES = [{"name": "ligne", "type": "string"}, {"name": "a", "type": "integer"},
           {"name": "b", "type": "integer"}, {"name": "x", "type": "double"},
           {"name": "jour", "type": "date", "timezone": "Europe/Paris",
            "format": "yyyy-MM-dd"}]


def kpi(nodes: list[dict], output: str):
    """KPI construit en Python ; la source n01 est `ventes.mesures`."""
    source = {"id": "n01", "type": "source", "platform": "duckdb", "table": "ventes.mesures",
              "owner": "claire.m", "columns": MESURES}
    result = validate_data({
        "schema_version": 1, "kind": "kpi",
        "data_product": {"id": "essai", "version": 1, "owner": "claire.m", "domain": "ventes"},
        "label": "Essai",
        "semantics": {"calendar": {"key": "civil"}, "timezone": "Europe/Paris"},
        "graph": {"nodes": [source, *nodes], "output": output},
    })
    assert result.valid, [i.to_dict() for i in result.issues]
    return result.document


def computed(**exprs: str):
    """Une colonne calculée par expression, en chaîne depuis la source, puis une agrégation
    par ligne qui les garde (la sortie d'un KPI est agrégée)."""
    nodes, previous = [], "n01"
    for index, (column, expr) in enumerate(exprs.items(), start=2):
        nodes.append({"id": f"n{index:02}", "type": "compute", "inputs": [previous],
                      "column": column, "expr": expr})
        previous = f"n{index:02}"
    nodes.append({"id": "n99", "type": "aggregate", "inputs": [previous],
                  "group_by": ["ligne", *exprs], "measures": [["*", "lignes", "count"]]})
    return kpi(nodes, "n99")


@pytest.fixture
def mesures(tmp_path):
    (tmp_path / "ventes.mesures.csv").write_text(
        "ligne,a,b,x,jour\n"
        "L1,1,3,1.5,2026-10-26\n"
        "L2,7,0,0,2026-11-01\n"
        "L3,7,2,4,2026-11-02\n", encoding="utf-8")
    return tmp_path


def sql(document, dialect: str) -> str:
    return compile_document(document, dialect).sql


# --- critère 1 : diviseur nul → NULL ------------------------------------------------------

def test_division_by_zero_is_null_on_duckdb(mesures):
    document = computed(q="a / b", e="a DIV b", r="a % b", y="x / x")
    found = {r["ligne"]: (r["q"], r["e"], r["r"], r["y"]) for r in run(document, mesures)}
    # Sans réécriture, DuckDB rendait `inf` pour 7 / 0 et échouait sur 7 % 0.
    assert found == {"L1": ("0.333333333", "0", "1", "1"),
                     "L2": ("", "", "", ""),
                     "L3": ("3.5", "3", "1", "1")}


# --- critère 2 : même DOUBLE dans les trois dialectes -------------------------------------

@pytest.mark.parametrize("dialect", DIALECTS)
def test_integer_division_is_a_double_everywhere(dialect):
    text = sql(computed(q="a / b"), dialect)
    # En Snowflake, `1 / 3` rendrait 0,333333 (NUMBER à 6 décimales) sans le cast.
    assert "CAST(a AS DOUBLE) / NULLIF(b, 0) AS q" in text
    assert isinstance(reparse(text, dialect), exp.Query)


def test_integer_division_and_modulo_keep_their_type():
    assert "a DIV NULLIF(b, 0)" in sql(computed(e="a DIV b"), "databricks")
    assert "a % NULLIF(b, 0)" in sql(computed(r="a % b"), "snowflake")


# --- critère 3 : rien de superflu ---------------------------------------------------------

@pytest.mark.parametrize(("expr", "fragment"), [
    ("a / NULLIF(b, 0)", "CAST(a AS DOUBLE) / NULLIF(b, 0) AS q"),
    ("a / 2", "CAST(a AS DOUBLE) / 2 AS q"),
    ("x / a", "x / NULLIF(a, 0) AS q"),
    ("a / x", "a / NULLIF(x, 0) AS q"),
    ("a / b / 2", "CAST(a AS DOUBLE) / NULLIF(b, 0) / 2 AS q"),
    ("a / 0", "CAST(a AS DOUBLE) / NULLIF(0, 0) AS q"),
])
def test_division_rewrite_adds_nothing_superfluous(expr, fragment):
    assert fragment in sql(computed(q=expr), "snowflake")


def test_division_in_a_filter_and_a_metric_op_is_rewritten():
    document = kpi([
        {"id": "n02", "type": "filter", "inputs": ["n01"], "condition": {"expr": "a / b > 1"},
         "nulls": "drop"},
        {"id": "n03", "type": "aggregate", "inputs": ["n02"], "group_by": [],
         "measures": [["a", "sa", "sum"], ["b", "sb", "sum"]]},
        {"id": "n04", "type": "metric_op", "inputs": ["n03"], "order": "aggregate_first",
         "metrics": [{"name": "taux", "expr": "sa / sb"}]},
    ], "n04")
    text = sql(document, "databricks")
    assert "CAST(a AS DOUBLE) / NULLIF(b, 0) > 1" in text
    assert "/ NULLIF(sb, 0) AS taux" in text


# --- critère 4 : type inféré --------------------------------------------------------------

@pytest.mark.parametrize("kinds", [("integer", "integer"), ("decimal", "integer"),
                                   ("decimal", "decimal"), ("integer", "double")])
def test_inferred_type_of_a_division_is_double(kinds):
    assert infer_type(parse_sql("a / b"), dict(zip("ab", kinds, strict=True))) == "double"


# --- critère 5 : semaine indépendante de WEEK_START ---------------------------------------

def weekly():
    return kpi([
        {"id": "n02", "type": "temporal", "inputs": ["n01"], "operation": "period",
         "column": "jour", "target": "semaine", "grain": "week"},
        {"id": "n03", "type": "aggregate", "inputs": ["n02"], "group_by": ["semaine"],
         "measures": [["*", "lignes", "count"]]},
    ], "n03")


def test_week_starts_on_monday_on_duckdb(mesures):
    # Lundi 26 octobre, dimanche 1er novembre (même semaine), lundi 2 novembre.
    assert run(weekly(), mesures) == [{"semaine": "2026-10-26", "lignes": "2"},
                                      {"semaine": "2026-11-02", "lignes": "1"}]


def test_snowflake_week_does_not_depend_on_week_start(mesures):
    text = sql(weekly(), "snowflake")
    assert "DATE_TRUNC('WEEK'" not in text
    assert "DATEADD(DAY, 1 - DAYOFWEEKISO(" in text
    assert "DATE_TRUNC('WEEK'" in sql(weekly(), "databricks")
    # Le SQL Snowflake, traduit en DuckDB, rend les mêmes semaines que le SQL DuckDB.
    compiled = compile_document(weekly(), "snowflake")
    connection = open_database(compiled.sources, mesures)
    try:
        found = connection.execute(sqlglot.transpile(
            compiled.sql, read="snowflake", write="duckdb")[0]).fetchall()
    finally:
        connection.close()
    assert sorted(found) == [(datetime.date(2026, 10, 26), 2), (datetime.date(2026, 11, 2), 1)]


def test_snowflake_week_formula_matches_iso_weeks_over_a_year():
    expression = week_start(exp.column("d"), "snowflake").sql("snowflake")
    assert expression == "CAST(DATEADD(DAY, 1 - DAYOFWEEKISO(d), d) AS DATE)"
    as_duckdb = sqlglot.transpile(expression, read="snowflake", write="duckdb")[0]
    mismatches = duckdb.sql(
        f"SELECT d FROM (SELECT CAST(d AS DATE) AS d FROM range(DATE '2025-12-01', "
        f"DATE '2027-01-15', INTERVAL 1 DAY) AS t(d)) "
        f"WHERE {as_duckdb} <> CAST(DATE_TRUNC('WEEK', d) AS DATE)").fetchall()
    assert mismatches == []


# --- critère 6 : garde évaluée quelle que soit la sortie ----------------------------------

def cardinality_kpi(condition: str | None = None):
    raw = yaml.safe_load((FIXTURES / "cardinalite" / "kpi.yaml").read_text(encoding="utf-8"))
    raw = copy.deepcopy(raw)
    if condition is not None:  # filtre après la jointure : la sortie peut être vide
        nodes = raw["graph"]["nodes"]
        nodes.insert(3, {"id": "n05", "type": "filter", "inputs": ["n03"],
                         "condition": condition, "nulls": "drop"})
        nodes[-1]["inputs"] = ["n05"]
    result = validate_data(raw)
    assert result.valid, [i.to_dict() for i in result.issues]
    return result.document


@pytest.fixture
def clean(tmp_path):
    """Les factures de la fixture, sans clé client en double."""
    (tmp_path / "ventes.factures.csv").write_text(
        (FIXTURES / "cardinalite" / "ventes.factures.csv").read_text(encoding="utf-8"),
        encoding="utf-8")
    (tmp_path / "ventes.clients.csv").write_text(
        "id_client,pays\nK1,FR\nK2,DE\nK3,FR\n", encoding="utf-8")
    return tmp_path


@pytest.mark.parametrize("dialect", DIALECTS)
def test_guard_is_read_by_a_branch_independent_of_the_output(dialect):
    tree = reparse(sql(cardinality_kpi(), dialect), dialect)
    assert isinstance(tree, exp.Union) and not tree.args.get("distinct")
    witness = tree.expression
    assert [t.name for t in witness.find_all(exp.Table)] == ["atlas_guard"]
    assert witness.args["where"].sql() == "WHERE NOT atlas_guard.failure IS NULL"
    assert "IS NULL" in tree.this.args["where"].sql()  # la sortie reste filtrée


def witness_only(document, data):
    """La seconde branche seule, avec les CTE : elle ne lit pas la sortie."""
    compiled = compile_document(document, "duckdb")
    tree = reparse(compiled.sql, "duckdb")
    witness = tree.expression.copy()
    witness.set("with_", tree.args["with_"].copy())
    connection = open_database(compiled.sources, data)
    try:
        return connection.execute(witness.sql("duckdb")).fetchall()
    finally:
        connection.close()


def test_anomaly_on_an_empty_output_fails_on_duckdb(clean):
    document = cardinality_kpi("pays:equals:XX")
    with pytest.raises(duckdb.Error, match="cardinalité N:1 non respectée en n03"):
        run(document, FIXTURES / "cardinalite")
    with pytest.raises(duckdb.Error, match="cardinalité N:1 non respectée en n03"):
        witness_only(document, FIXTURES / "cardinalite")
    assert witness_only(document, clean) == []
    assert run(document, clean) == []


def test_no_anomaly_gives_the_rows_and_only_them(clean):
    assert run(cardinality_kpi(), clean) == [{"pays": "DE", "ca": "50"},
                                             {"pays": "FR", "ca": "130"}]


# --- plan 0030 : horodatages indépendants de la session -----------------------------------

FUSEAU = FIXTURES / "fuseau"


def orders(timezone: str = "UTC", after: list[dict] | None = None):
    """Le KPI `fuseau` (commandes par mois du jour de Paris), en calendrier civil, source
    déclarée dans `timezone` ; `after` remplace les nœuds qui suivent la source."""
    data = yaml.safe_load((FUSEAU / "kpi.yaml").read_text(encoding="utf-8"))
    data["semantics"]["calendar"] = {"key": "civil"}
    nodes = data["graph"]["nodes"]
    nodes[0]["columns"][1]["timezone"] = timezone
    if after:
        nodes[1:] = after
        data["graph"]["output"] = after[-1]["id"]
    result = validate_data(data)
    assert result.valid, [i.to_dict() for i in result.issues]
    return result.document


def flat(text: str) -> str:
    """SQL sur une ligne, sans espace après « ( » ni avant « ) » : la mise en page de
    SQLGlot coupe les lignes selon leur longueur."""
    return re.sub(r"\(\s+", "(", re.sub(r"\s+\)", ")", " ".join(text.split())))


def test_databricks_reads_a_source_timestamp_as_wall_clock_of_its_zone():
    """Critère 1 : instant ou heure murale, la colonne est lue dans son fuseau déclaré."""
    text = sql(orders("Europe/Paris"), "databricks")
    assert ("CASE WHEN TYPEOF(passee_le) = 'timestamp' THEN CONVERT_TIMEZONE('UTC', "
            "'Europe/Paris', DATE_ADD(MICROSECOND, UNIX_MICROS(CAST(passee_le AS TIMESTAMP)), "
            "CAST('1970-01-01 00:00:00' AS TIMESTAMP_NTZ))) ELSE CAST(passee_le AS "
            "TIMESTAMP_NTZ) END AS passee_le") in flat(text)
    reparse(text, "databricks")
    # Fuseau UTC : la branche instant s'arrête à l'heure UTC.
    assert ("THEN DATE_ADD(MICROSECOND, UNIX_MICROS(CAST(passee_le AS TIMESTAMP)), "
            "CAST('1970-01-01 00:00:00' AS TIMESTAMP_NTZ)) ELSE") in flat(
                sql(orders(), "databricks"))
    assert "TYPEOF" not in sql(orders("Europe/Paris"), "duckdb").upper()


def test_an_instant_is_read_without_the_session_zone():
    """Critère 1 : la branche instant, traduite en DuckDB, rend l'heure de Paris quelle que
    soit la session, y compris pendant l'heure doublée du passage à l'heure d'hiver."""
    branch = wall_clock(exp.column("t"), "Europe/Paris", "databricks").args["ifs"][0].args["true"]
    query = sqlglot.transpile(exp.select(branch.as_("v")).from_("x").sql("databricks"),
                              read="databricks", write="duckdb")[0]
    instants = ["2025-09-30 23:00:00", "2025-10-26 00:30:00", "2025-10-26 01:30:00"]
    for zone in ("UTC", "America/New_York", "Europe/Paris"):
        with duckdb.connect() as connection:
            connection.execute(f"SET TimeZone = '{zone}'")
            connection.execute("CREATE TABLE x (t TIMESTAMPTZ)")
            for instant in instants:
                connection.execute("INSERT INTO x VALUES (CAST(? || '+00' AS TIMESTAMPTZ))",
                                   [instant])
            assert [r[0] for r in connection.execute(query).fetchall()] == [
                datetime.datetime(2025, 10, 1, 1, 0), datetime.datetime(2025, 10, 26, 2, 30),
                datetime.datetime(2025, 10, 26, 2, 30)], zone


def test_snowflake_reads_a_source_timestamp_as_wall_clock_of_its_zone():
    """Plan 0031, critère 1 : `TIMESTAMP_LTZ`, `TIMESTAMP_TZ` ou `TIMESTAMP_NTZ`, la colonne
    est lue dans son fuseau déclaré."""
    text = sql(orders("Europe/Paris"), "snowflake")
    assert ("CASE WHEN TYPEOF(CAST(passee_le AS VARIANT)) IN ('TIMESTAMP_LTZ', 'TIMESTAMP_TZ') "
            "THEN CAST(CONVERT_TIMEZONE('Europe/Paris', CAST(passee_le AS TIMESTAMPTZ)) AS "
            "TIMESTAMPNTZ) ELSE CAST(passee_le AS TIMESTAMPNTZ) END AS passee_le") in flat(text)
    reparse(text, "snowflake")
    # Fuseau UTC : un TIMESTAMP_LTZ passe quand même à l'heure UTC.
    assert ("THEN CAST(CONVERT_TIMEZONE('UTC', CAST(passee_le AS TIMESTAMPTZ)) AS TIMESTAMPNTZ)"
            in flat(sql(orders(), "snowflake")))


def test_a_snowflake_instant_is_read_without_the_session_zone():
    """Plan 0031, critère 2 : la branche instant, traduite en DuckDB, rend l'heure de Paris
    quelle que soit la session, y compris pendant l'heure doublée du passage à l'heure
    d'hiver, et pour un instant écrit avec un autre décalage (`TIMESTAMP_TZ`)."""
    branch = wall_clock(exp.column("t"), "Europe/Paris", "snowflake").args["ifs"][0].args["true"]
    query = sqlglot.transpile(exp.select(branch.as_("v")).from_("x").sql("snowflake"),
                              read="snowflake", write="duckdb")[0]
    instants = ["2025-09-30 23:00:00+00", "2025-10-26 00:30:00+00", "2025-10-26 01:30:00+00",
                "2025-10-26 07:00:00+05:30"]
    for zone in ("UTC", "America/New_York", "Europe/Paris"):
        with duckdb.connect() as connection:
            connection.execute(f"SET TimeZone = '{zone}'")
            connection.execute("CREATE TABLE x (t TIMESTAMPTZ)")
            for instant in instants:
                connection.execute("INSERT INTO x VALUES (CAST(? AS TIMESTAMPTZ))", [instant])
            assert [r[0] for r in connection.execute(query).fetchall()] == [
                datetime.datetime(2025, 10, 1, 1, 0), datetime.datetime(2025, 10, 26, 2, 30),
                datetime.datetime(2025, 10, 26, 2, 30), datetime.datetime(2025, 10, 26, 2, 30)], zone


# Seul `TIMESTAMP` permis : le cast d'un instant vers lui-même, dans la branche instant de
# la lecture en heure murale (plan 0030, critère 2), quelle que soit la colonne.
INSTANT_CAST = re.compile(r"UNIX_MICROS\(CAST\(\w+ AS TIMESTAMP\)\)")


def without_instant_casts(text: str) -> str:
    return INSTANT_CAST.sub("", text)


def test_no_timestamp_cast_depends_on_the_session():
    """Critère 2 : littéral, conversion vers le même fuseau et NULL typé d'une union portent
    le type sans fuseau en Databricks et en Snowflake."""
    document = orders(after=[
        {"id": "n05", "type": "filter", "inputs": ["n01"], "nulls": "drop",
         "condition": "passee_le:greater_than:2025-01-01 00:00:00"},
        {"id": "n06", "type": "temporal", "inputs": ["n05"], "operation": "convert_timezone",
         "column": "passee_le", "target": "passee_le_utc", "to": "UTC"},
        {"id": "n07", "type": "union", "inputs": ["n06", "n05"], "mode": "all", "columns": [
            {"name": "commande_id", "from": {"n06": "commande_id", "n05": "commande_id"}},
            {"name": "passee_le_utc", "from": {"n06": "passee_le_utc"}}]},
        {"id": "n08", "type": "aggregate", "inputs": ["n07"], "group_by": ["passee_le_utc"],
         "measures": [["*", "commandes", "count"]]},
    ])
    for dialect, ntz in (("databricks", "AS TIMESTAMP_NTZ)"), ("snowflake", "AS TIMESTAMPNTZ)")):
        text = sql(document, dialect)
        assert "AS TIMESTAMP)" not in without_instant_casts(text), dialect
        assert f"CAST('2025-01-01 00:00:00' {ntz}" in text
        assert f"CAST(passee_le {ntz} AS passee_le_utc" in text
        assert f"CAST(NULL {ntz} AS passee_le_utc" in text
        reparse(text, dialect)


@pytest.mark.parametrize("dialect", DIALECTS)
def test_the_paris_day_does_not_depend_on_the_session_zone(dialect):
    """Critère 3 : chaque dialecte, traduit en DuckDB, rend les mois du jour de Paris,
    session de DuckDB à New York. C2 (23 h UTC le 30 septembre) tombe le 1er octobre à
    Paris, C3 et C4 le 4 et le 5 novembre."""
    compiled = compile_document(orders(), dialect)
    connection = open_database(compiled.sources, FUSEAU)
    try:
        connection.execute("SET TimeZone = 'America/New_York'")
        found = connection.execute(sqlglot.transpile(
            compiled.sql, read=dialect, write="duckdb")[0]).fetchall()
    finally:
        connection.close()
    assert sorted(found) == [(datetime.date(2025, 9, 1), 1), (datetime.date(2025, 10, 1), 1),
                             (datetime.date(2025, 11, 1), 2)]


@pytest.mark.parametrize("name", ["revenu-net", "ventes"])
@pytest.mark.parametrize("dialect", ["databricks", "snowflake"])
def test_no_reference_sql_casts_to_a_session_timestamp(name, dialect):
    """Critère 2 sur les références : aucune autre conversion vers `TIMESTAMP` que celle
    de la branche instant (par exemple `horodatage` dans ventes.databricks.sql)."""
    text = (FIXTURES / "golden" / f"{name}.{dialect}.sql").read_text()
    assert "AS TIMESTAMP)" not in without_instant_casts(text)
