"""Exécution REST réelle en boucle locale, cache Parquet et DuckDB (plan 0036)."""

import sys
import threading
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parents[1] / "connections"))
from fake_rest import FakeRest
from test_rest_access_points import example_url, point, space, write_points

from skifer_atlas import connections
from skifer_atlas.compare.rest_runner import RestRunner
from skifer_atlas.compile import Compiled, SourceTable
from skifer_atlas.repo.git import RepoError

__all__ = ["space"]


@pytest.fixture
def setup_rest(space):
    with FakeRest() as server:
        write_points(space, [point(host=server.host, entity="exemple", http_path="/v1")])
        ds = {"table": "marche.prix.cours_jour", "access_point": "api-exemple", "path": "/data",
              "columns": [{"name": "close", "from": "c", "type": "double"}]}
        (space / "rest_datasets.yaml").write_text(yaml.safe_dump({"datasets": [ds]}),
                                                  encoding="utf-8")
        connections.store_api_key("exemple", "api-exemple", server.key)
        compiled = Compiled("duckdb", "SELECT sum(close) AS value FROM marche.prix.cours_jour",
                            sources=[SourceTable(ds["table"], (("close", "double"),))])
        plan = SimpleNamespace(entity="exemple", access_point="api-exemple")
        yield server, ds, compiled, plan


def save_dataset(space, ds):
    (space / "rest_datasets.yaml").write_text(yaml.safe_dump({"datasets": [ds]}), encoding="utf-8")


def test_pattern_query_list(setup_rest):
    server, _ds, compiled, plan = setup_rest
    result = RestRunner("exemple")(plan, compiled, threading.Event())
    assert result.rows == [(10.0,)]
    assert len(server.requests) == 1


def test_pattern_next_url_results(space, setup_rest):
    server, ds, compiled, plan = setup_rest
    server.mode = "pages"
    ds.update(rows_path="results", pagination={"kind": "next_url"})
    save_dataset(space, ds)
    assert RestRunner("exemple")(plan, compiled, threading.Event()).rows == [(20.0,)]
    assert len(server.requests) == 2


@pytest.mark.parametrize("foreign_part", ["scheme", "host"])
def test_runner_refuses_next_origin_before_charging_another_call(space, setup_rest, foreign_part):
    from urllib.parse import urlsplit, urlunsplit

    from skifer_atlas.connectors.rest_budget import read_usage

    server, ds, compiled, plan = setup_rest
    origin = urlsplit(server.url)
    candidate = origin._replace(path="/v1/data", scheme="https") if foreign_part == "scheme" else (
        origin._replace(path="/v1/data", netloc="other.exemple.test"))
    server.replies = [(200, {"results": server.rows, "next_url": urlunsplit(candidate)}, {})]
    ds.update(rows_path="results", pagination={"kind": "next_url"})
    save_dataset(space, ds)
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert caught.value.code == "rest_next_url_refused"
    assert len(server.requests) == 1
    [usage] = read_usage("exemple", point_id="api-exemple")
    assert usage["calls"] == 1
    assert usage["errors"] == 1


def test_pattern_header_token(space, setup_rest):
    server, _ds, compiled, plan = setup_rest
    write_points(space, [point(host=server.host, entity="exemple", http_path="/v1",
                              key_in="header", key_name="Authorization", key_prefix="Bearer ")])
    assert RestRunner("exemple")(plan, compiled, threading.Event()).rows == [(10.0,)]
    assert "apikey" not in server.requests[0][1]
    assert server.requests[0][2]["Authorization"] == "Bearer " + server.key


def test_immutable_window_served_from_cache(space, setup_rest):
    server, ds, compiled, plan = setup_rest
    compiled.window = (date(2025, 1, 1), date(2025, 1, 31))
    ds["window"] = {"from_param": "from", "to_param": "to"}
    save_dataset(space, ds)
    runner = RestRunner("exemple")
    runner(plan, compiled, threading.Event())
    later = RestRunner("exemple", now=lambda: datetime(2027, 1, 1, tzinfo=UTC))
    assert later(plan, compiled, threading.Event()).rows == [(10.0,)]
    assert len(server.requests) == 1 and later.report()[0]["cache"] == "immutable"


