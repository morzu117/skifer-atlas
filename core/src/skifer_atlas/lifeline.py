"""Le serveur s'arrête quand l'app qui l'a lancé disparaît (plan 0019).

Tauri tue le sidecar à la fermeture, mais un binaire PyInstaller `--onefile` est deux
processus : un chargeur, puis l'interpréteur qu'il lance. Tuer le chargeur (SIGKILL sous
macOS) laisse l'interpréteur tourner, et l'app peut aussi être tuée sans passer par sa
fermeture. L'app passe donc son identifiant de processus (`ATLAS_PARENT_PID`) ; le
serveur le surveille et s'arrête de lui-même dès qu'il n'existe plus.
"""

from __future__ import annotations

import os
import sys
import threading
from collections.abc import Callable
from functools import cache

POLL_SECONDS = 1.0
ERROR_ACCESS_DENIED = 5


@cache
def _windows_api():
    """Charge kernel32 une fois et déclare les signatures qui transportent un HANDLE."""
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    return kernel32


def alive(pid: int) -> bool:
    """Le processus existe-t-il encore ? Sans dépendance : `kill(pid, 0)` sous Unix,
    `OpenProcess` et `WaitForSingleObject` sous Windows."""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        # Tauri fournit un PID u32. Un entier plus grand ne peut pas être transmis à
        # OpenProcess(DWORD) : le traiter comme disparu pour arrêter le serveur orphelin.
        if pid > 0xFFFFFFFF:
            return False
        kernel32 = _windows_api()
        handle = kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            # Accès refusé : il existe, sous un autre compte (comme `PermissionError` sous
            # Unix) ; paramètre invalide : il n'existe plus.
            return ctypes.get_last_error() == ERROR_ACCESS_DENIED
        try:
            # WAIT_FAILED est aussi traité comme absent (comportement historique).
            return kernel32.WaitForSingleObject(handle, 0) == 0x102  # WAIT_TIMEOUT
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # il existe, sous un autre compte
    return True


def parent_pid() -> int | None:
    raw = os.environ.get("ATLAS_PARENT_PID", "").strip()
    return int(raw) if raw.isdigit() else None


def watch(pid: int, on_gone: Callable[[], None], poll: float | None = None) -> threading.Event:
    """Appelle `on_gone` une fois, dans un fil, quand `pid` disparaît. Rend l'événement
    qui arrête la surveillance."""
    stop = threading.Event()

    def loop() -> None:
        while not stop.wait(POLL_SECONDS if poll is None else poll):
            if not alive(pid):
                on_gone()
                return

    threading.Thread(target=loop, name="atlas-lifeline", daemon=True).start()
    return stop
