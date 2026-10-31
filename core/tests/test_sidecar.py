"""Binaire figé (plans 0018 et 0019) : le sidecar construit par `scripts/build-sidecar.sh`.

- Test de fumée : /health, token exigé, `GET /api/_selftest` (modules chargés à la
  demande, extraction, compilation).
- Hors ligne : rejoindre le dépôt de démonstration local, lire le catalogue, compiler Revenu
  net ; sous macOS, réseau coupé par `sandbox-exec`.
- Arrêt avec l'app : le serveur s'arrête quand son parent disparaît, même si le chargeur
  PyInstaller a été tué.
- Snowflake : authentification (paire de clés et SSO) et exécution contre le faux compte.

Hors de la suite par défaut sans binaire : `uv run pytest -m sidecar` après la
construction, sur chaque plateforme en CI (.github/workflows/release.yml)."""

import json
import os
import shutil
import signal
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

from skifer_atlas import __version__

sys.path.insert(0, str(Path(__file__).parent / "connections"))
from fake_snowflake import FakeSnowflake
from test_connections import space

ROOT = Path(__file__).parents[2]
BINARIES = ROOT / "app" / "src-tauri" / "binaries"
ALERT_BYTES = 200 * 1024 * 1024
TOKEN = "jeton-de-session"
PASSPHRASE = "pass-sidecar"
# Réseau coupé sauf la boucle locale (critère 4) ; `sandbox-exec` n'existe que sous macOS.
OFFLINE = ("(version 1)(allow default)(deny network-outbound (remote ip \"*:*\"))"
           "(allow network-outbound (remote ip \"localhost:*\"))")

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


def listening(port: int) -> bool:
    with socket.socket() as probe:
        probe.settimeout(0.5)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def call(port, method, path, body=None, token=TOKEN):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", method=method, headers=headers,
        data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"null")


def isolated_env(home: Path, data: Path, port: int, **extra: str) -> dict[str, str]:
    """L'environnement du poste, avec un dossier personnel vide (critère 6 de 0018)."""
    env = {**os.environ, "HOME": str(home), "XDG_CACHE_HOME": str(home / ".cache"),
           "ATLAS_DATA_DIR": str(data), "ATLAS_VAULT": "memory", "ATLAS_PORT": str(port),
           "ATLAS_TOKEN": TOKEN, "ATLAS_LOG_LEVEL": "warning", "SF_TEST_BROWSER_OPENER": "noop",
           **extra}
    if sys.platform == "win32":
        env.update(USERPROFILE=str(home), APPDATA=str(home / "AppData" / "Roaming"),
                   LOCALAPPDATA=str(home / "AppData" / "Local"))
    for key in ("ATLAS_DEV_NO_TOKEN", "ATLAS_PARENT_PID", "VIRTUAL_ENV", "PYTHONPATH"):
        if key not in extra:
            env.pop(key, None)
    return env


def launch(env: dict[str, str], sandbox: str | None = None) -> subprocess.Popen:
    command = [str(binary())]
    if sandbox:
        command = ["sandbox-exec", "-p", sandbox, *command]
    process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT)
    port = int(env["ATLAS_PORT"])
    started = time.time()
    while time.time() - started < 60:  # premier lancement : décompression du binaire
        try:
            if call(port, "GET", "/health")[0] == 200:
                process.startup_seconds = time.time() - started
                return process
        except OSError:
            time.sleep(0.1)
        if process.poll() is not None:
            break
    process.kill()
    pytest.fail(process.stdout.read().decode(errors="replace"))


def stop(process: subprocess.Popen) -> None:
    process.terminate()
    try:
        process.wait(10)
    except subprocess.TimeoutExpired:
        process.kill()


@pytest.fixture
def folders(tmp_path):
    home, data = tmp_path / "home", tmp_path / "donnees"
    home.mkdir()
    return home, data


# --- test de fumée (critère 2 de 0019) ------------------------------------------------------

def test_frozen_binary_smoke(folders):
    home, data = folders
    port = free_port()
    process = launch(isolated_env(home, data, port))
    try:
        print(f"\nDémarrage du binaire : {process.startup_seconds:.1f} s ; "
              f"taille : {binary().stat().st_size / 1024 / 1024:.1f} Mo")
        assert binary().stat().st_size < ALERT_BYTES, "seuil d'alerte de 200 Mo dépassé"
        status, health = call(port, "GET", "/health", token=None)
        assert (status, health) == (200, {"status": "ok", "version": __version__})
        assert call(port, "GET", "/api/workspaces", token=None)[0] == 401
        assert call(port, "GET", "/api/_selftest", token=None)[0] == 401
        status, found = call(port, "GET", "/api/_selftest")
        assert status == 200 and found["ok"] is True, found
        assert found["frozen"] is True and found["version"] == __version__
    finally:
        stop(process)


