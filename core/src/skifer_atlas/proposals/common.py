"""Contexte d'une opération sur les propositions : clone à jour, hôte, gouvernance de la
branche principale (ADR 0008), compte de l'utilisateur ; et plomberie Git commune."""

from __future__ import annotations

import json
import re
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from ..githost import GitHost, host_for, remote_token
from ..governance.model import ROLE_RANK, Governance, parse_governance, role_of
from ..repo.git import RepoError, run_git
from ..repo.layout import GOVERNANCE_FILE, read_meta
from ..repo.sync import sync_workspace
from ..workspaces import Workspace, get_workspace, repo_dir

BLOCK = re.compile(r"```atlas-proposal\n(?P<json>.*?)\n```", re.DOTALL)


@dataclass
class Context:
    workspace: Workspace
    repo: Path
    main_branch: str
    host: GitHost
    token: str | None
    base: str  # tête de la branche principale distante
    governance: Governance
    account: str

    def role(self) -> str:
        return role_of(self.governance, self.account)

    def require(self, role: str) -> None:
        if ROLE_RANK[self.role()] < ROLE_RANK[role]:
            raise RepoError("forbidden", f"Rôle « {role} » requis ; « {self.account} » est "
                            f"{self.role()} dans cet espace.")

    def show(self, path: str, revision: str | None = None) -> str | None:
        try:
            return run_git(["show", f"{revision or self.base}:{path}"], self.repo)
        except RepoError:
            return None


def open_context(workspace_id: str, sync: bool = False) -> Context:
    """`sync` : avance rapide du clone (création et fusion) ; sinon un simple fetch."""
    workspace = get_workspace(workspace_id)
    if workspace is None:
        raise RepoError("not_found", f"Espace « {workspace_id} » inconnu.")
    repo = repo_dir(workspace_id)
    main_branch = read_meta(repo).main_branch
    host = host_for(workspace.git_remote, main_branch)
    token = remote_token(workspace.git_remote)
    if sync:
        sync_workspace(workspace_id)
    else:
        run_git(["fetch", "--quiet", "--prune", "origin"], repo, error_code="fetch_failed",
                token=token)
    base = run_git(["rev-parse", "--verify", f"refs/remotes/origin/{main_branch}"],
                   repo).strip()
    try:
        text = run_git(["show", f"{base}:{GOVERNANCE_FILE}"], repo)
    except RepoError:
        text = ""
    governance, issues = parse_governance(text)
    if governance is None:
        raise RepoError("invalid_governance", "La gouvernance de la branche principale est "
                        "absente ou invalide.", [i.to_dict() for i in issues])
    return Context(workspace, repo, main_branch, host, token, base, governance,
                   host.current_account())


# --- bloc `atlas-proposal` du corps de la PR ---------------------------------------------

def render_body(justification: str, block: dict) -> str:
    payload = json.dumps(block, ensure_ascii=False, indent=2, sort_keys=True)
    return (f"{justification.strip()}\n\n<!-- Bloc lu par Atlas : ne pas modifier. -->\n"
            f"```atlas-proposal\n{payload}\n```\n")


def parse_body(body: str) -> tuple[str, dict | None]:
    """(justification, bloc) ; bloc None si la PR n'a pas été créée par Atlas."""
    match = BLOCK.search(body or "")
    if match is None:
        return (body or "").strip(), None
    try:
        block = json.loads(match["json"])
    except ValueError:
        return body.strip(), None
    justification = body[:match.start()].replace(
        "<!-- Bloc lu par Atlas : ne pas modifier. -->", "").strip()
    return justification, block


# --- plomberie Git -------------------------------------------------------------------------

def commit_files(repo: Path, parent: str, files: dict[str, str], message: str) -> str:
    """Commit enfant de `parent` qui écrit ces fichiers, sans toucher à la copie de
    travail ni à l'index du clone. Auteur : l'identité Git de l'utilisateur."""
    with tempfile.TemporaryDirectory(prefix="atlas-commit-") as tmp:
        env = {"GIT_INDEX_FILE": str(Path(tmp) / "index")}
        run_git(["read-tree", parent], repo, env=env)
        for index, (path, content) in enumerate(sorted(files.items())):
            source = Path(tmp) / f"blob-{index}"
            source.write_bytes(content.encode("utf-8"))
            blob = run_git(["hash-object", "-w", "--no-filters", str(source)], repo).strip()
            run_git(["update-index", "--add", "--cacheinfo", f"100644,{blob},{path}"], repo,
                    env=env)
        tree = run_git(["write-tree"], repo, env=env).strip()
    return run_git(["commit-tree", tree, "-p", parent, "-m", message], repo).strip()


@contextmanager
def checkout(repo: Path, commit: str) -> Iterator[Path]:
    """Extraction temporaire d'un commit, pour le contrôler comme un clone."""
    with tempfile.TemporaryDirectory(prefix="atlas-tree-") as tmp:
        root = Path(tmp) / "tree"
        env = {"GIT_INDEX_FILE": str(Path(tmp) / "index")}
        run_git(["read-tree", commit], repo, env=env)
        run_git(["checkout-index", "--all", f"--prefix={root}/"], repo, env=env)
        root.mkdir(exist_ok=True)
        yield root


def remote_branches(context: Context, prefix: str) -> set[str]:
    output = run_git(["ls-remote", "--heads", "origin", f"refs/heads/{prefix}*"], context.repo,
                     token=context.token)
    return {line.split("refs/heads/", 1)[1] for line in output.splitlines() if line}


def push(context: Context, refspec: str, error_code: str = "push_failed") -> None:
    run_git(["push", "--quiet", "origin", refspec], context.repo, error_code=error_code,
            token=context.token)
