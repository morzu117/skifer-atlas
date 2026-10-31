"""Point d'entrée du sidecar : lance l'API locale sur le port demandé."""

from __future__ import annotations

import os
import sys
import threading

import uvicorn

from . import lifeline
from .api.app import create_app, dev_without_token

# Au-delà, l'arrêt demandé par la surveillance du parent devient immédiat.
SHUTDOWN_GRACE_SECONDS = 5.0


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
    server = uvicorn.Server(config)
    parent = lifeline.parent_pid()
    if parent is not None:
        def stop() -> None:
            server.should_exit = True
            # Une requête longue (comparaison) ne doit pas retenir le serveur orphelin.
            deadline = threading.Timer(SHUTDOWN_GRACE_SECONDS, os._exit, args=(0,))
            deadline.daemon = True  # ne retient pas un arrêt qui se passe bien
            deadline.start()
            # Après l'arrêt demandé : l'app partie, sa sortie n'a souvent plus de lecteur
            # (BrokenPipeError), et l'erreur ne doit ni empêcher l'arrêt ni le faire échouer
            # au vidage final des sorties.
            try:
                print(f"Processus parent {parent} disparu : arrêt du serveur.",
                      file=sys.stderr, flush=True)
            except (OSError, ValueError):
                sys.stdout = sys.stderr = open(os.devnull, "w")  # noqa: SIM115

        lifeline.watch(parent, stop)
    server.run()


if __name__ == "__main__":
    main()
