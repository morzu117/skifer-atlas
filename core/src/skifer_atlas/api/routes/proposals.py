"""Propositions : création, liste, détail, commentaires, revues, fusion (plan 0006)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from ... import proposals
from .common import workspace_or_404

router = APIRouter(prefix="/api/workspaces/{ws}/proposals")


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProposalRequest(_Body):
    document_yaml: str = Field(min_length=1)
    justification: str = Field(min_length=1)
    base_version: int | None = Field(default=None, ge=1)  # None : nouveau document


class CommentRequest(_Body):
    body: str = Field(min_length=1)


class ReviewRequest(_Body):
    event: Literal["approve", "request_changes"]
    body: str = ""


@router.get("")
def get_proposals(ws: str, domain: str | None = None, kpi: str | None = None,
                  author: str | None = None, entity: str | None = None,
                  status: Literal["open", "merged", "closed", "all"] = "open") -> list[dict]:
    return proposals.list_proposals(workspace_or_404(ws).id, domain, kpi, author, entity,
                                    status)


@router.post("", status_code=201)
def post_proposal(ws: str, body: ProposalRequest) -> dict:
    return proposals.create_proposal(workspace_or_404(ws).id, body.document_yaml,
                                     body.justification, body.base_version)


@router.get("/{number}")
def get_proposal(ws: str, number: int) -> dict:
    return proposals.get_proposal(workspace_or_404(ws).id, number)


@router.post("/{number}/comments", status_code=201)
def post_comment(ws: str, number: int, body: CommentRequest) -> dict:
    return proposals.comment(workspace_or_404(ws).id, number, body.body)


@router.post("/{number}/reviews")
def post_review(ws: str, number: int, body: ReviewRequest) -> dict:
    return proposals.review(workspace_or_404(ws).id, number, body.event, body.body)


@router.post("/{number}/merge")
def post_merge(ws: str, number: int) -> dict:
    return proposals.merge_proposal(workspace_or_404(ws).id, number)
