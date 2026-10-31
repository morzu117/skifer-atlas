"""Jeton GitHub au coffre par le device flow, contre un faux GitHub (plan 0025)."""

import json
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient
from workspace_helpers import atlas_env, remote

from skifer_atlas.api.app import create_app
from skifer_atlas.githost import device, host_for, remote_token
from skifer_atlas.repo.sync import join_workspace
from skifer_atlas.vault import GITHUB_ENTRY, Credential, Vault
from skifer_atlas.vault.keyring_vault import _memory
from skifer_atlas.workspaces import get_workspace

__all__ = ["atlas_env", "remote"]  # fixtures importées

AUTH = {"Authorization": "Bearer secret"}
CLIENT_ID = "Iv1.atlas-test"
TOKEN = "gho_jeton-du-device-flow"
GITHUB = "https://github.com/nordis/annuaire.git"


class FakeGitHub(BaseHTTPRequestHandler):
    """Le device flow et `/user`. `answers` : les réponses successives au jeton."""

    state: dict

    def log_message(self, *args):
        pass

    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        form = dict(urllib.parse.parse_qsl(self.rfile.read(length).decode()))
        self.state["calls"].append((self.path, form))
        if form.get("client_id") != CLIENT_ID:
            return self._send(401, {"error": "incorrect_client_credentials"})
        if self.path == "/login/device/code":
            return self._send(200, {"device_code": "dc-secret", "user_code": "WDJB-MJHT",
                                    "verification_uri": "https://github.com/login/device",
                                    "expires_in": 900, "interval": 0})
        if self.path == "/login/oauth/access_token":
            assert form["device_code"] == "dc-secret"
            return self._send(200, self.state["answers"].pop(0))
        return self._send(404, {"message": "Not Found"})

    def do_GET(self):
        if self.path == "/user" and self.headers["Authorization"] == f"Bearer {TOKEN}":
            return self._send(200, {"login": "anna-k"})
        return self._send(401, {"message": "Bad credentials"})


