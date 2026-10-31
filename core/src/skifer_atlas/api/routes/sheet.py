"""Fiche d'un document (plan 0012) : en-tête et onglets, disposition du graphe, diff
entre versions, implémentations, copie pour une nouvelle version."""

from __future__ import annotations

from fastapi import APIRouter, Query

from ... import sheet as fiche
from ...index import document as search_document
from ...index import ensure_index
from ...workspaces import index_path, repo_dir
from .common import document_id_or_404, not_found, workspace_or_404

router = APIRouter(prefix="/api/workspaces/{ws}/documents/{document_id}")


def _repo(ws: str):
    return repo_dir(workspace_or_404(ws).id)


@router.get("/sheet")
def get_sheet(ws: str, document_id: str) -> dict:
    workspace = workspace_or_404(ws)
    connection = ensure_index(repo_dir(workspace.id), index_path(workspace.id))
    try:
        found = fiche.sheet(connection, repo_dir(workspace.id), document_id_or_404(document_id))
    finally:
        connection.close()
    if found is None:
        raise not_found(f"Document « {document_id} » introuvable.")
    return found


@router.get("/layout")
def get_layout(ws: str, document_id: str, version: int | None = Query(default=None, ge=1)) -> dict:
    return fiche.graph_layout(_repo(ws), document_id_or_404(document_id), version)


@router.get("/diff")
def get_diff(ws: str, document_id: str, base: int = Query(ge=1), other: int = Query(ge=1)) -> dict:
    return fiche.version_diff(_repo(ws), document_id_or_404(document_id), base, other)


@router.get("/canonical-diff")
def get_canonical_diff(ws: str, document_id: str) -> dict:
    """Une déclinaison face à son canonique : deux graphes et rapport de diff (0015)."""
    return fiche.canonical_diff(_repo(ws), document_id_or_404(document_id))


@router.post("/implementations/{entity}/{platform}/extract")
def post_extract(ws: str, document_id: str, entity: str, platform: str) -> dict:
    return fiche.extract_implementation(
        _repo(ws), document_id_or_404(document_id), document_id_or_404(entity),
        document_id_or_404(platform),
    )


@router.get("/draft")
def get_draft(ws: str, document_id: str) -> dict:
    """Copie de la version courante pour l'éditeur (plan 0013), version incrémentée."""
    workspace = workspace_or_404(ws)
    connection = ensure_index(repo_dir(workspace.id), index_path(workspace.id))
    try:
        found = search_document(connection, document_id_or_404(document_id))
    finally:
        connection.close()
    if found is None:
        raise not_found(f"Document « {document_id} » introuvable.")
    text = (repo_dir(workspace.id) / found["path"]).read_text(encoding="utf-8")
    content, base, version = fiche.next_version(text)
    return {"id": document_id, "kind": found["kind"], "label": found["label"],
            "base_version": base, "version": version, "content": content}
