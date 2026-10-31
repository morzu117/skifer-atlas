"""Écran Mes connexions (plan 0016) : plateformes du panneau, point d'accès en brouillon
(se connecter et tester avant de le proposer), propriétaire nommé, plateformes prises en
charge."""

import time
import urllib.request

from test_connections import client, env, fake, point, secrets_in, space

from skifer_atlas.connectors import oauth
from skifer_atlas.vault import SERVICE, keyring_vault
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
    for body in client.bodies:
        assert not secrets_in(body), body


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

