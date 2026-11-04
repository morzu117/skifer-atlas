"""Espaces : liste, création, adhésion, synchronisation (plan 0005)."""

from __future__ import annotations

import duckdb
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from ...admin import is_space_referent
from ...dbfile import without_waiting
from ...index import ensure_index, index_fresh
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
    """Compteurs locaux de la carte d'accueil, sans appel à l'hébergeur. Les propositions
    sont chargées séparément par l'écran. Une base occupée ne bloque pas la liste."""
    found: dict = {"kpi": None, "concept": None, "open_proposals": None}
    try:
        with without_waiting():
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
    return found


def _out(ws: Workspace, counts: bool = False) -> dict:
    found = {**ws.model_dump(), "role_label": ROLE_LABELS[ws.role]}
    if counts:
        found["counts"] = _counts(ws)
    else:
        found["space_referent"] = is_space_referent(ws)
    return found


@router.get("")
def get_workspaces() -> list[dict]:
    return [_out(ws, counts=True) for ws in list_workspaces()]


@router.get("/{ws}")
def get_workspace_detail(ws: str) -> dict:
    """Métadonnées et rôle courant d'un espace, sans ses compteurs."""
    return _out(workspace_or_404(ws))


@router.post("", status_code=201)
def post_workspace(meta: WorkspaceMeta) -> dict:
    return _out(create_workspace(meta))


@router.post("/join", status_code=201)
def post_join(body: JoinRequest) -> dict:
    return _out(join_workspace(body.remote_url, body.github_flow))


@router.post("/{ws}/sync")
def post_sync(ws: str) -> dict:
    """Synchronise, puis réindexe si nécessaire. Un échec d'index reste un avertissement :
    le résultat Git a déjà été enregistré et ne doit pas être présenté comme un échec."""
    workspace = workspace_or_404(ws)
    result = sync_workspace(workspace.id)
    repo, db = repo_dir(workspace.id), index_path(workspace.id)
    reindexed, fresh = False, False
    try:
        was_fresh = index_fresh(repo, db)
        ensure_index(repo, db).close()
        reindexed, fresh = not was_fresh, True
    except (RepoError, OSError, duckdb.Error):
        result["warnings"].append({"code": "index_unavailable", "message":
                                   "Le dépôt est synchronisé, mais l'index n'a pas pu être "
                                   "reconstruit. Réessayer la synchronisation."})
    synced = get_workspace(workspace.id)
    return {**result, "reindexed": reindexed, "index_fresh": fresh,
            "synced_at": synced.synced_at if synced else None}
