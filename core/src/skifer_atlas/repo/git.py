"""Git en sous-processus (plan 0005, ADR 0001).

Toujours la CLI `git`, avec un délai, sans invite interactive et code de retour vérifié.
Aucun identifiant ne passe dans une URL : l'authentification viendra du coffre
(`GIT_ASKPASS`, plan 0006).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from functools import cache
from pathlib import Path
from urllib.parse import urlsplit

MIN_VERSION = (2, 30)
TIMEOUT = 120  # secondes ; un clone d'annuaire reste petit


class RepoError(Exception):
    """Échec d'une opération sur le dépôt d'un espace, avec un code stable pour l'API."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _env() -> dict[str, str]:
    env = dict(os.environ)
    env.update(GIT_TERMINAL_PROMPT="0", LC_ALL="C", GIT_CONFIG_NOSYSTEM="1")
    return env


@cache
def git_version() -> tuple[int, ...]:
    if shutil.which("git") is None:
        raise RepoError("git_missing", "Git est introuvable : installer Git 2.30 ou plus récent "
                       "(https://git-scm.com/downloads), puis relancer Atlas.")
    output = subprocess.run(["git", "--version"], capture_output=True, text=True, check=False,
                            timeout=10).stdout
    match = re.search(r"(\d+)\.(\d+)", output)
    version = tuple(int(part) for part in match.groups()) if match else (0, 0)
    if version < MIN_VERSION:
        raise RepoError("git_missing", f"Git {'.'.join(map(str, version))} est trop ancien : "
                       "installer Git 2.30 ou plus récent.")
    return version


def run_git(args: list[str], cwd: Path | None = None, timeout: int = TIMEOUT,
            error_code: str = "git_failed") -> str:
    """Sortie standard d'une commande git ; lève `RepoError` si elle échoue."""
    git_version()
    try:
        result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True,
                                check=False, timeout=timeout, env=_env())
    except subprocess.TimeoutExpired as error:
        raise RepoError("git_timeout", f"git {args[0]} n'a pas répondu en {timeout} s.") from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()
        raise RepoError(error_code, f"git {args[0]} a échoué : {detail[-1] if detail else '?'}")
    return result.stdout


def check_remote_url(url: str) -> None:
    """Refuse une URL qui porte un identifiant (`https://jeton@hôte/…`)."""
    parts = urlsplit(url)
    if parts.scheme in ("http", "https") and (parts.username or parts.password):
        raise RepoError("credentials_in_url", "L'adresse du dépôt ne doit contenir ni "
                       "identifiant ni jeton : l'authentification passe par le coffre.")
    if not url.strip() or url.startswith("-"):
        raise RepoError("invalid_remote", "Adresse de dépôt invalide.")


def head(repo: Path) -> str:
    return run_git(["rev-parse", "HEAD"], repo).strip()


def show(repo: Path, revision: str, path: str) -> str:
    return run_git(["show", f"{revision}:{path}"], repo, error_code="not_found")
