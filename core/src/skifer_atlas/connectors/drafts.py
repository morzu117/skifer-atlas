"""Index local non secret des identifiants créés pendant une connexion en brouillon."""

from __future__ import annotations

import json
import os
import threading

from ..paths import data_dir, is_workspace_id
from ..repo.git import RepoError

FILE = "connection-drafts.json"
_lock = threading.Lock()


def _key(workspace_id: str, access_point_id: str) -> str:
    if not is_workspace_id(workspace_id) or not is_workspace_id(access_point_id):
        raise RepoError("not_found", "Espace ou point d'accès invalide.")
    return f"{workspace_id}/{access_point_id}"


def _read() -> dict[str, str]:
    try:
        found = json.loads((data_dir() / FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return found if isinstance(found, dict) else {}


def _write(entries: dict[str, str]) -> None:
    path = data_dir() / FILE
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(entries, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(temporary, path)


def put(workspace_id: str, access_point_id: str, host: str) -> None:
    key = _key(workspace_id, access_point_id)
    with _lock:
        entries = _read()
        entries[key] = host
        _write(entries)


def get(workspace_id: str, access_point_id: str) -> str | None:
    host = _read().get(_key(workspace_id, access_point_id))
    return host if isinstance(host, str) else None


def list_for(workspace_id: str) -> dict[str, str]:
    if not is_workspace_id(workspace_id):
        raise RepoError("not_found", "Espace invalide.")
    prefix = f"{workspace_id}/"
    return {key[len(prefix):]: host for key, host in _read().items()
            if key.startswith(prefix) and is_workspace_id(key[len(prefix):])
            and isinstance(host, str)}


def delete(workspace_id: str, access_point_id: str) -> None:
    key = _key(workspace_id, access_point_id)
    with _lock:
        entries = _read()
        if entries.pop(key, None) is not None:
            _write(entries)
