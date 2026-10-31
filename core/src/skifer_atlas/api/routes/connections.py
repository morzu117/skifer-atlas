"""Mes connexions dans un espace (plan 0008).

Aucune réponse ne contient de jeton : le token personnel du repli entre par
`PUT …/token`, la passphrase d'une clé Snowflake par `PUT …/key-pair` (plan 0018), et
n'en ressortent jamais.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from ... import connections
from ...proposals import create_access_point_proposal
from .common import workspace_or_404

router = APIRouter(prefix="/api/workspaces/{ws}/connections")
# Un point d'accès pas encore déclaré, dans le corps : se connecter et tester avant de le
# proposer (plan 0016). Préfixe à part : `…/connections/{ap}/…` reste sans ambiguïté.
drafts = APIRouter(prefix="/api/workspaces/{ws}/access-point-draft")


class DeclareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_point: dict
    justification: str = Field(min_length=1)


class DraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_point: dict
    user: str | None = None  # identifiant Snowflake, pour le SSO


class AuthorizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user: str | None = None  # identifiant Snowflake ; sinon celui du registre local


class KeyPairRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user: str = Field(min_length=1)
    private_key_file: str = Field(min_length=1)
    passphrase: str | None = Field(default=None, repr=False)


class DraftKeyPairRequest(KeyPairRequest):
    access_point: dict


class PersonalTokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, repr=False)
    expires_at: float | None = None


@router.get("")
def list_connections(ws: str) -> list[dict]:
    return connections.list_connections(workspace_or_404(ws).id)


@router.get("/platforms")
def platforms(ws: str) -> list[dict]:
    """Plateformes autorisées par le référent, et celles qu'Atlas sait connecter."""
    return connections.platforms(workspace_or_404(ws).id)


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
def authorize(ws: str, ap: str, body: AuthorizeRequest | None = None) -> dict:
    return connections.authorize(workspace_or_404(ws).id, ap, user=body.user if body else None)


@router.put("/{ap}/key-pair")
def key_pair(ws: str, ap: str, body: KeyPairRequest) -> dict:
    """Paire de clés Snowflake : chemin de la clé au registre local, passphrase au coffre."""
    return connections.store_key_pair(workspace_or_404(ws).id, ap, body.user,
                                      body.private_key_file, body.passphrase)


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


@drafts.post("/authorize")
def authorize_draft(ws: str, body: DraftRequest) -> dict:
    return connections.authorize_draft(workspace_or_404(ws).id, body.access_point,
                                       user=body.user)


@drafts.put("/key-pair")
def key_pair_draft(ws: str, body: DraftKeyPairRequest) -> dict:
    return connections.store_key_pair_draft(workspace_or_404(ws).id, body.access_point,
                                            body.user, body.private_key_file, body.passphrase)


@drafts.post("/status")
def draft_status(ws: str, body: DraftRequest) -> dict:
    return connections.draft_status(workspace_or_404(ws).id, body.access_point)


@drafts.post("/test")
def test_draft(ws: str, body: DraftRequest) -> dict:
    return connections.check_draft(workspace_or_404(ws).id, body.access_point)
