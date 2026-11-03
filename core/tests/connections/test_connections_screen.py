"""Écran Mes connexions (plan 0016) : plateformes du panneau, point d'accès en brouillon
(se connecter et tester avant de le proposer), propriétaire nommé, plateformes prises en
charge."""

import time
import urllib.request
from unittest.mock import Mock

import pytest
from fake_databricks import FakeDatabricks
from test_connections import client, env, fake, point, secrets_in, space

from skifer_atlas import connections
from skifer_atlas.connectors import drafts, oauth
from skifer_atlas.connectors.snowflake import LIVE
from skifer_atlas.repo.git import RepoError
from skifer_atlas.vault import SERVICE, Credential, Vault, keyring_vault
from skifer_atlas.workspaces import repo_dir

__all__ = ["client", "env", "fake"]  # fixtures importées

DRAFT = "/api/workspaces/nordis/access-point-draft"


def test_platforms_are_the_allowed_ones_with_support(client, fake):
    space("nordis", [point(fake)])
    assert client.get("/api/workspaces/nordis/connections/platforms").json() == [
        {"id": "databricks", "label": "Databricks", "supported": True},
        {"id": "snowflake", "label": "Snowflake", "supported": True}]
    governance = repo_dir("nordis") / "governance.yaml"
    governance.write_text(governance.read_text(encoding="utf-8").replace(
        "allowed_platforms: [databricks, snowflake]", "allowed_platforms: [databricks]"),
        encoding="utf-8")
    assert [p["id"] for p in client.get("/api/workspaces/nordis/connections/platforms").json()] == [
        "databricks"]


def test_list_names_the_owner_and_says_what_atlas_supports(client, fake):
    snowflake = {"id": "snow-de", "platform": "snowflake", "host": "https://nordis.snowflakecomputing.com",
                 "schema": "FIN_GOLD.PUBLIC", "entity": "nordis-de", "owner": "anna.k"}
    space("nordis", [point(fake), snowflake])
    listed = {c["access_point"]: c for c in client.get("/api/workspaces/nordis/connections").json()}
    assert (listed["dbx-fr"]["owner_name"], listed["dbx-fr"]["supported"]) == ("Claire M.", True)
    assert (listed["snow-de"]["owner_name"], listed["snow-de"]["supported"]) == ("Anna K.", True)
    assert (listed["dbx-fr"]["auth_mode"], listed["snow-de"]["auth_mode"]) == ("oauth", "sso")


def test_draft_access_point_connects_and_tests_before_being_proposed(client, fake):
    space("nordis", [])
    draft = point(fake, "dbx-de", entity="nordis-de")
    status = client.post(f"{DRAFT}/status", json={"access_point": draft}).json()
    assert (status["my_access"], status["flow"]) == ("never", None)
    assert client.post(f"{DRAFT}/test", json={"access_point": draft}).json()["error"]["code"] == (
        "not_connected")

    response = client.post(f"{DRAFT}/authorize", json={"access_point": draft})
    assert response.status_code == 200, response.text
    with urllib.request.urlopen(response.json()["authorize_url"], timeout=10) as page:
        assert "Connexion réussie" in page.read().decode()
    flow = oauth.FLOWS.last(("nordis", "dbx-de"))
    deadline = time.time() + 5
    while flow.status == "pending" and time.time() < deadline:
        time.sleep(0.01)
    status = client.post(f"{DRAFT}/status", json={"access_point": draft}).json()
    assert (status["my_access"], status["flow"]["status"]) == ("connected", "connected")
    assert client.post(f"{DRAFT}/test", json={"access_point": draft}).json()["ok"] is True
    # Le jeton est rangé sous l'identifiant : il sert dès que le point est déclaré.
    assert keyring_vault._memory.usernames(SERVICE) == ["nordis/dbx-de"]
    assert not (repo_dir("nordis") / "access_points.yaml").read_text().count("dbx-de")
    assert client.get(f"{DRAFT}/credentials").json() == [
        {"id": "dbx-de", "host": draft["host"]}]
    removed = client.delete(f"{DRAFT}/credentials/dbx-de")
    assert removed.json() == {"removed": True}
    assert client.get(f"{DRAFT}/credentials").json() == []
    assert keyring_vault._memory.usernames(SERVICE) == []
    for body in client.bodies:
        assert not secrets_in(body), body


