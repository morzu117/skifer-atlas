"""Contrats observables du connecteur REST."""

import json
import threading
from dataclasses import replace
from datetime import UTC, date, datetime
from types import SimpleNamespace

import pytest
from test_rest_runner import save_dataset, setup_rest, space

from skifer_atlas.compare.rest_runner import RestRunner, _convert, parameters
from skifer_atlas.connectors.rest_budget import read_usage
from skifer_atlas.connectors.rest_datasets import Column, RestDataset
from skifer_atlas.repo.git import RepoError

__all__ = ["setup_rest", "space"]


def assert_error(error, code, message):
    assert (error.value.code, error.value.message, str(error.value)) == (code, message, message)


def usage():
    [row] = read_usage("exemple", point_id="api-exemple")
    return tuple(row[k] for k in ("calls", "bytes", "errors", "cache_hits"))


@pytest.mark.parametrize("status,code,message", [
    (401, "access_expired", "Clé d'API refusée : se reconnecter."),
    (402, "rest_payment_required", "Appel REST refusé par le fournisseur."),
    (403, "rest_forbidden", "Appel REST refusé par le fournisseur."),
    (429, "rate_limited", "Appel REST refusé par le fournisseur."),
    (500, "rest_server_error", "Appel REST refusé par le fournisseur."),
    (418, "rest_http_error", "Appel REST refusé par le fournisseur."),
])
def test_http_status_and_usage(setup_rest, status, code, message):
    server, _, compiled, plan = setup_rest
    server.replies = [(status, {}, {})]
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert_error(caught, code, message)
    assert usage() == (1, len(json.dumps({}).encode()), 1, 0)
    assert len(server.requests) == 1


@pytest.mark.parametrize("delay", ["-1", "61", "nonnumeric"])
def test_retry_after_invalid_does_not_retry(setup_rest, delay):
    server, _, compiled, plan = setup_rest
    server.replies = [(429, {}, {"Retry-After": delay})]
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert_error(caught, "rate_limited", "Appel REST refusé par le fournisseur.")
    assert len(server.requests) == 1
    assert usage() == (1, 2, 1, 0)


def test_missing_retry_after_does_not_retry(setup_rest):
    server, _, compiled, plan = setup_rest
    server.replies = [(429, {}, {})]
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert_error(caught, "rate_limited", "Appel REST refusé par le fournisseur.")
    assert len(server.requests) == 1
    assert usage() == (1, 2, 1, 0)


def test_retry_after_then_success_and_cache(setup_rest):
    server, _, compiled, plan = setup_rest
    server.replies = [(429, {}, {"Retry-After": "0"}), (200, server.rows, {})]
    runner = RestRunner("exemple")
    assert runner(plan, compiled, threading.Event()).rows == [(10.0,)]
    assert usage() == (2, 2 + len(json.dumps(server.rows).encode()), 1, 0)
    assert runner(plan, compiled, threading.Event()).rows == [(10.0,)]
    assert usage() == (2, 2 + len(json.dumps(server.rows).encode()), 1, 1)
    assert len(server.requests) == 2


def test_cancel_during_retry(setup_rest):
    server, _, compiled, plan = setup_rest
    server.replies = [(429, {}, {"Retry-After": "1"})]
    cancel = SimpleNamespace(is_set=lambda: False, wait=lambda delay: delay == 1)
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, cancel)
    assert_error(caught, "query_canceled", "Requête annulée.")
    assert usage() == (1, 2, 1, 0)


def test_retry_after_sixty_seconds_is_inclusive(setup_rest):
    server, _, compiled, plan = setup_rest
    server.replies = [(429, {}, {"Retry-After": "60"}), (200, server.rows, {})]
    delays = []
    cancel = SimpleNamespace(is_set=lambda: False, wait=lambda delay: delays.append(delay) or False)
    assert RestRunner("exemple")(plan, compiled, cancel).rows == [(10.0,)]
    assert delays == [60.0]
    assert usage() == (2, 2 + len(json.dumps(server.rows).encode()), 1, 0)


@pytest.mark.parametrize("body,keys,code,message", [
    ({"failure": "secret"}, ["failure"], "rest_error_body", "Corps d'erreur REST reçu."),
    ({"unexpected": []}, [], "rest_bad_response", "Liste de lignes REST attendue."),
    ([{"c": "secret"}], [], "rest_bad_response", "Colonne REST « close » illisible."),
])
def test_bad_body_counts_bytes_and_error(space, setup_rest, body, keys, code, message):
    server, ds, compiled, plan = setup_rest
    ds["error_keys"] = keys
    save_dataset(space, ds)
    server.replies = [(200, body, {})]
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert_error(caught, code, message)
    assert usage() == (1, len(json.dumps(body).encode()), 1, 0)


