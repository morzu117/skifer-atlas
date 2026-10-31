"""API locale d'Atlas, consommée par l'application de bureau.

Elle n'écoute que sur 127.0.0.1 et exige le token de session que le shell
Tauri lui passe au démarrage : aucun autre processus de la machine ne peut
la piloter par accident. Sans token, toute route protégée répond 401, sauf en
mode dev explicite (`ATLAS_DEV_NO_TOKEN=1`).
"""

from __future__ import annotations

import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .. import __version__
from ..repo import RepoError
from .routes import (
    catalog,
    comparisons,
    connections,
    editor,
    governance,
    proposals,
    sheet,
    workspaces,
)

# Code d'erreur métier → statut HTTP ; un code absent donne 500.
ERROR_STATUS = {
    "not_found": 404,
    "platform_not_found": 404,
    "forbidden": 403,
    "workspace_exists": 409,
    "sync_conflict": 409,
    "stale_base": 409,
    "document_exists": 409,
    "comment_required": 422,
    "not_ready": 409,
    "not_open": 409,
    "head_changed": 409,
    "merge_conflict": 409,
    "merge_refused": 409,
    "branch_protected": 409,
    "not_connected": 409,
    "access_expired": 409,
    "oauth_port_busy": 409,
    "query_canceled": 409,
    "needs_auth": 409,
    "not_running": 409,
    "variant_outdated": 409,
    "invalid_remote": 422,
    "credentials_in_url": 422,
    "invalid_workspace": 422,
    "invalid_document": 422,
    "not_a_variant": 422,
    "invalid_governance": 422,
    "no_change": 422,
    "cannot_review_own": 422,
    "host_rejected": 422,
    "no_remote": 422,
    "unsupported_host": 422,
    "invalid_access_point": 422,
    "access_point_exists": 409,
    "invalid_access_points": 422,
    "platform_not_allowed": 422,
    "platform_not_supported": 422,
    "invalid_token": 422,
    "result_too_large": 422,
    "invalid_scope": 422,
    "unknown_scope": 422,
    "scope_required": 422,
    "not_compilable": 422,
    "canonical_not_rebindable": 422,
    "ambiguous_measure": 422,
    "mixed_platforms": 422,
    "no_access_point": 422,
    "ambiguous_access_point": 422,
    "access_point_mismatch": 422,
    "clone_failed": 502,
    "fetch_failed": 502,
    "push_failed": 502,
    "git_failed": 502,
    "host_auth_failed": 502,  # pas 401 : réservé au token de session de l'API locale
    "host_forbidden": 502,
    "host_unreachable": 502,
    "host_failed": 502,
    "oauth_unavailable": 502,
    "oauth_failed": 502,
    "platform_forbidden": 502,
    "query_failed": 502,
    "git_missing": 503,
    "vault_unavailable": 503,
    "git_timeout": 504,
    "query_timeout": 504,
}


def dev_without_token() -> bool:
    return os.environ.get("ATLAS_DEV_NO_TOKEN") == "1"


def require_token(request: Request, authorization: str | None = Header(default=None)) -> None:
    token: str = request.app.state.token
    if not token:
        if request.app.state.dev_no_token:
            return
        raise HTTPException(status_code=401, detail="Aucun token de session configuré.")
    expected = f"Bearer {token}".encode()
    if authorization is None or not hmac.compare_digest(authorization.encode(), expected):
        raise HTTPException(status_code=401, detail="Token de session invalide.")


def create_app(token: str | None = None, dev_no_token: bool | None = None) -> FastAPI:
    app = FastAPI(title="Skifer Atlas", version=__version__)
    app.state.token = os.environ.get("ATLAS_TOKEN", "") if token is None else token
    app.state.dev_no_token = dev_without_token() if dev_no_token is None else dev_no_token
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["tauri://localhost", "http://tauri.localhost", "http://localhost:1420"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(RepoError)
    def repo_error(_: Request, error: RepoError) -> JSONResponse:
        detail = {"code": error.code, "message": error.message}
        if error.details is not None:
            detail["issues"] = error.details
        return JSONResponse(status_code=ERROR_STATUS.get(error.code, 500),
                            content={"detail": detail})

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "version": __version__}

    protected = [Depends(require_token)]
    app.include_router(workspaces.router, dependencies=protected)
    app.include_router(catalog.router, dependencies=protected)
    app.include_router(sheet.router, dependencies=protected)
    app.include_router(editor.router, dependencies=protected)
    app.include_router(proposals.router, dependencies=protected)
    app.include_router(governance.router, dependencies=protected)
    app.include_router(connections.router, dependencies=protected)
    app.include_router(connections.drafts, dependencies=protected)
    app.include_router(comparisons.router, dependencies=protected)
    return app
