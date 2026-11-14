"""Construit le dépôt de démonstration Nordis avec son historique Git."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def build(dest: Path) -> None:
    work = dest / "travail"
    shutil.copytree(HERE / "espace-nordis", work)

    def git(*args: str, env: dict[str, str] | None = None) -> None:
        subprocess.run(["git", *args], cwd=work, env=env, check=True,
                       capture_output=True)

    def commit(author: str, date: str, message: str) -> None:
        git("add", "-A")
        timestamp = f"{date}T09:00:00+02:00"
        env = os.environ | {"GIT_AUTHOR_DATE": timestamp, "GIT_COMMITTER_DATE": timestamp}
        git("-c", f"user.name={author}", "-c", "user.email=demo@exemple.invalid",
            "-c", "commit.gpgsign=false", "commit", "-qm", message, env=env)

    git("init", "-q", "-b", "main")
    versions = [
        ("Claire M.", "2026-01-15", "Espace Groupe Nordis ; Revenu net v1 : chiffre d'affaires hors taxes"),
        ("Claire M.", "2026-03-09", "Revenu net v2 : déduction des avoirs"),
        ("Marc D.", "2026-06-02", "Revenu net v3 : points de variation déclarés (taxes, mois fiscal)"),
    ]
    for n, (author, date, message) in enumerate(versions, 1):
        shutil.copyfile(HERE / "historique-nordis" / f"revenu-net.v{n}.yaml",
                        work / "kpis" / "revenu-net.yaml")
        commit(author, date, message)
        git("tag", f"doc/revenu-net/v{n}")
    shutil.copyfile(HERE / "espace-nordis" / "kpis" / "revenu-net.yaml",
                    work / "kpis" / "revenu-net.yaml")
    commit("Claire M.", "2026-10-12", "Revenu net v4 : mois fiscal sur la date comptable")
    git("tag", "doc/revenu-net/v4")
    git("tag", "doc/commande/v5")
    git("clone", "-q", "--bare", ".", str(dest.resolve() / "distant.git"))


if __name__ == "__main__":
    build(Path(sys.argv[1]))
