"""Binaire figé (plan 0018, critère 5) : le sidecar construit par `scripts/build-sidecar.sh`
s'authentifie sur Snowflake (paire de clés et SSO) et exécute, contre le faux compte
local. Hors CI : `uv run pytest -m sidecar` après la construction."""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

sys.path.insert(0, str(Path(__file__).parent / "connections"))
from fake_snowflake import FakeSnowflake
from test_connections import space

BINARIES = Path(__file__).parents[2] / "app" / "src-tauri" / "binaries"
ALERT_BYTES = 200 * 1024 * 1024
TOKEN = "jeton-de-session"
PASSPHRASE = "pass-sidecar"

pytestmark = pytest.mark.sidecar


def binary() -> Path:
    found = sorted(BINARIES.glob("skifer-atlas-server-*"))
    if not found:
        pytest.skip("binaire absent : lancer scripts/build-sidecar.sh")
    return found[0]


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def call(port, method, path, body=None):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"null")


@pytest.fixture
def server(tmp_path, monkeypatch):
    fake = FakeSnowflake()
    data, home = tmp_path / "donnees", tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("ATLAS_DATA_DIR", str(data))
    snow = {"platform": "snowflake", "host": fake.url, "account": "nordis-de",
            "warehouse": "WH_FINANCE", "entity": "nordis-de", "owner": "anna.k"}
    space("nordis", [{"id": "snow-key", "auth": "keypair", **snow},
                     {"id": "snow-sso", "auth": "sso", **snow}])
    port = free_port()
    env = {"PATH": os.environ["PATH"], "HOME": str(home), "XDG_CACHE_HOME": str(home / ".cache"),
           "ATLAS_DATA_DIR": str(data), "ATLAS_VAULT": "memory", "ATLAS_PORT": str(port),
           "ATLAS_TOKEN": TOKEN, "ATLAS_LOG_LEVEL": "warning", "SF_TEST_BROWSER_OPENER": "noop"}
    process = subprocess.Popen([str(binary())], env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT)
    deadline = time.time() + 60  # premier lancement : décompression du binaire
    while time.time() < deadline:
        try:
            if call(port, "GET", "/health")[0] == 200:
                break
        except OSError:
            time.sleep(0.2)
    else:
        process.kill()
        pytest.fail(process.stdout.read().decode(errors="replace"))
    yield port, fake, tmp_path, home
    process.terminate()
    process.wait(10)
    fake.close()


def test_frozen_binary_authenticates_and_runs(server):
    port, fake, tmp_path, home = server
    size = binary().stat().st_size
    print(f"\nTaille du binaire : {size / 1024 / 1024:.1f} Mo")
    assert size < ALERT_BYTES, "seuil d'alerte de 200 Mo dépassé"

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    fake.add_key_user("svc_de", key.public_key())
    path = tmp_path / "rsa_key.p8"
    path.write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.BestAvailableEncryption(PASSPHRASE.encode())))
    status, body = call(port, "PUT", "/api/workspaces/nordis/connections/snow-key/key-pair", {
        "user": "svc_de", "private_key_file": str(path), "passphrase": PASSPHRASE})
    assert status == 200, body
    status, body = call(port, "POST", "/api/workspaces/nordis/connections/snow-key/test")
    assert (status, body["ok"]) == (200, True), body

    fake.add_sso_user("anna@nordis.example")
    status, body = call(port, "POST", "/api/workspaces/nordis/connections/snow-sso/authorize",
                        {"user": "anna@nordis.example"})
    assert (status, body["authorize_url"]) == (200, None), body
    deadline = time.time() + 30
    while time.time() < deadline:
        found = call(port, "GET", "/api/workspaces/nordis/connections/snow-sso/status")[1]
        if found["flow"]["status"] != "pending":
            break
        time.sleep(0.1)
    assert found["my_access"] == "connected", found
    status, body = call(port, "POST", "/api/workspaces/nordis/connections/snow-sso/test")
    assert (status, body["ok"]) == (200, True), body
    assert fake.state.seen_sql.count("SELECT 1 AS ok") == 2
    # Critère 6 aussi dans le binaire : rien d'écrit sous le HOME du poste.
    assert not [p for p in home.rglob("*") if p.is_file()]
