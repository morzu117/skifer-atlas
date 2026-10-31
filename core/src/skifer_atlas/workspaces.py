"""Espaces de travail : un par client, étanches entre eux.

Le registre des espaces est un fichier YAML local ; chaque espace pointe vers
son dépôt Git et porte le rôle de l'utilisateur courant. Le clone d'un espace est
dans `workspace_dir(id)/repo`, son index dans `workspace_dir(id)/atlas.duckdb`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field

from .paths import WORKSPACE_ID_PATTERN, data_dir, is_workspace_id, workspace_dir

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


def registry_path():
    return data_dir() / "workspaces.yaml"


def load_registry() -> WorkspaceRegistry:
    path = registry_path()
    if not path.exists():
        return WorkspaceRegistry()
    with path.open("r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    return WorkspaceRegistry.model_validate(raw)


def save_registry(registry: WorkspaceRegistry) -> None:
    path = registry_path()
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(registry.model_dump(), fh, allow_unicode=True, sort_keys=False)


def list_workspaces() -> list[Workspace]:
    return load_registry().workspaces


def add_workspace(ws: Workspace) -> Workspace:
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
    registry = load_registry()
    registry.workspaces = [ws if w.id == ws.id else w for w in registry.workspaces]
    save_registry(registry)


def repo_dir(workspace_id: str) -> Path:
    return workspace_dir(workspace_id) / "repo"


def index_path(workspace_id: str) -> Path:
    return workspace_dir(workspace_id) / "atlas.duckdb"
