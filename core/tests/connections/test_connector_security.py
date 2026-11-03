"""Les jetons restent sur l'origine déclarée par le point d'accès."""

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from skifer_atlas.connectors import http, oauth
from skifer_atlas.connectors.access_points import AccessPoint
from skifer_atlas.connectors.databricks import DatabricksConnector, _value
from skifer_atlas.repo.git import RepoError


def test_bearer_is_not_forwarded_by_an_http_redirect():
    seen = []

    class Target(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append(self.headers.get("Authorization"))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):
            pass

    target = ThreadingHTTPServer(("127.0.0.1", 0), Target)

    class Redirect(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", f"http://127.0.0.1:{target.server_port}/target")
            self.end_headers()

        def log_message(self, *args):
            pass

    source = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
    threads = [threading.Thread(target=server.serve_forever, daemon=True)
               for server in (source, target)]
    for thread in threads:
        thread.start()
    try:
        reply = http.request("GET", f"http://127.0.0.1:{source.server_port}/start",
                             token="secret")
        assert reply.status == 302
        assert seen == []
    finally:
        for server in (source, target):
            server.shutdown()
            server.server_close()
        for thread in threads:
            thread.join()


@pytest.mark.parametrize("bad", [
    "http://adb.example.com/oidc/v1/token",
    "https://other.example.com/oidc/v1/token",
    "https://adb.example.com:8443/oidc/v1/token",
    "https://user@adb.example.com/oidc/v1/token",
    "https://adb.example.com/oidc/v1/token#fragment",
])
def test_oauth_discovery_rejects_foreign_endpoints(monkeypatch, bad):
    point = AccessPoint.model_validate({"id": "dbx", "platform": "databricks",
                                        "host": "https://adb.example.com",
                                        "warehouse_id": "abc", "owner": "claire.m"})
    monkeypatch.setattr(oauth, "request", lambda *_args: http.Response(200, {
        "authorization_endpoint": "https://adb.example.com/oidc/v1/authorize",
        "token_endpoint": bad,
    }))
    with pytest.raises(RepoError) as refused:
        oauth.discover(point)
    assert refused.value.code == "oauth_unavailable"


def test_oauth_discovery_checks_optional_revocation_endpoint(monkeypatch):
    point = AccessPoint.model_validate({"id": "dbx", "platform": "databricks",
                                        "host": "https://adb.example.com",
                                        "warehouse_id": "abc", "owner": "claire.m"})
    monkeypatch.setattr(oauth, "request", lambda *_args: http.Response(200, {
        "authorization_endpoint": "https://adb.example.com/oidc/v1/authorize",
        "token_endpoint": "https://adb.example.com/oidc/v1/token",
        "revocation_endpoint": "https://other.example.com/revoke",
    }))
    with pytest.raises(RepoError) as refused:
        oauth.discover(point)
    assert refused.value.code == "oauth_unavailable"


@pytest.mark.parametrize("raw,kind", [
    ("pas-un-entier", "int"), ("pas-un-décimal", "decimal"),
    ("2026-99-99", "date"), ("pas-une-date", "timestamp"),
])
def test_databricks_invalid_cell_is_a_typed_error(raw, kind):
    with pytest.raises(RepoError) as refused:
        _value(raw, kind)
    assert refused.value.code == "query_failed"
    assert raw not in str(refused.value)


def test_databricks_requires_a_statement_id(monkeypatch):
    point = AccessPoint.model_validate({"id": "dbx", "platform": "databricks",
                                        "host": "https://adb.example.com",
                                        "warehouse_id": "abc", "owner": "claire.m"})
    connector = DatabricksConnector(point, "secret")
    calls = []

    def fake_call(method, path, body=None, timeout=60):
        calls.append((method, path))
        return {"status": {"state": "RUNNING"}}

    monkeypatch.setattr(connector, "_call", fake_call)
    with pytest.raises(RepoError) as refused:
        connector.run_aggregate("SELECT 1")
    assert refused.value.code == "query_failed"
    assert calls == [("POST", "/api/2.0/sql/statements")]
