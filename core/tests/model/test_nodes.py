import pytest
from conftest import MINIMAL_NODES, codes, kpi_with

from skifer_atlas.model import NODE_TYPES, validate_data


def test_every_node_type_has_a_minimal_fixture():
    assert set(MINIMAL_NODES) == set(NODE_TYPES)


@pytest.mark.parametrize("node_type", NODE_TYPES)
def test_minimal_node_is_valid(node_type):
    result = validate_data(kpi_with(MINIMAL_NODES[node_type]))
    assert result.valid, result.issues


@pytest.mark.parametrize(
    ("node_type", "field"),
    [(t, f) for t, node in MINIMAL_NODES.items() for f in node],
)
def test_missing_required_field(node_type, field):
    node = dict(MINIMAL_NODES[node_type])
    del node[field]
    result = validate_data(kpi_with(node))
    expected_node = None if field == "id" else "n01"
    assert (f"/graph/nodes/0/{field}", expected_node, "missing_field") in codes(result)


@pytest.mark.parametrize(
    ("operation", "extra"),
    [
        ("convert_timezone", {"to": "UTC"}),
        ("to_date", {"timezone": "Europe/Paris", "format": "yyyy-MM-dd"}),
        ("period", {"grain": "quarter"}),
        ("window", {"function": "sum", "frame": "rows:6:0", "order_by": [["d", "asc"]]}),
    ],
)
def test_temporal_operations(operation, extra):
    node = {k: v for k, v in MINIMAL_NODES["temporal"].items() if k != "grain"}
    node.update(operation=operation, **extra)
    assert validate_data(kpi_with(node)).valid
    for field in extra:
        if field == "format":
            continue
        partial = {k: v for k, v in node.items() if k != field}
        assert (f"/graph/nodes/0/{field}", "n01", "missing_field") in codes(
            validate_data(kpi_with(partial))
        )


def test_unknown_node_type():
    node = dict(MINIMAL_NODES["filter"], type="pivot")
    assert codes(validate_data(kpi_with(node))) == [("/graph/nodes/0/type", "n01", "unknown_node_type")]


def test_filter_without_nulls_is_refused():
    node = {k: v for k, v in MINIMAL_NODES["filter"].items() if k != "nulls"}
    assert ("/graph/nodes/0/nulls", "n01", "missing_field") in codes(validate_data(kpi_with(node)))


@pytest.mark.parametrize(
    ("condition", "canonical"),
    [
        ("statut:eq:validée", "statut:equals:validée"),
        ("statut:=:validée", "statut:equals:validée"),
        ("statut:in: validée ; expédiée", "statut:in:validée,expédiée"),
        ("montant:between:0,100", "montant:between:0,100"),
        ("client_id:is_not_null", "client_id:is_not_null"),
    ],
)
def test_filter_condition_is_rewritten_in_canonical_form(condition, canonical):
    node = dict(MINIMAL_NODES["filter"], condition=condition)
    result = validate_data(kpi_with(node))
    assert result.valid, result.issues
    assert result.document.graph.nodes[0].condition == canonical


@pytest.mark.parametrize(
    "condition",
    ["statut", "statut:pivot:x", "statut:sql:1=1", "statut:equals", "x:is_null:1",
     "montant:between:1", "statut:EQUALS:x", {"expr": "a >"}],
)
def test_invalid_filter_condition(condition):
    node = dict(MINIMAL_NODES["filter"], condition=condition)
    issues = codes(validate_data(kpi_with(node)))
    assert issues and all(code == "invalid_value" for _, _, code in issues)
    assert all(path.startswith("/graph/nodes/0/condition") for path, _, _ in issues)


def test_filter_accepts_sql_expression():
    node = dict(MINIMAL_NODES["filter"], condition={"expr": "statut = 'validée' AND montant > 0"})
    assert validate_data(kpi_with(node)).valid


def test_join_without_cardinality_is_refused():
    node = {k: v for k, v in MINIMAL_NODES["join"].items() if k != "cardinality"}
    assert ("/graph/nodes/0/cardinality", "n01", "missing_field") in codes(
        validate_data(kpi_with(node))
    )


def test_join_bypass_needs_a_reason():
    node = dict(MINIMAL_NODES["join"], check="bypass")
    assert codes(validate_data(kpi_with(node))) == [
        ("/graph/nodes/0/bypass_reason", "n01", "missing_field")
    ]
    node["bypass_reason"] = "Doublons connus dans la table de référence, corrigés en amont."
    assert validate_data(kpi_with(node)).valid


