"""Connecteur Snowflake (plan 0018) : SSO et paire de clés contre un faux Snowflake local,
avec le vrai `snowflake-connector-python`. Le test réel est marqué `snowflake`."""

import os
import time
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fake_snowflake import FakeSnowflake
from test_connections import client, env, space

from skifer_atlas import connections
from skifer_atlas.connectors import logins
from skifer_atlas.connectors import snowflake as connector
from skifer_atlas.connectors.access_points import AccessPoint
from skifer_atlas.connectors.base import AuthRejected
from skifer_atlas.repo.git import RepoError
from skifer_atlas.vault import SERVICE, Credential, Vault, keyring_vault

__all__ = ["client", "env"]  # fixtures importées

PASSPHRASE = "pass-secrete-42"
CONNECTIONS = "/api/workspaces/nordis/connections"


@pytest.fixture
def snow(env, tmp_path, monkeypatch):
    """Faux Snowflake ; le navigateur du SSO n'est pas ouvert, le faux fournisseur
    d'identité rappelle lui-même le connecteur."""
    monkeypatch.setenv("SF_TEST_BROWSER_OPENER", "noop")
    monkeypatch.setattr(connector, "POLL_SECONDS", 0.01)
    server = FakeSnowflake()
    server.add_sso_user("anna@nordis.example")
    yield server
    for live in list(connector.LIVE.values()):
        connector.close_quietly(live)
    connector.LIVE.clear()
    server.close()


