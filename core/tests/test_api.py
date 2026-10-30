"""Token de session de l'API locale (plan 0005, critère 10)."""

import pytest
from fastapi.testclient import TestClient

from skifer_atlas import server
from skifer_atlas.api.app import create_app


@pytest.fixture(autouse=True)
def isolated_data(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ATLAS_TOKEN", raising=False)
    monkeypatch.delenv("ATLAS_DEV_NO_TOKEN", raising=False)


def test_health_needs_no_token():
    client = TestClient(create_app(token="secret"))
    assert client.get("/health").json()["status"] == "ok"


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
