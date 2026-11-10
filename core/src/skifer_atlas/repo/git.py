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
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from functools import cache
from pathlib import Path
from urllib.parse import urlsplit

from ..filelock import LockTimeout, file_lock, file_lock_if_free
from ..masking import mask_secrets

MIN_VERSION = (2, 30)
TIMEOUT = 120  # secondes ; un clone d'annuaire reste petit


class RepoError(Exception):
    """Échec d'une opération sur le dépôt d'un espace, avec un code stable pour l'API."""

    def __init__(self, code: str, message: str, details: list | None = None, output: str = ""):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details  # diagnostics, pour un document ou une gouvernance refusés
        self.output = output  # sortie d'erreur de git, jeton masqué : jamais rendue par l'API


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
        output = (result.stderr or result.stdout).strip()
        message = mask_secrets(message, token)
        output = mask_secrets(output, token)
        raise RepoError(error_code, f"git {args[0]} a échoué : {message}", output=output)
    return result.stdout


# Attente d'un clone tenu par une autre opération avant `clone_busy` : un fetch ou une
# synchronisation dure au plus `TIMEOUT` (120 s) par commande git, plus les tags. Lu à chaque
# appel, pour qu'un test le raccourcisse.
CLONE_WAIT_SECONDS = 150.0


def clone_lock_path(repo: Path) -> Path:
    """Fichier verrou d'un clone : à côté de `repo/`, dans le dossier de l'espace, donc hors de
    l'arbre de travail Git (il ne salit ni `git status` ni un `git clean`)."""
    repo = Path(repo).resolve()
    return repo.parent / f"{repo.name}.lock"


@contextmanager
def clone_lock(repo: Path, timeout: float | None = None, *,
               create_parent: bool = True) -> Iterator[None]:
    """Un seul fetch ou une seule synchronisation à la fois par clone, dans ce processus et
    entre processus (l'app et la CLI, plan 0028 ; ADR 0035 puis 0039). Deux `git fetch`
    concurrents se disputent le verrou des références distantes, et le second échoue (« cannot
    lock ref 'refs/remotes/origin/main' »). Réentrant : une synchronisation peut suivre un
    fetch sous le même verrou. Au-delà de `timeout` secondes, `clone_busy` ; par défaut,
    `timeout` vaut `CLONE_WAIT_SECONDS`.

    Ordre de prise (ADR 0039) : le verrou d'un clone se prend AVANT celui du registre
    (`workspaces.registry_lock`), jamais l'inverse ; un seul clone à la fois."""
    with ExitStack() as stack:
        try:
            stack.enter_context(file_lock(clone_lock_path(repo),
                                          CLONE_WAIT_SECONDS if timeout is None else timeout,
                                          create_parent=create_parent))
        except LockTimeout as error:
            raise RepoError("clone_busy", "Une autre opération (dans l'application ou dans la "
                            "ligne de commande) tient le dépôt de l'espace. Réessayer quand "
                            "elle aura fini.") from error
        yield


@contextmanager
def clone_lock_if_free(repo: Path) -> Iterator[bool]:
    """Comme `clone_lock`, sans attendre : rend `False` quand une autre opération, de ce
    processus ou d'un autre, tient déjà le clone. Sert aux lectures d'état qui ne doivent ni
    bloquer ni voir un état à mi-chemin."""
    with file_lock_if_free(clone_lock_path(repo)) as free:
        yield free


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


_SCP_FORM = re.compile(r"(?:(?P<user>[^@/:]+)@)?(?P<host>[^@/:]+):(?P<path>.+)")


def _scp(url: str) -> re.Match[str] | None:
    """Syntaxe scp (`git@hôte:chemin`). Une lettre seule avant « : » est un lecteur Windows."""
    found = _SCP_FORM.fullmatch(url)
    return found if found and (found["user"] or len(found["host"]) > 1) else None


def normalize_remote_url(url: str) -> str:
    """Forme de comparaison de deux adresses de dépôt : `.git` et `/` finaux, casse du
    schéma et de l'hôte sont sans effet. Le chemin garde sa casse, et un chemin local garde
    son `.git` (`dépôt` et `dépôt.git` peuvent être deux dossiers). L'identifiant éventuel
    est conservé : une adresse qui en porte un n'est jamais celle d'une adresse sans."""
    url = url.strip()
    if "://" in url:
        scheme, _, rest = url.partition("://")
        authority, slash, path = rest.partition("/")
        userinfo, at, host = authority.rpartition("@")
        path = path.rstrip("/")
        if scheme.lower() in ("https", "http", "ssh"):
            path = path.removesuffix(".git").rstrip("/")
        return f"{scheme.lower()}://{userinfo}{at}{host.lower()}{slash}{path}"
    scp = _scp(url)
    if scp:
        user = f"{scp['user']}@" if scp["user"] else ""
        path = scp["path"].rstrip("/").removesuffix(".git").rstrip("/")
        return f"{user}{scp['host'].lower()}:{path}"
    return url.rstrip("/") or url


def mask_remote_url(url: str) -> str:
    """L'adresse prête à être montrée, sans rien de secret : l'identifiant (un jeton mis à la
    main dans `origin`, par exemple) devient `***`, comme la query string et le fragment
    (`?token=…`), remplacés par `?***` et `#***`. Seul `git`, l'utilisateur SSH habituel,
    reste. Toute adresse configurée montrée à l'utilisateur passe par cette fonction."""
    def hide(user: str) -> str:
        return user if user == "git" else "***"

    base = re.split(r"[?#]", url, maxsplit=1)[0]
    suffix = ("?***" if "?" in url.split("#", 1)[0] else "") + ("#***" if "#" in url else "")
    if "://" in base:
        scheme, _, rest = base.partition("://")
        authority, slash, path = rest.partition("/")
        userinfo, at, host = authority.rpartition("@")
        return f"{scheme}://{hide(userinfo) + at if at else ''}{host}{slash}{path}{suffix}"
    scp = _scp(base)
    if scp and scp["user"]:
        return f"{hide(scp['user'])}@{scp['host']}:{scp['path']}{suffix}"
    return base + suffix


def head(repo: Path) -> str:
    return run_git(["rev-parse", "HEAD"], repo).strip()


def show(repo: Path, revision: str, path: str) -> str:
    return run_git(["show", f"{revision}:{path}"], repo, error_code="not_found",
                   encoding="utf-8")
