"""Coffre, OAuth et connecteur Databricks (plan 0008), contre un faux Databricks local."""

import contextlib
import os
import shutil
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
import yaml
from fake_databricks import FakeDatabricks, free_port
from fastapi.testclient import TestClient

from skifer_atlas import connections
from skifer_atlas.api.app import create_app
from skifer_atlas.connectors import databricks, oauth
from skifer_atlas.repo.git import RepoError
from skifer_atlas.vault import SERVICE, Credential, Vault, keyring_vault, system_keyring
from skifer_atlas.workspaces import Workspace, add_workspace, repo_dir

EXAMPLE = Path(__file__).parents[3] / "examples" / "espace-nordis"
AUTH = {"Authorization": "Bearer session"}
SECRETS = ("at-secret", "rt-secret", "dapi-perso")


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path / "donnees"))
    monkeypatch.setenv("ATLAS_VAULT", "memory")
    monkeypatch.setattr(databricks, "POLL_SECONDS", 0.01)
    keyring_vault._memory._items.clear()
    yield tmp_path / "donnees"
    oauth.FLOWS.stop_all()
    keyring_vault._memory._items.clear()


@pytest.fixture
def fake():
    server = FakeDatabricks()
    yield server
    server.close()


def point(fake, ap="dbx-fr", **extra):
    return {"id": ap, "platform": "databricks", "host": fake.url, "warehouse_id": "abc123",
            "schema": "gold.finance", "entity": "nordis-fr", "owner": "claire.m",
            "freshness": "quotidienne, 6 h", "oauth_redirect_port": free_port(), **extra}


def space(workspace_id, points):
    """Espace minimal au registre local : gouvernance de la démonstration, points d'accès."""
    add_workspace(Workspace(id=workspace_id, name=workspace_id, account="julien.h",
                            role="referent"))
    repo = repo_dir(workspace_id)
    repo.mkdir(parents=True, exist_ok=True)
    shutil.copy(EXAMPLE / "governance.yaml", repo / "governance.yaml")
    (repo / "access_points.yaml").write_text(yaml.safe_dump(
        {"schema_version": 1, "access_points": points}), encoding="utf-8")


class Recorder(TestClient):
    """Client qui garde toutes les réponses, pour y chercher des secrets (critère 8)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.bodies: list[str] = []

    def request(self, *args, **kwargs):
        response = super().request(*args, **kwargs)
        self.bodies.append(response.text)
        return response


@pytest.fixture
def client(env):
    return Recorder(create_app(token="session"), headers=AUTH)


def login(client, ws="nordis", ap="dbx-fr"):
    """Le parcours du navigateur : URL d'autorisation, redirection vers Atlas."""
    response = client.post(f"/api/workspaces/{ws}/connections/{ap}/authorize")
    assert response.status_code == 200, response.text
    with urllib.request.urlopen(response.json()["authorize_url"], timeout=10) as page:
        assert page.status == 200
        assert "Connexion réussie" in page.read().decode()
    flow = oauth.FLOWS.last((ws, ap))
    deadline = time.time() + 5
    while flow.status == "pending" and time.time() < deadline:
        time.sleep(0.01)
    assert flow.status == "connected", flow.error


def secrets_in(text: str) -> list[str]:
    return [s for s in SECRETS if s in text]


# --- critère 1 : OAuth, puis le trousseau seulement -----------------------------------------

def test_oauth_stores_tokens_in_the_vault_only(client, fake, env, capfd, caplog):
    space("nordis", [point(fake)])
    login(client)
    stored = keyring_vault._memory.get_password(SERVICE, "nordis/dbx-fr")
    assert stored is not None and "at-secret" in stored
    assert keyring_vault._memory.usernames(SERVICE) == ["nordis/dbx-fr"]
    status = client.get("/api/workspaces/nordis/connections/dbx-fr/status").json()
    assert (status["my_access"], status["auth"], status["flow"]["status"]) == (
        "connected", "oauth", "connected")
    # Ni le dossier de données (registre, clone), ni les journaux, ni la sortie.
    for path in env.rglob("*"):
        if path.is_file():
            assert not secrets_in(path.read_bytes().decode("utf-8", "replace")), path
    captured = capfd.readouterr()
    assert not secrets_in(captured.out + captured.err + caplog.text)
    assert fake.state.token_requests[0]["client_id"] == "databricks-cli"


def test_default_client_uses_the_databricks_cli_redirect():
    from skifer_atlas.connectors.access_points import AccessPoint

    default = AccessPoint.model_validate({"id": "dbx", "platform": "databricks",
                                          "host": "https://adb-1.2.azuredatabricks.net",
                                          "warehouse_id": "abc", "owner": "claire.m"})
    assert default.redirect_port == 8020


