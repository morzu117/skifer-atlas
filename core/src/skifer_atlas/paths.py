"""Emplacements locaux d'Atlas : tout vit sur la machine de l'utilisateur."""

from pathlib import Path

from platformdirs import user_data_dir


def data_dir() -> Path:
    """Répertoire de données d'Atlas (espaces, bases DuckDB, index)."""
    p = Path(user_data_dir("skifer-atlas", "skifer"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def workspace_dir(workspace_id: str) -> Path:
    """Répertoire propre à un espace de travail (base DuckDB, clone Git, index)."""
    p = data_dir() / "workspaces" / workspace_id
    p.mkdir(parents=True, exist_ok=True)
    return p