@pytest.mark.parametrize("next_url", [
    "/v10/data", "/outside", "/v1/%2e%2e/data", "/v1/%2e/data", "/v1/%5cdata",
    "/v1/data x", "/v1/data\x7f", 42,
])
def test_pagination_refuses_unsafe_address(space, setup_rest, next_url):
    server, ds, compiled, plan = setup_rest
    ds.update(rows_path="results", pagination={"kind": "next_url"})
    save_dataset(space, ds)
    body = {"results": server.rows, "next_url": next_url}
    server.replies = [(200, body, {})]
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert_error(caught, "rest_next_url_refused", "Adresse de pagination REST refusée.")
    assert usage() == (1, len(json.dumps(body).encode()), 1, 0)
    assert len(server.requests) == 1


def test_page_limit_counts_error(space, setup_rest):
    server, ds, compiled, plan = setup_rest
    ds.update(rows_path="results", pagination={"kind": "next_url", "max_pages": 1})
    save_dataset(space, ds)
    body = {"results": server.rows, "next_url": "/v1/data?page=2"}
    server.replies = [(200, body, {})]
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert_error(caught, "rest_too_many_pages", "Nombre maximal de pages REST atteint.")
    assert usage() == (1, len(json.dumps(body).encode()), 1, 0)


@pytest.mark.parametrize("value,expected", [(True, True), ("true", True), ("True", True),
    (1, True), (False, False), ("false", False), ("False", False), (0, False)])
def test_boolean_conversion(value, expected):
    column = Column(name="flag", **{"from": "flag", "type": "boolean"})
    assert _convert(value, column) is expected


def test_boolean_conversion_rejects_two():
    column = Column(name="flag", **{"from": "flag", "type": "boolean"})
    with pytest.raises(RepoError) as caught:
        _convert(2, column)
    assert_error(caught, "rest_bad_response", "Colonne REST « flag » illisible.")


def test_conversion_dates_and_failure():
    def col(kind, **extra):
        return Column(name="value", **{"from": "value", "type": kind, **extra})

    assert _convert(1000, col("timestamp", format="epoch_ms")) == datetime(1970, 1, 1, 0, 0, 1)
    assert _convert(1, col("timestamp", format="epoch_s")) == datetime(1970, 1, 1, 0, 0, 1)
    assert _convert("2026-01-02 12:00", col("timestamp", format="%Y-%m-%d %H:%M",
                                            timezone="Europe/Paris")) == datetime(2026, 1, 2, 11)
    assert _convert("2026-01-02", col("date")) == date(2026, 1, 2)
    assert _convert(None, col("date")) is None
    with pytest.raises(RepoError) as caught:
        _convert("private-value", col("boolean"))
    assert_error(caught, "rest_bad_response", "Colonne REST « value » illisible.")


def test_parameters_exact_errors_and_selection():
    ds = RestDataset.model_validate({"table": "a.b.c", "access_point": "api-exemple",
        "path": "/data", "columns": [{"name": "symbol", "from": "s", "type": "string"}],
        "window": {"from_param": "start", "to_param": "end"},
        "perimeter": {"param": "symbol", "column": "symbol"}})
    source = SimpleNamespace(perimeter=[])
    with pytest.raises(RepoError) as caught:
        parameters(ds, source, None)
    assert_error(caught, "rest_period_required", "Une période est requise pour ce jeu REST.")
    window = (datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 2, tzinfo=UTC))
    with pytest.raises(RepoError) as caught:
        parameters(ds, source, window)
    assert_error(caught, "rest_scope_required", "Un périmètre non vide est requis avant tout appel REST.")
    source.perimeter = ["symbol:like:X"]
    with pytest.raises(RepoError) as caught:
        parameters(ds, source, window)
    assert_error(caught, "rest_perimeter_unsupported", "Opérateur de périmètre REST non pris en charge.")
    source.perimeter = ["symbol:in:A,B,A", "symbol:in:B,A"]
    assert parameters(ds, source, window) == [
        ({"start": "2026-01-01", "end": "2026-01-02", "symbol": "A"}, "A"),
        ({"start": "2026-01-01", "end": "2026-01-02", "symbol": "B"}, "B")]


def test_invalid_dataset_registry_message(space, setup_rest):
    _, _, compiled, plan = setup_rest
    (space / "rest_datasets.yaml").write_text("[broken", encoding="utf-8")
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert_error(caught, "invalid_rest_datasets", "Jeux de données REST invalides.")
    assert read_usage("exemple") == []


def test_invalid_access_registry_message(space, setup_rest):
    from skifer_atlas.compare.rest_runner import datasets

    (space / "rest_access_points.yaml").write_text("[broken", encoding="utf-8")
    with pytest.raises(RepoError) as caught:
        datasets("exemple")
    assert_error(caught, "invalid_rest_access_points", "Registre REST invalide.")


