"""Connexion GitHub d'un espace, par le device flow (plan 0025, ADR 0029).

Aucune réponse ne contient de jeton : seulement le code à saisir sur GitHub et des états.
`POST /api/github/device` sans espace sert à rejoindre un dépôt privé : le flux abouti se
remet ensuite à `POST /api/workspaces/join` (`github_flow`).
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict

from ...githost import device
from ...githost.github import github_repository
from ...repo.git import RepoError
from ...repo.sync import refresh_account
from .common import workspace_or_404

router = APIRouter(prefix="/api/workspaces/{ws}/github")
flows = APIRouter(prefix="/api/github/device")


class StartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace: str | None = None


@router.get("")
def get_github(ws: str) -> dict:
    workspace = workspace_or_404(ws)
    found = {"configured": device.client_id() is not None,
             "applies": github_repository(workspace.git_remote) is not None,
             "state": "absent", "source": None, "account": None}
    credential = device.stored(workspace.id)
    if credential is not None:
        found.update(state=credential.state(), source="vault", account=credential.account)
    elif os.environ.get("ATLAS_GITHUB_TOKEN"):
        found.update(state="connected", source="environment")
    return found


@router.delete("", status_code=204)
def delete_github(ws: str) -> Response:
    """Retire le jeton du coffre de ce poste. Il reste valide chez GitHub jusqu'à sa
    révocation dans les réglages du compte (Applications autorisées)."""
    if not device.forget(workspace_or_404(ws).id):
        raise RepoError("not_found", "Aucune connexion GitHub pour cet espace.")
    return Response(status_code=204)


@flows.post("")
def post_device(body: StartRequest) -> dict:
    workspace = workspace_or_404(body.workspace).id if body.workspace else None
    return device.start(workspace)


@flows.post("/{flow}")
def post_poll(flow: str) -> dict:
    found = device.poll(flow)
    if found["status"] == "connected" and found.get("workspace"):
        refresh_account(found.pop("workspace"))
    return found
