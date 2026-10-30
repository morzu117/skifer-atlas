"""Catalogue, fiche, versions et dépendances d'un document (plan 0005) ; facettes,
aperçu et état de l'index pour l'écran Catalogue (plan 0011).

L'index est mis à jour à la demande : s'il ne porte pas sur le commit courant du clone,
la première lecture le reconstruit.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import duckdb
from fastapi import APIRouter

from ...index import catalog as search_catalog
from ...index import dependencies as search_dependencies
from ...index import document as search_document
from ...index import ensure_index, index_fresh
from ...index import facets as search_facets
from ...index import summary as search_summary
from ...repo import versions as repo_versions
from ...repo.layout import read_governance
from ...workspaces import index_path, repo_dir
from .common import document_id_or_404, not_found, workspace_or_404

router = APIRouter(prefix="/api/workspaces/{ws}")


@contextmanager
def _index(ws: str) -> Iterator[duckdb.DuckDBPyConnection]:
    workspace = workspace_or_404(ws)
    connection = ensure_index(repo_dir(workspace.id), index_path(workspace.id))
    try:
        yield connection
    finally:
        connection.close()


def _document(connection: duckdb.DuckDBPyConnection, document_id: str) -> dict:
    found = search_document(connection, document_id_or_404(document_id))
    if found is None:
        raise not_found(f"Document « {document_id} » introuvable.")
    return found


@router.get("/catalog")
def get_catalog(ws: str, q: str | None = None, domain: str | None = None,
                owner: str | None = None, status: str | None = None,
                kind: str | None = None) -> list[dict]:
    with _index(ws) as connection:
        return search_catalog(connection, q, domain, owner, status, kind)


@router.get("/catalog/facets")
def get_facets(ws: str) -> dict:
    """Valeurs des filtres présentes dans l'index ; domaines et propriétaires avec leur
    libellé de gouvernance quand il existe."""
    with _index(ws) as connection:
        found = search_facets(connection)
    governance = read_governance(repo_dir(ws))
    domains = {d.id: d.label for d in governance.domains} if governance else {}
    members = {m.account: m.name for m in governance.members} if governance else {}
    return {
        "domain": [{"value": v, "label": domains.get(v, v)} for v in found["domain"]],
        "owner": [{"value": v, "label": members.get(v, v)} for v in found["owner"]],
        "status": found["status"],
        "kind": found["kind"],
    }


@router.get("/index")
def get_index(ws: str) -> dict:
    """`fresh: false` : la prochaine lecture du catalogue reconstruira l'index."""
    workspace = workspace_or_404(ws)
    return {"fresh": index_fresh(repo_dir(workspace.id), index_path(workspace.id))}


@router.get("/documents/{document_id}/summary")
def get_summary(ws: str, document_id: str) -> dict:
    with _index(ws) as connection:
        found = search_summary(connection, repo_dir(ws), document_id_or_404(document_id))
    if found is None:
        raise not_found(f"Document « {document_id} » introuvable.")
    return found


@router.get("/documents/{document_id}")
def get_document(ws: str, document_id: str) -> dict:
    with _index(ws) as connection:
        found = _document(connection, document_id)
    found["content"] = (repo_dir(ws) / found["path"]).read_text(encoding="utf-8")
    return found


@router.get("/documents/{document_id}/versions")
def get_versions(ws: str, document_id: str) -> list[dict]:
    with _index(ws) as connection:
        _document(connection, document_id)
    return [v.to_dict() for v in repo_versions.versions(repo_dir(ws), document_id)]


@router.get("/documents/{document_id}/versions/{version}")
def get_version(ws: str, document_id: str, version: int) -> dict:
    with _index(ws) as connection:
        found = _document(connection, document_id)
    repo = repo_dir(ws)
    tagged = {v.version: v for v in repo_versions.versions(repo, document_id)}
    if version not in tagged:
        raise not_found(f"Version {version} de « {document_id} » introuvable.")
    content = repo_versions.document_at(repo, document_id, version, found["path"])
    return {**tagged[version].to_dict(), "id": document_id, "content": content}


@router.get("/documents/{document_id}/dependencies")
def get_dependencies(ws: str, document_id: str) -> dict:
    with _index(ws) as connection:
        _document(connection, document_id)
        return search_dependencies(connection, document_id)
