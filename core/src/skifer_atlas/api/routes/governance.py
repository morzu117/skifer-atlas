"""Gouvernance d'un espace et rattachement de son dépôt distant (plans 0006 et 0017)."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from ...governance.model import parse_governance, role_of, space_referents
from ...proposals import create_governance_proposal
from ...repo.layout import GOVERNANCE_FILE
from ...repo.sync import set_remote
from ...workspaces import ROLE_LABELS, repo_dir
from .common import workspace_or_404

router = APIRouter(prefix="/api/workspaces/{ws}")


class GovernanceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    governance: dict
    justification: str = Field(min_length=1)


class RemoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    remote_url: str


@router.get("/governance")
def get_governance(ws: str) -> dict:
    """La gouvernance du clone, ses avertissements et la situation de l'utilisateur."""
    workspace = workspace_or_404(ws)
    path = repo_dir(workspace.id) / GOVERNANCE_FILE
    governance, issues = parse_governance(path.read_text(encoding="utf-8")
                                          if path.exists() else "")
    referents = space_referents(governance) if governance else set()
    return {
        "governance": governance.model_dump(mode="json") if governance else None,
        "issues": [i.to_dict() for i in issues],
        "account": workspace.account,
        "role": role_of(governance, workspace.account) if governance else "lecteur",
        "single_referent": len(referents) == 1,
        "git_remote": workspace.git_remote,
    }


@router.post("/governance", status_code=201)
def post_governance(ws: str, body: GovernanceRequest) -> dict:
    return create_governance_proposal(workspace_or_404(ws).id, body.governance,
                                      body.justification)


@router.post("/remote")
def post_remote(ws: str, body: RemoteRequest) -> dict:
    workspace = set_remote(workspace_or_404(ws).id, body.remote_url)
    return {**workspace.model_dump(), "role_label": ROLE_LABELS[workspace.role]}