def test_callback_with_a_foreign_state_is_ignored(client, fake):
    entry = point(fake)
    space("nordis", [entry])
    client.post("/api/workspaces/nordis/connections/dbx-fr/authorize")
    port = entry["oauth_redirect_port"]
    with pytest.raises(urllib.error.HTTPError) as refused:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/?code=x&state=autre", timeout=5)
    assert refused.value.code == 400
    assert oauth.FLOWS.last(("nordis", "dbx-fr")).status == "pending"
    assert keyring_vault._memory.get_password(SERVICE, "nordis/dbx-fr") is None


def test_busy_redirect_port_is_reported(client, fake):
    entry = point(fake)
    space("nordis", [entry])
    with socket.socket() as squatter:
        squatter.bind(("127.0.0.1", entry["oauth_redirect_port"]))
        squatter.listen()
        response = client.post("/api/workspaces/nordis/connections/dbx-fr/authorize")
    assert (response.status_code, response.json()["detail"]["code"]) == (409, "oauth_port_busy")


def test_relaunching_replaces_the_flow_still_listening(client, fake):
    """Page d'autorisation abandonnée : relancer remplace l'écoute du premier flux, sans port occupé."""
    entry = point(fake)
    space("nordis", [entry])
    first = client.post("/api/workspaces/nordis/connections/dbx-fr/authorize")
    abandoned = oauth.FLOWS.last(("nordis", "dbx-fr"))
    assert first.status_code == 200 and abandoned.status == "pending"
    second = client.post("/api/workspaces/nordis/connections/dbx-fr/authorize")
    assert second.status_code == 200
    assert abandoned.status == "failed" and abandoned.server is None
    assert oauth.FLOWS.last(("nordis", "dbx-fr")).status == "pending"
    assert second.json()["authorize_url"] != first.json()["authorize_url"]


def _callback(url: str, port: int) -> str:
    """Le retour du navigateur d'une autorisation lancée avant : même `state`, code quelconque."""
    from urllib.parse import parse_qs, urlparse

    state = parse_qs(urlparse(url).query)["state"][0]
    return f"http://127.0.0.1:{port}/?code=code-tardif&state={state}"


def test_cancelling_stops_the_flow_and_a_late_callback_connects_nothing(client, fake):
    entry = point(fake)
    space("nordis", [entry])
    started = client.post("/api/workspaces/nordis/connections/dbx-fr/authorize").json()
    flow = oauth.FLOWS.last(("nordis", "dbx-fr"))
    cancelled = client.post("/api/workspaces/nordis/connections/dbx-fr/authorize/cancel")
    assert cancelled.status_code == 200
    assert (flow.status, flow.error, flow.server) == ("failed", "Connexion annulée.", None)
    status = client.get("/api/workspaces/nordis/connections/dbx-fr/status").json()
    assert status["flow"] == {"status": "failed", "error": "Connexion annulée."}
    # La page d'autorisation, déjà ouverte, rappelle Atlas : plus personne n'écoute.
    with pytest.raises(urllib.error.URLError):
        urllib.request.urlopen(_callback(started["authorize_url"], entry["oauth_redirect_port"]),
                               timeout=5)
    assert keyring_vault._memory.get_password(SERVICE, "nordis/dbx-fr") is None
    assert fake.state.token_requests == []
    # Le port est libre : une nouvelle connexion démarre et aboutit.
    login(client)


def test_cancelling_while_the_callback_is_registering_waits_and_the_vault_holds_the_access(client, fake):
    import threading

    space("nordis", [point(fake)])
    started = client.post("/api/workspaces/nordis/connections/dbx-fr/authorize").json()
    flow = oauth.FLOWS.last(("nordis", "dbx-fr"))
    registering, release = threading.Event(), threading.Event()
    store = flow.on_success

    def slow_store(credential):
        registering.set()
        release.wait(5)
        store(credential)

    flow.on_success = slow_store
    browser = threading.Thread(target=lambda: urllib.request.urlopen(started["authorize_url"], timeout=10).read())
    browser.start()
    assert registering.wait(5)
    answers = []
    canceller = threading.Thread(target=lambda: answers.append(
        client.post("/api/workspaces/nordis/connections/dbx-fr/authorize/cancel").json()))
    canceller.start()
    time.sleep(0.2)  # l'annulation attend la fin de l'enregistrement
    assert answers == []
    release.set()
    canceller.join(5)
    browser.join(5)
    # Rien n'a été arrêté : l'accès est au coffre, et c'est l'écran qui le relit.
    assert answers == [{"cancelled": False}]
    assert flow.status == "connected"
    assert keyring_vault._memory.get_password(SERVICE, "nordis/dbx-fr") is not None


