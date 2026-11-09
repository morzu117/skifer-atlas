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
    "https://[invalid/oidc/v1/token",
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
    ("pas-un-booléen", "boolean"),
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


def test_databricks_rejects_a_redirected_result_chunk(monkeypatch):
    point = AccessPoint.model_validate({"id": "dbx", "platform": "databricks",
                                        "host": "https://adb.example.com",
                                        "warehouse_id": "abc", "owner": "claire.m"})
    connector = DatabricksConnector(point, "secret")
    replies = [http.Response(200, {
        "statement_id": "s1", "status": {"state": "SUCCEEDED"},
        "manifest": {"total_row_count": 1, "schema": {"columns": [
            {"name": "total", "type_name": "INT"}]}},
        "result": {"next_chunk_internal_link": "/api/2.0/sql/statements/s1/chunks/1"},
    }), http.Response(302, {})]
    monkeypatch.setattr("skifer_atlas.connectors.databricks.request",
                        lambda *args, **kwargs: replies.pop(0))
    with pytest.raises(RepoError) as refused:
        connector.run_aggregate("SELECT 1")
    assert refused.value.code == "query_failed"


def test_databricks_rejects_a_row_with_the_wrong_number_of_cells(monkeypatch):
    point = AccessPoint.model_validate({"id": "dbx", "platform": "databricks",
                                        "host": "https://adb.example.com",
                                        "warehouse_id": "abc", "owner": "claire.m"})
    connector = DatabricksConnector(point, "secret")
    monkeypatch.setattr(connector, "_call", lambda *args, **kwargs: {
        "statement_id": "s1", "status": {"state": "SUCCEEDED"},
        "manifest": {"total_row_count": 1, "schema": {"columns": [
            {"name": "total", "type_name": "INT"}]}},
        "result": {"data_array": [["1", "2"]]},
    })
    with pytest.raises(RepoError) as refused:
        connector.run_aggregate("SELECT 1")
    assert refused.value.code == "query_failed"


def test_message_of_masks_known_secrets_before_truncating():
    token = "dapi-0123456789abcdef"
    # Le jeton à cheval sur la limite de 300 caractères : masqué avant la troncature.
    late = http.message_of({"message": "x" * 295 + token + " fin"}, token)
    assert token not in late and token[:8] not in late and "***" in late
    assert http.message_of({"error": f"jeton {token}"}, token) == "jeton ***"
    assert token not in http.message_of(f"corps brut {token}", token)
    # Hors des clés connues, le corps est restitué sérialisé : masqué lui aussi, même
    # dans une liste imbriquée ou avec des caractères que `str(dict)` échapperait.
    odd = "a'b\\c-secret"
    assert odd not in http.message_of({"details": [{"hint": f"vu {odd}"}]}, odd)
    assert http.message_of({"error": "invalid_grant"}) == "invalid_grant"
    assert http.message_of(None, token) == ""


def test_secret_variants_and_empty_secrets():
    from skifer_atlas.masking import mask_secrets

    assert mask_secrets("a b/c=d", "b/c=d") == "a ***"
    assert mask_secrets("redirect=b%2Fc%3Dd", "b/c=d") == "redirect=***"
    assert mask_secrets("rien à masquer", "", None) == "rien à masquer"


def test_oauth_code_exchange_error_does_not_echo_the_code_or_verifier(monkeypatch):
    endpoints = oauth.Endpoints("https://adb.example.com/a", "https://adb.example.com/t")
    monkeypatch.setattr(oauth, "request", lambda *_args, **_kwargs: http.Response(400, {
        "error_description": "code code-77 ou vérificateur verif-88 invalide"}))
    with pytest.raises(RepoError) as refused:
        oauth.exchange(endpoints, "databricks-cli", "code-77", "verif-88", "http://localhost")
    assert refused.value.code == "oauth_failed"
    assert "code-77" not in refused.value.message and "verif-88" not in refused.value.message
    assert "***" in refused.value.message


def test_unreachable_host_message_does_not_carry_the_token(monkeypatch):
    import urllib.error

    def refuse(*_args, **_kwargs):
        raise urllib.error.URLError("refusé pour Bearer jeton-xyz")

    monkeypatch.setattr(http._OPENER, "open", refuse)
    with pytest.raises(RepoError) as refused:
        http.request("GET", "https://adb.example.com/x", token="jeton-xyz")
    assert refused.value.code == "host_unreachable" and "jeton-xyz" not in refused.value.message


def test_a_secret_returned_as_a_json_key_is_masked():
    from skifer_atlas.connectors.http import message_of
    from skifer_atlas.masking import mask_body

    body = {"dapi-secret-key": "refusé", "autre": {"dapi-secret-key": ["x"]}}
    assert "dapi-secret-key" not in str(mask_body(body, "dapi-secret-key"))
    assert "dapi-secret-key" not in message_of(body, "dapi-secret-key")
    assert "***" in message_of(body, "dapi-secret-key")
