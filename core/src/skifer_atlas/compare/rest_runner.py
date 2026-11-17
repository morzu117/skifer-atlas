"""HTTPS GET → cache Parquet → LocalRunner DuckDB (plan 0036, ADR 0051/0052)."""

from __future__ import annotations

import tempfile
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from urllib.parse import unquote, urlencode, urljoin, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import duckdb

from .. import connections
from ..connectors import http, rest_cache
from ..connectors.rest_budget import RestBudget, utc_now
from ..connectors.rest_datasets import FILE, parse_rest_datasets
from ..masking import mask_body
from ..repo.git import RepoError
from ..workspaces import repo_dir


def datasets(workspace_id):
    registry = connections.registry(workspace_id)
    if registry.diagnostics:
        raise RepoError("invalid_rest_access_points", "Registre REST invalide.",
                        registry.diagnostics[0]["issues"])
    path = repo_dir(workspace_id) / FILE
    try:
        text = path.read_text(encoding="utf-8") if path.exists() else ""
    except (OSError, UnicodeError):
        raise RepoError("invalid_rest_datasets", "Fichier de jeux de données REST illisible.") from None
    found, issues = parse_rest_datasets(text,
        [p for p in registry.access_points if p.platform == "rest"],
        legacy_ids={p.id for p in registry.access_points if p.platform != "rest"})
    if found is None:
        raise RepoError("invalid_rest_datasets", "Jeux de données REST invalides.",
                        [i.to_dict() for i in issues])
    return found


def _at(value, path):
    for part in path.split(".") if path else ():
        try:
            value = value[int(part)] if isinstance(value, list) else value[part]
        except (KeyError, IndexError, TypeError, ValueError):
            return None
    return value


def _convert(value, column):
    if value is None:
        return None
    try:
        if column.type in ("date", "timestamp"):
            if column.format in ("epoch_s", "epoch_ms"):
                value = datetime.fromtimestamp(float(value) / (
                    1000 if column.format == "epoch_ms" else 1), UTC)
            elif column.format:
                value = datetime.strptime(str(value), column.format)
            else:
                value = datetime.fromisoformat(str(value))
            if value.tzinfo is None:
                value = value.replace(tzinfo=ZoneInfo(column.timezone))
            return value.date() if column.type == "date" else value.astimezone(UTC).replace(tzinfo=None)
        if column.type == "boolean":
            if value in (True, "true", "True", 1):
                return True
            if value in (False, "false", "False", 0):
                return False
            raise ValueError()
        return {"string": str, "integer": int, "double": float, "decimal": Decimal}[
            column.type](value)
    except (ValueError, TypeError, ArithmeticError, OverflowError):
        raise RepoError("rest_bad_response", f"Colonne REST « {column.name} » illisible.") from None


def parameters(dataset, source, window):
    params = dict(dataset.params)
    if dataset.window:
        if window is None:
            raise RepoError("rest_period_required", "Une période est requise pour ce jeu REST.")
        params[dataset.window.from_param] = window[0].strftime(dataset.window.format)
        params[dataset.window.to_param] = window[1].strftime(dataset.window.format)
    perimeter = dataset.perimeter
    if perimeter is None:
        return [(params, None)]
    selected = None
    for text in source.perimeter:
        column, operator, value = text.split(":", 2)
        if column != perimeter.column:
            continue
        if operator not in ("equals", "in"):
            raise RepoError("rest_perimeter_unsupported", "Opérateur de périmètre REST non pris en charge.")
        values = value.split(",") if operator == "in" else [value]
        selected = values if selected is None else [v for v in selected if v in values]
    if not selected:
        if perimeter.required:
            raise RepoError("rest_scope_required", "Un périmètre non vide est requis avant tout appel REST.")
        return [(params, None)]
    if perimeter.mode == "list":
        return [({**params, perimeter.param: ",".join(selected)}, None)]
    return [({**params, perimeter.param: value}, value) for value in dict.fromkeys(selected)]