def test_a_start_during_a_cancellation_finds_the_port_free(client, fake):
    import threading

    space("nordis", [point(fake)])
    client.post("/api/workspaces/nordis/connections/dbx-fr/authorize")
    flow = oauth.FLOWS.last(("nordis", "dbx-fr"))
    flow.lock.acquire()  # un retour du navigateur tient le flux : l'annulation est retenue
    answers = {}
    canceller = threading.Thread(target=lambda: answers.update(
        cancel=client.post("/api/workspaces/nordis/connections/dbx-fr/authorize/cancel").json()))
    canceller.start()
    time.sleep(0.2)
    starter = threading.Thread(target=lambda: answers.update(
        start=client.post("/api/workspaces/nordis/connections/dbx-fr/authorize")))
    starter.start()
    time.sleep(0.2)
    flow.lock.release()
    canceller.join(5)
    starter.join(5)
    assert answers["cancel"] == {"cancelled": True}
    assert answers["start"].status_code == 200, answers["start"].text
    assert flow.status == "failed" and oauth.FLOWS.last(("nordis", "dbx-fr")).status == "pending"


def test_cancelling_without_a_pending_flow_is_harmless(client, fake):
    space("nordis", [point(fake)])
    assert client.post("/api/workspaces/nordis/connections/dbx-fr/authorize/cancel").status_code == 200
    login(client)
    # Un ancien flux connecté du même identifiant n'est pas « en attente » : rien à annuler.
    again = client.post("/api/workspaces/nordis/connections/dbx-fr/authorize/cancel")
    assert again.status_code == 200 and again.json() == {"cancelled": False}
    assert oauth.FLOWS.last(("nordis", "dbx-fr")).status == "connected"


def test_cancelling_stops_the_pending_flow_and_ignores_an_old_one_of_the_same_id(client, fake):
    """Un identifiant de brouillon réutilisé : l'ancien flux OAuth connecté ne dicte pas l'issue
    de l'annulation du SSO en attente, ni l'inverse (points d'accès et brouillons)."""
    from skifer_atlas.connectors.snowflake import SSO_FLOWS, SsoFlow

    space("nordis", [point(fake)])
    login(client)  # flux OAuth « connected » pour (nordis, dbx-fr)
    key = ("nordis", "dbx-fr")
    sso = SsoFlow(key)
    SSO_FLOWS._last[key] = sso  # un SSO en attente sur le même identifiant
    try:
        draft = {"id": "dbx-fr", "platform": "databricks", "host": "https://adb-1.azuredatabricks.net"}
        for route, body in (("connections/dbx-fr/authorize/cancel", None),
                            ("access-point-draft/authorize/cancel", {"access_point": draft})):
            sso.status, sso.error = "pending", None
            answer = client.post(f"/api/workspaces/nordis/{route}", json=body)
            assert answer.json() == {"cancelled": True}, route
            assert sso.status == "failed"
        # Et l'inverse : un SSO ancien « connecté », un flux OAuth en attente.
        SSO_FLOWS._last[key] = SsoFlow(key, status="connected")
        time.sleep(1)  # l'écoute du premier flux, terminé, se ferme en tâche de fond
        again = client.post("/api/workspaces/nordis/connections/dbx-fr/authorize")
        assert again.status_code == 200, again.text
        waiting = oauth.FLOWS.last(key)
        assert waiting.status == "pending"
        assert client.post("/api/workspaces/nordis/connections/dbx-fr/authorize/cancel").json() == {"cancelled": True}
        assert waiting.status == "failed"
    finally:
        SSO_FLOWS._last.pop(key, None)


def test_forgetting_a_draft_while_a_callback_registers_and_a_cancel_waits_does_not_deadlock(client, fake):
    """Ordre des verrous registre, flux, `_draft_lock` : le retour du navigateur tient le verrou de son
    flux et attend `_draft_lock` ; l'annulation tient le registre en attendant ce flux ; « Oublier »
    tient `_draft_lock`. Chaque fil a un délai : un interblocage fait échouer le test."""
    from skifer_atlas.connectors import drafts

    space("nordis", [])
    entry = point(fake, ap="dbx-brouillon")
    started = client.post("/api/workspaces/nordis/access-point-draft/authorize",
                          json={"access_point": entry}).json()
    key = ("nordis", "dbx-brouillon")
    drafts.put("nordis", "dbx-brouillon", fake.url)
    flow = oauth.FLOWS.last(key)
    registering, proceed = threading.Event(), threading.Event()
    store = flow.on_success

    def held_store(credential):
        registering.set()
        proceed.wait(10)
        store(credential)  # passe par `_store_draft`, qui attend `_draft_lock`

    flow.on_success = held_store
    threads = {
        "browser": threading.Thread(target=lambda: _quietly(urllib.request.urlopen, started["authorize_url"], timeout=10)),
        "cancel": threading.Thread(target=lambda: connections.cancel_authorization(*key)),
        "forget": threading.Thread(target=lambda: _quietly(connections.forget_draft_credential, *key)),
    }
    for thread in threads.values():
        thread.daemon = True  # un interblocage ne doit pas bloquer la fin de la suite
    threads["browser"].start()
    assert registering.wait(5)  # le flux est tenu par le retour du navigateur
    threads["cancel"].start()
    deadline = time.time() + 5
    while not oauth.FLOWS._lock.locked() and time.time() < deadline:
        time.sleep(0.01)  # l'annulation tient le registre, en attente du flux
    threads["forget"].start()
    time.sleep(0.3)  # « Oublier » tient `_draft_lock` (ancien ordre : puis attend le registre)
    proceed.set()
    for name, thread in threads.items():
        thread.join(10)
        assert not thread.is_alive(), f"interblocage : {name}"
    assert drafts.get("nordis", "dbx-brouillon") is None
    assert keyring_vault._memory.get_password(SERVICE, "nordis/dbx-brouillon") is None