@pytest.mark.parametrize("hour,minute", [(12, 0), (23, 58)])
def test_window_becomes_immutable_after_utc_midnight(space, setup_rest, hour, minute):
    server, ds, compiled, plan = setup_rest
    ds["window"] = {"from_param": "from", "to_param": "to"}
    save_dataset(space, ds)
    compiled.window = (date(2026, 1, 1), date(2026, 1, 2))
    now = datetime(2026, 1, 2, hour, minute, tzinfo=UTC)
    assert RestRunner("exemple", now=lambda: now)(plan, compiled, threading.Event()).rows == [(10.0,)]
    server.rows[0]["c"] = 99.0
    now = datetime(2026, 1, 3, 0, 1, tzinfo=UTC)
    runner = RestRunner("exemple", now=lambda: now)
    assert runner(plan, compiled, threading.Event()).rows == [(99.0,)]
    assert len(server.requests) == 2
    server.rows[0]["c"] = 7.0
    now = datetime(2026, 2, 3, tzinfo=UTC)
    later = RestRunner("exemple", now=lambda: now)
    assert later(plan, compiled, threading.Event()).rows == [(99.0,)]
    assert len(server.requests) == 2 and later.report()[0]["cache"] == "immutable"


def test_dataset_without_window_remains_provisional(setup_rest):
    server, _ds, compiled, plan = setup_rest
    compiled.window = (date(2025, 1, 1), date(2025, 1, 31))
    now = datetime(2026, 1, 2, tzinfo=UTC)
    RestRunner("exemple", now=lambda: now)(plan, compiled, threading.Event())
    now += timedelta(minutes=15)
    RestRunner("exemple", now=lambda: now)(plan, compiled, threading.Event())
    assert len(server.requests) == 2


def test_compile_transmits_window_and_perimeter(space, real_rest_workspace):
    from skifer_atlas.compare import service
    from skifer_atlas.compare.orchestrate import CompareRequest

    path = space / "kpis/cours-total.yaml"
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    raw["graph"]["nodes"][0].update(concept="titre",
                                   binding={"symbol": "symbol"})
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    concepts = space / "concepts"
    concepts.mkdir()
    (concepts / "titre.yaml").write_text(yaml.safe_dump({"schema_version": 1, "kind": "concept",
        "data_product": {"id": "titre", "version": 1, "owner": "exemple.owner", "domain": "finance"},
        "label": "Titre", "entity": {"key": ["symbol"], "attributes": [
            {"name": "symbol", "type": "string"}]}}), encoding="utf-8")
    request = CompareRequest(kpi_id="cours-total", variants=["exemple"], scope={
        "period": {"from": "2026-01-01", "to": "2026-01-31"}, "perimeter": ["symbol:in:EX"]})
    from skifer_atlas.index.build import analyze

    assert not [i for i in analyze(space).entry("cours-total").issues if i.severity == "error"]
    prepared = service.prepare_in(space, request, "exemple", False)
    for side in (prepared.plans[0].canonical, prepared.plans[0].variant):
        assert side.compiled.window == (date(2026, 1, 1), date(2026, 1, 31))
        assert side.compiled.sources[0].perimeter == ("symbol:in:EX",)


@pytest.mark.parametrize("mode", ["bad_rows", "bad_column", "integer_overflow", "foreign", "path_escape", "encoded", "pages"])
def test_rest_response_refusals(space, setup_rest, mode):
    server, ds, compiled, plan = setup_rest
    expected = "rest_bad_response"
    if mode == "bad_rows":
        server.replies = [(200, {"not_rows": True}, {})]
    elif mode == "bad_column":
        server.rows = [{"c": "not-a-number"}]
    elif mode == "integer_overflow":
        ds["columns"][0]["type"] = "integer"
        compiled.sources = [SourceTable(ds["table"], (("close", "integer"),))]
        save_dataset(space, ds)
        server.rows = [{"c": 10**100}]
    else:
        ds.update(rows_path="results", pagination={"kind": "next_url", "max_pages": 1 if mode == "pages" else 2})
        if mode == "pages":
            server.mode = "pages"
            expected = "rest_too_many_pages"
        else:
            expected = "rest_next_url_refused"
            from urllib.parse import urlunsplit

            next_url = (server.url + "/outside" if mode == "path_escape" else
                        urlunsplit(("https", "other.exemple.test", "/v1/data", "", "")))
            if mode == "encoded":
                next_url = server.url + "/v1/%2e%2e/outside"
            server.replies = [(200, {"results": server.rows, "next_url": next_url}, {})]
        save_dataset(space, ds)
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert caught.value.code == expected and len(server.requests) == 1
    assert str(10**100) not in str(caught.value)


