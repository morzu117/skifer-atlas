"""Espaces de travail : un par client, étanches entre eux.

Le registre des espaces est un fichier YAML local ; chaque espace pointe vers
son dépôt Git et porte le rôle de l'utilisateur courant. Le clone d'un espace est
dans `workspace_dir(id)/repo`, son index dans `workspace_dir(id)/atlas.duckdb`.

Le registre est partagé entre processus (l'app et la CLI, plan 0028) : il s'écrit de façon
atomique et toute lecture–modification–écriture se fait sous `registry_lock` (ADR 0039).
"""

from __future__ import annotations

import contextlib
import os
import sys
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field

from .filelock import LockTimeout, file_lock
from .paths import WORKSPACE_ID_PATTERN, data_dir, is_workspace_id, workspace_dir
from .repo.git import RepoError

Role = Literal["referent", "validateur", "contributeur", "lecteur"]

ROLE_LABELS: dict[Role, str] = {
    "referent": "Référent d'annuaire",
    "validateur": "Validateur",
    "contributeur": "Contributeur",
    "lecteur": "Lecteur",
}


class Workspace(BaseModel):
    id: str = Field(pattern=WORKSPACE_ID_PATTERN)
    name: str
    sector: str = ""
    git_remote: str = ""
    account: str = ""  # identité de l'utilisateur dans cet espace (compte de l'hébergeur)
    role: Role = "lecteur"
    domains: list[str] = Field(default_factory=list)
    entities: list[str] = Field(default_factory=list)
    synced_at: str = ""  # dernière synchronisation avec le dépôt distant (UTC, ISO 8601)


class WorkspaceRegistry(BaseModel):
    workspaces: list[Workspace] = Field(default_factory=list)


# Attente du verrou du registre avant `registry_busy` : il n'est tenu que le temps d'une
# lecture et d'une écriture de quelques lignes, donc 10 s (comme `dbfile.WAIT_SECONDS`) sont
# largement suffisantes. Lu à chaque appel, pour qu'un test le raccourcisse.
LOCK_WAIT_SECONDS = 10.0


def registry_path() -> Path:
    return data_dir() / "workspaces.yaml"


def lock_path() -> Path:
    return data_dir() / "workspaces.yaml.lock"


@contextmanager
def registry_lock() -> Iterator[None]:
    """Exclut les autres threads et les autres processus Atlas. Réentrant : `add_workspace`
    prend le verrou, puis `load_registry` et `save_registry` le reprennent. Dernier verrou de
    l'ordre de prise (ADR 0039) : ne jamais prendre un verrou de clone une fois celui-ci pris.
    Au-delà de `LOCK_WAIT_SECONDS`, `registry_busy`."""
    with contextlib.ExitStack() as stack:
        try:
            stack.enter_context(file_lock(lock_path(), LOCK_WAIT_SECONDS))
        except LockTimeout as error:
            raise RepoError("registry_busy", "La liste des espaces est en cours de modification "
                            "par un autre processus Atlas (la ligne de commande ou "
                            "l'application). Réessayer quand il aura fini.") from error
        yield


def load_registry() -> WorkspaceRegistry:
    with registry_lock():
        path = registry_path()
        if not path.exists():
            return WorkspaceRegistry()
        with path.open("r", encoding="utf-8") as fh:
            raw = yaml.safe_load(fh) or {}
        return WorkspaceRegistry.model_validate(raw)


def _replace(source: str, target: Path) -> None:
    """`os.replace`, réessayé brièvement sous Windows : un lecteur qui a le fichier ouvert (un
    antivirus, un indexeur) fait échouer le remplacement par un `PermissionError` passager."""
    attempts = 6 if sys.platform == "win32" else 1
    for attempt in range(attempts):
        try:
            os.replace(source, target)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.05 * 2 ** attempt)


def save_registry(registry: WorkspaceRegistry) -> None:
    """Écrit le registre de façon atomique : un fichier temporaire du même dossier, vidé sur
    disque (`fsync`), puis `os.replace`. Une interruption, ou un échec du dump, laisse l'ancien
    registre intact ; le fichier temporaire est supprimé."""
    with registry_lock():
        path = registry_path()
        fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                yaml.safe_dump(registry.model_dump(), fh, allow_unicode=True, sort_keys=False)
                fh.flush()
                os.fsync(fh.fileno())
            _replace(temporary, path)
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(temporary)
            raise
        _sync_directory(path.parent)


def _sync_directory(folder: Path) -> None:
    """Rend le remplacement durable sous macOS et Linux ; sans effet sous Windows, qui ne
    permet pas d'ouvrir un dossier."""
    if sys.platform == "win32":
        return
    with contextlib.suppress(OSError):
        fd = os.open(folder, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def list_workspaces() -> list[Workspace]:
    return load_registry().workspaces


def add_workspace(ws: Workspace) -> Workspace:
    with registry_lock():
        registry = load_registry()
        if any(w.id == ws.id for w in registry.workspaces):
            raise ValueError(f"L'espace « {ws.id} » existe déjà.")
        registry.workspaces.append(ws)
        save_registry(registry)
    return ws


def get_workspace(workspace_id: str) -> Workspace | None:
    if not is_workspace_id(workspace_id):
        return None
    return next((w for w in list_workspaces() if w.id == workspace_id), None)


def update_workspace(ws: Workspace) -> None:
    with registry_lock():
        registry = load_registry()
        registry.workspaces = [ws if w.id == ws.id else w for w in registry.workspaces]
        save_registry(registry)


def repo_dir(workspace_id: str) -> Path:
    return workspace_dir(workspace_id) / "repo"


def index_path(workspace_id: str) -> Path:
    return workspace_dir(workspace_id) / "atlas.duckdb"