def _quietly(call, *args, **kwargs):
    with contextlib.suppress(Exception):  # seul compte ici que l'appel se termine
        call(*args, **kwargs)


def test_forgetting_a_draft_does_not_fail_a_flow_started_afterwards(client, fake, monkeypatch):
    from skifer_atlas.connectors import drafts
    from skifer_atlas.connectors.access_points import AccessPoint

    space("nordis", [])
    entry = point(fake, ap="dbx-oublie")
    drafts.put("nordis", "dbx-oublie", fake.url)
    real_delete = drafts.delete

    def delete_then_a_flow_starts(workspace_id, access_point_id):
        real_delete(workspace_id, access_point_id)
        # Un nouveau flux démarre pendant l'oubli, après la lecture des flux existants.
        oauth.FLOWS.start((workspace_id, access_point_id), AccessPoint.model_validate(entry),
                          lambda credential: None)

    monkeypatch.setattr(drafts, "delete", delete_then_a_flow_starts)
    connections.forget_draft_credential("nordis", "dbx-oublie")
    assert oauth.FLOWS.last(("nordis", "dbx-oublie")).status == "pending"


def test_cancelling_requires_the_session_token(client, fake):
    space("nordis", [point(fake)])
    from fastapi.testclient import TestClient

    from skifer_atlas.api.app import create_app

    anonymous = TestClient(create_app(token="session"))
    assert anonymous.post("/api/workspaces/nordis/connections/dbx-fr/authorize/cancel").status_code == 401


def test_a_callback_for_a_flow_no_longer_pending_answers_410_and_stores_nothing(client, fake):
    entry = point(fake)
    space("nordis", [entry])
    started = client.post("/api/workspaces/nordis/connections/dbx-fr/authorize").json()
    flow = oauth.FLOWS.last(("nordis", "dbx-fr"))
    flow.status = "failed"  # annulé pendant que la requête du navigateur arrive
    with pytest.raises(urllib.error.HTTPError) as late:
        urllib.request.urlopen(_callback(started["authorize_url"], entry["oauth_redirect_port"]),
                               timeout=5)
    assert late.value.code == 410 and "annulée ou remplacée" in late.value.read().decode()
    assert keyring_vault._memory.get_password(SERVICE, "nordis/dbx-fr") is None
    assert fake.state.token_requests == []


def test_a_replaced_flow_cannot_connect_late(client, fake):
    entry = point(fake)
    space("nordis", [entry])
    first = client.post("/api/workspaces/nordis/connections/dbx-fr/authorize").json()
    old = oauth.FLOWS.last(("nordis", "dbx-fr"))
    client.post("/api/workspaces/nordis/connections/dbx-fr/authorize")
    assert old.status == "failed" and old.server is None
    # Le `state` du premier flux est refusé par le second, qui écoute désormais sur ce port.
    with pytest.raises(urllib.error.HTTPError) as foreign:
        urllib.request.urlopen(_callback(first["authorize_url"], entry["oauth_redirect_port"]),
                               timeout=5)
    assert foreign.value.code == 400
    assert keyring_vault._memory.get_password(SERVICE, "nordis/dbx-fr") is None
    assert oauth.FLOWS.last(("nordis", "dbx-fr")).status == "pending"


def test_flow_expires_after_the_listening_delay(env, fake):
    space("nordis", [point(fake)])
    connections.authorize("nordis", "dbx-fr", listen_seconds=0.05)
    time.sleep(0.3)
    flow = oauth.FLOWS.last(("nordis", "dbx-fr"))
    assert flow.status == "expired" and flow.server is None


def test_pkce_challenge_is_s256_of_the_verifier():
    verifier, challenge = oauth.pkce()
    assert 43 <= len(verifier) <= 128
    import base64
    import hashlib

    digest = hashlib.sha256(verifier.encode()).digest()
    assert challenge == base64.urlsafe_b64encode(digest).decode().rstrip("=")


