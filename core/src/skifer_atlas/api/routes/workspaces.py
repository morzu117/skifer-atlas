"""Espaces : liste, création, adhésion, synchronisation (plan 0005)."""

from __future__ import annotations

import duckdb
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from ...admin import is_space_referent
from ...index import ensure_index, index_fresh
from ...proposals import list_proposals
from ...repo.git import RepoError
from ...repo.layout import WorkspaceMeta
from ...repo.sync import create_workspace, join_workspace, sync_workspace
from ...workspaces import (
    ROLE_LABELS,
    Workspace,
    get_workspace,
    index_path,
    list_workspaces,
    repo_dir,
)
from .common import workspace_or_404

router = APIRouter(prefix="/api/workspaces")


class JoinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    remote_url: str
    github_flow: str | None = None  # connexion GitHub faite avant d'adhérer (plan 0025)


def _counts(ws: Workspace) -> dict:
    """Compteurs de la carte d'accueil, sans réseau côté Git : l'index du clone, et les
    propositions qui attendent ma revue d'après le dernier fetch. Un compteur
    indisponible vaut `None` ; il n'empêche pas la liste."""
    found: dict = {"kpi": None, "concept": None, "open_proposals": None}
    try:
        connection = ensure_index(repo_dir(ws.id), index_path(ws.id))
        try:
            kinds = dict(connection.execute(
                'SELECT kind, count(*) FROM "index".documents GROUP BY kind').fetchall())
        finally:
            connection.close()
        found.update(kpi=kinds.get("kpi", 0), concept=kinds.get("concept", 0))
    except (RepoError, OSError, duckdb.Error):
        pass
    if not ws.git_remote:
        found["open_proposals"] = 0  # pas encore de dépôt distant, donc pas de proposition
        return found
    try:
        found["open_proposals"] = len(list_proposals(ws.id, for_me=True, fetch=False))
    except (RepoError, OSError):
        pass
    return found


def _out(ws: Workspace, counts: bool = False) -> dict:
    found = {**ws.model_dump(), "role_label": ROLE_LABELS[ws.role],
             "space_referent": is_space_referent(ws)}
    if counts:
        found["counts"] = _counts(ws)
    return found


@router.get("")
def get_workspaces() -> list[dict]:
    return [_out(ws, counts=True) for ws in list_workspaces()]


@router.post("", status_code=201)
def post_workspace(meta: WorkspaceMeta) -> dict:
    return _out(create_workspace(meta))


@router.post("/join", status_code=201)
def post_join(body: JoinRequest) -> dict:
    return _out(join_workspace(body.remote_url, body.github_flow))


@router.post("/{ws}/sync")
def post_sync(ws: str) -> dict:
    """Synchronise, puis réindexe si la branche principale a bougé (plan 0017)."""
    workspace = workspace_or_404(ws)
    result = sync_workspace(workspace.id)
    repo, db = repo_dir(workspace.id), index_path(workspace.id)
    reindexed = not index_fresh(repo, db)
    ensure_index(repo, db).close()
    synced = get_workspace(workspace.id)
    return {**result, "reindexed": reindexed, "synced_at": synced.synced_at if synced else None}
