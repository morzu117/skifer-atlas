"""Versions des documents : un tag `doc/<id>/v<n>` par version (plan 0005).

Le tag pointe sur le commit de fusion de la version. Le plan 0006 les pose à la fusion
d'une proposition ; `missing_tags` retrouve, au `sync`, les versions arrivées sans tag
(pull request fusionnée directement sur l'hébergeur, plan 0020) ; `tag_version` sert aux
tests et aux démonstrations.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from pathlib import Path

import yaml

from .git import RepoError, run_git, show
from .layout import document_files

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


def version_at(repo: Path, revision: str, path: str) -> int | None:
    """`data_product.version` du fichier à cette révision, ou None (absent, illisible)."""
    try:
        data = yaml.safe_load(show(repo, revision, path))
    except (RepoError, yaml.YAMLError):
        return None
    product = data.get("data_product") if isinstance(data, dict) else None
    version = product.get("version") if isinstance(product, dict) else None
    return version if isinstance(version, int) and not isinstance(version, bool) else None


def missing_tags(repo: Path, before: str, after: str) -> list[tuple[str, str]]:
    """Versions apparues entre `before` et `after` sur la branche principale sans leur tag.

    Pour chaque document dont la version a changé, le tag revient au premier commit de la
    branche principale (premier parent : la fusion, comme pour Atlas) qui porte la nouvelle
    version. Une version déjà taguée, ou un document modifié sans changer de version, ne
    donne rien. Renvoie `(tag, commit)` dans l'ordre des documents."""
    changed = set(run_git(["diff", "--name-only", before, after], repo).splitlines())
    existing = set(run_git(["tag", "--list", "doc/*"], repo).split())
    commits = run_git(["rev-list", "--first-parent", "--reverse", f"{before}..{after}"],
                      repo).split()
    found = []
    for file in document_files(repo):
        if file.path not in changed:
            continue
        version = version_at(repo, after, file.path)
        if version is None or version == version_at(repo, before, file.path):
            continue
        name = tag_name(file.expected_id, version)
        if name in existing:
            continue
        first = next((c for c in commits if version_at(repo, c, file.path) == version), None)
        if first is not None:
            found.append((name, first))
    return found
