"""Le fichier DuckDB d'un espace ouvert par deux processus Atlas (ADR 0032)."""

import subprocess
import sys
import time
from contextlib import contextmanager

import duckdb
import pytest

from skifer_atlas import dbfile
from skifer_atlas.compare import store
from skifer_atlas.repo.git import RepoError

# Un autre processus (la CLI, par exemple) ouvre la base et la garde `sys.argv[2]` secondes.
HOLDER = """
import sys, time, duckdb
connection = duckdb.connect(sys.argv[1])
print("ouverte", flush=True)
time.sleep(float(sys.argv[2]))
connection.close()
"""


@contextmanager
def held(db, seconds):
    process = subprocess.Popen([sys.executable, "-c", HOLDER, str(db), str(seconds)],
                               stdout=subprocess.PIPE, text=True)
    try:
        assert process.stdout.readline().strip() == "ouverte"
        yield
    finally:
        process.kill()
        process.wait()


def test_a_second_process_waits_for_the_file(tmp_path, perf_factor):
    db = tmp_path / "atlas.duckdb"
    store.history(db)  # schéma `results` créé
    with held(db, 0.6):
        started = time.monotonic()
        assert store.history(db) == []
        assert time.monotonic() - started > 0.3 / perf_factor


def test_requests_waiting_together_all_get_the_file(tmp_path):
    """Plusieurs requêtes attendent la même base, puis l'ouvrent ensemble à sa libération :
    DuckDB ne doit refuser aucune d'elles (« Unique file handle conflict »)."""
    import threading

    db = tmp_path / "atlas.duckdb"
    store.history(db)
    outcomes = []

    def read():
        try:
            outcomes.append(store.history(db))
        except duckdb.Error as error:
            outcomes.append(error)

    with held(db, 0.5):
        threads = [threading.Thread(target=read) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    assert outcomes == [[]] * 6


def test_a_file_held_too_long_is_index_busy(tmp_path, monkeypatch):
    monkeypatch.setattr(dbfile, "WAIT_SECONDS", 0.3)
    db = tmp_path / "atlas.duckdb"
    with held(db, 30), pytest.raises(RepoError) as error:
        dbfile.open_db(db)
    assert error.value.code == "index_busy"
    assert "autre processus Atlas" in error.value.message


def test_other_io_errors_are_not_retried(tmp_path, perf_factor):
    started = time.monotonic()
    with pytest.raises(duckdb.IOException):
        dbfile.open_db(tmp_path / "absent" / "atlas.duckdb")
    assert time.monotonic() - started < 1 * perf_factor


def test_the_pinned_duckdb_still_says_the_file_is_locked(tmp_path):
    """`open_db` reconnaît le verrou d'un autre processus à son libellé : si une version de
    DuckDB le change, ce test échoue avant qu'une requête ne réponde 500."""
    db = tmp_path / "atlas.duckdb"
    with held(db, 30), pytest.raises(duckdb.IOException) as error:
        duckdb.connect(str(db))
    assert dbfile.is_locked_by_another_process(error.value)


def test_opening_one_space_does_not_wait_for_another(tmp_path, monkeypatch, perf_factor):
    """Le verrou d'ouverture est propre à chaque fichier."""
    import threading

    slow, other = tmp_path / "lent.duckdb", tmp_path / "autre.duckdb"
    entered, release = threading.Event(), threading.Event()
    connect = duckdb.connect

    def fake(path, *args, **kwargs):
        if path == str(slow):
            entered.set()
            release.wait(5)
        return connect(path, *args, **kwargs)

    monkeypatch.setattr(dbfile.duckdb, "connect", fake)
    opening = threading.Thread(target=lambda: dbfile.open_db(slow).close())
    opening.start()
    try:
        assert entered.wait(5)
        started = time.monotonic()
        dbfile.open_db(other).close()
        assert time.monotonic() - started < 1 * perf_factor
    finally:
        release.set()
        opening.join()
