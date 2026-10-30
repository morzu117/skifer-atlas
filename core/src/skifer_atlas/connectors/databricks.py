"""Connecteur Databricks : API REST d'exécution de requêtes SQL (plan 0008, ADR 0011).

`POST /api/2.0/sql/statements` sur le SQL warehouse du point d'accès, résultat en
JSON, en ligne. Le warehouse ne renvoie jamais plus de `max_rows + 1` lignes
(`row_limit`) ; au-delà de `max_rows`, la requête est refusée avant de lire les blocs
suivants (`result_too_large`). Le délai et l'annulation passent par
`/statements/{id}/cancel`.
"""

from __future__ import annotations

import datetime
import threading
import time
from decimal import Decimal
from typing import Any

from ..repo.git import RepoError
from .access_points import AccessPoint
from .base import MAX_ROWS, QUERY_TIMEOUT, AuthRejected, QueryResult
from .http import message_of, request

POLL_SECONDS = 1.0
_DONE = {"SUCCEEDED", "FAILED", "CANCELED", "CLOSED"}


def _value(text: str | None, kind: str) -> Any:
    if text is None:
        return None
    if kind in ("byte", "short", "int", "long"):
        return int(text)
    if kind == "decimal":
        return Decimal(text)
    if kind in ("float", "double"):
        return float(text)
    if kind == "boolean":
        return text.lower() == "true"
    if kind == "date":
        return datetime.date.fromisoformat(text)
    if kind in ("timestamp", "timestamp_ntz"):
        return datetime.datetime.fromisoformat(text)
    return text


class DatabricksConnector:
    def __init__(self, point: AccessPoint, token: str):
        self.point = point
        self._token = token

    def _call(self, method: str, path: str, body: Any = None, timeout: float = 60):
        reply = request(method, f"{self.point.base_url}{path}", token=self._token,
                        json_body=body, timeout=timeout)
        if reply.status == 401:
            raise AuthRejected
        if reply.status == 403:
            raise RepoError("platform_forbidden", f"Accès refusé par Databricks : "
                            f"{message_of(reply.body)}")
        if reply.status == 404:
            raise RepoError("platform_not_found", f"Introuvable sur Databricks (warehouse "
                            f"{self.point.warehouse()} ?) : {message_of(reply.body)}")
        if reply.status >= 400:
            raise RepoError("query_failed", f"Databricks a répondu HTTP {reply.status} : "
                            f"{message_of(reply.body)}")
        return reply.body if isinstance(reply.body, dict) else {}

    def test(self) -> None:
        self.run_aggregate("SELECT 1 AS ok", max_rows=1, timeout=60)

    def run_aggregate(self, sql: str, max_rows: int = MAX_ROWS,
                      timeout: float = QUERY_TIMEOUT,
                      cancel: threading.Event | None = None) -> QueryResult:
        catalog, schema = self.point.catalog_and_schema()
        body = {"statement": sql, "warehouse_id": self.point.warehouse(),
                "wait_timeout": "10s", "on_wait_timeout": "CONTINUE",
                "disposition": "INLINE", "format": "JSON_ARRAY", "row_limit": max_rows + 1}
        if catalog:
            body["catalog"] = catalog
        if schema:
            body["schema"] = schema
        deadline = time.monotonic() + timeout
        reply = self._call("POST", "/api/2.0/sql/statements", body)
        statement = reply.get("statement_id")
        while reply.get("status", {}).get("state") not in _DONE:
            if cancel is not None and cancel.is_set():
                self._cancel(statement)
                raise RepoError("query_canceled", "Requête annulée.")
            if time.monotonic() >= deadline:
                self._cancel(statement)
                raise RepoError("query_timeout", f"Requête interrompue après {timeout:g} s.")
            time.sleep(POLL_SECONDS)
            reply = self._call("GET", f"/api/2.0/sql/statements/{statement}")
        status = reply["status"]
        if status["state"] != "SUCCEEDED":
            error = status.get("error") or {}
            raise RepoError("query_failed", f"Requête en échec ({status['state']}) : "
                            f"{error.get('message', '')[:500]}")
        manifest = reply.get("manifest") or {}
        total = manifest.get("total_row_count") or 0
        if total > max_rows or manifest.get("truncated"):
            self._cancel(statement)  # libère le résultat retenu par le warehouse
            raise RepoError("result_too_large", f"Le résultat dépasse {max_rows} lignes : "
                            "seul un résultat agrégé est rapatrié.")
        columns = (manifest.get("schema") or {}).get("columns") or []
        kinds = [str(c.get("type_name", "string")).lower() for c in columns]
        rows: list[tuple] = []
        chunk = reply.get("result") or {}
        while True:
            for raw in chunk.get("data_array") or []:
                rows.append(tuple(_value(v, k) for v, k in zip(raw, kinds, strict=True)))
            following = chunk.get("next_chunk_internal_link")
            if not following:
                break
            chunk = self._call("GET", following)
        return QueryResult([c["name"] for c in columns], kinds, rows)

    def _cancel(self, statement: str | None) -> None:
        if statement:
            try:
                self._call("POST", f"/api/2.0/sql/statements/{statement}/cancel")
            except (RepoError, AuthRejected):
                pass  # au mieux : le warehouse finira par abandonner la requête