def test_join_keys_depend_on_how():
    assert not validate_data(kpi_with(dict(MINIMAL_NODES["join"], keys=[]))).valid
    assert not validate_data(kpi_with(dict(MINIMAL_NODES["join"], how="cross"))).valid
    assert validate_data(kpi_with(dict(MINIMAL_NODES["join"], how="cross", keys=[]))).valid


def test_unquoted_cardinality_gets_a_hint():
    # YAML 1.1 lit 1:1 sans guillemets comme l'entier 61.
    result = validate_data(kpi_with(dict(MINIMAL_NODES["join"], cardinality=61)))
    assert "guillemets" in result.issues[0].message


@pytest.mark.parametrize("expr", ["ROUND(a, 2)", "a + round(b)", "bround(a, 2) * 3"])
def test_round_is_forbidden_in_compute(expr):
    node = dict(MINIMAL_NODES["compute"], expr=expr)
    assert codes(validate_data(kpi_with(node))) == [
        ("/graph/nodes/0/expr", "n01", "forbidden_function")
    ]


def test_round_is_forbidden_in_metrics():
    node = dict(MINIMAL_NODES["metric_op"], metrics=[{"name": "m", "expr": "round(a / b, 2)"}])
    assert codes(validate_data(kpi_with(node))) == [
        ("/graph/nodes/0/metrics/0/expr", "n01", "forbidden_function")
    ]


def test_unreadable_sql_is_refused():
    node = dict(MINIMAL_NODES["compute"], expr="a + (b")
    assert codes(validate_data(kpi_with(node))) == [("/graph/nodes/0/expr", "n01", "invalid_value")]


@pytest.mark.parametrize("function", ["first", "last"])
def test_first_and_last_are_forbidden(function):
    node = dict(MINIMAL_NODES["aggregate"], measures=[["a", "b", function]])
    assert codes(validate_data(kpi_with(node))) == [
        ("/graph/nodes/0/measures/0/2", "n01", "forbidden_function")
    ]


def test_aggregate_aliases_are_rewritten():
    node = dict(MINIMAL_NODES["aggregate"], measures=[["a", "b", "mean"]])
    result = validate_data(kpi_with(node))
    assert result.document.graph.nodes[0].measures == [("a", "b", "avg")]


def test_star_only_with_count():
    node = dict(MINIMAL_NODES["aggregate"], measures=[["*", "n", "sum"]])
    assert codes(validate_data(kpi_with(node))) == [
        ("/graph/nodes/0/measures/0", "n01", "invalid_value")
    ]


@pytest.mark.parametrize("column_type", ["date", "timestamp"])
def test_temporal_source_column_needs_timezone_and_format(column_type):
    node = dict(MINIMAL_NODES["source"], columns=[{"name": "d", "type": column_type}])
    assert ("/graph/nodes/0/columns/0/timezone", "n01", "missing_field") in codes(
        validate_data(kpi_with(node))
    )
    node["columns"] = [{"name": "d", "type": column_type, "timezone": "Europe/Paris"}]
    assert ("/graph/nodes/0/columns/0/format", "n01", "missing_field") in codes(
        validate_data(kpi_with(node))
    )


def test_unknown_timezone_is_refused():
    columns = [{"name": "d", "type": "date", "timezone": "Europe/Lutece", "format": "yyyy-MM-dd"}]
    node = dict(MINIMAL_NODES["source"], columns=columns)
    assert codes(validate_data(kpi_with(node))) == [
        ("/graph/nodes/0/columns/0/timezone", "n01", "invalid_value")
    ]


def test_binding_needs_a_concept():
    node = dict(MINIMAL_NODES["source"], binding={"x": "commande_id"})
    assert codes(validate_data(kpi_with(node))) == [("/graph/nodes/0/concept", "n01", "missing_field")]


def test_metric_op_rows_first_needs_aggregate():
    node = dict(MINIMAL_NODES["metric_op"], order="rows_first")
    assert codes(validate_data(kpi_with(node))) == [
        ("/graph/nodes/0/aggregate", "n01", "missing_field")
    ]


def test_union_needs_two_inputs():
    node = dict(MINIMAL_NODES["union"], inputs=["n10"])
    assert codes(validate_data(kpi_with(node))) == [("/graph/nodes/0/inputs", "n01", "invalid_value")]
