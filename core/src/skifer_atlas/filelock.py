"""Verrou de fichier entre processus, réentrant dans le processus (ADR 0039).

Deux processus Atlas (l'app et la CLI, plan 0028) partagent le dossier de données : ce verrou
exclut l'autre processus, et un `threading.RLock` par fichier exclut les autres threads. Le
verrou du système (`flock` sous macOS et Linux, `msvcrt.locking` sous Windows) est rendu par
le noyau à la mort du processus : un processus tué ne laisse jamais de verrou orphelin. Le
fichier verrou lui-même n'est jamais supprimé (le supprimer ouvre une course entre deux
processus qui verrouilleraient deux fichiers différents du même nom) ; il reste vide.

Seule la bibliothèque standard est utilisée : rien à déclarer à PyInstaller.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

if sys.platform == "win32":
    import msvcrt

    def _try_lock(fd: int) -> bool:
        os.lseek(fd, 0, os.SEEK_SET)
        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        return True

    def _unlock(fd: int) -> None:
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
else:
    import fcntl

    def _try_lock(fd: int) -> bool:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return False
        return True

    def _unlock(fd: int) -> None:
        fcntl.flock(fd, fcntl.LOCK_UN)


class LockTimeout(Exception):
    """Le verrou est resté tenu au-delà du délai demandé."""


class _Busy(Exception):
    """Interne à `_acquire` : le verrou du système est resté tenu jusqu'au délai."""


class _Held:
    """Le verrou d'un fichier dans ce processus : le `RLock` des threads, la profondeur de
    réentrance et le descripteur qui porte le verrou du système tant que la profondeur est
    positive. `depth` et `fd` ne sont lus et écrits que par le thread qui tient `rlock`."""

    def __init__(self) -> None:
        self.rlock = threading.RLock()
        self.depth = 0
        self.fd = -1


_held: dict[Path, _Held] = {}
_held_guard = threading.Lock()


def _entry(path: Path) -> tuple[Path, _Held]:
    path = Path(path).resolve()
    with _held_guard:
        return path, _held.setdefault(path, _Held())


def _acquire(path: Path, held: _Held, timeout: float) -> bool:
    """Prend le verrou en attendant au plus `timeout` secondes (0 : un seul essai)."""
    deadline = time.monotonic() + timeout
    if timeout > 0:
        got = held.rlock.acquire(timeout=timeout)
    else:
        got = held.rlock.acquire(blocking=False)
    if not got:
        return False
    fd = -1
    try:
        if held.depth == 0:
            # Toute exception d'ici à la prise du verrou du système (dossier ou fichier
            # inaccessible, disque plein) rend le `RLock` : sinon les autres threads
            # attendraient ce verrou jusqu'au redémarrage.
            path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
            delay = 0.01
            while not _try_lock(fd):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise _Busy
                time.sleep(min(delay, remaining))
                delay = min(delay * 2, 0.2)
            held.fd = fd
        held.depth += 1
    except BaseException as error:
        if fd >= 0 and held.fd != fd:
            os.close(fd)
        held.rlock.release()
        if isinstance(error, _Busy):
            return False
        raise
    return True


def _release(held: _Held) -> None:
    held.depth -= 1
    if held.depth == 0:
        fd, held.fd = held.fd, -1
        try:
            _unlock(fd)
        finally:
            os.close(fd)
    held.rlock.release()


@contextmanager
def file_lock(path: Path, timeout: float) -> Iterator[None]:
    """Tient le verrou de `path` pendant le bloc ; `LockTimeout` si un autre thread ou un
    autre processus le tient encore après `timeout` secondes. Réentrant dans le processus."""
    path, held = _entry(path)
    if not _acquire(path, held, timeout):
        raise LockTimeout(str(path))
    try:
        yield
    finally:
        _release(held)


@contextmanager
def file_lock_if_free(path: Path) -> Iterator[bool]:
    """Comme `file_lock`, sans attendre : rend `False` quand un autre thread ou un autre
    processus tient le verrou. Le thread qui le tient déjà le retrouve (réentrance)."""
    path, held = _entry(path)
    if not _acquire(path, held, 0):
        yield False
        return
    try:
        yield True
    finally:
        _release(held)