def test_cancelled_rest_never_calls_server(setup_rest):
    server, _ds, compiled, plan = setup_rest
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, cancel)
    assert caught.value.code == "query_canceled" and not server.requests


def test_provisional_window_expires(setup_rest):
    server, _ds, compiled, plan = setup_rest
    now = datetime(2026, 1, 2, tzinfo=UTC)
    runner = RestRunner("exemple", now=lambda: now)
    runner(plan, compiled, threading.Event())
    now += timedelta(minutes=14)
    runner(plan, compiled, threading.Event())
    assert len(server.requests) == 1
    now += timedelta(minutes=1)
    runner(plan, compiled, threading.Event())
    assert len(server.requests) == 2


def test_refresh_one_call_per_key(setup_rest):
    server, _ds, compiled, plan = setup_rest
    RestRunner("exemple")(plan, compiled, threading.Event())
    runner = RestRunner("exemple", refresh=True)
    runner(plan, compiled, threading.Event())
    runner(plan, compiled, threading.Event())
    assert len(server.requests) == 2 and runner.report()[0]["calls"] == 1
    assert runner.report()[0]["cache"] == "refreshed"


def test_cache_key_ignores_api_key_follows_mapping(space, setup_rest):
    import secrets

    server, ds, compiled, plan = setup_rest
    RestRunner("exemple")(plan, compiled, threading.Event())
    server.key = secrets.token_urlsafe(24)
    connections.store_api_key("exemple", "api-exemple", server.key)
    RestRunner("exemple")(plan, compiled, threading.Event())
    assert len(server.requests) == 1
    ds["path"] = "/other"
    save_dataset(space, ds)
    RestRunner("exemple")(plan, compiled, threading.Event())
    assert len(server.requests) == 2


def test_empty_perimeter_refused_before_call(space, setup_rest):
    server, ds, compiled, plan = setup_rest
    ds.update(perimeter={"param": "symbol", "column": "symbol"})
    ds["columns"].append({"name": "symbol", "from": "symbol", "type": "string"})
    save_dataset(space, ds)
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert caught.value.code == "rest_scope_required" and not server.requests


def test_perimeter_each_and_unsupported(space, setup_rest):
    server, ds, compiled, plan = setup_rest
    ds.update(perimeter={"param": "symbol", "column": "symbol"})
    ds["columns"].append({"name": "symbol", "from": "symbol", "type": "string"})
    save_dataset(space, ds)
    compiled.sources[0] = SourceTable(ds["table"], (("close", "double"),), ("symbol:in:EX,OTHER",))
    assert RestRunner("exemple")(plan, compiled, threading.Event()).rows == [(20.0,)]
    assert [r[1]["symbol"] for r in server.requests] == [["EX"], ["OTHER"]]
    compiled.sources[0] = SourceTable(ds["table"], (("close", "double"),), ("symbol:not_equals:EX",))
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert caught.value.code == "rest_perimeter_unsupported" and len(server.requests) == 2


def test_both_sides_share_one_load(setup_rest):
    server, _ds, compiled, plan = setup_rest
    runner = RestRunner("exemple")
    assert runner(plan, compiled, threading.Event()).rows == [(10.0,)]
    assert runner(plan, compiled, threading.Event()).rows == [(10.0,)]
    assert len(server.requests) == 1


def test_loads_three_part_names(setup_rest):
    _server, ds, compiled, plan = setup_rest
    assert ds["table"].count(".") == 2
    assert RestRunner("exemple")(plan, compiled, threading.Event()).rows == [(10.0,)]


def test_column_conversion(space, setup_rest):
    server, ds, compiled, plan = setup_rest
    ds["columns"] = [{"name": "day", "from": "day", "type": "date", "format": "%Y-%m-%d"},
        {"name": "stamp", "from": "stamp", "type": "timestamp", "format": "epoch_ms"},
        {"name": "local", "from": "local", "type": "timestamp", "timezone": "Europe/Paris"}]
    server.rows = [{"day": "2026-01-02", "stamp": 0, "local": "2026-01-02T12:00:00"}]
    save_dataset(space, ds)
    compiled.sources = [SourceTable(ds["table"], tuple((c["name"], c["type"]) for c in ds["columns"]))]
    compiled.sql = "SELECT * FROM " + ds["table"]
    assert RestRunner("exemple")(plan, compiled, threading.Event()).rows == [(
        date(2026, 1, 2), datetime(1970, 1, 1), datetime(2026, 1, 2, 11))]