class RestRunner:
    def __init__(self, workspace_id, refresh=False, now=utc_now):
        self.workspace_id, self.refresh, self.now = workspace_id, refresh, now
        self.refreshed = set()
        self.reports = {}

    def report(self):
        return list(self.reports.values())

    def __call__(self, plan, compiled, cancel):
        from .orchestrate import LocalRunner

        point = connections.access_point(self.workspace_id, plan.access_point)
        value, key_source = connections.rest_key(self.workspace_id, point)
        definitions = datasets(self.workspace_id)
        pending = []
        for source in compiled.sources:
            if source.perimeter_conflict:
                raise RepoError("rest_perimeter_conflict",
                                "Périmètres distincts pour une même table REST.")
            ds = definitions.require(source.table, point.id)
            pending.append((source, ds, parameters(ds, source, compiled.window)))
        key = http.ApiKey(value, point.key_in, point.key_name, point.key_prefix or "")
        budget = RestBudget(self.workspace_id, point, self.now)
        with tempfile.TemporaryDirectory() as folder:
            for source, ds, calls in pending:
                files = []
                for params, perimeter in calls:
                    identity = rest_cache.cache_key((point.id, point.host, point.http_path), ds,
                                                   params, compiled.window, perimeter)
                    immutable = ds.window is not None and compiled.window is not None and (
                        compiled.window[1] < self.now().date())
                    hit = rest_cache.cached(self.workspace_id, identity, self.now(), immutable=immutable)
                    forced = self.refresh and identity not in self.refreshed
                    report = self.reports.setdefault((point.id, ds.table), {
                        "access_point": point.id, "table": ds.table, "calls": 0, "bytes": 0,
                        "cache": "none", "key_source": key_source})
                    if hit is not None and not forced:
                        path, metadata = hit
                        budget.record(ds.table, cache_hits=1)
                        if report["calls"] == 0:
                            report["cache"] = "provisional" if metadata["provisional"] else "immutable"
                    else:
                        rows, count, size = self._fetch(point, ds, params, perimeter, key, budget, cancel)
                        provisional = not immutable
                        try:
                            path = rest_cache.write(self.workspace_id, identity, ds.columns, rows, {
                                "date": self.now().isoformat(), "provisional": provisional,
                                "calls": count, "bytes": size})
                        except RepoError:
                            budget.record(ds.table, errors=1)
                            raise
                        self.refreshed.add(identity)
                        report["calls"] += count
                        report["bytes"] += size
                        report["cache"] = "refreshed" if forced else "none"
                    files.append(str(path))
                with duckdb.connect(":memory:") as connection:
                    connection.execute("COPY (SELECT * FROM read_parquet(?)) TO ? (FORMAT PARQUET)",
                                       [files, str(Path(folder) / (source.table + ".parquet"))])
            return LocalRunner(Path(folder))(plan, compiled, cancel)

    def _fetch(self, point, ds, params, perimeter, key, budget, cancel):
        url = point.call_url(ds.path)
        origin = urlunsplit(urlsplit(url)._replace(path="", query=""))
        url += "?" + urlencode(params)
        rows, calls, size = [], 0, 0
        pages = ds.pagination.max_pages if ds.pagination else 1
        for page in range(pages):
            for attempt in range(2):
                if cancel.is_set():
                    raise RepoError("query_canceled", "Requête annulée.")
                budget.before_call()
                calls += 1
                try:
                    reply = http.get(url, key=key, origin=origin)
                except RepoError:
                    budget.record(ds.table, calls=1, errors=1)
                    raise
                body = mask_body(reply.body, key.value)
                # Ne jamais recopier le message fournisseur ; le masquage précède sa troncature.
                http.message_of(body, key.value)
                bad_body = isinstance(body, dict) and any(k in body for k in ds.error_keys)
                budget.record(ds.table, calls=1, bytes=reply.size,
                              errors=int(reply.status != 200 or bad_body))
                size += reply.size
                if reply.status == 429 and attempt == 0:
                    try:
                        delay = float(reply.headers.get("retry-after", "nan"))
                    except ValueError:
                        delay = float("nan")
                    if 0 <= delay <= 60:
                        if cancel.wait(delay):
                            raise RepoError("query_canceled", "Requête annulée.")
                        continue
                break
            status = reply.status
            if status == 401:
                if connections.rest_key(self.workspace_id, point)[1] == "vault":
                    vault = connections.Vault()
                    credential = vault.get(self.workspace_id, point.id)
                    credential.rejected = True
                    vault.put(self.workspace_id, point.id, credential)
                raise RepoError("access_expired", "Clé d'API refusée : se reconnecter.")
            code = {402: "rest_payment_required", 403: "rest_forbidden", 429: "rate_limited"}.get(status)
            if status != 200:
                raise RepoError(code or ("rest_server_error" if status >= 500 else "rest_http_error"),
                                "Appel REST refusé par le fournisseur.")
            if bad_body:
                raise RepoError("rest_error_body", "Corps d'erreur REST reçu.")
            data = _at(body, ds.rows_path)
            if not isinstance(data, list) or any(not isinstance(r, dict) for r in data):
                budget.record(ds.table, errors=1)
                raise RepoError("rest_bad_response", "Liste de lignes REST attendue.")
            if len(rows) + len(data) > 1_000_000:
                budget.record(ds.table, errors=1)
                raise RepoError("rest_response_too_large", "Réponse REST trop volumineuse.")
            for row in data:
                converted = []
                for column in ds.columns:
                    raw = _at(row, column.from_)
                    if raw is None and ds.perimeter and column.name == ds.perimeter.column:
                        raw = perimeter
                    try:
                        converted.append(_convert(raw, column))
                    except RepoError:
                        budget.record(ds.table, errors=1)
                        raise
                rows.append(tuple(converted))
            next_url = _at(body, ds.pagination.next_path) if ds.pagination else None
            if not next_url:
                return rows, calls, size
            if not isinstance(next_url, str):
                budget.record(ds.table, errors=1)
                raise RepoError("rest_next_url_refused", "Adresse de pagination REST refusée.")
            candidate = urljoin(url, next_url)
            parsed, allowed = urlsplit(candidate), urlsplit(origin)
            path = unquote(parsed.path)
            base = point.http_path.rstrip("/")
            if ((parsed.scheme, parsed.netloc) != (allowed.scheme, allowed.netloc)
                    or not (path == base or path.startswith(base + "/"))
                    or "\\" in path or any(part in (".", "..") for part in path.split("/"))):
                budget.record(ds.table, errors=1)
                raise RepoError("rest_next_url_refused", "Adresse de pagination REST refusée.")
            url = candidate
        budget.record(ds.table, errors=1)
        raise RepoError("rest_too_many_pages", "Nombre maximal de pages REST atteint.")
