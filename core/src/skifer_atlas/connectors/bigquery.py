"""Connecteur BigQuery par jobs.query et getQueryResults (plan 0037)."""

from __future__ import annotations

import datetime
import math
import re
import threading
import time
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import quote, urlencode

from ..masking import mask_secrets
from ..repo.git import RepoError
from .access_points import AccessPoint
from .base import MAX_ROWS, QUERY_TIMEOUT, AuthRejected, QueryResult
from .http import message_of, request

_WAIT_MS = 500
POLL_SECONDS = 0.5
_TYPES = {"INTEGER": "int64", "INT64": "int64", "FLOAT": "float64", "FLOAT64": "float64",
          "BOOLEAN": "bool", "BOOL": "bool", "STRING": "string", "NUMERIC": "numeric",
          "BIGNUMERIC": "bignumeric", "DATE": "date", "DATETIME": "datetime",
          "TIMESTAMP": "timestamp"}


def _value(raw: Any, kind: str) -> Any:
    # Hypothèse non documentée : cellules scalaires en chaînes, NULL en null et
    # TIMESTAMP en microsecondes entières ; à vérifier sur BigQuery au point 4.
    if raw is None:
        return None
    try:
        if not isinstance(raw, str):
            raise TypeError
        if kind == "string":
            return raw
        if kind in ("int64", "timestamp"):
            if not re.fullmatch(r"-?[0-9]+", raw):
                raise ValueError
            number = int(raw)
            if kind == "int64":
                if not -(2**63) <= number < 2**63:
                    raise ValueError
                return number
            return datetime.datetime(1970, 1, 1, tzinfo=datetime.UTC) + datetime.timedelta(microseconds=number)
        if kind in ("numeric", "bignumeric", "float64"):
            if not re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", raw):
                raise ValueError
            number = float(raw) if kind == "float64" else Decimal(raw)
            if not math.isfinite(number):
                raise ValueError
            return number
        if kind == "bool":
            if raw not in ("true", "false"):
                raise ValueError
            return raw == "true"
        if kind == "date":
            if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", raw):
                raise ValueError
            return datetime.date.fromisoformat(raw)
        if kind == "datetime":
            if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?", raw):
                raise ValueError
            return datetime.datetime.fromisoformat(raw)
    except (ValueError, TypeError, InvalidOperation, OverflowError):
        raise RepoError("query_failed", f"Valeur {kind} invalide dans la réponse BigQuery.") from None
    raise RepoError("query_failed", f"Valeur {kind} invalide dans la réponse BigQuery.")


