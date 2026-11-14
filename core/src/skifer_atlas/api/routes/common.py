"""Contrôles communs aux routes `{ws}` : l'espace doit être au registre local, et un
identifiant n'est accepté que s'il a la forme d'un slug (aucun `..`, aucun `/`)."""

from __future__ import annotations

import re

import duckdb
from fastapi import HTTPException, Request
from fastapi.routing import APIRoute

from ...repo.git import RepoError
from ...repo.layout import SLUG
from ...workspaces import Workspace, get_workspace, repo_dir


def not_found(message: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"code": "not_found", "message": message})


def workspace_or_404(ws: str) -> Workspace:
    workspace = get_workspace(ws)
    if workspace is None:
        raise not_found(f"Espace « {ws} » inconnu.")
    try:
        repo_dir(workspace.id).stat()
    except FileNotFoundError as error:
        raise not_found(f"Espace « {ws} » inconnu.") from error
    return workspace


def document_id_or_404(document_id: str) -> str:
    # `<kpi>--<entité>` pour une variante
    if not all(re.fullmatch(SLUG, part) for part in document_id.split("--", 1)):
        raise not_found(f"Document « {document_id} » introuvable.")
    return document_id


class WorkspaceRoute(APIRoute):
    """Détecte aussi un retrait entre la lecture du registre et celle du clone."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def checked(request: Request):
            ws = request.path_params.get("ws")
            if ws is None:
                return await handler(request)
            try:
                return await handler(request)
            except (OSError, RepoError, duckdb.Error) as original:
                try:
                    workspace_or_404(ws)
                except HTTPException as check_error:
                    if check_error.status_code == 404:
                        raise
                    raise original from None
                except Exception:  # noqa: BLE001 — préserver toute erreur initiale
                    raise original from None
                raise

        return checked
