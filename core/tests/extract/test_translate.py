"""Une ligne du tableau de traduction du plan 0004 par test, dans les deux dialectes."""

import pytest
from helpers import DIALECTS, by_type, codes, column_names, extract_sql, graph, single

from skifer_atlas.extract import NULLS_INFERRED
from skifer_atlas.extract.translate import NULLS_DROP_NOTE, NULLS_KEEP_NOTE

pytestmark = pytest.mark.parametrize("dialect", DIALECTS)


# --- sources ------------------------------------------------------------------------------

def test_source_lists_cited_columns(tmp_path, dialect):
    extraction = single(tmp_path, "SELECT f.id, f.montant FROM fin.factures f WHERE f.statut = 'ok'",
                        dialect)
    [source] = by_type(extraction, "source")
    assert source["platform"] == dialect
    assert source["table"] == "fin.factures"
    assert source["owner"] == "TODO"
    assert source["columns"] == [{"name": n, "type": "TODO"} for n in ("id", "montant", "statut")]
    assert extraction.draft.status == "draft"


def test_unqualified_table_is_a_todo(tmp_path, dialect):
    extraction = single(tmp_path, "SELECT id FROM factures", dialect)
    assert by_type(extraction, "source")[0]["table"] == "TODO.factures"
    assert codes(extraction) == ["unqualified_table"]
    assert extraction.draft.status == "draft"


def test_same_table_twice_is_one_source(tmp_path, dialect):
    sql = """SELECT a.id, b.parent FROM s.noeuds a JOIN s.noeuds b ON a.parent = b.id"""
    extraction = single(tmp_path, sql, dialect)
    sources = by_type(extraction, "source")
    assert len(sources) == 1 and column_names(sources[0]) == ["id", "parent"]


# --- WHERE --------------------------------------------------------------------------------

def test_each_where_conjunct_is_a_filter(tmp_path, dialect):
    sql = """SELECT id FROM s.t WHERE v BETWEEN 1 AND 10 AND n LIKE 'A%'
             AND k NOT IN ('x', 'y') AND z IS NOT NULL AND (a > 2 OR b < 3)"""
    filters = by_type(single(tmp_path, sql, dialect), "filter")
    assert [f["condition"] for f in filters] == [
        "v:between:1,10", "n:like:A%", "k:not_in:x,y", "z:is_not_null", {"expr": "a > 2 OR b < 3"},
    ]
    assert [f["inputs"] for f in filters] == [["n01"], ["n02"], ["n03"], ["n04"], ["n05"]]


def test_not_equals_drops_nulls_with_an_info(tmp_path, dialect):
    extraction = single(tmp_path, "SELECT id FROM s.clients WHERE pays <> 'FR'", dialect)
    [node] = by_type(extraction, "filter")
    assert (node["condition"], node["nulls"], node["note"]) == (
        "pays:not_equals:FR", "drop", NULLS_DROP_NOTE,
    )
    assert extraction.infos == [{
        "code": NULLS_INFERRED, "node_id": node["id"],
        "message": "nulls: drop déduit du SQL : à confirmer.",
    }]
    assert extraction.draft.residues == []


def test_is_null_or_keeps_nulls(tmp_path, dialect):
    extraction = single(tmp_path, "SELECT id FROM s.clients WHERE pays IS NULL OR pays <> 'FR'",
                        dialect)
    [node] = by_type(extraction, "filter")
    assert node["nulls"] == "keep" and node["note"] == NULLS_KEEP_NOTE
    assert node["condition"] == {"expr": "pays IS NULL OR pays <> 'FR'"}


def test_literal_on_the_left_is_flipped(tmp_path, dialect):
    [node] = by_type(single(tmp_path, "SELECT id FROM s.t WHERE 10 < v", dialect), "filter")
    assert node["condition"] == "v:greater_than:10"


# --- JOIN ---------------------------------------------------------------------------------

