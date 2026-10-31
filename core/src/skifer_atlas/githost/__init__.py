"""Hébergeurs Git : GitHub, et un dépôt nu local pour les tests et les démos (plan 0006)."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit

from ..repo.git import RepoError
from .base import Comment, GitHost, PullRequest
from .github import GitHubHost, github_repository, github_token
from .local import LocalHost

__all__ = ["Comment", "GitHost", "GitHubHost", "LocalHost", "PullRequest", "host_for",
           "remote_token"]


def _local_path(remote_url: str) -> Path | None:
    parts = urlsplit(remote_url)
    if parts.scheme == "file":
        return Path(parts.path)
    path = Path(remote_url)
    if path.is_absolute() or (not parts.scheme and ":" not in remote_url):
        return path
    return None


def host_for(remote_url: str, main_branch: str = "main",
             workspace_id: str | None = None) -> GitHost:
    """L'hébergeur d'un dépôt, d'après son adresse ; le jeton est celui de l'espace."""
    if not remote_url:
        raise RepoError("no_remote", "Cet espace n'a pas encore de dépôt distant.")
    repository = github_repository(remote_url)
    if repository is not None:
        return GitHubHost(*repository, token=github_token(workspace_id),
                          main_branch=main_branch)
    local = _local_path(remote_url)
    if local is not None:
        return LocalHost(local, main_branch)
    raise RepoError("unsupported_host", "Hébergeur non pris en charge : GitHub ou dépôt local.")


def remote_token(remote_url: str, workspace_id: str | None = None) -> str | None:
    """Jeton à remettre à git pour ce dépôt distant (GitHub en HTTPS seulement)."""
    if remote_url.startswith("https://") and github_repository(remote_url) is not None:
        return github_token(workspace_id)
    return None