def test_a_draft_token_is_not_sent_to_another_host(client, fake):
    """#33 : le même identifiant de brouillon sur un autre hôte ne réutilise pas son jeton."""
    space("nordis", [])
    original = point(fake, "dbx-de", entity="nordis-de")
    response = client.post(f"{DRAFT}/authorize", json={"access_point": original})
    with urllib.request.urlopen(response.json()["authorize_url"], timeout=10) as page:
        assert page.status == 200
    flow = oauth.FLOWS.last(("nordis", "dbx-de"))
    deadline = time.time() + 5
    while flow.status == "pending" and time.time() < deadline:
        time.sleep(0.01)
    assert flow.status == "connected"

    other = FakeDatabricks()
    try:
        changed = {**original, "host": other.url}
        status = client.post(f"{DRAFT}/status", json={"access_point": changed}).json()
        assert (status["my_access"], status["error"]["code"]) == (
            "expired", "access_host_mismatch")
        tested = client.post(f"{DRAFT}/test", json={"access_point": changed}).json()
        assert (tested["ok"], tested["error"]["code"]) == (
            False, "access_host_mismatch")
        assert other.state.seen_sql == []
        assert other.state.token_requests == []
    finally:
        other.close()


def test_draft_is_validated_like_a_declaration(client, fake):
    space("nordis", [point(fake)])

    def code(body):
        return client.post(f"{DRAFT}/status", json={"access_point": body}).json()["detail"]["code"]

    assert code(point(fake, "dbx-fr")) == "access_point_exists"
    assert code({**point(fake, "dbx-de"), "warehouse_id": None}) == "invalid_access_point"
    assert code({**point(fake, "dbx-de"), "host": "http://example.com"}) == "invalid_access_point"
    assert code({**point(fake, "bq-de"), "platform": "bigquery"}) == "platform_not_allowed"
    response = client.post(f"{DRAFT}/authorize", json={"access_point": {
        "id": "snow-de", "platform": "snowflake", "host": "https://x.snowflakecomputing.com",
        "owner": "anna.k", "warehouse_id": "abc"}})
    assert response.json()["detail"]["code"] == "invalid_access_point"
    assert client.post(f"{DRAFT}/status", json={"access_point": point(fake, "dbx-de"),
                                                "other": 1}).status_code == 422


def test_a_draft_access_point_has_a_size_limit(client, fake):
    """#33 : un corps de brouillon démesuré est refusé avant toute connexion."""
    space("nordis", [])
    oversized = point(fake, "dbx-de", owner="x" * (16 * 1024))
    response = client.post(f"{DRAFT}/status", json={"access_point": oversized})
    assert response.status_code == 422
    assert "16 Kio" in response.text


def test_forgetting_a_draft_closes_its_live_sso_session(client):
    space("nordis", [])
    key = ("nordis", "snow-de")
    host = "https://nordis.snowflakecomputing.com"
    drafts.put(*key, host)
    Vault().put(*key, Credential("sso", "", host=host))
    connection = Mock()
    LIVE[key] = connection

    response = client.delete(f"{DRAFT}/credentials/snow-de")

    assert response.json() == {"removed": True}
    assert key not in LIVE
    connection.close.assert_called_once_with()
    assert drafts.get(*key) is None
    assert Vault().get(*key) is None


def test_forgetting_a_draft_invalidates_pending_sso_callback(client, monkeypatch):
    space("nordis", [])
    key = ("nordis", "snow-de")
    host = "https://nordis.snowflakecomputing.com"
    drafts.put(*key, host)
    Vault().put(*key, Credential("sso", "", host=host))
    captured = {}

    def start(_key, _point, _user, on_success):
        captured["on_success"] = on_success

    monkeypatch.setattr(connections.SSO_FLOWS, "start", start)
    draft = {"id": key[1], "platform": "snowflake", "host": host,
             "schema": "FIN_GOLD.PUBLIC", "entity": "nordis-de", "owner": "anna.k"}
    response = client.post(f"{DRAFT}/authorize", json={"access_point": draft,
                                                        "user": "anna.k"})
    assert response.status_code == 200, response.text
    assert client.delete(f"{DRAFT}/credentials/snow-de").json() == {"removed": True}

    connection = Mock()
    connection._get_connection_info.side_effect = RuntimeError("sans jeton exportable")
    with pytest.raises(RepoError, match="oubliée"):
        captured["on_success"](connection)
    assert drafts.get(*key) is None
    assert Vault().get(*key) is None
    assert key not in LIVE

