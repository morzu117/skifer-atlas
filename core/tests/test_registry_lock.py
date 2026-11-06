"""Le registre des espaces : écriture atomique et verrou entre processus (ADR 0039).

Pas de `monkeypatch.undo()` : il défait aussi `ATLAS_DATA_DIR`, et le test écrirait dans le
vrai dossier de données. Les remplacements locaux passent par `monkeypatch.context()`.
"""

import os
import subprocess
import sys
import threading
import time
from contextlib import contextmanager

import pytest
import yaml
from fastapi.testclient import TestClient

from skifer_atlas import workspaces
from skifer_atlas.api.app import ERROR_STATUS, create_app
from skifer_atlas.repo.git import RepoError
from skifer_atlas.workspaces import (
    Workspace,
    add_workspace,
    get_workspace,
    list_workspaces,
    registry_path,
    update_workspace,
)

# Un autre processus (la CLI, par exemple) tient le verrou du registre `sys.argv[1]` secondes.
HOLDER = """
import sys, time
from skifer_atlas.workspaces import registry_lock
with registry_lock():
    print("tenu", flush=True)
    time.sleep(float(sys.argv[1]))
"""


@pytest.fixture
def data(tmp_path, monkeypatch):
    folder = tmp_path / "donnees"
    monkeypatch.setenv("ATLAS_DATA_DIR", str(folder))
    return folder


def workspace(ident: str, **fields) -> Workspace:
    return Workspace(id=ident, **{"name": ident.title(), **fields})


@contextmanager
def held(seconds):
    process = subprocess.Popen([sys.executable, "-c", HOLDER, str(seconds)],
                               stdout=subprocess.PIPE, text=True, env=os.environ)
    try:
        assert process.stdout.readline().strip() == "tenu"
        yield process
    finally:
        process.kill()
        process.wait()


# --- écriture atomique -------------------------------------------------------------------

def test_an_interrupted_write_keeps_the_old_registry(data, monkeypatch):
    add_workspace(workspace("groupe-nordis"))
    before = registry_path().read_bytes()

    def half_dump(content, stream, **_):
        stream.write("workspaces:\n- id: groupe-no")  # un YAML partiel, puis l'interruption
        raise OSError("disque plein")

    with monkeypatch.context() as patched:
        patched.setattr(workspaces.yaml, "safe_dump", half_dump)
        with pytest.raises(OSError, match="disque plein"):
            add_workspace(workspace("maison-perrault"))
    assert registry_path().read_bytes() == before
    assert [w.id for w in list_workspaces()] == ["groupe-nordis"]
    assert sorted(path.name for path in data.iterdir()) == [
        "workspaces.yaml", "workspaces.yaml.lock"]  # aucun fichier temporaire


def test_a_failed_replace_keeps_the_old_registry_and_removes_the_temporary_file(data, monkeypatch):
    add_workspace(workspace("groupe-nordis"))
    before = registry_path().read_bytes()

    def refuse(source, target):
        raise OSError("remplacement refusé")

    with monkeypatch.context() as patched:
        patched.setattr(workspaces.os, "replace", refuse)
        with pytest.raises(OSError, match="remplacement refusé"):
            update_workspace(workspace("groupe-nordis", name="Autre"))
    assert registry_path().read_bytes() == before
    assert sorted(path.name for path in data.iterdir()) == [
        "workspaces.yaml", "workspaces.yaml.lock"]


def test_the_temporary_file_is_synced_before_it_replaces_the_registry(data, monkeypatch):
    calls = []
    real_fsync, real_replace = os.fsync, os.replace
    with monkeypatch.context() as patched:
        patched.setattr(workspaces.os, "fsync", lambda fd: (calls.append("fsync"), real_fsync(fd)))
        patched.setattr(workspaces.os, "replace",
                        lambda a, b: (calls.append("replace"), real_replace(a, b)))
        add_workspace(workspace("groupe-nordis"))
    assert calls.index("fsync") < calls.index("replace")


def test_the_registry_keeps_its_format(data):
    add_workspace(workspace("groupe-nordis", sector="Distribution"))
    raw = yaml.safe_load(registry_path().read_text(encoding="utf-8"))
    assert raw["workspaces"][0]["id"] == "groupe-nordis"
    assert get_workspace("groupe-nordis").sector == "Distribution"


# --- verrou entre threads ----------------------------------------------------------------