@pytest.fixture
def github(atlas_env, monkeypatch):
    state = {"calls": [], "answers": [{"error": "authorization_pending"},
                                      {"error": "slow_down", "interval": 0},
                                      {"access_token": TOKEN, "token_type": "bearer",
                                       "scope": "repo"}]}
    handler = type("Handler", (FakeGitHub,), {"state": state})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}"
    monkeypatch.setenv("ATLAS_GITHUB_URL", url)
    monkeypatch.setenv("ATLAS_GITHUB_API_URL", url)
    monkeypatch.setenv("ATLAS_GITHUB_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("ATLAS_VAULT", "memory")
    monkeypatch.delenv("ATLAS_GITHUB_TOKEN", raising=False)
    _memory._items.clear()
    yield state
    server.shutdown()
    _memory._items.clear()


def connect(client, workspace=None):
    started = client.post("/api/github/device", json={"workspace": workspace} if workspace else {})
    assert started.status_code == 200, started.text
    body = started.json()
    assert body["user_code"] == "WDJB-MJHT" and "device_code" not in json.dumps(body)
    statuses = [client.post(f"/api/github/device/{body['flow']}").json() for _ in range(3)]
    return body["flow"], statuses


def test_device_flow_stores_the_token_in_the_workspace_vault(github, remote):
    """Critères 1 et 2 : code affiché, attente, jeton rangé sous `<espace>/@github`, jamais
    rendu par l'API."""
    bare, _ = remote
    join_workspace(str(bare))
    client = TestClient(create_app(token="secret"), headers=AUTH)
    assert client.get("/api/workspaces/groupe-nordis/github").json() == {
        "configured": True, "applies": False, "state": "absent", "source": None,
        "account": None}
    _, statuses = connect(client, "groupe-nordis")
    assert [s["status"] for s in statuses] == ["pending", "pending", "connected"]
    assert statuses[-1]["account"] == "anna-k"
    stored = Vault().get("groupe-nordis", GITHUB_ENTRY)
    assert (stored.kind, stored.access_token, stored.account) == ("github", TOKEN, "anna-k")
    status = client.get("/api/workspaces/groupe-nordis/github")
    assert status.json()["state"] == "connected" and TOKEN not in status.text
    assert all(TOKEN not in json.dumps(s) for s in statuses)


def test_the_token_is_scoped_to_its_workspace(github, monkeypatch):
    """Critère 3 : chaque espace lit son propre jeton ; à défaut, `ATLAS_GITHUB_TOKEN`."""
    Vault().put("groupe-nordis", GITHUB_ENTRY, Credential(kind="github", access_token=TOKEN))
    assert remote_token(GITHUB, "groupe-nordis") == TOKEN
    assert remote_token(GITHUB, "autre-espace") is None
    assert host_for(GITHUB, workspace_id="groupe-nordis")._token == TOKEN
    monkeypatch.setenv("ATLAS_GITHUB_TOKEN", "ghp_repli")
    assert remote_token(GITHUB, "autre-espace") == "ghp_repli"
    assert remote_token(GITHUB, "groupe-nordis") == TOKEN
    Vault().put("groupe-nordis", GITHUB_ENTRY,
                Credential(kind="github", access_token=TOKEN, rejected=True))
    assert remote_token(GITHUB, "groupe-nordis") == "ghp_repli"


def test_join_takes_the_token_of_a_flow_made_before_the_workspace_exists(github, remote):
    """Critère 4 : pour un dépôt privé, la connexion se fait avant l'adhésion ; le jeton va
    au coffre sous l'identifiant lu dans `atlas.yaml`."""
    bare, _ = remote
    client = TestClient(create_app(token="secret"), headers=AUTH)
    flow, statuses = connect(client)
    assert statuses[-1]["status"] == "connected" and "workspace" not in statuses[-1]
    assert _memory.usernames("skifer-atlas") == []  # rien au coffre avant l'adhésion
    joined = client.post("/api/workspaces/join", json={"remote_url": str(bare),
                                                       "github_flow": flow})
    assert joined.status_code == 201, joined.text
    assert Vault().get("groupe-nordis", GITHUB_ENTRY).access_token == TOKEN
    again = client.post("/api/workspaces/join", json={"remote_url": str(bare),
                                                      "github_flow": flow})
    assert again.json()["detail"]["code"] == "not_found"  # flux consommé


def test_a_failed_join_keeps_the_flow(github, atlas_env, tmp_path):
    client = TestClient(create_app(token="secret"), headers=AUTH)
    flow, _ = connect(client)
    failed = client.post("/api/workspaces/join", json={"remote_url": str(tmp_path / "absent.git"),
                                                       "github_flow": flow})
    assert failed.json()["detail"]["code"] == "clone_failed"
    assert device.pending(flow).access_token == TOKEN


def test_refused_expired_and_unconfigured(github, monkeypatch):
    """Critère 5 : refus et expiration sont des états ; sans client OAuth, une erreur claire."""
    client = TestClient(create_app(token="secret"), headers=AUTH)
    github["answers"][:] = [{"error": "access_denied"}]
    _, statuses = connect(client)
    assert [s["status"] for s in statuses] == ["denied"] * 3
    github["answers"][:] = [{"error": "expired_token"}]
    _, statuses = connect(client)
    assert statuses[0]["status"] == "expired"
    monkeypatch.delenv("ATLAS_GITHUB_CLIENT_ID")
    refused = client.post("/api/github/device", json={})
    assert (refused.status_code, refused.json()["detail"]["code"]) == (422, "github_not_configured")


def test_polling_respects_the_interval(github, monkeypatch):
    """Au plus une requête à GitHub par intervalle, quel que soit le rythme de l'écran."""
    client = TestClient(create_app(token="secret"), headers=AUTH)
    started = client.post("/api/github/device", json={}).json()
    monkeypatch.setattr(device._flows[started["flow"]], "interval", 60)
    for _ in range(5):
        assert client.post(f"/api/github/device/{started['flow']}").json()["status"] == "pending"
    assert [path for path, _ in github["calls"]].count("/login/oauth/access_token") == 1


def test_disconnect_removes_the_token(github, remote):
    """Critère 6 : « Déconnecter » retire le jeton du coffre de ce poste."""
    bare, _ = remote
    join_workspace(str(bare))
    Vault().put("groupe-nordis", GITHUB_ENTRY, Credential(kind="github", access_token=TOKEN))
    client = TestClient(create_app(token="secret"), headers=AUTH)
    assert client.delete("/api/workspaces/groupe-nordis/github").status_code == 204
    assert Vault().get("groupe-nordis", GITHUB_ENTRY) is None
    assert client.delete("/api/workspaces/groupe-nordis/github").status_code == 404


def test_connecting_refreshes_the_account_of_a_workspace_joined_without_token(github, remote,
                                                                              monkeypatch):
    """Un espace rejoint sans jeton n'a pas de compte GitHub : la connexion le relit."""
    bare, _ = remote
    joined = join_workspace(str(bare))
    monkeypatch.setattr("skifer_atlas.repo.sync._host_account",
                        lambda url, branch, ws=None: "anna-k" if ws else "")
    client = TestClient(create_app(token="secret"), headers=AUTH)
    connect(client, "groupe-nordis")
    assert joined.account != "anna-k"
    assert get_workspace("groupe-nordis").account == "anna-k"
