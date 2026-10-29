"""API locale d'Atlas, consommée par l'application de bureau.

Elle n'écoute que sur 127.0.0.1 et exige le token de session que le shell
Tauri lui passe au démarrage : aucun autre processus de la machine ne peut
la piloter par accident.
"""

from __future__ import annotations

import os

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .. import __version__
from ..workspaces import ROLE_LABELS, Workspace, add_workspace, list_workspaces

SESSION_TOKEN = os.environ.get("ATLAS_TOKEN", "")


def require_token(authorization: str | None = Header(default=None)) -> None:
    if SESSION_TOKEN and authorization != f"Bearer {SESSION_TOKEN}":
        raise HTTPException(status_code=401, detail="Token de session invalide.")


def create_app() -> FastAPI:
    app = FastAPI(title="Skifer Atlas", version=__version__)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["tauri://localhost", "http://tauri.localhost", "http://localhost:1420"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "version": __version__}

    @app.get("/api/workspaces", dependencies=[Depends(require_token)])
    def get_workspaces() -> list[dict]:
        return [
            {**ws.model_dump(), "role_label": ROLE_LABELS[ws.role]} for ws in list_workspaces()
        ]

    @app.post("/api/workspaces", dependencies=[Depends(require_token)], status_code=201)
    def post_workspace(ws: Workspace) -> dict:
        try:
            created = add_workspace(ws)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {**created.model_dump(), "role_label": ROLE_LABELS[created.role]}

    return app
