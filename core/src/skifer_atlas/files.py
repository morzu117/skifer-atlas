"""Suppression des arbres contenant des objets Git en lecture seule."""

import logging
import os
import shutil
import stat
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def remove_tree(path: Path, *, best_effort: bool = False) -> None:
    """Retire les fichiers en lecture seule ; un chemin absent est déjà nettoyé."""
    def retry(function, name, error):
        if not isinstance(error, PermissionError) or not os.path.isfile(name):
            raise error
        os.chmod(name, os.stat(name).st_mode | stat.S_IWRITE)
        function(name)

    def retry_legacy(function, name, exc_info):
        retry(function, name, exc_info[1])

    try:
        if sys.version_info >= (3, 12):
            shutil.rmtree(path, onexc=retry)
        else:
            shutil.rmtree(path, onerror=retry_legacy)
    except Exception as error:
        if isinstance(error, FileNotFoundError) and not path.exists():
            return
        if not best_effort:
            raise
        logger.warning("Nettoyage impossible pour %s (%s).", path, type(error).__name__)
