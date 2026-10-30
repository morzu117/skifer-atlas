"""Versions des documents : un tag `doc/<id>/v<n>` par version (plan 0005).

Le tag pointe sur le commit de fusion de la version. Le plan 0006 les pose à la fusion
d'une proposition ; ici, `tag_version` sert aux tests et aux démonstrations.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from pathlib import Path

from .git import RepoError, run_git, show

_SEPARATOR = "\x1f"


def tag_name(document_id: str, version: int) -> str:
    return f"doc/{document_id}/v{version}"


@dataclass(frozen=True)
class Version:
    version: int
    commit: str
    date: str  # ISO 8601, date du commit
    author: str  # nom de l'auteur du commit (jamais son adresse)
    message: str

    def to_dict(self) -> dict:
        return asdict(self)


def versions(repo: Path, document_id: str) -> list[Version]:
    """Versions taguées d'un document, de la plus ancienne à la plus récente."""
    output = run_git(["for-each-ref", f"refs/tags/doc/{document_id}/",
                      "--format=%(refname:lstrip=-1)"], repo)
    found = []
    for name in output.splitlines():
        match = re.fullmatch(r"v([1-9][0-9]*)", name)
        if match is None:
            continue
        commit = run_git(["rev-list", "-n", "1", tag_name(document_id, int(match[1]))],
                         repo).strip()
        date, author, message = run_git(
            ["log", "-1", f"--format=%cI{_SEPARATOR}%an{_SEPARATOR}%s", commit], repo,
        ).rstrip("\n").split(_SEPARATOR)
        found.append(Version(int(match[1]), commit, date, author, message))
    return sorted(found, key=lambda v: v.version)


def document_at(repo: Path, document_id: str, version: int, path: str) -> str:
    """Contenu exact du fichier au commit du tag de cette version."""
    try:
        return show(repo, f"refs/tags/{tag_name(document_id, version)}", path)
    except RepoError as error:
        raise RepoError("not_found", f"Version {version} de « {document_id} » introuvable.") \
            from error


def tag_version(repo: Path, document_id: str, version: int, commit: str = "HEAD") -> None:
    run_git(["tag", tag_name(document_id, version), commit], repo)
