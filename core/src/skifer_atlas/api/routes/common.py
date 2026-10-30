"""Contrôles communs aux routes `{ws}` : l'espace doit être au registre local, et un
identifiant n'est accepté que s'il a la forme d'un slug (aucun `..`, aucun `/`)."""

from __future__ import annotations

import re

from fastapi import HTTPException

from ...repo.layout import SLUG
from ...workspaces import Workspace, get_workspace


def not_found(message: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"code": "not_found", "message": message})


def workspace_or_404(ws: str) -> Workspace:
    workspace = get_workspace(ws)
    if workspace is None:
        raise not_found(f"Espace « {ws} » inconnu.")
    return workspace


def document_id_or_404(document_id: str) -> str:
    # `<kpi>--<entité>` pour une variante
    if not all(re.match(SLUG, part) for part in document_id.split("--", 1)):
        raise not_found(f"Document « {document_id} » introuvable.")
    return document_id