@pytest.mark.parametrize(("sql_join", "how"), [
    ("JOIN", "inner"), ("INNER JOIN", "inner"), ("LEFT JOIN", "left"),
    ("LEFT OUTER JOIN", "left"), ("RIGHT JOIN", "right"), ("FULL OUTER JOIN", "full"),
])
def test_join_how_and_keys(tmp_path, dialect, sql_join, how):
    sql = f"SELECT o.id, c.pays FROM s.commandes o {sql_join} s.clients c ON c.ref = o.client_id"
    extraction = single(tmp_path, sql, dialect)
    [join] = by_type(extraction, "join")
    assert join == {
        "id": "n03", "type": "join", "inputs": {"left": "n01", "right": "n02"}, "how": how,
        "keys": [["client_id", "ref"]], "cardinality": "TODO", "check": "required",
    }
    assert codes(extraction) == ["cardinality_unknown"]
    assert not extraction.blocking


def test_same_column_on_both_sides_of_a_join_needs_curation(tmp_path, dialect):
    # Atlas ne préfixe pas les colonnes : deux `id` après la jointure sont ambigus (plan 0002).
    sql = "SELECT o.id, c.pays FROM s.commandes o JOIN s.clients c ON c.id = o.client_id"
    extraction = single(tmp_path, sql, dialect)
    assert codes(extraction) == ["cardinality_unknown", "invalid_draft"]
    assert "ambiguous_column (n03)" in extraction.draft.residues[1].message


def test_join_using(tmp_path, dialect):
    sql = "SELECT id, montant, pays FROM s.commandes JOIN s.clients USING (id)"
    [join] = by_type(single(tmp_path, sql, dialect), "join")
    assert join["keys"] == [["id", "id"]]


def test_extra_on_predicate_of_an_inner_join_becomes_a_filter(tmp_path, dialect):
    sql = "SELECT a.id FROM s.a a JOIN s.b b ON a.id = b.id AND b.actif = 1"
    extraction = single(tmp_path, sql, dialect)
    assert [n["type"] for n in graph(extraction)] == ["source", "source", "join", "filter"]
    assert by_type(extraction, "filter")[0]["condition"] == "actif:equals:1"


def test_extra_on_predicate_of_an_outer_join_is_blocking(tmp_path, dialect):
    sql = "SELECT a.id FROM s.a a LEFT JOIN s.b b ON a.id = b.id AND b.actif = 1"
    extraction = single(tmp_path, sql, dialect)
    assert "unsupported_construct" in codes(extraction)
    assert extraction.draft.status == "needs_curation"


# --- UNION, CTE, sous-requêtes ------------------------------------------------------------

@pytest.mark.parametrize(("keyword", "mode"), [("UNION ALL", "all"), ("UNION", "distinct")])
def test_union(tmp_path, dialect, keyword, mode):
    sql = f"SELECT id, montant FROM s.a {keyword} SELECT ref, total FROM s.b"
    [union] = by_type(single(tmp_path, sql, dialect), "union")
    assert union == {
        "id": "n03", "type": "union", "inputs": ["n01", "n02"], "mode": mode,
        "columns": [{"name": "id", "from": {"n01": "id", "n02": "ref"}},
                    {"name": "montant", "from": {"n01": "montant", "n02": "total"}}],
    }


def test_cte_nodes_are_shared(tmp_path, dialect):
    sql = """WITH propres AS (SELECT id, UPPER(pays) AS pays FROM s.clients)
             SELECT id, pays FROM propres WHERE pays = 'FR'
             UNION ALL SELECT id, pays FROM propres WHERE pays = 'BE'"""
    extraction = single(tmp_path, sql, dialect)
    assert [n["type"] for n in graph(extraction)] == [
        "source", "compute", "filter", "filter", "union",
    ]
    assert [f["inputs"] for f in by_type(extraction, "filter")] == [["n02"], ["n02"]]


