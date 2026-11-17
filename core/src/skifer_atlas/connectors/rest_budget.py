"""Budgets REST par espace/point et registre DuckDB durable (plan 0036)."""

from collections import defaultdict, deque
from datetime import UTC, datetime
from threading import RLock

from ..dbfile import open_db
from ..repo.git import RepoError
from ..workspaces import index_path

_lock = RLock()
_calls = defaultdict(deque)
_DDL = """
CREATE SCHEMA IF NOT EXISTS rest;
CREATE TABLE IF NOT EXISTS rest.usage (
    day DATE, access_point VARCHAR, dataset VARCHAR,
    calls BIGINT, bytes BIGINT, errors BIGINT, cache_hits BIGINT,
    PRIMARY KEY(day, access_point, dataset)
);
"""


def utc_now():
    return datetime.now(UTC)


def _connect(workspace_id):
    db = index_path(workspace_id)
    db.parent.mkdir(parents=True, exist_ok=True)
    connection = open_db(db)
    connection.execute(_DDL)
    return connection


def read_usage(workspace_id, *, point_id=None, day=None):
    with _lock, _connect(workspace_id) as connection:
        cursor = connection.execute("SELECT * FROM rest.usage WHERE "
            "(? IS NULL OR access_point = ?) AND (? IS NULL OR day = ?) "
            "ORDER BY day, access_point, dataset", [point_id, point_id, day, day])
        return [dict(zip((d[0] for d in cursor.description), row)) for row in cursor.fetchall()]


class RestBudget:
    def __init__(self, workspace_id, point, now=utc_now):
        self.workspace_id, self.point, self.now = workspace_id, point, now

    def before_call(self):
        now = self.now()
        with _lock:
            calls = _calls[(str(index_path(self.workspace_id)), self.point.id)]
            while calls and calls[0] <= now.timestamp() - 60:
                calls.popleft()
            if self.point.calls_per_minute is not None and len(calls) >= self.point.calls_per_minute:
                raise RepoError("budget_exceeded", "Budget d'appels REST à la minute atteint.")
            if self.point.bytes_per_day is not None:
                used = sum(r["bytes"] for r in read_usage(
                    self.workspace_id, point_id=self.point.id, day=now.date()))
                if used >= self.point.bytes_per_day:
                    raise RepoError("budget_exceeded", "Budget d'octets REST du jour atteint.")
            calls.append(now.timestamp())

    def record(self, dataset, *, calls=0, bytes=0, errors=0, cache_hits=0):
        with _lock, _connect(self.workspace_id) as connection:
            connection.execute("INSERT INTO rest.usage VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(day, access_point, dataset) DO UPDATE SET "
                "calls=usage.calls+excluded.calls, bytes=usage.bytes+excluded.bytes, "
                "errors=usage.errors+excluded.errors, cache_hits=usage.cache_hits+excluded.cache_hits",
                [self.now().date(), self.point.id, dataset, calls, bytes, errors, cache_hits])
