"""Registre local de l'utilisateur : son identifiant sur une plateforme et le chemin de sa
clé privée, par espace et point d'accès (plan 0018).

Rien de secret ici : la passphrase et les jetons sont au coffre (`vault/`). Le fichier vit
dans le répertoire de données d'Atlas, jamais dans le dépôt d'un espace. La clé privée
n'est pas copiée : Atlas la relit à son emplacement à chaque connexion.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import asdict, dataclass

from ..paths import data_dir, is_workspace_id
from ..repo.git import RepoError

FILE = "logins.json"
_lock = threading.Lock()


@dataclass
class Login:
    user: str
    private_key_file: str | None = None


def _key(workspace_id: str, access_point_id: str) -> str:
    if not is_workspace_id(workspace_id) or not is_workspace_id(access_point_id):
        raise RepoError("not_found", "Espace ou point d'accès invalide.")
    return f"{workspace_id}/{access_point_id}"


def _read() -> dict[str, dict]:
    path = data_dir() / FILE
    try:
        found = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return found if isinstance(found, dict) else {}


def _write(entries: dict[str, dict]) -> None:
    path = data_dir() / FILE
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(entries, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(temporary, path)


def get(workspace_id: str, access_point_id: str) -> Login | None:
    entry = _read().get(_key(workspace_id, access_point_id))
    if not isinstance(entry, dict) or not isinstance(entry.get("user"), str):
        return None
    key_file = entry.get("private_key_file")
    return Login(entry["user"], key_file if isinstance(key_file, str) else None)


def put(workspace_id: str, access_point_id: str, login: Login) -> None:
    key = _key(workspace_id, access_point_id)
    with _lock:
        entries = _read()
        entries[key] = {k: v for k, v in asdict(login).items() if v is not None}
        _write(entries)


def delete(workspace_id: str, access_point_id: str) -> None:
    key = _key(workspace_id, access_point_id)
    with _lock:
        entries = _read()
        if entries.pop(key, None) is not None:
            _write(entries)
