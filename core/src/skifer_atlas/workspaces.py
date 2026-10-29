"""Espaces de travail : un par client, étanches entre eux.

Le registre des espaces est un fichier YAML local ; chaque espace pointe vers
son dépôt Git et porte le rôle de l'utilisateur courant.
"""

from __future__ import annotations

from typing import Literal

import yaml
from pydantic import BaseModel, Field

from .paths import data_dir

Role = Literal["referent", "validateur", "contributeur", "lecteur"]

ROLE_LABELS: dict[Role, str] = {
    "referent": "Référent d'annuaire",
    "validateur": "Validateur",
    "contributeur": "Contributeur",
    "lecteur": "Lecteur",
}


class Workspace(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,63}$")
    name: str
    sector: str = ""
    git_remote: str = ""
    role: Role = "lecteur"
    domains: list[str] = Field(default_factory=list)
    entities: list[str] = Field(default_factory=list)


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
