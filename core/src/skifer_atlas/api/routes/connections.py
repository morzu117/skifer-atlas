"""Mes connexions dans un espace (plan 0008).

Aucune réponse ne contient de jeton : le token personnel du repli entre par
`PUT …/token` et n'en ressort jamais.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from ... import connections
from ...proposals import create_access_point_proposal
from .common import workspace_or_404

router = APIRouter(prefix="/api/workspaces/{ws}/connections")


class DeclareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_point: dict
    justification: str = Field(min_length=1)


class PersonalTokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, repr=False)
    expires_at: float | None = None


@router.get("")
def list_connections(ws: str) -> list[dict]:
    return connections.list_connections(workspace_or_404(ws).id)


@router.post("", status_code=201)
def declare(ws: str, body: DeclareRequest) -> dict:
    """Déclarer ou modifier un point d'accès : une proposition sur `access_points.yaml`,
    qu'un référent d'espace approuve (ADR 0011)."""
    return create_access_point_proposal(workspace_or_404(ws).id, body.access_point,
                                        body.justification)


@router.get("/{ap}/status")
def status(ws: str, ap: str) -> dict:
    return connections.status(workspace_or_404(ws).id, ap)


@router.post("/{ap}/authorize")
def authorize(ws: str, ap: str) -> dict:
    return connections.authorize(workspace_or_404(ws).id, ap)


@router.put("/{ap}/token")
def personal_token(ws: str, ap: str, body: PersonalTokenRequest) -> dict:
    return connections.store_personal_token(workspace_or_404(ws).id, ap, body.token,
                                            body.expires_at)


@router.post("/{ap}/test")
def test_connection(ws: str, ap: str) -> dict:
    return connections.check_connection(workspace_or_404(ws).id, ap)


@router.delete("/{ap}/token")
def revoke(ws: str, ap: str) -> dict:
    return connections.revoke(workspace_or_404(ws).id, ap)
