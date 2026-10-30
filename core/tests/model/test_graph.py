import copy

from conftest import read_fixture
from graphs import (
    ENTITES,
    build,
    kpi,
    kpi_ref,
    nodes,
    revenu_net,
    total,
    with_join,
)

from skifer_atlas.model.check import check_document, has_errors
from skifer_atlas.model.graph import Library


def issues_of(raw: dict, *library_docs: dict):
    library = Library(build(doc) for doc in library_docs)
    return check_document(build(raw), library)


def found(issues, code: str) -> list[tuple[str | None, str]]:
    return [(i.node_id, i.severity) for i in issues if i.code == code]


def test_reference_kpi_and_concept_are_clean():
    assert check_document(build(revenu_net())) == []
    assert check_document(build(read_fixture("commande.yaml"))) == []


def test_unknown_input():
    raw = revenu_net()
    nodes(raw)["n03"]["inputs"] = ["n09"]
    issues = issues_of(raw)
    assert found(issues, "unknown_input") == [("n03", "error")]
    assert issues[0].path == "/graph/nodes/2/inputs/0"


def test_cycle_lists_its_nodes():
    raw = revenu_net()
    nodes(raw)["n02"]["inputs"] = ["n04"]
    issues = issues_of(raw)
    assert [i.code for i in issues] == ["cycle"]
    assert issues[0].node_id in {"n02", "n03", "n04"}
    assert all(n in issues[0].message for n in ("n02", "n03", "n04"))


def test_orphan_node_is_a_warning():
    raw = revenu_net()
    raw["graph"]["nodes"].append(dict(ENTITES))
    issues = issues_of(raw)
    assert found(issues, "orphan_node") == [("n06", "warning")]
    assert not has_errors(issues)


def test_branch_not_merged():
    raw = revenu_net()
    raw["graph"]["nodes"].append(
        {"id": "n06", "type": "compute", "inputs": ["n02"], "column": "x", "expr": "avoirs * 2"}
    )
    issues = issues_of(raw)
    assert found(issues, "branch_not_merged") == [("n02", "error")]
    assert found(issues, "orphan_node") == [("n06", "warning")]


def test_branches_merged_by_a_join_are_fine():
    raw = revenu_net()
    graph_nodes = raw["graph"]["nodes"]
    graph_nodes.append(total("n06", "n02", ["entite"], ["montant_ttc", "ttc", "sum"]))
    graph_nodes.append({
        "id": "n07", "type": "join", "inputs": {"left": "n05", "right": "n06"}, "how": "left",
        "keys": [["entite", "entite"]], "cardinality": "N:1", "check": "required",
    })
    raw["graph"]["output"] = "n07"
    assert issues_of(raw) == []


def test_metric_op_on_rows():
    raw = revenu_net()
    raw["graph"]["nodes"].append({
        "id": "n06", "type": "metric_op", "inputs": ["n03"], "order": "aggregate_first",
        "metrics": [{"name": "taux", "expr": "montant_ht / montant_ttc"}],
    })
    raw["graph"]["output"] = "n06"
    assert found(issues_of(raw), "metric_op_on_rows") == [("n06", "error")]


def test_reaggregation_of_a_referenced_kpi_is_a_warning():
    annual = kpi("revenu-annuel", 1, [
        kpi_ref("n01", "revenu-net", 4),
        total("n02", "n01", ["entite"], ["revenu_net", "revenu_annuel", "sum"]),
    ], "n02")
    issues = issues_of(annual, revenu_net())
    assert issues == [i for i in issues if i.code == "reaggregation"]
    assert found(issues, "reaggregation") == [("n02", "warning")]


def test_reaggregation_within_the_same_grain_is_fine():
    raw = revenu_net()
    raw["graph"]["nodes"].append(
        total("n06", "n05", ["entite"], ["revenu_net", "revenu_entite", "sum"])
    )
    raw["graph"]["output"] = "n06"
    assert issues_of(raw) == []


def test_kpi_output_must_be_aggregated():
    raw = revenu_net()
    raw["graph"]["output"] = "n04"
    issues = issues_of(raw)
    assert found(issues, "kpi_output_not_aggregated") == [("n04", "error")]


def _concept_with(*graph_nodes: dict) -> dict:
    raw = read_fixture("commande.yaml")
    source = {
        "id": "n01", "type": "source", "platform": "databricks", "table": "gold.ventes.commandes",
        "owner": "marc.d",
        "columns": [{"name": "commande_id", "type": "string"},
                    {"name": "date_commande", "type": "date", "timezone": "Europe/Paris",
                     "format": "yyyy-MM-dd"}],
    }
    raw["graph"] = {"nodes": [source, *graph_nodes], "output": (graph_nodes or [source])[-1]["id"]}
    return raw


def test_concept_output_must_not_be_aggregated():
    raw = _concept_with(total("n02", "n01", [], ["*", "n", "count"]))
    assert found(issues_of(raw), "concept_output_aggregated") == [("n02", "error")]


def test_period_needs_a_calendar():
    raw = _concept_with({
        "id": "n02", "type": "temporal", "inputs": ["n01"], "operation": "period",
        "column": "date_commande", "target": "mois", "grain": "month",
    })
    assert found(issues_of(raw), "missing_calendar") == [("n02", "error")]


def test_unknown_kpi_ref():
    raw = kpi("revenu-annuel", 1, [
        kpi_ref("n01", "revenu-net", 9),
        total("n02", "n01", ["entite"], ["revenu_net", "revenu_annuel", "sum"]),
    ], "n02")
    issues = issues_of(raw, revenu_net())
    assert found(issues, "unknown_kpi_ref") == [("n01", "error")]


def test_kpi_ref_cycle_between_two_kpis():
    a = kpi("kpi-a", 1, [kpi_ref("n01", "kpi-b", 1), total("n02", "n01", [], ["x", "x", "sum"])], "n02")
    b = kpi("kpi-b", 1, [kpi_ref("n01", "kpi-a", 1), total("n02", "n01", [], ["x", "x", "sum"])], "n02")
    issues = issues_of(a, b)
    assert found(issues, "kpi_ref_cycle") == [("n01", "error")]
    cycle = next(i for i in issues if i.code == "kpi_ref_cycle")
    assert "kpi-a v1 → kpi-b v1 → kpi-a v1" in cycle.message


def test_cardinality_bypass_is_reported_as_info():
    raw = with_join(revenu_net(), check="bypass", bypass_reason="Doublons connus, corrigés en amont.")
    issues = issues_of(raw)
    assert found(issues, "cardinality_bypass") == [("n07", "info")]
    assert not has_errors(issues)


def test_issue_paths_point_to_the_document():
    raw = with_join(revenu_net())
    nodes(raw)["n07"]["keys"] = [["entite", "entite_idd"]]
    issue = next(i for i in issues_of(raw) if i.code == "unknown_column")
    assert issue.path == "/graph/nodes/3/keys/0/1"
    assert copy.deepcopy(raw)["graph"]["nodes"][3]["id"] == "n07"