def test_subquery_in_from(tmp_path, dialect):
    sql = "SELECT x.id FROM (SELECT id, v FROM s.t WHERE v > 0) x WHERE x.id IN (1, 2)"
    filters = by_type(single(tmp_path, sql, dialect), "filter")
    assert [f["condition"] for f in filters] == ["v:greater_than:0", "id:in:1,2"]


# --- SELECT -------------------------------------------------------------------------------

def test_select_expression_is_a_compute(tmp_path, dialect):
    sql = "SELECT id, COALESCE(remise, 0) AS remise, montant * 1.2 AS ttc, id AS ref FROM s.t"
    extraction = single(tmp_path, sql, dialect)
    computes = by_type(extraction, "compute")
    # La colonne remplacée (`remise`) passe en dernier, comme en SQL.
    assert [(c["column"], c["expr"]) for c in computes] == [
        ("ttc", "montant * 1.2"), ("ref", "id"), ("remise", "COALESCE(remise, 0)"),
    ]


def test_unnamed_expression_gets_a_name(tmp_path, dialect):
    extraction = single(tmp_path, "SELECT id, montant * 2 FROM s.t", dialect)
    assert by_type(extraction, "compute")[0]["column"] == "col_2"
    assert codes(extraction) == ["unnamed_expression"]


def test_order_by_without_limit_is_ignored(tmp_path, dialect):
    extraction = single(tmp_path, "SELECT id FROM s.t ORDER BY id", dialect)
    assert codes(extraction) == ["ignored_clause"] and not extraction.blocking


# --- dédoublonnage ------------------------------------------------------------------------

def test_qualify_row_number_is_a_deduplicate(tmp_path, dialect):
    sql = """SELECT a.id, a.v FROM s.t a
             QUALIFY ROW_NUMBER() OVER (PARTITION BY a.id ORDER BY a.maj DESC, a.v) = 1"""
    extraction = single(tmp_path, sql, dialect)
    [dedup] = by_type(extraction, "deduplicate")
    assert dedup == {
        "id": "n02", "type": "deduplicate", "inputs": ["n01"], "keys": ["id"],
        "keep": {"order_by": [["maj", "desc"], ["v", "asc"]]},
    }
    assert extraction.draft.residues == []


def test_row_number_subquery_filtered_on_one_is_a_deduplicate(tmp_path, dialect):
    sql = """SELECT id, v FROM (
               SELECT id, v, ROW_NUMBER() OVER (PARTITION BY id ORDER BY maj DESC) AS rn
               FROM s.t) x
             WHERE rn = 1"""
    extraction = single(tmp_path, sql, dialect)
    assert [n["type"] for n in graph(extraction)] == ["source", "deduplicate"]
    assert column_names(by_type(extraction, "source")[0]) == ["id", "v", "maj"]


# --- regroupement -------------------------------------------------------------------------

def test_group_by_and_having(tmp_path, dialect):
    sql = """SELECT pays, SUM(montant) AS total, COUNT(*) AS n, COUNT(DISTINCT client) AS clients
             FROM s.t GROUP BY pays HAVING SUM(montant) > 1000"""
    extraction = single(tmp_path, sql, dialect)
    [aggregate] = by_type(extraction, "aggregate")
    assert aggregate["group_by"] == ["pays"]
    assert aggregate["measures"] == [
        ["montant", "total", "sum"], ["*", "n", "count"], ["client", "clients", "count_distinct"],
    ]
    assert aggregate["having"] == ["total:greater_than:1000"]
    assert extraction.draft.data["kind"] == "kpi"
    assert extraction.draft.data["semantics"] == {"calendar": "TODO", "timezone": "TODO"}


