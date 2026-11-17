"""Registre et refus avant appel REST (plan 0036)."""

import sys
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from skifer_atlas.connectors.rest_access_points import RestAccessPoint
from skifer_atlas.connectors.rest_budget import RestBudget, read_usage
from skifer_atlas.repo.git import RepoError

sys.path.insert(0, str(Path(__file__).parents[1] / "repo"))
from test_rest_compare_cli import ARGS, rest_workspace, space
from test_rest_runner import save_dataset, setup_rest

__all__ = ["rest_workspace", "setup_rest", "space"]


def point(**changes):
    return RestAccessPoint(id="api-exemple", platform="rest", host="api.exemple.test",
                           key_in="query", key_name="apikey", owner="exemple.owner", **changes)


def test_usage_ledger_counts(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    now = datetime(2026, 1, 2, tzinfo=UTC)
    budget = RestBudget("exemple", point(), now=lambda: now)
    budget.record("a.b", calls=1, bytes=100)
    budget.record("a.b", calls=1, errors=1)
    budget.record("a.b", cache_hits=1)
    budget.record("a.c", calls=1, bytes=50)
    rows = read_usage("exemple", point_id="api-exemple", day=now.date())
    assert [(r["dataset"], r["calls"], r["bytes"], r["errors"], r["cache_hits"])
            for r in rows] == [("a.b", 2, 100, 1, 1), ("a.c", 1, 50, 0, 0)]
    now += timedelta(days=1)
    budget.record("a.b", calls=1, bytes=5)
    assert len(read_usage("exemple")) == 3


def test_calls_per_minute_refused_before_call(space, setup_rest):
    from skifer_atlas.compare.rest_runner import RestRunner

    server, ds, compiled, plan = setup_rest
    path = space / "rest_access_points.yaml"
    import yaml

    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    raw["access_points"][0]["calls_per_minute"] = 1
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    ds.update(rows_path="results", pagination={"kind": "next_url"})
    server.mode = "pages"
    save_dataset(space, ds)
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert caught.value.code == "budget_exceeded" and len(server.requests) == 1


def test_bytes_per_day_refused_when_reached(space, setup_rest):
    import yaml

    from skifer_atlas.compare.rest_runner import RestRunner

    server, _ds, compiled, plan = setup_rest
    path = space / "rest_access_points.yaml"
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    raw["access_points"][0]["bytes_per_day"] = 1
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    RestRunner("exemple")(plan, compiled, threading.Event())
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple", refresh=True)(plan, compiled, threading.Event())
    assert caught.value.code == "budget_exceeded" and len(server.requests) == 1


@pytest.mark.parametrize("code", ["rate_limited", "budget_exceeded"])
def test_budget_codes_stored_with_text(space, rest_workspace, capsys, code):
    import json

    import yaml

    from skifer_atlas.cli import main

    if code == "rate_limited":
        rest_workspace.replies = [(429, {}, {})]
    else:
        path = space / "rest_access_points.yaml"
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        raw["access_points"][0]["bytes_per_day"] = 1
        path.write_text(yaml.safe_dump(raw), encoding="utf-8")
        assert main(ARGS) == 0
        capsys.readouterr()
    assert main(ARGS + ["--refresh", "--format", "json"]) == 1
    found = json.loads(capsys.readouterr().out)
    assert code in str(found["runs"])
    assert "Échec de la comparaison." not in str(found["runs"])


def test_usage_survives_index_rebuild(space, rest_workspace, capsys):
    from skifer_atlas.cli import main
    from skifer_atlas.index import ensure_index
    from skifer_atlas.workspaces import index_path

    assert main(ARGS) == 0
    capsys.readouterr()
    before = read_usage("exemple")
    ensure_index(space, index_path("exemple")).close()
    assert read_usage("exemple") == before


@pytest.mark.parametrize("mode", ["bad_rows", "bad_column", "overflow", "http_error"])
def test_failed_rest_pages_count_errors(space, setup_rest, mode):
    from skifer_atlas.compare.rest_runner import RestRunner
    from skifer_atlas.compile import SourceTable

    server, ds, compiled, plan = setup_rest
    if mode == "bad_rows":
        server.replies = [(200, {"unexpected": True}, {})]
    elif mode == "bad_column":
        server.rows = [{"c": "not-a-number"}]
    elif mode == "overflow":
        ds["columns"][0]["type"] = "integer"
        compiled.sources = [SourceTable(ds["table"], (("close", "integer"),))]
        save_dataset(space, ds)
        server.rows = [{"c": 10**100}]
    else:
        server.replies = [(500, {}, {})]
    with pytest.raises(RepoError):
        RestRunner("exemple")(plan, compiled, threading.Event())
    [row] = read_usage("exemple")
    assert row["calls"] == 1 and row["errors"] == 1 and row["bytes"] > 0
