"""Éditeur de graphe (plan 0013) : ouverture, validation à la frappe, YAML plein écran,
brouillon local, aperçu de la proposition. La soumission passe par `POST …/proposals`."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ... import editor
from ...index.build import Analysis, analyze
from ...paths import workspace_dir
from ...repo.git import RepoError, head
from ...workspaces import repo_dir
from .common import document_id_or_404, workspace_or_404

router = APIRouter(prefix="/api/workspaces/{ws}/editor")

# La validation tourne à chaque frappe (temporisée à 300 ms) : l'analyse de l'espace et
# ses calendriers ne se relisent que quand le commit courant change.
_cache: dict[Path, tuple[str, Analysis, dict]] = {}
_guard = threading.Lock()


def _context(ws: str) -> tuple[Path, Analysis, dict]:
    repo = repo_dir(workspace_or_404(ws).id)
    commit = head(repo)
    with _guard:
        cached = _cache.get(repo)
        if cached is None or cached[0] != commit:
            cached = (commit, analyze(repo), editor.calendars_of(repo))
            _cache[repo] = cached
    return repo, cached[1], cached[2]


class CheckRequest(BaseModel):
    document: Any
    node_id: str | None = None


class ParseRequest(BaseModel):
    text: str


class NewRequest(BaseModel):
    kind: Literal["concept", "kpi"]
    id: str
    label: str = Field(min_length=1)
    domain: str = Field(min_length=1)
    owner: str = Field(min_length=1)


class DraftRequest(BaseModel):
    document: Any
    positions: dict[str, Any] = Field(default_factory=dict)
    highest: int = 0
    base_version: int | None = None


class PreviewRequest(BaseModel):
    document: Any


@router.post("/check")
def post_check(ws: str, body: CheckRequest) -> dict:
    _, analysis, calendars = _context(ws)
    return editor.check(body.document, analysis.library, calendars, body.node_id)


@router.post("/parse")
def post_parse(ws: str, body: ParseRequest) -> dict:
    workspace_or_404(ws)
    return editor.parse(body.text)


@router.post("/documents", status_code=201)
def post_document(ws: str, body: NewRequest) -> dict:
    workspace = workspace_or_404(ws)
    if workspace.role == "lecteur":
        raise RepoError("forbidden", "Un lecteur ne crée pas de document.")
    repo, analysis, _ = _context(ws)
    return editor.new_document(repo, analysis, workspace_dir(workspace.id), body.kind,
                               body.id, body.label.strip(), body.domain.strip(),
                               body.owner.strip())


@router.get("/documents/{document_id}")
def get_document(ws: str, document_id: str) -> dict:
    workspace = workspace_or_404(ws)
    repo, analysis, _ = _context(ws)
    return editor.open_document(repo, analysis, workspace_dir(workspace.id),
                                document_id_or_404(document_id))


@router.put("/documents/{document_id}/draft")
def put_draft(ws: str, document_id: str, body: DraftRequest) -> dict:
    workspace = workspace_or_404(ws)
    return editor.save_draft(workspace_dir(workspace.id), document_id_or_404(document_id),
                             body.model_dump())


@router.delete("/documents/{document_id}/draft", status_code=204)
def delete_draft(ws: str, document_id: str) -> None:
    workspace = workspace_or_404(ws)
    editor.delete_draft(workspace_dir(workspace.id), document_id_or_404(document_id))


@router.post("/preview")
def post_preview(ws: str, body: PreviewRequest) -> dict:
    repo, analysis, _ = _context(ws)
    return editor.preview(repo, analysis, body.document)