def test_ratio_of_sums_is_aggregate_then_metric_op(tmp_path, dialect):
    extraction = single(tmp_path, "SELECT g, SUM(a) / SUM(b) AS r FROM s.t GROUP BY g", dialect)
    assert [n["type"] for n in graph(extraction)] == ["source", "aggregate", "metric_op"]
    [metric] = by_type(extraction, "metric_op")
    assert metric["order"] == "aggregate_first"
    assert metric["metrics"] == [{"name": "r", "expr": "r__1 / r__2"}]
    assert by_type(extraction, "aggregate")[0]["measures"] == [
        ["a", "r__1", "sum"], ["b", "r__2", "sum"],
    ]


def test_average_of_ratio_is_compute_then_aggregate(tmp_path, dialect):
    extraction = single(tmp_path, "SELECT g, AVG(a / b) AS r FROM s.t GROUP BY g", dialect)
    assert [n["type"] for n in graph(extraction)] == ["source", "compute", "aggregate"]
    assert by_type(extraction, "compute")[0]["expr"] == "a / b"
    assert by_type(extraction, "aggregate")[0]["measures"] == [["r__arg", "r", "avg"]]


def test_group_by_position_and_expression(tmp_path, dialect):
    sql = "SELECT UPPER(pays) AS p, SUM(v) AS total FROM s.t GROUP BY 1"
    extraction = single(tmp_path, sql, dialect)
    assert [n["type"] for n in graph(extraction)] == ["source", "compute", "aggregate"]
    assert by_type(extraction, "aggregate")[0]["group_by"] == ["p"]


# --- dates et fuseaux ---------------------------------------------------------------------

DATE_FUNCTIONS = {
    "databricks": "FROM_UTC_TIMESTAMP(cree_le, 'Europe/Paris')",
    "snowflake": "CONVERT_TIMEZONE('UTC', 'Europe/Paris', cree_le)",
}


def test_timezone_conversion_is_temporal(tmp_path, dialect):
    sql = f"SELECT id, {DATE_FUNCTIONS[dialect]} AS locale FROM s.t"
    [node] = by_type(single(tmp_path, sql, dialect), "temporal")
    assert {k: node[k] for k in ("operation", "column", "target", "to", "note")} == {
        "operation": "convert_timezone", "column": "cree_le", "target": "locale",
        "to": "Europe/Paris", "note": "Fuseau d'origine dans le SQL : UTC.",
    }


@pytest.mark.parametrize("expression", ["TO_DATE(cree_le)", "CAST(cree_le AS DATE)",
                                        "cree_le::DATE"])
def test_to_date_is_temporal_with_timezone_to_complete(tmp_path, dialect, expression):
    extraction = single(tmp_path, f"SELECT id, {expression} AS jour FROM s.t", dialect)
    [node] = by_type(extraction, "temporal")
    assert (node["operation"], node["column"], node["target"], node["timezone"]) == (
        "to_date", "cree_le", "jour", "TODO",
    )


def test_to_date_keeps_its_format(tmp_path, dialect):
    [node] = by_type(single(tmp_path, "SELECT TO_DATE(d, 'yyyy-MM-dd') AS jour FROM s.t", dialect),
                     "temporal")
    assert node["format"]


def test_date_trunc_is_a_period(tmp_path, dialect):
    sql = "SELECT DATE_TRUNC('MONTH', jour) AS mois, SUM(v) AS total FROM s.t GROUP BY 1"
    extraction = single(tmp_path, sql, dialect)
    [node] = by_type(extraction, "temporal")
    assert (node["operation"], node["column"], node["target"], node["grain"]) == (
        "period", "jour", "mois", "month",
    )
    assert extraction.draft.status == "draft"


def test_period_in_a_concept_fails_the_check(tmp_path, dialect):
    extraction = single(tmp_path, "SELECT id, DATE_TRUNC('MONTH', jour) AS mois FROM s.t", dialect)
    assert codes(extraction) == ["invalid_draft"]
    assert "missing_calendar (n02)" in extraction.draft.residues[0].message
    assert extraction.draft.status == "needs_curation"


# --- résidus bloquants --------------------------------------------------------------------