# --- critère 2 : un espace, une entrée ------------------------------------------------------

def test_same_access_point_in_two_spaces_gives_two_entries(client, fake):
    space("nordis", [point(fake)])
    space("autre-client", [point(fake)])
    login(client, "nordis")
    login(client, "autre-client")
    assert keyring_vault._memory.usernames(SERVICE) == ["autre-client/dbx-fr", "nordis/dbx-fr"]
    revoked = client.delete("/api/workspaces/nordis/connections/dbx-fr/token").json()
    assert revoked == {"revoked": True, "remote_revoked": True}
    assert keyring_vault._memory.usernames(SERVICE) == ["autre-client/dbx-fr"]
    mine = client.get("/api/workspaces/nordis/connections").json()
    other = client.get("/api/workspaces/autre-client/connections").json()
    assert (mine[0]["my_access"], other[0]["my_access"]) == ("never", "connected")
    assert client.post("/api/workspaces/autre-client/connections/dbx-fr/test").json()["ok"]


# --- critère 3 : test de connexion ----------------------------------------------------------

def test_test_is_ok_then_explicit_for_an_unreachable_host(client, fake):
    dead_host = f"http://127.0.0.1:{free_port()}"
    space("nordis", [point(fake), point(fake, "dbx-mort", host=dead_host)])
    login(client)
    ok = client.post("/api/workspaces/nordis/connections/dbx-fr/test").json()
    assert ok["ok"] is True and ok["latency_ms"] >= 0 and ok["error"] is None
    assert fake.state.seen_sql[-1] == "SELECT 1 AS ok"
    keyring_vault._memory.set_password(SERVICE, "nordis/dbx-mort",
                                       Credential("pat", "dapi-perso-1", host=dead_host).to_json())
    dead = client.post("/api/workspaces/nordis/connections/dbx-mort/test").json()
    assert dead["ok"] is False
    assert dead["error"]["code"] == "host_unreachable"
    assert "Hôte injoignable" in dead["error"]["message"]


def test_test_without_credentials_says_so(client, fake):
    space("nordis", [point(fake)])
    result = client.post("/api/workspaces/nordis/connections/dbx-fr/test").json()
    assert result["error"]["code"] == "not_connected"


def test_a_declared_connection_is_not_sent_to_a_changed_host(client, fake):
    """#33 : test, rafraîchissement et révocation ne transmettent pas le jeton à B."""
    other = FakeDatabricks()
    try:
        original = point(fake)
        space("nordis", [original])
        login(client)
        changed = {**original, "host": other.url}
        repo = repo_dir("nordis") / "access_points.yaml"
        repo.write_text(yaml.safe_dump({"schema_version": 1, "access_points": [changed]}),
                        encoding="utf-8")
        status = client.get("/api/workspaces/nordis/connections/dbx-fr/status").json()
        assert (status["my_access"], status["error"]["code"]) == (
            "expired", "access_host_mismatch")
        tested = client.post("/api/workspaces/nordis/connections/dbx-fr/test").json()
        assert tested["error"]["code"] == "access_host_mismatch"
        revoked = client.delete("/api/workspaces/nordis/connections/dbx-fr/token").json()
        assert revoked == {"revoked": True, "remote_revoked": False}
        assert other.state.seen_sql == [] and other.state.revoked == []
    finally:
        other.close()


def test_an_old_unbound_token_requires_reconnection(client, fake):
    space("nordis", [point(fake)])
    Vault().put("nordis", "dbx-fr", Credential("pat", "dapi-perso-1"))
    status = client.get("/api/workspaces/nordis/connections/dbx-fr/status").json()
    assert (status["my_access"], status["error"]["code"]) == (
        "expired", "access_host_mismatch")
    assert client.post("/api/workspaces/nordis/connections/dbx-fr/test").json()[
        "error"]["code"] == "access_host_mismatch"


@pytest.mark.databricks
def test_real_warehouse(env):
    """Hors CI : ATLAS_DATABRICKS_HOST, ATLAS_DATABRICKS_WAREHOUSE et
    ATLAS_DATABRICKS_TOKEN (jeton personnel de test)."""
    host = os.environ.get("ATLAS_DATABRICKS_HOST")
    warehouse = os.environ.get("ATLAS_DATABRICKS_WAREHOUSE")
    token = os.environ.get("ATLAS_DATABRICKS_TOKEN")
    if not (host and warehouse and token):
        pytest.skip("Databricks réel non configuré")
    space("reel", [{"id": "dbx", "platform": "databricks", "host": host,
                    "warehouse_id": warehouse, "owner": "test"}])
    connections.store_personal_token("reel", "dbx", token)
    assert connections.check_connection("reel", "dbx")["ok"]
    result = connections.run_aggregate("reel", "dbx", "SELECT 1 AS un, 'a' AS deux")
    assert result.rows == [(1, "a")]


