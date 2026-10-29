from fastapi.testclient import TestClient

from skifer_atlas.api import app as app_module
from skifer_atlas.api.app import create_app


def test_health():
    client = TestClient(create_app())
    assert client.get("/health").json()["status"] == "ok"


def test_token_required(monkeypatch):
    monkeypatch.setattr(app_module, "SESSION_TOKEN", "secret")
    client = TestClient(create_app())
    assert client.get("/api/workspaces").status_code == 401
    assert client.get("/api/workspaces", headers={"Authorization": "Bearer secret"}).status_code == 200
