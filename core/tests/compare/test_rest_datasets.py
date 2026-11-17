"""Jeux de données REST fermés et rattachés au seul registre REST (plan 0036)."""

import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parents[1] / "repo"))
from test_rest_compare_cli import rest_workspace, space

from skifer_atlas.compare import service, store
from skifer_atlas.compare.orchestrate import CompareRequest
from skifer_atlas.repo.git import RepoError
from skifer_atlas.workspaces import index_path

__all__ = ["rest_workspace", "space"]

from skifer_atlas.connectors.rest_access_points import RestAccessPoint
from skifer_atlas.connectors.rest_datasets import parse_rest_datasets


def dataset(**changes):
    return {"table": "marche.prix.cours_jour", "access_point": "api-exemple", "path": "/data",
            "columns": [{"name": "close", "from": "c", "type": "double"}], **changes}


def rest_point():
    return RestAccessPoint(id="api-exemple", platform="rest", host="api.exemple.test",
                           key_in="query", key_name="apikey", owner="exemple.owner")


@pytest.mark.parametrize("changes,code", [
    ({"unknown": 1}, "unknown_key"), ({"table": "bad"}, "invalid_value"),
    ({"params": {"apikey": "forbidden"}}, "key_param_in_dataset"),
    ({"params": {"from": "x"}, "window": {"from_param": "from", "to_param": "to"}},
     "param_clash"),
    ({"perimeter": {"param": "symbol", "column": "missing"}}, "perimeter_column_unknown"),
    ({"pagination": {"kind": "offset"}}, "invalid_value"),
    ({"path": "//other"}, "invalid_value"),
])
def test_rest_datasets_validation(changes, code):
    found, issues = parse_rest_datasets(yaml.safe_dump({"schema_version": 1,
        "datasets": [dataset(**changes)]}), [rest_point()])
    assert found is None and code in {i.code for i in issues}


def test_dataset_requires_point_in_rest_file():
    text = yaml.safe_dump({"datasets": [dataset()]})
    found, issues = parse_rest_datasets(text, [])
    assert found is None and issues[0].code == "unknown_access_point"
    found, issues = parse_rest_datasets(text, [], legacy_ids={"api-exemple"})
    assert found is None and issues[0].code == "access_point_not_rest"
    found, issues = parse_rest_datasets(text, [rest_point()])
    assert found.get("marche.prix.cours_jour", "api-exemple").path == "/data" and not issues


@pytest.mark.parametrize("change", ["missing", "other_point", "columns", "window"])
def test_missing_dataset_stops_before_any_run(space, rest_workspace, change):
    path = space / "rest_datasets.yaml"
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if change == "missing":
        raw["datasets"] = []
    elif change == "other_point":
        points = space / "rest_access_points.yaml"
        p = yaml.safe_load(points.read_text(encoding="utf-8"))
        p["access_points"].append({**p["access_points"][0], "id": "other-point"})
        points.write_text(yaml.safe_dump(p), encoding="utf-8")
        raw["datasets"][0]["access_point"] = "other-point"
    elif change == "columns":
        raw["datasets"][0]["columns"] = [{"name": "wrong", "from": "c", "type": "string"}]
    else:
        raw["datasets"][0]["window"] = {"from_param": "from", "to_param": "to"}
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    with pytest.raises(RepoError) as caught:
        service.start_comparison("exemple", CompareRequest(kpi_id="cours-total",
            variants=["exemple"], scope_id="total", access_points={"exemple": "api-exemple"}), wait=True)
    assert caught.value.code == {"columns": "rest_dataset_mismatch", "window": "rest_period_required"
                                }.get(change, "rest_dataset_missing")
    if change in ("missing", "other_point"):
        assert caught.value.message == ("Jeu de données déclaré sur un autre point REST."
            if change == "other_point" else "Table sans jeu de données sur ce point REST.")
    assert not store.history(index_path("exemple")) and not rest_workspace.requests


@pytest.mark.parametrize("order", [["n01", "n04"], ["n04", "n01"]])
def test_same_table_different_perimeters_refused_before_run(space, rest_workspace, order):
    from copy import deepcopy

    path = space / "kpis/cours-total.yaml"
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    nodes = raw["graph"]["nodes"]
    nodes[0].update(concept="titre", binding={"symbol": "symbol"})
    unbound = deepcopy(nodes[0])
    unbound["id"] = "n04"
    del unbound["concept"], unbound["binding"]
    union = {"id": "n05", "type": "union", "inputs": order, "mode": "all",
             "columns": [{"name": name, "from": {"n01": name, "n04": name}}
                         for name in ("trade_date", "symbol", "close")]}
    nodes[1]["inputs"] = ["n05"]
    raw["graph"]["nodes"] = [nodes[0], unbound, union, *nodes[1:]]
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    (space / "concepts").mkdir()
    (space / "concepts/titre.yaml").write_text(yaml.safe_dump({
        "schema_version": 1, "kind": "concept", "data_product": {"id": "titre",
        "version": 1, "owner": "exemple.owner", "domain": "finance"}, "label": "Titre",
        "entity": {"key": ["symbol"], "attributes": [{"name": "symbol", "type": "string"}]}
    }), encoding="utf-8")
    request = CompareRequest(kpi_id="cours-total", variants=["exemple"], scope={
        "period": {"from": "2026-01-01", "to": "2026-01-31"},
        "perimeter": ["symbol:in:EX"]})
    from skifer_atlas.index.build import analyze

    assert not [i for i in analyze(space).entry("cours-total").issues if i.severity == "error"]
    with pytest.raises(RepoError) as caught:
        service.start_comparison("exemple", request, wait=True)
    assert caught.value.code == "rest_perimeter_conflict", caught.value.details
    from skifer_atlas.api.app import ERROR_STATUS

    assert ERROR_STATUS[caught.value.code] == 422
    assert not store.history(index_path("exemple")) and not rest_workspace.requests
    assert service.prepare_in(space, request, "exemple", True).plans


def test_malformed_file_only_matters_for_rest_plans(space, rest_workspace):
    request = CompareRequest(kpi_id="cours-total", variants=["exemple"], scope_id="total")
    (space / "rest_datasets.yaml").write_text("[broken", encoding="utf-8")
    with pytest.raises(RepoError) as caught:
        service.prepare_in(space, request, "exemple", False)
    assert caught.value.code == "invalid_rest_datasets"
    assert service.prepare_in(space, request, "exemple", True).plans
    # Même fichier invalide ignoré pour une préparation historique distante.
    kpi = space / "kpis/cours-total.yaml"
    kpi.write_text(kpi.read_text(encoding="utf-8").replace("platform: duckdb", "platform: databricks"),
                   encoding="utf-8")
    from test_rest_access_points import legacy

    legacy(space)
    p = space / "access_points.yaml"
    raw = yaml.safe_load(p.read_text(encoding="utf-8"))
    raw["access_points"][0]["entity"] = "exemple"
    p.write_text(yaml.safe_dump(raw), encoding="utf-8")
    assert service.prepare_in(space, request, "exemple", False).plans[0].access_point == "sql-exemple"