# --- critère 4 : rafraîchissement -----------------------------------------------------------

def test_expired_token_is_refreshed(client, fake):
    space("nordis", [point(fake)])
    fake.state.expires_in = 0  # jeton déjà expiré à la réception
    login(client)
    before = Vault().get("nordis", "dbx-fr")
    assert before.needs_refresh()
    fake.state.expires_in = 3600
    status = client.get("/api/workspaces/nordis/connections/dbx-fr/status").json()
    assert status["my_access"] == "connected" and status["error"] is None
    after = Vault().get("nordis", "dbx-fr")
    assert after.access_token != before.access_token and not after.needs_refresh()
    assert fake.state.token_requests[-1]["grant_type"] == "refresh_token"


def test_concurrent_refreshes_use_one_new_token(client, fake, monkeypatch):
    space("nordis", [point(fake)])
    fake.state.expires_in = 0
    login(client)
    fake.state.expires_in = 3600
    original = oauth.refresh

    def slow_refresh(*args):
        time.sleep(0.05)
        return original(*args)

    monkeypatch.setattr(oauth, "refresh", slow_refresh)
    barrier = threading.Barrier(3)

    def use():
        barrier.wait()
        connections.ensure_usable("nordis", "dbx-fr")

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(use) for _ in range(2)]
        barrier.wait()
        for future in futures:
            future.result()
    assert [r["grant_type"] for r in fake.state.token_requests].count("refresh_token") == 1


def test_refresh_reuses_a_fresh_token_even_when_its_value_is_unchanged(
        client, fake, monkeypatch):
    space("nordis", [point(fake)])
    fake.state.expires_in = 0
    login(client)
    vault = Vault()
    stale = vault.get("nordis", "dbx-fr")
    current = vault.get("nordis", "dbx-fr")
    current.expires_at = time.time() + 3600
    vault.put("nordis", "dbx-fr", current)

    def unexpected_refresh(*args):
        raise AssertionError("Le jeton du coffre est déjà frais.")

    monkeypatch.setattr(oauth, "refresh", unexpected_refresh)
    actual = connections._refresh("nordis", connections.access_point("nordis", "dbx-fr"),
                                  stale, vault)
    assert actual.access_token == stale.access_token
    assert not actual.needs_refresh()


def test_forced_refresh_does_not_refresh_a_replacement_pat_with_the_same_value(
        client, fake, monkeypatch):
    space("nordis", [point(fake)])
    fake.state.expires_in = 0
    login(client)
    vault = Vault()
    stale = vault.get("nordis", "dbx-fr")
    location = connections.access_point("nordis", "dbx-fr")
    vault.put("nordis", "dbx-fr", Credential("pat", stale.access_token,
                                             host=location.base_url))

    def unexpected_refresh(*args):
        raise AssertionError("Le coffre contient maintenant un token personnel.")

    monkeypatch.setattr(oauth, "refresh", unexpected_refresh)
    actual = connections._refresh("nordis", location, stale, vault, force=True)
    assert actual.kind == "pat" and actual.access_token == stale.access_token


def test_refused_refresh_gives_expired(client, fake):
    space("nordis", [point(fake)])
    fake.state.expires_in = 0
    login(client)
    fake.state.refuse_refresh = True
    status = client.get("/api/workspaces/nordis/connections/dbx-fr/status").json()
    assert status["my_access"] == "expired"
    assert status["error"]["code"] == "access_expired"
    listed = client.get("/api/workspaces/nordis/connections").json()
    assert listed[0]["my_access"] == "expired"
    test = client.post("/api/workspaces/nordis/connections/dbx-fr/test").json()
    assert test["error"]["code"] == "access_expired"


def test_rejected_access_token_is_refreshed_once(client, fake):
    space("nordis", [point(fake)])
    login(client)
    fake.state.valid.clear()  # le jeton d'accès est révoqué côté Databricks
    assert client.post("/api/workspaces/nordis/connections/dbx-fr/test").json()["ok"]
    assert fake.state.token_requests[-1]["grant_type"] == "refresh_token"


# --- critère 5 : token personnel en repli ---------------------------------------------------

def test_personal_token_goes_to_the_vault_and_never_comes_back(client, fake):
    space("nordis", [point(fake)])
    fake.state.valid.add("dapi-perso-42")
    response = client.put("/api/workspaces/nordis/connections/dbx-fr/token",
                          json={"token": "dapi-perso-42", "expires_at": time.time() + 9 * 86400})
    assert response.status_code == 200
    assert (response.json()["auth"], response.json()["my_access"],
            response.json()["expires_in_days"]) == ("pat", "connected", 8)
    assert Vault().get("nordis", "dbx-fr").access_token == "dapi-perso-42"
    assert client.post("/api/workspaces/nordis/connections/dbx-fr/test").json()["ok"]
    for path in ("", "/dbx-fr/status"):
        assert "dapi-perso" not in client.get(f"/api/workspaces/nordis/connections{path}").text


