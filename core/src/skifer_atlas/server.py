"""Point d'entrée du sidecar : lance l'API locale sur le port demandé."""

from __future__ import annotations

import os

import uvicorn

from .api.app import create_app


def main() -> None:
    port = int(os.environ.get("ATLAS_PORT", "8765"))
    # loop/http explicites : évite les imports dynamiques que PyInstaller ne voit pas.
    config = uvicorn.Config(
        create_app(),
        host="127.0.0.1",
        port=port,
        loop="asyncio",
        http="h11",
        lifespan="off",
        log_level=os.environ.get("ATLAS_LOG_LEVEL", "info"),
    )
    uvicorn.Server(config).run()


if __name__ == "__main__":
    main()
