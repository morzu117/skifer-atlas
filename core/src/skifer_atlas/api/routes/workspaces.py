"""Espaces : liste, création, adhésion, synchronisation (plan 0005)."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from ...repo.layout import WorkspaceMeta
from ...repo.sync import create_workspace, join_workspace, sync_workspace
from ...workspaces import ROLE_LABELS, Workspace, list_workspaces
from .common import workspace_or_404

router = APIRouter(prefix="/api/workspaces")


class JoinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    remote_url: str


def _out(ws: Workspace) -> dict:
    return {**ws.model_dump(), "role_label": ROLE_LABELS[ws.role]}


@router.get("")
def get_workspaces() -> list[dict]:
    return [_out(ws) for ws in list_workspaces()]


@router.post("", status_code=201)
def post_workspace(meta: WorkspaceMeta) -> dict:
    return _out(create_workspace(meta))


@router.post("/join", status_code=201)
def post_join(body: JoinRequest) -> dict:
    return _out(join_workspace(body.remote_url))


@router.post("/{ws}/sync")
def post_sync(ws: str) -> dict:
    return sync_workspace(workspace_or_404(ws).id)