def test_legacy_point_is_not_a_rest_dataset_point(space, setup_rest):
    from test_rest_access_points import legacy

    from skifer_atlas.compare.rest_runner import datasets

    _, ds, _, _ = setup_rest
    legacy(space)
    ds["access_point"] = "sql-exemple"
    save_dataset(space, ds)
    with pytest.raises(RepoError) as caught:
        datasets("exemple")
    assert_error(caught, "invalid_rest_datasets", "Jeux de données REST invalides.")
    assert caught.value.details == [{"path": "/datasets/0", "node_id": None,
        "code": "access_point_not_rest",
        "message": "Le point du jeu de données n'est pas déclaré dans le registre REST.",
        "severity": "error"}]


def test_conflicting_perimeters_message(setup_rest):
    _, _, compiled, plan = setup_rest
    compiled.sources[0] = replace(compiled.sources[0], perimeter_conflict=True)
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert_error(caught, "rest_perimeter_conflict", "Périmètres distincts pour une même table REST.")
    assert read_usage("exemple") == []


def test_nested_array_decimal_and_parameter_modes():
    from decimal import Decimal

    from skifer_atlas.compare.rest_runner import _at

    assert _at({"items": [{"price": "1.25"}]}, "items.0.price") == "1.25"
    assert _convert("1.25", Column(name="p", **{"from": "p", "type": "decimal"})) == Decimal("1.25")
    ds = RestDataset.model_validate({"table": "a.b.c", "access_point": "api-exemple",
        "path": "/data", "columns": [{"name": "symbol", "from": "s", "type": "string"}],
        "perimeter": {"param": "symbols", "column": "symbol", "mode": "list"}})
    source = SimpleNamespace(perimeter=["other:equals:ignored", "symbol:equals:A,B:C"])
    assert parameters(ds, source, None) == [({"symbols": "A,B:C"}, None)]
    source.perimeter = ["symbol:in:A,B"]
    assert parameters(ds, source, None) == [({"symbols": "A,B"}, None)]


def test_cancel_before_call_has_exact_message_and_no_usage(setup_rest):
    _, _, compiled, plan = setup_rest
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, cancel)
    assert_error(caught, "query_canceled", "Requête annulée.")
    assert str(caught.value) == "Requête annulée."
    assert read_usage("exemple") == []


def test_unreadable_dataset_file_has_exact_error(space, setup_rest, monkeypatch):
    from pathlib import Path

    from skifer_atlas.compare.rest_runner import datasets

    original = Path.read_text

    def unreadable(path, *args, **kwargs):
        if path.name == "rest_datasets.yaml":
            raise OSError("unreadable")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", unreadable)
    with pytest.raises(RepoError) as caught:
        datasets("exemple")
    assert_error(caught, "invalid_rest_datasets", "Fichier de jeux de données REST illisible.")
    assert str(caught.value) == "Fichier de jeux de données REST illisible."


def test_new_parquet_validation_failure_counts_usage(setup_rest, monkeypatch):
    import duckdb

    from skifer_atlas.compare import rest_runner
    from skifer_atlas.connectors.rest_cache import paths

    server, _, compiled, plan = setup_rest

    def fail_check(path):
        raise duckdb.Error("bad parquet")

    monkeypatch.setattr(rest_runner, "_check_parquet", fail_check)
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert_error(caught, "rest_bad_response", "Cache REST illisible.")
    assert str(caught.value) == "Cache REST illisible."
    assert usage() == (1, len(json.dumps(server.rows).encode()), 1, 0)
    assert list(paths("exemple", "unused")[0].parent.glob("*.parquet")) == []
    assert list(paths("exemple", "unused")[0].parent.glob("*.json")) == []


def test_final_copy_failure_has_exact_message(setup_rest, monkeypatch):
    import duckdb

    from skifer_atlas.compare import rest_runner

    server, _, compiled, plan = setup_rest
    runner = RestRunner("exemple")
    runner(plan, compiled, threading.Event())
    monkeypatch.setattr(rest_runner, "_check_parquet", lambda path: None)

    original_connect = rest_runner.duckdb.connect

    def fail_connect(*args, **kwargs):
        if args and args[0] == ":memory:":
            raise duckdb.Error("copy failed")
        return original_connect(*args, **kwargs)

    monkeypatch.setattr(rest_runner.duckdb, "connect", fail_connect)
    with pytest.raises(RepoError) as caught:
        runner(plan, compiled, threading.Event())
    assert_error(caught, "rest_bad_response", "Cache REST illisible.")
    assert str(caught.value) == "Cache REST illisible."
    monkeypatch.setattr(rest_runner.duckdb, "connect", original_connect)
    assert usage() == (1, len(json.dumps(server.rows).encode()), 0, 1)


