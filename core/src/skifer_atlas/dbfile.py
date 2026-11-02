"""Ouverture du fichier DuckDB d'un espace, partagé entre processus (ADR 0032).

DuckDB verrouille le fichier : tant qu'un processus Atlas (l'app, ou la CLI) l'a ouvert,
un autre ne peut pas l'ouvrir et échoue aussitôt. Atlas ne garde le fichier ouvert que le
temps d'une lecture ou d'une écriture : on réessaie donc quelques secondes, puis on
répond `index_busy`. Dans un même processus, DuckDB partage le fichier entre connexions.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

import duckdb

from .repo.git import RepoError

WAIT_SECONDS = 10.0
# Ce que DuckDB dit quand un autre processus tient le fichier (2.0.0, épinglé par uv.lock) :
# « IO Error: Could not set lock on file "…": Conflicting lock is held in … ». DuckDB n'a
# pas d'exception propre à ce cas ; `test_dbfile.py` vérifie ces libellés sur la version
# installée, pour qu'un changement de libellé fasse échouer un test plutôt qu'une requête.
LOCK_MESSAGES = ("Could not set lock", "Conflicting lock")
_no_wait: ContextVar[bool] = ContextVar("no_wait", default=False)
# Deux threads qui ouvrent le même fichier au même instant se gênent : DuckDB refuse le
# second (« Unique file handle conflict ») au lieu de partager la base. C'est le cas dès que
# plusieurs requêtes attendent la même base occupée et réessaient ensemble. Les ouvertures
# d'un même fichier passent donc une à une ; chacune est brève, l'attente se fait hors du
# verrou, et un espace ne retient pas l'ouverture d'un autre.
_opening: dict[Path, threading.Lock] = {}
_opening_guard = threading.Lock()


def is_locked_by_another_process(error: duckdb.Error) -> bool:
    return isinstance(error, duckdb.IOException) and any(
        message in str(error) for message in LOCK_MESSAGES)


def waiting() -> bool:
    """Faux dans un bloc `without_waiting` : qui ne doit pas attendre la base n'attend
    pas non plus sa reconstruction (`ensure_index`)."""
    return not _no_wait.get()


@contextmanager
def without_waiting() -> Iterator[None]:
    """Les ouvertures faites dans ce bloc n'attendent pas : `index_busy` aussitôt. Pour ce
    qui est accessoire (les compteurs de la liste des espaces), qu'une base occupée ne doit
    pas retarder de `WAIT_SECONDS`."""
    token = _no_wait.set(True)
    try:
        yield
    finally:
        _no_wait.reset(token)


def open_db(db: Path) -> duckdb.DuckDBPyConnection:
    deadline = time.monotonic() + (WAIT_SECONDS if waiting() else 0.0)
    with _opening_guard:
        opening = _opening.setdefault(db.resolve(), threading.Lock())
    delay = 0.02
    while True:
        try:
            with opening:
                return duckdb.connect(str(db))
        except duckdb.IOException as error:
            if not is_locked_by_another_process(error):
                raise
            if time.monotonic() >= deadline:
                raise RepoError("index_busy", "La base de l'espace est ouverte par un autre "
                                "processus Atlas (la ligne de commande ou l'application). "
                                "Réessayer quand il aura fini.") from error
        time.sleep(min(delay, max(deadline - time.monotonic(), 0)))
        delay = min(delay * 2, 0.5)