class BigQueryConnector:
    def __init__(self, point: AccessPoint, token: str):
        if issue := point.bigquery_issue():
            raise RepoError("invalid_access_point", issue)
        self.point = point
        self._token = token

    def _call(self, method: str, path: str, body: Any = None):
        reply = request(method, self.point.base_url + path, token=self._token, json_body=body)
        if reply.status == 401:
            raise AuthRejected
        if reply.status >= 300:
            detail = message_of(reply.body, self._token)
            if reply.status == 403:
                raise RepoError("platform_forbidden", f"Accès refusé par BigQuery : {detail}")
            if reply.status == 404:
                raise RepoError("platform_not_found", f"Introuvable sur BigQuery (projet {self.point.project}) : {detail}")
            raise RepoError("query_failed", f"BigQuery a répondu HTTP {reply.status} : {detail}")
        if not isinstance(reply.body, dict):
            raise RepoError("query_failed", "Réponse BigQuery invalide.")
        if reply.body.get("errors"):
            raise RepoError("query_failed", f"Requête BigQuery en échec : {message_of(reply.body['errors'], self._token)}")
        return reply.body

    def test(self) -> None:
        self.run_aggregate("SELECT 1 AS ok", max_rows=1, timeout=60)

    def run_aggregate(self, sql: str, max_rows: int = MAX_ROWS,
                      timeout: float = QUERY_TIMEOUT,
                      cancel: threading.Event | None = None) -> QueryResult:
        project = quote(self.point.project or "", safe="")
        root = f"/bigquery/v2/projects/{project}"
        body: dict[str, Any] = {"query": sql, "useLegacySql": False, "maxResults": max_rows + 1,
                                "timeoutMs": _WAIT_MS, "formatOptions": {"useInt64Timestamp": True}}
        if self.point.location:
            body["location"] = self.point.location
        catalog, schema = self.point.catalog_and_schema()
        if schema:
            body["defaultDataset"] = {"projectId": catalog or self.point.project, "datasetId": schema}
        deadline = time.monotonic() + timeout
        reply = self._call("POST", root + "/queries", body)
        ref = reply.get("jobReference")
        if not isinstance(ref, dict) or not isinstance(ref.get("jobId"), str) or not ref["jobId"]:
            raise RepoError("query_failed", "Réponse BigQuery sans identifiant de requête.")
        job = quote(ref["jobId"], safe="")
        job_project = quote(ref.get("projectId") or self.point.project or "", safe="")
        root = f"/bigquery/v2/projects/{job_project}"
        location = ref.get("location") or self.point.location
        params: dict[str, Any] = {"maxResults": max_rows + 1, "timeoutMs": _WAIT_MS,
                                  "formatOptions.useInt64Timestamp": "true"}
        if location:
            params["location"] = location

        def check():
            if cancel is not None and cancel.is_set():
                self._cancel(root, job, location)
                raise RepoError("query_canceled", "Requête annulée.")
            if time.monotonic() >= deadline:
                self._cancel(root, job, location)
                raise RepoError("query_timeout", f"Requête interrompue après {timeout:g} s.")

        last_poll = None
        while reply.get("jobComplete") is False:
            check()
            if last_poll is not None:
                delay = min(POLL_SECONDS - (time.monotonic() - last_poll), deadline - time.monotonic())
                if delay > 0:
                    time.sleep(delay)
                check()
            last_poll = time.monotonic()
            reply = self._call("GET", f"{root}/queries/{job}?{urlencode(params)}")
        if reply.get("jobComplete") is not True:
            raise RepoError("query_failed", "État de requête BigQuery invalide.")
        fields = (reply.get("schema") or {}).get("fields")
        if not isinstance(fields, list):
            raise RepoError("query_failed", "Schéma absent de la réponse BigQuery.")
        columns, kinds = [], []
        for field in fields:
            if not isinstance(field, dict) or not isinstance(field.get("name"), str):
                raise RepoError("query_failed", "Colonne invalide dans la réponse BigQuery.")
            name, kind = field["name"], field.get("type")
            if not isinstance(kind, str) or kind not in _TYPES or field.get("mode", "NULLABLE") not in ("NULLABLE", "REQUIRED"):
                detail = mask_secrets(f"Colonne {name} : type {kind} ou mode {field.get('mode')} non pris en charge par BigQuery.", self._token)
                raise RepoError("query_failed", detail[:500])
            columns.append(name)
            kinds.append(_TYPES[kind])
        rows: list[tuple] = []
        while True:
            total = reply.get("totalRows")
            if not isinstance(total, str) or not re.fullmatch(r"[0-9]+", total):
                raise RepoError("query_failed", "Nombre de lignes invalide dans la réponse BigQuery.")
            if int(total) > max_rows:
                self._cancel(root, job, location)
                raise RepoError("result_too_large", f"Le résultat dépasse {max_rows} lignes : seul un résultat agrégé est rapatrié.")
            for row in reply.get("rows", []):
                cells = row.get("f") if isinstance(row, dict) else None
                if not isinstance(cells, list) or len(cells) != len(kinds) or any(not isinstance(c, dict) or "v" not in c for c in cells):
                    raise RepoError("query_failed", "Ligne incomplète dans la réponse BigQuery.")
                rows.append(tuple(_value(c["v"], k) for c, k in zip(cells, kinds, strict=True)))
                if len(rows) > max_rows:
                    self._cancel(root, job, location)
                    raise RepoError("result_too_large", f"Le résultat dépasse {max_rows} lignes : seul un résultat agrégé est rapatrié.")
            following = reply.get("pageToken")
            if not following:
                break
            check()
            params["pageToken"] = following
            reply = self._call("GET", f"{root}/queries/{job}?{urlencode(params)}")
        return QueryResult(columns, kinds, rows)

    def _cancel(self, root: str, job: str, location: str | None) -> None:
        query = "?" + urlencode({"location": location}) if location else ""
        try:
            self._call("POST", f"{root}/jobs/{job}/cancel{query}", {})
        except (RepoError, AuthRejected):
            pass  # Annulation au mieux.
