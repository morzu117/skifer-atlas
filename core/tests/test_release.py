"""Préparation du binaire et de la release (plan 0019), sans le binaire : version unique,
route de diagnostic, arrêt du serveur quand l'app disparaît."""

import importlib.util
import os
import subprocess
import sys
import threading
import time
import types
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from skifer_atlas import __version__, lifeline, selftest
from skifer_atlas.api.app import create_app

ROOT = Path(__file__).parents[2]


def version_script():
    spec = importlib.util.spec_from_file_location("version", ROOT / "scripts" / "version.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_one_version_for_app_sidecar_and_package():
    """Critère 6 : app (package.json, tauri.conf.json, Cargo), paquet Python et /health."""
    versions = version_script().found()
    assert set(versions.values()) == {__version__}, versions
    client = TestClient(create_app(token="t"))
    assert client.get("/health").json()["version"] == __version__


def test_version_bump_reaches_every_file(tmp_path, monkeypatch):
    script = version_script()
    for name in ("INIT", "PACKAGE", "LOCK", "CARGO", "CARGO_LOCK", "TAURI", "PYPROJECT"):
        source = getattr(script, name)
        copy = tmp_path / name / source.name
        copy.parent.mkdir()
        copy.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        monkeypatch.setattr(script, name, copy)
    script.bump("1.2.3")
    assert set(script.found().values()) == {"1.2.3"}
    assert script.check() == "1.2.3"
    with pytest.raises(SystemExit, match="n'est pas une version"):
        script.bump("v1.2")
    script.CARGO.write_text(script.CARGO.read_text().replace('"1.2.3"', '"9.9.9"', 1))
    with pytest.raises(SystemExit, match="Versions divergentes"):
        script.check()


def test_selftest_route_is_protected_and_checks_dynamic_imports():
    """Critère 2, côté code : la route répond 401 sans le token, puis tout est vert."""
    client = TestClient(create_app(token="jeton"))
    assert client.get("/api/_selftest").status_code == 401
    assert client.get("/api/_selftest", headers={"Authorization": "Bearer faux"}).status_code == 401
    found = client.get("/api/_selftest", headers={"Authorization": "Bearer jeton"}).json()
    assert found["ok"] is True, found
    assert found["version"] == __version__ and found["frozen"] is False
    assert set(found["modules"]) >= set(selftest.DYNAMIC_MODULES)
    assert {k: v for k, v in found["checks"].items() if k != "git"} == {
        "extract.databricks": "ok", "compile.databricks": "ok", "extract.snowflake": "ok",
        "compile.snowflake": "ok", "run.duckdb": "ok", "zoneinfo": "ok"}


def test_selftest_reports_a_missing_module(monkeypatch):
    monkeypatch.setattr(selftest, "DYNAMIC_MODULES", (*selftest.DYNAMIC_MODULES, "atlas_absent"))
    found = selftest.run()
    assert found["ok"] is False
    assert found["modules"]["atlas_absent"].startswith("ModuleNotFoundError")


def test_lifeline_sees_a_process_disappear():
    assert lifeline.alive(os.getpid())
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    gone = threading.Event()
    stop = lifeline.watch(child.pid, gone.set, poll=0.05)
    assert lifeline.alive(child.pid)
    time.sleep(0.2)
    assert not gone.is_set()
    child.kill()
    child.wait()
    assert gone.wait(5)
    assert not lifeline.alive(child.pid)
    stop.set()


@pytest.fixture
def uncached_windows_api():
    lifeline._windows_api.cache_clear()
    yield
    lifeline._windows_api.cache_clear()


@pytest.mark.parametrize(("handle", "error", "wait", "expected"), [
    (0, 5, None, True),  # ERROR_ACCESS_DENIED : il existe, sous un autre compte
    (0, 87, None, False),  # ERROR_INVALID_PARAMETER : il n'existe plus
    (7, 0, 0x102, True),  # WAIT_TIMEOUT : il tourne
    (7, 0, 0, False),  # signalé : il s'est terminé
])
def test_lifeline_on_windows(monkeypatch, uncached_windows_api, handle, error, wait, expected):
    """#51 : sous Windows, un `OpenProcess` refusé n'arrête pas le serveur. Faux `ctypes`,
    pour exécuter la branche Windows sur tout poste."""
    closed = []
    wintypes = types.SimpleNamespace(DWORD=object(), BOOL=object(), HANDLE=object())
    kernel32 = types.SimpleNamespace(
        OpenProcess=Mock(return_value=handle),
        WaitForSingleObject=Mock(return_value=wait),
        CloseHandle=Mock(side_effect=closed.append))
    load = Mock(return_value=kernel32)
    fake = types.SimpleNamespace(WinDLL=load, wintypes=wintypes, get_last_error=lambda: error)
    monkeypatch.setitem(sys.modules, "ctypes", fake)
    monkeypatch.setattr(sys, "platform", "win32")
    assert lifeline.alive(4242) is expected
    assert lifeline.alive(4242) is expected
    load.assert_called_once_with("kernel32", use_last_error=True)
    assert kernel32.OpenProcess.argtypes == (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    assert kernel32.OpenProcess.restype is wintypes.HANDLE
    assert kernel32.WaitForSingleObject.argtypes == (wintypes.HANDLE, wintypes.DWORD)
    assert kernel32.WaitForSingleObject.restype is wintypes.DWORD
    assert kernel32.CloseHandle.argtypes == (wintypes.HANDLE,)
    assert kernel32.CloseHandle.restype is wintypes.BOOL
    assert closed == ([handle, handle] if handle else [])


def test_parent_pid_comes_from_the_environment(monkeypatch):
    monkeypatch.delenv("ATLAS_PARENT_PID", raising=False)
    assert lifeline.parent_pid() is None
    monkeypatch.setenv("ATLAS_PARENT_PID", "4242")
    assert lifeline.parent_pid() == 4242
    monkeypatch.setenv("ATLAS_PARENT_PID", "pas-un-pid")
    assert lifeline.parent_pid() is None


@pytest.mark.parametrize("reader", ["présent", "parti"])
def test_server_stops_when_its_parent_disappears(tmp_path, reader):
    """Le serveur (ici en Python, en binaire dans test_sidecar.py) suit son parent, y compris
    quand plus personne ne lit sa sortie (l'app partie, ses tubes sont fermés)."""
    parent = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    env = {**os.environ, "ATLAS_TOKEN": "t", "ATLAS_PORT": "0", "ATLAS_LOG_LEVEL": "warning",
           "ATLAS_DATA_DIR": str(tmp_path), "ATLAS_PARENT_PID": str(parent.pid)}
    server = subprocess.Popen([sys.executable, "-m", "skifer_atlas.server"], env=env,
                              stderr=subprocess.PIPE, text=True)
    try:
        time.sleep(1.5)
        assert server.poll() is None
        if reader == "parti":
            server.stderr.close()
        parent.kill()
        parent.wait()
        assert server.wait(15) == 0
        if reader == "présent":
            assert "disparu : arrêt du serveur" in server.stderr.read()
    finally:
        server.kill()
        parent.kill()