@pytest.mark.parametrize("length,too_large", [(1_000_000, False), (1_000_001, True)])
def test_response_row_limit_boundary(setup_rest, monkeypatch, length, too_large):
    from skifer_atlas import connections
    from skifer_atlas.compare import rest_runner
    from skifer_atlas.connectors import http
    from skifer_atlas.connectors.rest_budget import RestBudget

    class SizedRows(list):
        def __len__(self):
            return length

    point = connections.access_point("exemple", "api-exemple")
    ds = RestDataset.model_validate({"table": "a.b.c", "access_point": point.id,
        "path": "/data", "columns": [{"name": "x", "from": "x", "type": "integer"}]})
    monkeypatch.setattr(rest_runner, "mask_body", lambda body, secret: body)
    monkeypatch.setattr(http, "get", lambda *args, **kwargs: SimpleNamespace(
        body=SizedRows(), status=200, size=17, headers={}))
    runner = RestRunner("exemple")
    args = (point, ds, {}, None, http.ApiKey("secret", "query", "key", ""),
            RestBudget("exemple", point), threading.Event())
    if too_large:
        with pytest.raises(RepoError) as caught:
            runner._fetch(*args)
        assert_error(caught, "rest_response_too_large", "Réponse REST trop volumineuse.")
    else:
        assert runner._fetch(*args) == ([], 1, 17)
    assert usage() == (1, 17, int(too_large), 0)


def test_report_aggregates_perimeter_calls_and_cached_metadata(space, setup_rest):
    from skifer_atlas.compile import SourceTable
    from skifer_atlas.connectors.rest_cache import paths

    server, ds, compiled, plan = setup_rest
    ds["perimeter"] = {"param": "symbol", "column": "symbol"}
    ds["columns"].append({"name": "symbol", "from": "symbol", "type": "string"})
    save_dataset(space, ds)
    compiled.sources[0] = SourceTable(ds["table"], (("close", "double"),), ("symbol:in:A,B",))
    runner = RestRunner("exemple")
    assert runner(plan, compiled, threading.Event()).rows == [(20.0,)]
    size = len(json.dumps(server.rows).encode())
    [report] = runner.report()
    assert report == {"access_point": "api-exemple", "table": ds["table"], "calls": 2,
                      "bytes": 2 * size, "cache": "none", "key_source": "vault"}
    files = list(paths("exemple", "unused")[0].parent.glob("*.json"))
    assert len(files) == 2
    for file in files:
        metadata = json.loads(file.read_text(encoding="utf-8"))
        assert metadata["calls"] == 1 and metadata["bytes"] == size
    assert usage() == (2, 2 * size, 0, 0)


def test_missing_perimeter_column_is_rebound(space, setup_rest):
    from skifer_atlas.compile import SourceTable

    server, ds, compiled, plan = setup_rest
    server.rows = [{"c": 10.0}]
    ds["perimeter"] = {"param": "symbol", "column": "symbol"}
    ds["columns"].append({"name": "symbol", "from": "symbol", "type": "string"})
    save_dataset(space, ds)
    compiled.sources[0] = SourceTable(ds["table"], (("symbol", "string"),), ("symbol:equals:EX",))
    compiled.sql = "SELECT symbol FROM " + ds["table"]
    assert RestRunner("exemple")(plan, compiled, threading.Event()).rows == [("EX",)]
    assert len(server.requests) == 1


@pytest.mark.parametrize("next_url,accepted", [("/v1X", True), ("/v1/data", False)])
def test_pagination_base_with_trailing_slash(space, setup_rest, next_url, accepted):
    from test_rest_access_points import point, write_points

    server, ds, compiled, plan = setup_rest
    write_points(space, [point(host=server.host, entity="exemple", http_path="/v1X/")])
    ds.update(rows_path="results", pagination={"kind": "next_url"})
    save_dataset(space, ds)
    body = {"results": server.rows, "next_url": next_url}
    server.replies = [(200, body, {}), (200, {"results": server.rows}, {})]
    if accepted:
        assert RestRunner("exemple")(plan, compiled, threading.Event()).rows == [(20.0,)]
        assert len(server.requests) == 2
    else:
        with pytest.raises(RepoError) as caught:
            RestRunner("exemple")(plan, compiled, threading.Event())
        assert_error(caught, "rest_next_url_refused", "Adresse de pagination REST refusée.")
        assert len(server.requests) == 1
        assert usage() == (1, len(json.dumps(body).encode()), 1, 0)


def test_malformed_pagination_url_has_exact_message(space, setup_rest):
    server, ds, compiled, plan = setup_rest
    ds.update(rows_path="results", pagination={"kind": "next_url"})
    save_dataset(space, ds)
    server.replies = [(200, {"results": server.rows, "next_url": "//[abc]/x"}, {})]
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert_error(caught, "rest_next_url_refused", "Adresse de pagination REST refusée.")