def test_frozen_binary_refuses_to_start_without_token(folders):
    home, data = folders
    env = isolated_env(home, data, free_port())
    env.pop("ATLAS_TOKEN")
    result = subprocess.run([str(binary())], env=env, capture_output=True, text=True,
                            timeout=60, check=False)
    assert result.returncode == 2
    assert "ATLAS_TOKEN est vide" in result.stderr


# --- hors ligne (critère 4 de 0019) ---------------------------------------------------------

def test_frozen_binary_works_offline(folders, tmp_path):
    """Espace local (le dépôt de démonstration, en dépôt nu sur le disque), catalogue,
    compilation du graphe de Revenu net vers Databricks et Snowflake."""
    if shutil.which("bash") is None:
        pytest.skip("bash requis pour examples/depot-nordis.sh")
    subprocess.run(["bash", str(ROOT / "examples" / "depot-nordis.sh"), str(tmp_path / "demo")],
                   check=True, capture_output=True)
    home, data = folders
    port = free_port()
    sandbox = OFFLINE if sys.platform == "darwin" and shutil.which("sandbox-exec") else None
    process = launch(isolated_env(home, data, port, ATLAS_ACCOUNT="anna.k"), sandbox)
    try:
        remote = (tmp_path / "demo" / "distant.git").as_posix()
        status, joined = call(port, "POST", "/api/workspaces/join", {"remote_url": remote})
        assert status == 201, joined
        ws = "/api/workspaces/groupe-nordis"
        rows = call(port, "GET", f"{ws}/catalog")[1]
        assert "revenu-net" in [row["id"] for row in rows]
        opened = call(port, "GET", f"{ws}/editor/documents/revenu-net")[1]
        status, checked = call(port, "POST", f"{ws}/editor/check",
                               {"document": opened["document"]})
        assert status == 200, checked
        compiled = checked["status"]["compilable"]
        assert (compiled["databricks"]["status"], compiled["snowflake"]["status"]) == ("ok", "ok")
        assert "RAISE_ERROR" in compiled["databricks"]["sql"]  # garde de cardinalité n07
        assert "AS INT)" in compiled["snowflake"]["sql"]
    finally:
        stop(process)


# --- arrêt avec l'app (critère 3 de 0019) ---------------------------------------------------

def test_frozen_binary_stops_when_the_app_disappears(folders):
    """Comme Tauri : l'app lance le binaire avec son identifiant de processus. Le chargeur
    PyInstaller est tué net (ce que fait Tauri à la fermeture), puis l'app disparaît sans
    fermeture propre : l'interpréteur ne doit pas rester à servir le port."""
    app = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
    home, data = folders
    port = free_port()
    process = launch(isolated_env(home, data, port, ATLAS_PARENT_PID=str(app.pid)))
    try:
        if sys.platform != "win32":
            process.send_signal(signal.SIGKILL)
        else:
            process.kill()
        process.wait(10)
        app.kill()
        app.wait()
        deadline = time.time() + 10
        while listening(port) and time.time() < deadline:
            time.sleep(0.2)
        assert not listening(port), "serveur orphelin après la disparition de l'app"
    finally:
        app.kill()
        process.kill()


# --- Snowflake (critère 5 de 0018) ----------------------------------------------------------

@pytest.fixture
def snowflake_server(folders, tmp_path, monkeypatch):
    fake = FakeSnowflake()
    home, data = folders
    monkeypatch.setenv("ATLAS_DATA_DIR", str(data))
    snow = {"platform": "snowflake", "host": fake.url, "account": "nordis-de",
            "warehouse": "WH_FINANCE", "entity": "nordis-de", "owner": "anna.k"}
    space("nordis", [{"id": "snow-key", "auth": "keypair", **snow},
                     {"id": "snow-sso", "auth": "sso", **snow}])
    port = free_port()
    process = launch(isolated_env(home, data, port))
    yield port, fake, tmp_path, home
    stop(process)
    fake.close()


def test_frozen_binary_authenticates_and_runs(snowflake_server):
    port, fake, tmp_path, home = snowflake_server
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
    # Critère 6 de 0018 aussi dans le binaire : rien d'écrit sous le dossier personnel.
    assert not [p for p in home.rglob("*") if p.is_file()]
