"""Emplacements locaux d'Atlas : tout vit sur la machine de l'utilisateur."""

import os
import re
from pathlib import Path

from platformdirs import user_data_dir

WORKSPACE_ID_PATTERN = r"^[a-z0-9][a-z0-9-]{1,63}$"


def data_dir() -> Path:
    """Répertoire de données d'Atlas (espaces, bases DuckDB, index).

    `ATLAS_DATA_DIR` le déplace : tests, démonstrations, plusieurs profils sur un poste.
    """
    override = os.environ.get("ATLAS_DATA_DIR")
    p = Path(override) if override else Path(user_data_dir("skifer-atlas", "skifer"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def is_workspace_id(workspace_id: str) -> bool:
    return re.fullmatch(WORKSPACE_ID_PATTERN, workspace_id) is not None


def workspace_dir(workspace_id: str) -> Path:
    """Répertoire propre à un espace de travail (base DuckDB, clone Git).

    L'identifiant est un slug : aucun `..` ni séparateur ne peut faire sortir du
    répertoire des espaces.
    """
    if not is_workspace_id(workspace_id):
        raise ValueError(f"Identifiant d'espace invalide : {workspace_id!r}.")
    p = data_dir() / "workspaces" / workspace_id
    p.mkdir(parents=True, exist_ok=True)
    return p
