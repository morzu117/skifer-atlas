"""Dépôts Git temporaires pour les tests du plan 0005.

Pas de `conftest.py` ici : les fixtures s'importent explicitement, ce qui évite un
conflit de nom avec `tests/model/conftest.py`.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

EXAMPLE = Path(__file__).parents[3] / "examples" / "espace-nordis"
USER = "julien.h"


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True,
                          env=os.environ).stdout


@pytest.fixture
def atlas_env(tmp_path, monkeypatch) -> Path:
    """Données d'Atlas et configuration Git isolées du poste."""
    data = tmp_path / "donnees"
    monkeypatch.setenv("ATLAS_DATA_DIR", str(data))
    config = tmp_path / "gitconfig"
    config.write_text("")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(config))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    settings = {"user.name": USER, "user.email": f"{USER}@nordis.example",
                "init.defaultBranch": "main", "commit.gpgsign": "false", "tag.gpgsign": "false"}
    for index, (key, value) in enumerate(settings.items()):
        monkeypatch.setenv(f"GIT_CONFIG_KEY_{index}", key)
        monkeypatch.setenv(f"GIT_CONFIG_VALUE_{index}", value)
    monkeypatch.setenv("GIT_CONFIG_COUNT", str(len(settings)))
    return data


def commit_all(work: Path, message: str) -> str:
    git(work, "add", "-A")
    git(work, "commit", "--quiet", "-m", message)
    return git(work, "rev-parse", "HEAD").strip()


REVENU_NET = "kpis/revenu-net.yaml"
REVENU_NET_V3 = ("version: 4", "version: 3"), ("net des avoirs, ", "")


@pytest.fixture
def remote(atlas_env, tmp_path) -> tuple[Path, Path]:
    """Dépôt nu « distant » de l'espace Groupe Nordis et la copie de travail de son
    auteur (remote `origin`). Revenu net a deux versions taguées (v3 puis v4)."""
    work = tmp_path / "auteur"
    shutil.copytree(EXAMPLE, work)
    git(work, "init", "--quiet", "--initial-branch=main")
    current = (work / REVENU_NET).read_text(encoding="utf-8")
    older = current
    for old, new in REVENU_NET_V3:
        older = older.replace(old, new, 1)
    (work / REVENU_NET).write_text(older, encoding="utf-8")
    commit_all(work, "Espace Groupe Nordis")
    git(work, "tag", "doc/revenu-net/v3")
    (work / REVENU_NET).write_text(current, encoding="utf-8")
    commit_all(work, "Revenu net : déduction des avoirs")
    git(work, "tag", "doc/revenu-net/v4")
    git(work, "tag", "doc/commande/v5")
    bare = tmp_path / "distant.git"
    git(tmp_path, "clone", "--quiet", "--bare", str(work), str(bare))
    git(work, "remote", "add", "origin", str(bare))
    git(work, "fetch", "--quiet", "origin")
    git(work, "branch", "--quiet", "--set-upstream-to=origin/main")
    return bare, work