def test_expired_personal_token(client, fake):
    space("nordis", [point(fake)])
    client.put("/api/workspaces/nordis/connections/dbx-fr/token",
               json={"token": "dapi-perso-1", "expires_at": time.time() - 1})
    assert client.get("/api/workspaces/nordis/connections").json()[0]["my_access"] == "expired"


def test_blank_personal_token_is_refused(client, fake):
    space("nordis", [point(fake)])
    response = client.put("/api/workspaces/nordis/connections/dbx-fr/token",
                          json={"token": "  dapi x "})
    assert response.json()["detail"]["code"] == "invalid_token"


# --- critère 6 : résultat borné -------------------------------------------------------------

def test_aggregate_result_is_typed_and_read_by_chunks(env, fake):
    space("nordis", [point(fake)])
    connections.store_personal_token("nordis", "dbx-fr", "dapi-perso-7")
    fake.state.valid.add("dapi-perso-7")
    result = connections.run_aggregate("nordis", "dbx-fr", "SELECT mois, SUM(ca) …")
    assert result.columns == ["mois", "ca"] and result.types == ["date", "decimal"]
    assert [str(v) for v in result.rows[2]] == ["2025-03-01", "300.50"]
    assert len(result.rows) == 3  # deux blocs de deux, puis un


def test_too_many_rows_are_refused_without_fetching(env, fake):
    space("nordis", [point(fake)])
    connections.store_personal_token("nordis", "dbx-fr", "dapi-perso-7")
    fake.state.valid.add("dapi-perso-7")
    fake.state.rows = 50
    with pytest.raises(RepoError) as error:
        connections.run_aggregate("nordis", "dbx-fr", "SELECT * FROM detail", max_rows=10)
    assert error.value.code == "result_too_large"
    [statement] = [s for s in fake.state.statements if s in fake.state.canceled]
    assert fake.state.statements[statement]["reply"]["manifest"]["total_row_count"] == 11


def test_a_held_statement_runs_until_released_or_cancelled(env, fake):
    """Le pilotage du faux pour les parcours de bout en bout : `hold` retient la requête."""
    import json
    from urllib.request import Request, urlopen

    def configure(**body):
        request = Request(f"{fake.url}/__test__/configure", json.dumps(body).encode(),
                          {"Content-Type": "application/json"})
        assert json.load(urlopen(request))["configured"] is True

    space("nordis", [point(fake)])
    connections.store_personal_token("nordis", "dbx-fr", "dapi-perso-7")
    fake.state.valid.add("dapi-perso-7")
    configure(hold=True)
    stop = threading.Event()
    timer = threading.Timer(0.3, stop.set)
    timer.start()
    with pytest.raises(RepoError) as error:
        connections.run_aggregate("nordis", "dbx-fr", "SELECT * FROM t", cancel=stop)
    assert error.value.code == "query_canceled" and len(fake.state.canceled) == 1
    configure(hold=True)
    assert len(json.load(urlopen(f"{fake.url}/__test__/state"))["held"]) == 0  # annulée : plus retenue
    configure(hold=True, rows=2)
    timer = threading.Timer(0.3, configure, kwargs={"rows": 2})  # libérée en cours d'attente
    timer.start()
    assert len(connections.run_aggregate("nordis", "dbx-fr", "SELECT * FROM t").rows) == 2
    timer.join()


def test_timeout_and_cancel_stop_the_statement(env, fake):
    space("nordis", [point(fake)])
    connections.store_personal_token("nordis", "dbx-fr", "dapi-perso-7")
    fake.state.valid.add("dapi-perso-7")
    with pytest.raises(RepoError) as error:
        connections.run_aggregate("nordis", "dbx-fr", "SELECT pg_sleep", timeout=0.05)
    assert error.value.code == "query_timeout" and len(fake.state.canceled) == 1
    stop = threading.Event()
    stop.set()
    with pytest.raises(RepoError) as error:
        connections.run_aggregate("nordis", "dbx-fr", "SELECT pg_sleep", cancel=stop)
    assert error.value.code == "query_canceled" and len(fake.state.canceled) == 2


def test_failed_statement_reports_databricks_message(env, fake):
    space("nordis", [point(fake)])
    connections.store_personal_token("nordis", "dbx-fr", "dapi-perso-7")
    fake.state.valid.add("dapi-perso-7")
    with pytest.raises(RepoError) as error:
        connections.run_aggregate("nordis", "dbx-fr", "BROKEN")
    assert error.value.code == "query_failed" and "PARSE_SYNTAX_ERROR" in error.value.message


