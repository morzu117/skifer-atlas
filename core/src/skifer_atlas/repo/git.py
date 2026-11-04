"""Git en sous-processus (plan 0005, ADR 0001).

Toujours la CLI `git`, avec un délai, sans invite interactive et code de retour vérifié.
Aucun identifiant ne passe dans une URL ni dans `.git/config` : le jeton de l'hébergeur
est remis à git par un credential helper en ligne (`-c credential.helper=…`) qui le lit
dans l'environnement du seul sous-processus (plan 0006).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from functools import cache
from pathlib import Path
from urllib.parse import urlsplit

MIN_VERSION = (2, 30)
TIMEOUT = 120  # secondes ; un clone d'annuaire reste petit


class RepoError(Exception):
    """Échec d'une opération sur le dépôt d'un espace, avec un code stable pour l'API."""

    def __init__(self, code: str, message: str, details: list | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details  # diagnostics, pour un document ou une gouvernance refusés


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


# Lit le jeton dans l'environnement du sous-processus : la ligne de commande ne le
# contient pas, et rien n'est écrit dans la configuration du dépôt.
_CREDENTIAL_HELPER = ('!f() { test "$1" = get || exit 0; '
                      'while IFS= read -r line && test -n "$line"; do '
                      'test "$line" = protocol=https && protocol_ok=1; '
                      'test "$line" = host=github.com && host_ok=1; done; '
                      'test "$protocol_ok" = 1 && test "$host_ok" = 1 || exit 0; '
                      'echo username=x-access-token; echo "password=$ATLAS_GIT_TOKEN"; }; f')


def run_git(args: list[str], cwd: Path | None = None, timeout: int = TIMEOUT,
            error_code: str = "git_failed", *, input: str | None = None,
            env: dict[str, str] | None = None, token: str | None = None,
            encoding: str | None = None) -> str:
    """Sortie standard d'une commande git ; lève `RepoError` si elle échoue."""
    git_version()
    command = ["git", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always",
               "-c", "protocol.ssh.allow=always"]
    if os.environ.get("ATLAS_ALLOW_LOCAL_GIT") == "1":
        command += ["-c", "protocol.file.allow=always"]
    environment = _env() | (env or {})
    if token:
        command += ["-c", "credential.helper=", "-c", f"credential.helper={_CREDENTIAL_HELPER}"]
        environment["ATLAS_GIT_TOKEN"] = token
    try:
        result = subprocess.run([*command, *args], cwd=cwd, capture_output=True, text=True,
                                check=False, timeout=timeout, env=environment, input=input,
                                encoding=encoding)
    except subprocess.TimeoutExpired as error:
        raise RepoError("git_timeout", f"git {args[0]} n'a pas répondu en {timeout} s.") from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()
        message = detail[-1] if detail else "?"
        if token:
            message = message.replace(token, "***")
        raise RepoError(error_code, f"git {args[0]} a échoué : {message}")
    return result.stdout


_clone_locks: dict[Path, threading.RLock] = {}
_clone_locks_guard = threading.Lock()


@contextmanager
def clone_lock(repo: Path) -> Iterator[None]:
    """Un seul fetch ou une seule synchronisation à la fois par clone, dans ce processus.
    Deux `git fetch` concurrents se disputent le verrou des références distantes, et le
    second échoue (« cannot lock ref 'refs/remotes/origin/main' »). Réentrant : une
    synchronisation peut suivre un fetch sous le même verrou."""
    with _clone_locks_guard:
        lock = _clone_locks.setdefault(Path(repo).resolve(), threading.RLock())
    with lock:
        yield


def check_remote_url(url: str) -> None:
    """N'admet que HTTPS et SSH ; un chemin local exige le mode de test explicite."""
    if not url or any(char.isspace() for char in url) or url.startswith("-"):
        raise RepoError("invalid_remote", "Adresse de dépôt invalide.")
    if os.environ.get("ATLAS_ALLOW_LOCAL_GIT") == "1" and (
            Path(url).is_absolute() or url.startswith("file://")):
        return
    try:
        parts = urlsplit(url)
        if parts.scheme in ("https", "ssh") and parts.hostname and parts.path:
            if parts.password or (parts.scheme == "https" and parts.username):
                raise RepoError("credentials_in_url", "L'adresse du dépôt ne doit contenir "
                                "ni identifiant ni jeton : l'authentification passe par "
                                "le coffre.")
            if not parts.query and not parts.fragment:
                return
    except ValueError:
        pass
    if re.fullmatch(r"[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:.+", url):
        return  # syntaxe SSH scp : git@github.com:organisation/depot.git
    raise RepoError("invalid_remote", "Adresse de dépôt invalide : utiliser HTTPS ou SSH.")


def head(repo: Path) -> str:
    return run_git(["rev-parse", "HEAD"], repo).strip()


def show(repo: Path, revision: str, path: str) -> str:
    return run_git(["show", f"{revision}:{path}"], repo, error_code="not_found",
                   encoding="utf-8")
