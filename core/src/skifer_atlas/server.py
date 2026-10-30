"""Point d'entrée du sidecar : lance l'API locale sur le port demandé."""

from __future__ import annotations

import os
import sys

import uvicorn

from .api.app import create_app, dev_without_token


def main() -> None:
    # Sans token, n'importe quel processus de la machine piloterait l'API : on refuse
    # de démarrer, sauf en mode dev explicite (README racine, section Développement).
    if not os.environ.get("ATLAS_TOKEN") and not dev_without_token():
        print("ATLAS_TOKEN est vide : le serveur refuse de démarrer sans token de session "
              "(ATLAS_DEV_NO_TOKEN=1 pour le seul mode dev).", file=sys.stderr)
        sys.exit(2)
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
