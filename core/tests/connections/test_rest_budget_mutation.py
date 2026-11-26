"""Limites et comptabilité persistante du budget REST."""

from datetime import UTC, datetime, timedelta

import pytest
from test_rest_access_points import point

from skifer_atlas.connectors.rest_access_points import RestAccessPoint
from skifer_atlas.connectors.rest_budget import RestBudget, read_usage
from skifer_atlas.repo.git import RepoError


def test_sliding_minute_boundary(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    now = datetime(2026, 1, 1, tzinfo=UTC)
    budget = RestBudget("exemple", RestAccessPoint(**point(calls_per_minute=1)), now=lambda: now)
    budget.before_call()
    now += timedelta(seconds=59)
    with pytest.raises(RepoError) as caught:
        budget.before_call()
    assert (caught.value.code, caught.value.message) == (
        "budget_exceeded", "Budget d'appels REST à la minute atteint.")
    now += timedelta(seconds=1)
    budget.before_call()
    assert read_usage("exemple") == []


def test_daily_bytes_and_usage_aggregation(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    now = datetime(2026, 1, 1, tzinfo=UTC)
    budget = RestBudget("exemple", RestAccessPoint(**point(bytes_per_day=10)), now=lambda: now)
    budget.record("a.b", calls=1, bytes=9, errors=1, cache_hits=1)
    budget.before_call()
    budget.record("a.b", calls=2, bytes=1, errors=2, cache_hits=3)
    [row] = read_usage("exemple", point_id="api-exemple", day=now.date())
    assert tuple(row[k] for k in ("dataset", "calls", "bytes", "errors", "cache_hits")) == (
        "a.b", 3, 10, 3, 4)
    with pytest.raises(RepoError) as caught:
        budget.before_call()
    assert (caught.value.code, caught.value.message) == (
        "budget_exceeded", "Budget d'octets REST du jour atteint.")
    now += timedelta(days=1)
    budget.before_call()


def test_usage_is_scoped_by_point_and_day(tmp_path, monkeypatch):
    from skifer_atlas.connectors.rest_budget import utc_now

    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    now = datetime(2026, 2, 3, 12, tzinfo=UTC)
    first = RestBudget("exemple", RestAccessPoint(**point(bytes_per_day=10)), now=lambda: now)
    second = RestBudget("exemple", RestAccessPoint(**point(id="autre-api", bytes_per_day=10)),
                        now=lambda: now)
    second.record("autre.table", calls=2, bytes=10, errors=3, cache_hits=4)
    first.before_call()
    first.record("a.b", calls=1, bytes=7, errors=1, cache_hits=2)
    assert read_usage("exemple", point_id="api-exemple", day=now.date()) == [{
        "day": now.date(), "access_point": "api-exemple", "dataset": "a.b", "calls": 1,
        "bytes": 7, "errors": 1, "cache_hits": 2}]
    assert utc_now().tzinfo == UTC


def test_minute_budget_is_isolated_between_workspaces(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    now = datetime(2026, 2, 3, tzinfo=UTC)
    api = RestAccessPoint(**point(calls_per_minute=1))
    first = RestBudget("premier", api, now=lambda: now)
    second = RestBudget("second", api, now=lambda: now)
    first.before_call()
    second.before_call()
    with pytest.raises(RepoError) as caught:
        first.before_call()
    assert (caught.value.code, caught.value.message) == (
        "budget_exceeded", "Budget d'appels REST à la minute atteint.")