def _request(**changes):
    from skifer_atlas.compare.orchestrate import CompareRequest

    return CompareRequest(kpi_id="cours-total", variants=["exemple"], scope_id="total", **changes)


@pytest.fixture
def real_rest_workspace(space):
    sys.path.insert(0, str(Path(__file__).parents[1] / "repo"))
    from test_rest_compare_cli import rest_workspace

    # Fixture commune utilisée sans remplacer le runner ni le service de comparaison.
    yield from rest_workspace.__wrapped__(space)


def test_choose_rest_serves_duckdb_sources(space, real_rest_workspace):
    from skifer_atlas.compare import service

    assert service.prepare_in(space, _request(), "exemple", False).plans[0].access_point == "api-exemple"
    assert service.prepare_in(space, _request(access_points={"exemple": "api-exemple"}),
                              "exemple", False).plans[0].access_point == "api-exemple"
    raw = yaml.safe_load((space / "rest_access_points.yaml").read_text(encoding="utf-8"))
    raw["access_points"].append({**raw["access_points"][0], "id": "second-point"})
    write_points(space, raw["access_points"])
    with pytest.raises(RepoError) as caught:
        service.prepare_in(space, _request(), "exemple", False)
    assert caught.value.code == "ambiguous_access_point"
    write_points(space, [])
    with pytest.raises(RepoError) as caught:
        service.prepare_in(space, _request(), "exemple", False)
    assert caught.value.code == "no_access_point"


@pytest.mark.parametrize("platform", ["databricks", "snowflake", "duckdb"])
def test_rest_never_serves_other_platforms(space, real_rest_workspace, platform):
    from skifer_atlas.compare import service

    path = space / "kpis/cours-total.yaml"
    if platform != "duckdb":
        path.write_text(path.read_text(encoding="utf-8").replace("platform: duckdb", "platform: " + platform),
                        encoding="utf-8")
    else:
        governance = space / "governance.yaml"
        raw = yaml.safe_load(governance.read_text(encoding="utf-8"))
        raw["allowed_platforms"].append("duckdb")
        governance.write_text(yaml.safe_dump(raw), encoding="utf-8")
        (space / "access_points.yaml").write_text(yaml.safe_dump({"access_points": [{
            "id": "sql-exemple", "platform": "duckdb", "host": example_url(),
            "owner": "exemple.owner", "entity": "exemple"}]}), encoding="utf-8")
    wanted = "sql-exemple" if platform == "duckdb" else "api-exemple"
    with pytest.raises(RepoError) as caught:
        service.prepare_in(space, _request(access_points={"exemple": wanted}), "exemple", False)
    assert caught.value.code == "access_point_mismatch"


def test_dialect_duckdb_after_rest_choice(space, real_rest_workspace):
    from skifer_atlas.compare import service

    plan = service.prepare_in(space, _request(), "exemple", False).plans[0]
    assert plan.canonical.compiled.dialect == "duckdb" and plan.variant.compiled.dialect == "duckdb"


def test_remote_runner_routes_by_point(space, setup_rest):
    from fake_databricks import FakeDatabricks

    from skifer_atlas.compare.service import remote_runner
    from skifer_atlas.vault import Credential, Vault

    _server, _ds, compiled, plan = setup_rest
    runner = remote_runner("exemple")
    assert runner(plan, compiled, threading.Event()).rows == [(10.0,)]
    fake = FakeDatabricks()
    try:
        (space / "access_points.yaml").write_text(yaml.safe_dump({"access_points": [{
            "id": "sql-exemple", "platform": "databricks", "host": fake.url,
            "warehouse_id": "abc", "owner": "exemple.owner"}]}), encoding="utf-8")
        token = fake.state.issue()["access_token"]
        Vault().put("exemple", "sql-exemple", Credential("pat", token, host=fake.url))
        compiled.sql = "SELECT 1"
        plan.access_point = "sql-exemple"
        assert runner(plan, compiled, threading.Event()).rows[0][0] == date(2025, 1, 1)
        assert fake.state.seen_sql == ["SELECT 1"]
    finally:
        fake.close()


def test_invalid_rest_file_only_blocks_rest_preparation(space, real_rest_workspace):
    from skifer_atlas.compare import service

    (space / "rest_access_points.yaml").write_text("[broken", encoding="utf-8")
    with pytest.raises(RepoError) as caught:
        service.prepare_in(space, _request(), "exemple", False)
    assert caught.value.code == "invalid_rest_access_points"
    assert service.prepare_in(space, _request(), "exemple", True).plans