# --- le jeton envoyé n'est jamais restitué, même recopié par la plateforme ------------------

PAT = "dapi-perso-echo-7"


@pytest.mark.parametrize("sql,code", [
    ("ECHO_HTTP", "query_failed"),  # message d'une réponse d'erreur
    ("ECHO_LATE", "query_failed"),  # jeton à cheval sur la limite de 300 caractères
    ("ECHO_RAW", "query_failed"),  # corps brut, hors JSON
    ("ECHO_STATEMENT", "query_failed"),  # requête terminée en échec
    ("ECHO_STATEMENT_LATE", "query_failed"),  # idem, jeton à cheval sur la limite de 500
])
def test_a_token_echoed_by_databricks_is_masked(env, fake, sql, code):
    space("nordis", [point(fake)])
    connections.store_personal_token("nordis", "dbx-fr", PAT)
    fake.state.valid.add(PAT)
    with pytest.raises(RepoError) as error:
        connections.run_aggregate("nordis", "dbx-fr", sql)
    assert error.value.code == code
    assert PAT not in error.value.message and PAT[:12] not in error.value.message
    assert "***" in error.value.message


def test_an_echoed_token_does_not_reach_the_test_route(client, fake, monkeypatch):
    space("nordis", [point(fake)])
    connections.store_personal_token("nordis", "dbx-fr", PAT)
    fake.state.valid.add(PAT)
    # Le faux répond à « SELECT 1 AS ok » : la requête d'essai devient un écho du jeton.
    monkeypatch.setattr(databricks.DatabricksConnector, "test",
                        lambda self: self.run_aggregate("ECHO_HTTP"))
    answer = client.post("/api/workspaces/nordis/connections/dbx-fr/test").json()
    assert answer["ok"] is False
    assert PAT not in answer["error"]["message"] and "***" in answer["error"]["message"]
    for body in client.bodies:
        assert PAT not in body


# --- critère 7 : plateformes autorisées -----------------------------------------------------

def test_platform_removed_from_allowed_platforms_cannot_be_used(client, fake):
    space("nordis", [point(fake)])
    governance = repo_dir("nordis") / "governance.yaml"
    governance.write_text(governance.read_text(encoding="utf-8").replace(
        "allowed_platforms: [databricks, snowflake]", "allowed_platforms: [snowflake]"),
        encoding="utf-8")
    listed = client.get("/api/workspaces/nordis/connections").json()
    assert listed[0]["allowed"] is False
    response = client.post("/api/workspaces/nordis/connections/dbx-fr/authorize")
    assert response.json()["detail"]["code"] == "platform_not_allowed"


# --- critère 8 : aucune réponse ne porte de secret ------------------------------------------

def test_no_route_returns_a_secret(client, fake):
    space("nordis", [point(fake)])
    fake.state.expires_in = 0
    login(client)
    fake.state.expires_in = 3600
    base = "/api/workspaces/nordis/connections"
    client.get(base)
    client.get(f"{base}/dbx-fr/status")
    client.post(f"{base}/dbx-fr/test")
    client.put(f"{base}/dbx-fr/token", json={"token": "dapi-perso-9"})
    client.get(base)
    client.get(f"{base}/dbx-fr/status")
    client.post(f"{base}/dbx-fr/test")
    client.delete(f"{base}/dbx-fr/token")
    client.post(f"{base}/dbx-fr/authorize")
    assert len(client.bodies) >= 10
    for body in client.bodies:
        assert not secrets_in(body), body
        assert "access_token" not in body and "refresh_token" not in body


def test_credential_repr_hides_tokens():
    shown = repr(Credential("oauth", "at-secret-1", "rt-secret-1", 1.0))
    assert not secrets_in(shown)


# --- coffre ---------------------------------------------------------------------------------

def test_without_a_system_keyring_nothing_is_stored(monkeypatch):
    monkeypatch.delenv("ATLAS_VAULT", raising=False)
    monkeypatch.setattr(sys, "platform", "linux")  # Secret Service absent sur ce poste
    with pytest.raises(RepoError) as error:
        system_keyring()
    assert error.value.code == "vault_unavailable"


def test_vault_lists_only_this_space(env):
    vault = Vault()
    vault.put("nordis", "dbx-fr", Credential("pat", "dapi-perso-1"))
    vault.put("autre-client", "dbx-fr", Credential("pat", "dapi-perso-2"))
    assert list(vault.list_my_connections("nordis", ["dbx-fr", "dbx-de"])) == ["dbx-fr"]
    with pytest.raises(RepoError):
        vault.get("../x", "dbx-fr")
