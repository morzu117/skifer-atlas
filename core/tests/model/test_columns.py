import pytest
from graphs import build, kpi, kpi_ref, nodes, revenu_net, total, with_join

from skifer_atlas.model import validate_data
from skifer_atlas.model.check import check_document
from skifer_atlas.model.columns import columns_at
from skifer_atlas.model.graph import Library

FACTURES = [
    ("facture_id", "string"), ("entite", "string"), ("statut", "string"),
    ("date_facture", "date"), ("montant_ttc", "decimal"), ("montant_taxes", "decimal"),
    ("avoirs", "decimal"),
]

# Table de vérité de la fixture « Revenu net » (critère 2).
REVENU_NET_COLUMNS = {
    "n01": FACTURES,
    "n02": FACTURES,
    "n03": [*FACTURES, ("montant_ht", "decimal")],
    "n04": [*FACTURES, ("montant_ht", "decimal"), ("mois_fiscal", "date")],
    "n05": [("mois_fiscal", "date"), ("entite", "string"), ("revenu_net", "decimal")],
}


def problems(raw: dict) -> list[tuple[str, str | None]]:
    """(code, node_id) des erreurs, qu'elles viennent du schéma (0001) ou du graphe (0002)."""
    result = validate_data(raw)
    issues = result.issues if not result.valid else check_document(result.document)
    return [(i.code, i.node_id) for i in issues if i.severity == "error"]


@pytest.mark.parametrize("node_id", sorted(REVENU_NET_COLUMNS))
def test_columns_at_revenu_net(node_id):
    assert columns_at(build(revenu_net()), node_id) == REVENU_NET_COLUMNS[node_id]


def test_columns_at_is_none_below_an_unknown_kpi_ref():
    raw = kpi("revenu-annuel", 1, [
        kpi_ref("n01", "revenu-net", 4),
        total("n02", "n01", ["entite"], ["revenu_net", "revenu_annuel", "sum"]),
    ], "n02")
    document = build(raw)
    assert columns_at(document, "n02") is None
    library = Library([build(revenu_net())])
    assert columns_at(document, "n01", library) == REVENU_NET_COLUMNS["n05"]
    assert columns_at(document, "n02", library) == [
        ("entite", "string"), ("revenu_annuel", "decimal"),
    ]


def test_kpi_ref_columns_restrict_the_output():
    ref = kpi_ref("n01", "revenu-net", 4)
    ref["columns"] = ["entite", "revenu_nett"]
    raw = kpi("revenu-annuel", 1, [
        ref, total("n02", "n01", ["entite"], ["entite", "n", "count"]),
    ], "n02")
    library = Library([build(revenu_net())])
    issues = check_document(build(raw), library)
    unknown = next(i for i in issues if i.code == "unknown_column")
    assert unknown.node_id == "n01"
    assert "Voulez-vous dire : revenu_net ?" in unknown.message
    assert columns_at(build(raw), "n01", library) == [("entite", "string")]


def test_unknown_join_key_suggests_the_closest_column():
    raw = with_join(revenu_net())
    nodes(raw)["n07"]["keys"] = [["entite", "entite_idd"]]
    issues = check_document(build(raw))
    assert [(i.code, i.node_id) for i in issues] == [("unknown_column", "n07")]
    assert "« entite_idd »" in issues[0].message
    assert "Voulez-vous dire : entite_id ?" in issues[0].message


def test_join_merges_both_sides():
    document = build(with_join(revenu_net()))
    assert columns_at(document, "n07") == [*FACTURES, ("entite_id", "string"), ("pays", "string")]


def test_anti_join_keeps_the_left_side_only():
    document = build(with_join(revenu_net(), how="left_anti"))
    assert columns_at(document, "n07") == FACTURES


def test_ambiguous_column():
    raw = with_join(revenu_net())
    nodes(raw)["n06"]["columns"].append({"name": "statut", "type": "string"})
    assert problems(raw) == [("ambiguous_column", "n07")]


def test_equal_join_keys_are_not_ambiguous():
    raw = with_join(revenu_net())
    nodes(raw)["n06"]["columns"][0]["name"] = "entite"
    nodes(raw)["n07"]["keys"] = [["entite", "entite"]]
    assert problems(raw) == []


@pytest.mark.parametrize("field, value", [
    ("condition", "statuts:equals:validée"),
    ("condition", {"expr": "montant_tc > 0"}),
])
def test_unknown_column_in_a_filter(field, value):
    raw = revenu_net()
    nodes(raw)["n02"][field] = value
    assert problems(raw) == [("unknown_column", "n02")]


def test_unknown_column_in_an_expression():
    raw = revenu_net()
    nodes(raw)["n03"]["expr"] = "montant_ttc - taxes"
    assert problems(raw) == [("unknown_column", "n03")]


def test_unknown_group_by_after_aggregation():
    raw = revenu_net()
    nodes(raw)["n05"]["group_by"] = ["mois_fiscal", "pays"]
    assert problems(raw) == [("unknown_column", "n05")]


@pytest.mark.parametrize("expr", ["NOW()", "ROUND(montant_ttc, 2)", "RAND() * avoirs",
                                  "CURRENT_DATE", "SUM(avoirs)"])
def test_forbidden_functions_in_compute(expr):
    raw = revenu_net()
    nodes(raw)["n03"]["expr"] = expr
    assert ("forbidden_function", "n03") in problems(raw)