def key_file(folder: Path, user: str | None = None, server: FakeSnowflake | None = None,
             passphrase: str | None = PASSPHRASE) -> Path:
    """Clé privée RSA dans un fichier PEM ; sa clé publique déclarée chez `server`."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    encryption = (serialization.BestAvailableEncryption(passphrase.encode()) if passphrase
                  else serialization.NoEncryption())
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "rsa_key.p8"
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM,
                                       serialization.PrivateFormat.PKCS8, encryption))
    if server is not None:
        server.add_key_user(user, key.public_key())
    return path


def snow_point(server, ap="snow-de", auth="sso", **extra):
    return {"id": ap, "platform": "snowflake", "host": server.url, "account": "nordis-de",
            "warehouse": "WH_FINANCE", "schema": "FIN_GOLD.PUBLIC", "role": "ANALYSTE",
            "auth": auth, "entity": "nordis-de", "owner": "anna.k", **extra}


def wait_flow(key=("nordis", "snow-de")):
    flow = connector.SSO_FLOWS.last(key)
    deadline = time.time() + 20
    while flow.status == "pending" and time.time() < deadline:
        time.sleep(0.02)
    return flow


def sso_login(client, ap="snow-de", user="anna@nordis.example"):
    response = client.post(f"{CONNECTIONS}/{ap}/authorize", json={"user": user})
    assert response.status_code == 200, response.text
    assert response.json() == {"authorize_url": None}  # le connecteur ouvre le navigateur
    flow = wait_flow(("nordis", ap))
    assert flow.status == "connected", flow.error


def files_containing(root: Path, needle: str) -> list[Path]:
    return [p for p in root.rglob("*") if p.is_file()
            and needle in p.read_bytes().decode("utf-8", "replace")]


# --- unitaires : point d'accès, paramètres de connexion, clé, erreurs -----------------------

def test_access_point_fields_by_platform():
    base = {"id": "snow-de", "platform": "snowflake", "owner": "anna.k"}
    point = AccessPoint.model_validate({**base, "host": "https://xy12345.eu-west-1.snowflakecomputing.com",
                                        "warehouse": "WH", "schema": "FIN.PUBLIC"})
    assert (point.snowflake_account(), point.auth_mode, point.warehouse_name) == (
        "xy12345.eu-west-1", "sso", "WH")
    assert point.public()["warehouse"] == "WH"
    loopback = {**base, "host": "http://127.0.0.1:9"}
    for refused in (loopback, {**base, "host": "https://nordis.snowflakecomputing.com",
                               "warehouse_id": "abc"},
                    {**base, "host": "https://nordis.snowflakecomputing.com", "auth": "oauth"}):
        with pytest.raises(ValueError):
            AccessPoint.model_validate(refused)
    assert AccessPoint.model_validate({**loopback, "account": "nordis"}).snowflake_account() == (
        "nordis")
    with pytest.raises(ValueError, match="warehouse"):
        AccessPoint.model_validate({"id": "dbx-fr", "platform": "databricks", "owner": "c",
                                    "host": "https://adb-1.azuredatabricks.net",
                                    "warehouse_id": "abc", "warehouse": "WH"})


def test_connection_params_never_cache_tokens():
    point = AccessPoint.model_validate({
        "id": "snow-de", "platform": "snowflake", "owner": "anna.k",
        "host": "https://nordis-de.snowflakecomputing.com", "warehouse": "WH_FINANCE",
        "schema": "FIN_GOLD.PUBLIC", "role": "ANALYSTE"})
    sso = connector.connection_params(point, "anna@nordis.example")
    assert {k: sso[k] for k in ("account", "user", "host", "warehouse", "database", "schema",
                                "role", "authenticator", "server_session_keep_alive")} == {
        "account": "nordis-de", "user": "anna@nordis.example",
        "host": "nordis-de.snowflakecomputing.com", "warehouse": "WH_FINANCE",
        "database": "FIN_GOLD", "schema": "PUBLIC", "role": "ANALYSTE",
        "authenticator": "EXTERNALBROWSER", "server_session_keep_alive": True}
    assert "port" not in sso and "protocol" not in sso
    keyed = connector.connection_params(point, "SVC", private_key=b"der")
    assert (keyed["authenticator"], keyed["private_key"]) == ("SNOWFLAKE_JWT", b"der")
    session = connector.connection_params(point, "anna", session=("st", "mt"), keep_alive=False)
    assert (session["session_token"], session["master_token"],
            session["server_session_keep_alive"]) == ("st", "mt", False)
    assert "authenticator" not in session
    for params in (sso, keyed, session):
        assert params["client_store_temporary_credential"] is False  # critère 6
        assert params["crl_enable_disk_caching"] is False
    local = AccessPoint.model_validate({"id": "snow-x", "platform": "snowflake", "owner": "a",
                                        "host": "http://127.0.0.1:8794", "account": "nordis"})
    params = connector.connection_params(local, "anna")
    assert (params["host"], params["port"], params["protocol"]) == ("127.0.0.1", 8794, "http")
    assert "warehouse" in params and params["warehouse"] is None


def test_private_key_is_read_and_decrypted_in_memory(tmp_path):
    path = key_file(tmp_path / "cles")
    der = connector.load_private_key(str(path), PASSPHRASE)
    assert serialization.load_der_private_key(der, password=None).key_size == 2048

    def code(path, passphrase):
        with pytest.raises(RepoError) as error:
            connector.load_private_key(str(path), passphrase)
        return error.value.code

    assert code(path, None) == "passphrase_required"
    assert code(path, "mauvaise") == "wrong_passphrase"
    assert code(tmp_path / "absente.p8", None) == "key_file_unreadable"
    clear = key_file(tmp_path / "claire", passphrase=None)
    assert code(clear, "inutile") == "passphrase_unexpected"
    elliptic = tmp_path / "ec.pem"
    elliptic.write_bytes(ec.generate_private_key(ec.SECP256R1()).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption()))
    assert code(elliptic, None) == "invalid_key_file"
    garbage = tmp_path / "texte.p8"
    garbage.write_text("pas une clé")
    assert code(garbage, None) == "invalid_key_file"


def test_errors_are_translated():
    from snowflake.connector import errors

    assert isinstance(connector.translate(errors.DatabaseError(msg="expirée", errno=390112)),
                      AuthRejected)
    guard = connector.translate(errors.ProgrammingError(
        msg="Numeric value 'atlas: cardinalité N:1 non respectée en n07, clés en double à "
            "droite : 3' is not recognized", errno=100038))
    assert (guard.code, guard.message) == (
        "query_failed", "atlas: cardinalité N:1 non respectée en n07, clés en double à droite : 3")
    missing = connector.translate(errors.ProgrammingError(
        msg="Object 'X' does not exist or not authorized.", errno=2003))
    assert missing.code == "platform_not_found"
    down = connector.translate(errors.OperationalError(msg="login timed out", errno=14))
    assert down.code == "host_unreachable"


# --- critère 2 : paire de clés, passphrase au coffre seulement -------------------------------

def test_key_pair_with_passphrase_only_in_the_vault(client, snow, env, tmp_path, capfd, caplog):
    space("nordis", [snow_point(snow, auth="keypair")])
    path = key_file(tmp_path / "cles", "svc_atlas", snow)
    listed = client.get(CONNECTIONS).json()[0]
    assert (listed["supported"], listed["auth_mode"], listed["my_access"]) == (
        True, "keypair", "never")
    response = client.put(f"{CONNECTIONS}/snow-de/key-pair", json={
        "user": "svc_atlas", "private_key_file": str(path), "passphrase": PASSPHRASE})
    assert response.status_code == 200, response.text
    assert {k: response.json()[k] for k in ("my_access", "auth", "login", "private_key_file")} == {
        "my_access": "connected", "auth": "keypair", "login": "svc_atlas",
        "private_key_file": str(path)}

    tested = client.post(f"{CONNECTIONS}/snow-de/test").json()
    assert tested["ok"] is True, tested
    assert snow.state.logins[-1]["AUTHENTICATOR"] == "SNOWFLAKE_JWT"
    result = connections.run_aggregate("nordis", "snow-de", "SELECT 2 AS deux, 'a' AS lettre")
    assert (result.columns, result.rows) == (["DEUX", "LETTRE"], [(2, "a")])

    stored = keyring_vault._memory.get_password(SERVICE, "nordis/snow-de")
    assert PASSPHRASE in stored and "PRIVATE KEY" not in stored
    assert logins.get("nordis", "snow-de") == logins.Login("svc_atlas", str(path))
    assert files_containing(env, PASSPHRASE) == []  # ni registre local, ni clone, ni index
    assert files_containing(env, "PRIVATE KEY") == []  # la clé n'est pas copiée
    assert not any(PASSPHRASE in body for body in client.bodies)
    captured = capfd.readouterr()
    assert PASSPHRASE not in captured.out + captured.err + caplog.text


def test_key_pair_is_checked_before_anything_is_stored(client, snow, tmp_path):
    space("nordis", [snow_point(snow, auth="keypair"), snow_point(snow, "snow-es")])
    path = key_file(tmp_path / "cles", "svc_atlas", snow)

    def code(ap="snow-de", **body):
        payload = {"user": "svc_atlas", "private_key_file": str(path), **body}
        response = client.put(f"{CONNECTIONS}/{ap}/key-pair", json=payload)
        return response.status_code, response.json()["detail"]["code"]

    assert code(passphrase="mauvaise") == (422, "wrong_passphrase")
    assert code() == (422, "passphrase_required")
    assert code(private_key_file="cles/rsa_key.p8", passphrase=PASSPHRASE) == (
        422, "key_file_unreadable")
    assert code(user="deux mots", passphrase=PASSPHRASE) == (422, "invalid_login")
    assert code("snow-es", passphrase=PASSPHRASE) == (422, "wrong_auth_mode")  # point SSO
    assert keyring_vault._memory.usernames(SERVICE) == []
    assert logins.get("nordis", "snow-de") is None


def test_key_pair_refused_by_snowflake_marks_the_access_expired(client, snow, tmp_path):
    space("nordis", [snow_point(snow, auth="keypair")])
    path = key_file(tmp_path / "cles")  # clé publique jamais déclarée chez Snowflake
    client.put(f"{CONNECTIONS}/snow-de/key-pair", json={
        "user": "svc_atlas", "private_key_file": str(path), "passphrase": PASSPHRASE})
    tested = client.post(f"{CONNECTIONS}/snow-de/test").json()
    assert (tested["ok"], tested["error"]["code"]) == (False, "access_expired")
    assert client.get(f"{CONNECTIONS}/snow-de/status").json()["my_access"] == "expired"
    path.unlink()
    with pytest.raises(RepoError) as error:
        connections.run_aggregate("nordis", "snow-de", "SELECT 1")
    assert error.value.code == "access_expired"


# --- critères 1 (simulé) et 6 : SSO, jetons au coffre, aucun cache ---------------------------

def test_sso_stores_the_session_in_the_vault_and_no_token_cache(client, snow, env, tmp_path,
                                                                monkeypatch):
    home = tmp_path / "maison"
    for name, folder in (("HOME", home), ("XDG_CACHE_HOME", home / ".cache"),
                         ("SF_TEMPORARY_CREDENTIAL_CACHE_DIR", home / "sf")):
        folder.mkdir(parents=True, exist_ok=True)
        monkeypatch.setenv(name, str(folder))
    space("nordis", [snow_point(snow)])
    assert client.post(f"{CONNECTIONS}/snow-de/authorize", json={}).json()["detail"][
        "code"] == "invalid_login"
    sso_login(client)

    login = snow.state.logins[-1]
    assert (login["AUTHENTICATOR"], login["LOGIN_NAME"]) == ("EXTERNALBROWSER",
                                                             "anna@nordis.example")
    assert "CLIENT_STORE_TEMPORARY_CREDENTIAL" not in login.get("SESSION_PARAMETERS", {})
    credential = Vault().get("nordis", "snow-de")
    assert credential.kind == "sso" and credential.access_token.startswith("sf-session-")
    assert credential.refresh_token.startswith("sf-master-") and credential.expires_at
    status = client.get(f"{CONNECTIONS}/snow-de/status").json()
    assert (status["my_access"], status["auth"], status["login"], status["flow"]["status"]) == (
        "connected", "sso", "anna@nordis.example", "connected")

    # Reconnexion par les jetons du coffre, sans navigateur ni nouvelle authentification.
    assert client.post(f"{CONNECTIONS}/snow-de/test").json()["ok"] is True
    assert snow.state.sso_requests == 1 and len(snow.state.logins) == 1
    assert not snow.state.logged_out  # la session survit à la fermeture des connexions

    # Critère 6 : aucun fichier sous le dossier personnel, aucun jeton hors du coffre.
    assert [p for p in home.rglob("*") if p.is_file()] == []
    assert files_containing(env, "sf-session-") == []
    assert files_containing(env, "sf-master-") == []
    assert not any("sf-session-" in body or "sf-master-" in body for body in client.bodies)
    # Pas de second SSO avec l'identifiant retenu : il sert à la reconnexion.
    assert logins.get("nordis", "snow-de") == logins.Login("anna@nordis.example")


def test_sso_session_expiry_then_revocation(client, snow):
    space("nordis", [snow_point(snow)])
    sso_login(client)
    snow.expire_sessions()
    tested = client.post(f"{CONNECTIONS}/snow-de/test").json()
    assert (tested["ok"], tested["error"]["code"]) == (False, "access_expired")
    assert client.get(f"{CONNECTIONS}/snow-de/status").json()["my_access"] == "expired"

    sso_login(client, user="ANNA@nordis.example")  # se reconnecter
    revoked = client.delete(f"{CONNECTIONS}/snow-de/token").json()
    assert revoked == {"revoked": True, "remote_revoked": True}
    assert snow.state.logged_out == ["ANNA@NORDIS.EXAMPLE"]
    assert keyring_vault._memory.usernames(SERVICE) == []
    assert logins.get("nordis", "snow-de") is None
    assert client.get(f"{CONNECTIONS}/snow-de/status").json()["my_access"] == "never"


def test_sso_refused_by_the_identity_provider(client, snow):
    space("nordis", [snow_point(snow)])
    client.post(f"{CONNECTIONS}/snow-de/authorize", json={"user": "inconnu@nordis.example"})
    flow = wait_flow()
    assert flow.status == "failed" and "fournisseur d'identité" in flow.error
    status = client.get(f"{CONNECTIONS}/snow-de/status").json()
    assert (status["my_access"], status["flow"]["status"]) == ("never", "failed")


def test_sso_session_only_in_memory_when_tokens_are_not_exported(client, snow, monkeypatch):
    """Sans jetons exportables, la session ne vit que dans ce processus."""
    monkeypatch.setattr(connector, "session_tokens", lambda connection: None)
    space("nordis", [snow_point(snow)])
    sso_login(client)
    credential = Vault().get("nordis", "snow-de")
    assert (credential.kind, credential.access_token) == ("sso", "")
    assert client.post(f"{CONNECTIONS}/snow-de/test").json()["ok"] is True
    assert client.post(f"{CONNECTIONS}/snow-de/test").json()["ok"] is True
    connector.close_quietly(connector.LIVE.pop(("nordis", "snow-de")))  # Atlas redémarre
    assert client.get(f"{CONNECTIONS}/snow-de/status").json()["my_access"] == "expired"
    tested = client.post(f"{CONNECTIONS}/snow-de/test").json()
    assert tested["error"]["code"] == "access_expired"


def test_draft_snowflake_point_connects_before_being_proposed(client, snow, tmp_path):
    space("nordis", [])
    draft = snow_point(snow, "snow-es", auth="keypair", entity="nordis-es")
    path = key_file(tmp_path / "cles", "svc_es", snow)
    response = client.put("/api/workspaces/nordis/access-point-draft/key-pair", json={
        "access_point": draft, "user": "svc_es", "private_key_file": str(path),
        "passphrase": PASSPHRASE})
    assert response.status_code == 200, response.text
    tested = client.post("/api/workspaces/nordis/access-point-draft/test",
                         json={"access_point": draft}).json()
    assert tested["ok"] is True, tested

    sso = snow_point(snow, "snow-de")
    client.post("/api/workspaces/nordis/access-point-draft/authorize",
                json={"access_point": sso, "user": "anna@nordis.example"})
    assert wait_flow().status == "connected"
    status = client.post("/api/workspaces/nordis/access-point-draft/status",
                         json={"access_point": sso}).json()
    assert (status["my_access"], status["auth"]) == ("connected", "sso")


# --- exécution agrégée bornée ----------------------------------------------------------------

def test_aggregate_execution_is_bounded(client, snow, tmp_path):
    space("nordis", [snow_point(snow, auth="keypair")])
    path = key_file(tmp_path / "cles", "svc_atlas", snow)
    connections.store_key_pair("nordis", "snow-de", "svc_atlas", str(path), PASSPHRASE)

    def code(sql, **kwargs):
        with pytest.raises(RepoError) as error:
            connections.run_aggregate("nordis", "snow-de", sql, **kwargs)
        return error.value.code, error.value.message

    assert code("SELECT * FROM range(20)", max_rows=10)[0] == "result_too_large"
    assert code("SELECT pg_sleep", timeout=0.2)[0] == "query_timeout"
    assert len(snow.state.aborted) == 1  # la requête est arrêtée côté Snowflake
    import threading

    stop = threading.Event()
    stop.set()
    assert code("SELECT pg_sleep", cancel=stop)[0] == "query_canceled"
    assert len(snow.state.aborted) == 2
    assert code("SELECT * FROM table_absente")[0] == "query_failed"
    failed = code("SELECT CAST('atlas: dates hors du calendrier : 2' AS INT)")
    assert failed == ("query_failed", "atlas: dates hors du calendrier : 2")


# --- critère 1 : compte réel ---------------------------------------------------------------

@pytest.mark.snowflake
def test_real_account(env):
    """Hors CI : ATLAS_SNOWFLAKE_HOST (https://<compte>.snowflakecomputing.com),
    ATLAS_SNOWFLAKE_USER, ATLAS_SNOWFLAKE_WAREHOUSE, et soit ATLAS_SNOWFLAKE_KEY_FILE (avec
    ATLAS_SNOWFLAKE_PASSPHRASE si elle est chiffrée), soit rien de plus pour le SSO, qui
    ouvre le navigateur."""
    host = os.environ.get("ATLAS_SNOWFLAKE_HOST")
    user = os.environ.get("ATLAS_SNOWFLAKE_USER")
    warehouse = os.environ.get("ATLAS_SNOWFLAKE_WAREHOUSE")
    key = os.environ.get("ATLAS_SNOWFLAKE_KEY_FILE")
    if not (host and user and warehouse):
        pytest.skip("Snowflake réel non configuré")
    point = {"id": "snow", "platform": "snowflake", "host": host, "warehouse": warehouse,
             "owner": "test", "auth": "keypair" if key else "sso"}
    space("reel", [point])
    if key:
        connections.store_key_pair("reel", "snow", user, key,
                                   os.environ.get("ATLAS_SNOWFLAKE_PASSPHRASE"))
    else:
        connections.authorize("reel", "snow", user=user)
        flow = connector.SSO_FLOWS.last(("reel", "snow"))
        assert flow.done.wait(connector.SSO_SECONDS) and flow.status == "connected", flow.error
        assert Credential.from_json(Vault().backend.get_password(SERVICE, "reel/snow"))
    assert connections.check_connection("reel", "snow")["ok"]
    result = connections.run_aggregate(
        "reel", "snow", "SELECT COUNT(*) AS n, 'a' AS lettre FROM (SELECT 1 UNION ALL SELECT 2)")
    assert result.rows == [(2, "a")]
