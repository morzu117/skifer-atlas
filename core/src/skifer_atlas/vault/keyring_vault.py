"""Coffre personnel : le trousseau de l'OS, rangé par espace (plan 0008, ADR 0001).

Service `skifer-atlas`, compte `<espace>/<point d'accès>`. Le backend est choisi
explicitement selon le système, jamais par la découverte de `keyring` : pas de repli
silencieux sur un fichier en clair. Sans trousseau utilisable, `vault_unavailable`.

`ATLAS_VAULT=memory` remplace le trousseau par un coffre en mémoire du processus, pour
les tests et les démonstrations : rien n'est écrit sur disque.
"""

from __future__ import annotations

import os
import sys
import threading

from keyring.backend import KeyringBackend
from keyring.errors import KeyringError, PasswordDeleteError

from ..paths import is_workspace_id
from ..repo.git import RepoError
from .model import Credential

SERVICE = "skifer-atlas"


class MemoryKeyring(KeyringBackend):
    """Trousseau en mémoire : tests et démonstrations seulement."""

    priority = 0  # jamais choisi par découverte

    def __init__(self) -> None:
        super().__init__()
        self._items: dict[tuple[str, str], str] = {}
        self._lock = threading.Lock()

    def get_password(self, service: str, username: str) -> str | None:
        with self._lock:
            return self._items.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        with self._lock:
            self._items[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        with self._lock:
            if self._items.pop((service, username), None) is None:
                raise PasswordDeleteError("absent")

    def usernames(self, service: str) -> list[str]:
        with self._lock:
            return sorted(u for s, u in self._items if s == service)


_memory = MemoryKeyring()


def _unavailable(reason: str) -> RepoError:
    return RepoError("vault_unavailable", f"Trousseau du système indisponible ({reason}) : "
                     "Atlas ne range aucun identifiant ailleurs.")


def system_keyring() -> KeyringBackend:
    """Le trousseau de l'OS, ou `vault_unavailable`."""
    if os.environ.get("ATLAS_VAULT") == "memory":
        return _memory
    try:
        if sys.platform == "darwin":
            from keyring.backends import macOS

            backend: KeyringBackend = macOS.Keyring()
        elif sys.platform == "win32":
            from keyring.backends import Windows

            backend = Windows.WinVaultKeyring()
        else:
            from keyring.backends import SecretService

            backend = SecretService.Keyring()
        backend.priority  # noqa: B018 — lève si le backend n'est pas utilisable ici
    except Exception as error:  # noqa: BLE001 — chaque backend a ses propres erreurs
        raise _unavailable(type(error).__name__) from None
    return backend


def _account(workspace_id: str, access_point_id: str) -> str:
    if not is_workspace_id(workspace_id) or not is_workspace_id(access_point_id):
        raise RepoError("not_found", "Espace ou point d'accès invalide.")
    return f"{workspace_id}/{access_point_id}"


class Vault:
    def __init__(self, backend: KeyringBackend | None = None):
        self.backend = backend or system_keyring()

    def get(self, workspace_id: str, access_point_id: str) -> Credential | None:
        try:
            text = self.backend.get_password(SERVICE, _account(workspace_id, access_point_id))
        except KeyringError as error:
            raise _unavailable(type(error).__name__) from None
        if text is None:
            return None
        try:
            return Credential.from_json(text)
        except (ValueError, TypeError):
            return None  # entrée illisible : traitée comme absente, réécrite au prochain accès

    def put(self, workspace_id: str, access_point_id: str, credential: Credential) -> None:
        try:
            self.backend.set_password(SERVICE, _account(workspace_id, access_point_id),
                                      credential.to_json())
        except KeyringError as error:
            raise _unavailable(type(error).__name__) from None

    def delete(self, workspace_id: str, access_point_id: str) -> bool:
        try:
            self.backend.delete_password(SERVICE, _account(workspace_id, access_point_id))
        except PasswordDeleteError:
            return False
        except KeyringError as error:
            raise _unavailable(type(error).__name__) from None
        return True

    def list_my_connections(self, workspace_id: str,
                            access_point_ids: list[str]) -> dict[str, Credential]:
        """Les entrées de cet espace seulement. Un trousseau ne s'énumère pas : on
        interroge les points d'accès déclarés par l'espace."""
        found = {}
        for access_point_id in access_point_ids:
            credential = self.get(workspace_id, access_point_id)
            if credential is not None:
                found[access_point_id] = credential
        return found
