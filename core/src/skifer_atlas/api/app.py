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
from .routes import catalog, workspaces

# Code d'erreur métier → statut HTTP ; un code absent donne 500.
ERROR_STATUS = {
    "not_found": 404,
    "workspace_exists": 409,
    "sync_conflict": 409,
    "invalid_remote": 422,
    "credentials_in_url": 422,
    "invalid_workspace": 422,
    "no_remote": 422,
    "clone_failed": 502,
    "fetch_failed": 502,
    "git_failed": 502,
    "git_missing": 503,
    "git_timeout": 504,
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
        return JSONResponse(status_code=ERROR_STATUS.get(error.code, 500),
                            content={"detail": {"code": error.code, "message": error.message}})

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "version": __version__}

    protected = [Depends(require_token)]
    app.include_router(workspaces.router, dependencies=protected)
    app.include_router(catalog.router, dependencies=protected)
    return app