@pytest.mark.parametrize(("sql", "code"), [
    ("SELECT id, LAG(v) OVER (ORDER BY d) AS prec FROM s.t", "window_function"),
    ("SELECT id, SUM(v) OVER (PARTITION BY g) AS cumul FROM s.t", "window_function"),
    ("SELECT id, ROUND(v, 2) AS r FROM s.t", "rounding_in_definition"),
    ("SELECT id, FLOOR(v) AS r FROM s.t", "rounding_in_definition"),
    ("SELECT id, CURRENT_TIMESTAMP() AS maintenant FROM s.t", "non_deterministic"),
    ("SELECT id, RANDOM() AS r FROM s.t", "non_deterministic"),
    ("SELECT id, (SELECT MAX(v) FROM s.u) AS m FROM s.t", "unsupported_construct"),
    ("SELECT * FROM s.t", "unsupported_construct"),
    ("SELECT id FROM s.t LIMIT 10", "unsupported_construct"),
    ("SELECT DISTINCT id FROM s.t", "unsupported_construct"),
    ("SELECT id FROM s.t EXCEPT SELECT id FROM s.u", "unsupported_construct"),
    ("SELECT * FROM s.t PIVOT (SUM(v) FOR k IN ('a', 'b'))", "unsupported_construct"),
])
def test_blocking_residues(tmp_path, dialect, sql, code):
    extraction = single(tmp_path, sql, dialect)
    assert code in codes(extraction)
    assert extraction.draft.status == "needs_curation"
    assert extraction.roundtrip.status == "skipped"


def test_lateral_is_blocking(tmp_path, dialect):
    sql = {
        "databricks": "SELECT id, x FROM s.t LATERAL VIEW EXPLODE(valeurs) e AS x",
        "snowflake": "SELECT a.id, l.value FROM s.t a, LATERAL FLATTEN(input => a.valeurs) l",
    }[dialect]
    extraction = single(tmp_path, sql, dialect)
    assert "unsupported_construct" in codes(extraction) and extraction.blocking


# --- instructions -------------------------------------------------------------------------

def test_create_table_as_and_insert_select(tmp_path, dialect):
    result = extract_sql(tmp_path, """
        CREATE OR REPLACE TABLE s.sortie AS SELECT id FROM s.t WHERE v > 0;
        INSERT INTO s.sortie SELECT id FROM s.u WHERE v > 0""", dialect)
    assert [e.draft.id for e in result.extractions] == ["requete-1", "requete-2"]
    assert [e.draft.data["label"] for e in result.extractions] == ["s.sortie", "s.sortie"]


def test_other_statements_get_no_draft(tmp_path, dialect):
    result = extract_sql(tmp_path, "UPDATE s.t SET v = 1; SELECT id FROM s.t", dialect)
    assert [e.draft.id for e in result.extractions] == ["requete"]
    assert [(line, r.code) for line, r in result.residues] == [(1, "unsupported_statement")]


def test_unreadable_statement_is_a_draft_to_curate(tmp_path, dialect):
    [extraction] = extract_sql(tmp_path, "SELECT id FROM s.t WHERE v >", dialect).extractions
    assert codes(extraction) == ["parse_error"]
    assert extraction.draft.status == "needs_curation"
    assert "graph" not in extraction.draft.data


def test_ids_follow_topological_order(tmp_path, dialect):
    sql = """WITH c AS (SELECT id, v FROM s.a WHERE v > 0)
             SELECT c.id, SUM(b.w) AS total FROM c JOIN s.b b ON b.id = c.id GROUP BY c.id"""
    nodes = graph(single(tmp_path, sql, dialect))
    assert [n["id"] for n in nodes] == [f"n{i:02d}" for i in range(1, len(nodes) + 1)]
    seen = set()
    for node in nodes:
        inputs = node.get("inputs", [])
        inputs = list(inputs.values()) if isinstance(inputs, dict) else inputs
        assert set(inputs) <= seen
        seen.add(node["id"])