def test_two_threads_never_lose_an_update(data):
    """Un thread ajoute des espaces pendant que l'autre en met un autre à jour : sans verrou,
    la dernière écriture efface l'autre."""
    add_workspace(workspace("existant"))
    errors = []

    def adding():
        try:
            for index in range(25):
                add_workspace(workspace(f"ajout-{index:02d}"))
        except BaseException as error:  # noqa: BLE001
            errors.append(error)

    def updating():
        try:
            for index in range(25):
                update_workspace(workspace("existant", synced_at=f"2026-11-06T10:{index:02d}"))
        except BaseException as error:  # noqa: BLE001
            errors.append(error)

    threads = [threading.Thread(target=adding), threading.Thread(target=updating)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(30)
    assert not errors
    ids = {w.id for w in list_workspaces()}
    assert ids == {"existant", *(f"ajout-{index:02d}" for index in range(25))}
    assert get_workspace("existant").synced_at == "2026-11-06T10:24"


def test_the_registry_lock_is_reentrant(data):
    with workspaces.registry_lock(), workspaces.registry_lock():
        add_workspace(workspace("groupe-nordis"))  # reprend le verrou deux fois de plus
        assert get_workspace("groupe-nordis") is not None


# --- verrou entre processus --------------------------------------------------------------

def test_a_second_process_waits_for_the_registry_lock(data):
    with held(0.8):
        started = time.monotonic()
        add_workspace(workspace("groupe-nordis"))
        assert time.monotonic() - started > 0.3
    assert [w.id for w in list_workspaces()] == ["groupe-nordis"]


def test_a_lock_held_too_long_is_registry_busy(data, monkeypatch):
    add_workspace(workspace("groupe-nordis"))
    before = registry_path().read_bytes()
    monkeypatch.setattr(workspaces, "LOCK_WAIT_SECONDS", 0.3)
    with held(30):
        started = time.monotonic()
        with pytest.raises(RepoError) as error:
            add_workspace(workspace("maison-perrault"))
        assert time.monotonic() - started < 5
        assert error.value.code == "registry_busy"
        assert "autre processus Atlas" in error.value.message
        for write in (lambda: update_workspace(workspace("groupe-nordis", name="X")),
                      list_workspaces):
            with pytest.raises(RepoError, match="autre processus"):
                write()
    assert registry_path().read_bytes() == before


def test_the_api_answers_503_when_the_registry_is_busy(data, monkeypatch):
    assert ERROR_STATUS["registry_busy"] == 503
    monkeypatch.setattr(workspaces, "LOCK_WAIT_SECONDS", 0.3)
    client = TestClient(create_app(token="secret"), headers={"Authorization": "Bearer secret"})
    with held(30):
        answer = client.get("/api/workspaces")
    assert answer.status_code == 503
    assert answer.json()["detail"]["code"] == "registry_busy"


def test_a_lock_left_by_a_dead_process_does_not_block(data, monkeypatch):
    """Le verrou du système est rendu à la mort du processus, même tué sans nettoyage."""
    monkeypatch.setattr(workspaces, "LOCK_WAIT_SECONDS", 2)
    with held(30) as process:
        process.kill()
        process.wait()
    started = time.monotonic()
    add_workspace(workspace("groupe-nordis"))
    assert time.monotonic() - started < 1.5
    assert workspaces.lock_path().exists()  # le fichier reste, vide : seul le verrou compte


# --- échec de la prise du verrou -----------------------------------------------------------

def test_a_failed_lock_open_releases_the_thread_lock(tmp_path, monkeypatch):
    """Revue de #146 : si l'ouverture du fichier verrou échoue (permission, disque plein), le
    `RLock` du processus est rendu ; un autre thread obtient le verrou aussitôt, au lieu
    d'attendre jusqu'au redémarrage."""
    from skifer_atlas import filelock

    path = tmp_path / "verrou.lock"
    real_open = os.open
    failures = []

    def refuse_once(target, *args, **kwargs):
        if not failures and str(target) == str(path.resolve()):
            failures.append(target)
            raise PermissionError("permission refusée")
        return real_open(target, *args, **kwargs)

    with monkeypatch.context() as patched:
        patched.setattr(filelock.os, "open", refuse_once)
        with pytest.raises(PermissionError), filelock.file_lock(path, 1):
            raise AssertionError("le verrou n'a pas été pris")

        outcome = []

        def other_thread():
            started = time.monotonic()
            try:
                with filelock.file_lock(path, 1):
                    outcome.append(time.monotonic() - started)
            except BaseException as error:  # noqa: BLE001
                outcome.append(error)

        thread = threading.Thread(target=other_thread)
        thread.start()
        thread.join(5)
    assert not thread.is_alive()
    assert len(outcome) == 1 and isinstance(outcome[0], float) and outcome[0] < 0.5
    assert len(failures) == 1
    # Le même thread peut reprendre le verrou : la profondeur est revenue à zéro.
    with filelock.file_lock(path, 1), filelock.file_lock(path, 1):
        pass
    with filelock.file_lock_if_free(path) as free:
        assert free is True
