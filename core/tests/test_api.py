"""Token de session de l'API locale (plan 0005, critère 10)."""

import hmac

import pytest
from fastapi.testclient import TestClient

from skifer_atlas import server
from skifer_atlas.api.app import alive_proof, create_app


@pytest.fixture(autouse=True)
def isolated_data(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ATLAS_TOKEN", raising=False)
    monkeypatch.delenv("ATLAS_DEV_NO_TOKEN", raising=False)


def test_health_needs_the_token_and_shows_the_version_only_with_it():
    client = TestClient(create_app(token="secret"))
    refused = client.get("/health")
    assert refused.status_code == 401 and "version" not in refused.text
    assert client.get("/health", headers={"Authorization": "Bearer faux"}).status_code == 401
    found = client.get("/health", headers={"Authorization": "Bearer secret"})
    assert (found.status_code, found.json()["status"]) == (200, "ok")


def test_dev_mode_health_needs_no_token(monkeypatch):
    monkeypatch.setenv("ATLAS_DEV_NO_TOKEN", "1")
    assert TestClient(create_app()).get("/health").json()["status"] == "ok"


NONCE = "0123456789abcdef0123456789abcdef"


def test_alive_proves_the_token_without_revealing_it():
    client = TestClient(create_app(token="secret"))
    found = client.get("/alive", params={"nonce": NONCE})
    assert found.status_code == 200
    expected = hmac.new(b"secret", b"skifer-atlas-alive:" + NONCE.encode(), "sha256").hexdigest()
    assert found.json() == {"proof": expected}
    assert "secret" not in found.text
    # Un autre token, ou un autre nonce, donne une autre preuve : elle ne se rejoue pas.
    other_token = TestClient(create_app(token="autre")).get("/alive", params={"nonce": NONCE})
    other_nonce = client.get("/alive", params={"nonce": NONCE[::-1]})
    assert {found.json()["proof"]}.isdisjoint({other_token.json()["proof"],
                                                other_nonce.json()["proof"]})


def test_alive_proof_matches_the_vector_checked_by_the_shell():
    """Le même vecteur est dans `app/src-tauri/src/lib.rs` (tests::PROOF)."""
    assert alive_proof("jeton-de-session", NONCE) == (
        "64c4bb9f25f4e223a53dc3ef420f459a0f570ee2929bfbfab8940fa6074806bf")


@pytest.mark.parametrize("nonce", [None, "", "court", "G" * 32, "a" * 129, "0123456789abcdef!"])
def test_alive_refuses_a_missing_or_malformed_nonce(nonce):
    client = TestClient(create_app(token="secret"))
    params = {} if nonce is None else {"nonce": nonce}
    assert client.get("/alive", params=params).status_code == 422


def test_alive_gives_no_proof_without_a_token(monkeypatch):
    monkeypatch.setenv("ATLAS_DEV_NO_TOKEN", "1")
    assert TestClient(create_app()).get("/alive", params={"nonce": NONCE}).status_code == 401


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"])
def test_documentation_routes_are_closed(path):
    for client in (TestClient(create_app(token="secret")),
                   TestClient(create_app(token="secret"), headers={"Authorization": "Bearer secret"})):
        assert client.get(path).status_code == 404


def test_documentation_is_served_in_explicit_dev_mode_only(monkeypatch):
    monkeypatch.setenv("ATLAS_DEV_NO_TOKEN", "1")
    client = TestClient(create_app())
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/docs").status_code == 200
    # Un token configuré referme le schéma, même si le mode dev est demandé.
    assert TestClient(create_app(token="secret")).get("/openapi.json").status_code == 404


@pytest.mark.parametrize("header", [None, "Bearer autre", "secret", "Bearer secret ",
                                    "Bearer é".encode("latin-1")])
def test_missing_or_wrong_token_is_refused(header):
    client = TestClient(create_app(token="secret"))
    headers = {} if header is None else {"Authorization": header}
    assert client.get("/api/workspaces", headers=headers).status_code == 401


def test_right_token_is_accepted():
    client = TestClient(create_app(token="secret"))
    response = client.get("/api/workspaces", headers={"Authorization": "Bearer secret"})
    assert (response.status_code, response.json()) == (200, [])


def test_token_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("ATLAS_TOKEN", "depuis-tauri")
    client = TestClient(create_app())
    assert client.get("/api/workspaces").status_code == 401
    assert client.get("/api/workspaces",
                      headers={"Authorization": "Bearer depuis-tauri"}).status_code == 200


def test_without_token_every_protected_route_is_closed():
    client = TestClient(create_app(token=""))
    assert client.get("/api/workspaces").status_code == 401
    assert client.get("/api/workspaces", headers={"Authorization": "Bearer "}).status_code == 401


def test_dev_mode_without_token(monkeypatch):
    monkeypatch.setenv("ATLAS_DEV_NO_TOKEN", "1")
    assert TestClient(create_app()).get("/api/workspaces").status_code == 200


class FakeServer:
    started = False

    def __init__(self, config):
        self.config = config

    def run(self):
        FakeServer.started = True


def test_server_refuses_to_start_without_token(monkeypatch, capsys):
    monkeypatch.setattr(server.uvicorn, "Server", FakeServer)
    FakeServer.started = False
    with pytest.raises(SystemExit) as stopped:
        server.main()
    assert stopped.value.code == 2 and not FakeServer.started
    assert "ATLAS_TOKEN" in capsys.readouterr().err


@pytest.mark.parametrize("env", [{"ATLAS_TOKEN": "secret"}, {"ATLAS_DEV_NO_TOKEN": "1"}])
def test_server_starts_on_loopback_with_a_token_or_in_dev_mode(monkeypatch, env):
    monkeypatch.setattr(server.uvicorn, "Server", FakeServer)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    FakeServer.started = False
    server.main()
    assert FakeServer.started


def test_unexpected_error_keeps_cors_and_hides_details():
    app = create_app(token="secret")

    @app.get("/test-erreur")
    def broken():
        raise RuntimeError("détail privé")

    client = TestClient(app)
    response = client.get("/test-erreur", headers={"Origin": "http://localhost:1420"})
    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == "http://localhost:1420"
    assert "détail privé" not in response.text