@pytest.mark.parametrize("expr", [
    "CASE WHEN avoirs > 0 AND montant_ttc > 0 THEN avoirs ELSE 0 END",
    "CASE WHEN avoirs IS NULL OR avoirs < 0 THEN 0 ELSE avoirs END",
])
def test_logical_operators_are_not_functions(expr):
    raw = revenu_net()
    nodes(raw)["n03"]["expr"] = expr
    assert problems(raw) == []


def test_window_function_in_compute_points_to_the_temporal_node():
    raw = revenu_net()
    nodes(raw)["n03"]["expr"] = "LAG(avoirs) OVER (ORDER BY date_facture)"
    issues = check_document(build(raw))
    assert [(i.code, i.node_id) for i in issues] == [("forbidden_function", "n03")]
    assert "« window »" in issues[0].message


def test_subquery_in_expr():
    raw = revenu_net()
    nodes(raw)["n03"]["expr"] = "montant_ttc - (SELECT MAX(t) FROM taxes)"
    assert ("subquery_in_expr", "n03") in problems(raw)


def test_allowed_functions_pass():
    raw = revenu_net()
    nodes(raw)["n03"]["expr"] = (
        "CASE WHEN UPPER(TRIM(statut)) = 'VALIDÉE' THEN COALESCE(montant_ttc, 0) "
        "ELSE ABS(NULLIF(avoirs, 0)) END"
    )
    assert problems(raw) == []


def _timestamp_source(raw: dict) -> dict:
    source = nodes(raw)["n01"]
    source["columns"][3] = {"name": "date_facture", "type": "timestamp", "timezone": "UTC",
                            "format": "yyyy-MM-dd'T'HH:mm:ss"}
    return raw


def test_period_on_a_timestamp_is_refused():
    assert problems(_timestamp_source(revenu_net())) == [("implicit_timezone_conversion", "n04")]


def test_period_after_an_explicit_to_date_passes():
    raw = _timestamp_source(revenu_net())
    raw["graph"]["nodes"].insert(3, {
        "id": "n06", "type": "temporal", "inputs": ["n03"], "operation": "to_date",
        "column": "date_facture", "target": "jour_facture", "timezone": "Europe/Paris",
    })
    nodes(raw)["n04"].update(inputs=["n06"], column="jour_facture")
    assert problems(raw) == []
    assert ("jour_facture", "date") in columns_at(build(raw), "n06")


def test_inferred_types():
    raw = revenu_net()
    del nodes(raw)["n03"]["column_type"]
    graph_nodes = raw["graph"]["nodes"]
    for index, (column, expr) in enumerate([
        ("taux", "montant_taxes / montant_ttc"),
        ("libelle", "UPPER(statut)"),
        ("positif", "montant_ttc > 0"),
        ("compte", "CAST(montant_ttc AS INT) + 1"),
        ("ratio", "CAST(avoirs AS DOUBLE) * 2"),
    ]):
        graph_nodes.insert(3 + index, {
            "id": f"n1{index}", "type": "compute", "inputs": [graph_nodes[2 + index]["id"]],
            "column": column, "expr": expr,
        })
    nodes(raw)["n04"]["inputs"] = ["n14"]
    columns = dict(columns_at(build(raw), "n14"))
    assert columns["montant_ht"] == "decimal"
    assert columns["taux"] == "double"  # division en DOUBLE (plan 0021)
    assert columns["libelle"] == "string"
    assert columns["positif"] == "boolean"
    assert columns["compte"] == "integer"
    assert columns["ratio"] == "double"


def test_union_maps_columns_from_each_input():
    raw = revenu_net()
    graph_nodes = raw["graph"]["nodes"]
    graph_nodes.insert(2, {
        "id": "n06", "type": "filter", "inputs": ["n01"], "condition": "statut:equals:expédiée",
        "nulls": "drop",
    })
    graph_nodes.insert(3, {
        "id": "n07", "type": "union", "inputs": ["n02", "n06"], "mode": "all",
        "columns": [
            {"name": "entite", "from": {"n02": "entite", "n06": "entite"}},
            {"name": "date_facture", "from": {"n02": "date_facture", "n06": "date_facture"}},
            {"name": "montant_ttc", "from": {"n02": "montant_ttc", "n06": "montant_ttc"}},
            {"name": "montant_taxes", "from": {"n02": "montant_taxes", "n06": "montant_taxes"}},
            {"name": "avoirs", "from": {"n02": "avoirs", "n06": "avoir"}},
        ],
    })
    nodes(raw)["n03"]["inputs"] = ["n07"]
    issues = check_document(build(raw))
    assert [(i.code, i.node_id, i.path) for i in issues] == [
        ("unknown_column", "n07", "/graph/nodes/3/columns/4/from/n06"),
    ]
    nodes(raw)["n07"]["columns"][4]["from"]["n06"] = "avoirs"
    assert problems(raw) == []
    assert columns_at(build(raw), "n07")[1] == ("date_facture", "date")


def test_metric_op_after_an_aggregate():
    raw = revenu_net()
    nodes(raw)["n05"]["measures"].append(["montant_ttc", "ttc", "sum"])
    raw["graph"]["nodes"].append({
        "id": "n06", "type": "metric_op", "inputs": ["n05"], "order": "aggregate_first",
        "metrics": [{"name": "taux_net", "expr": "revenu_net / ttc"}],
    })
    raw["graph"]["output"] = "n06"
    assert problems(raw) == []
    assert columns_at(build(raw), "n06")[-1] == ("taux_net", "double")
