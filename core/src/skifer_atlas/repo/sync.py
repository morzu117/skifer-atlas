"""Créer, rejoindre et synchroniser l'espace (plan 0005).

Le registre local (`workspaces.yaml`) n'est modifié qu'une fois le dépôt en place : une
opération qui échoue ne laisse ni espace fantôme ni clone à moitié écrit.
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

import yaml
from pydantic import ValidationError

from ..paths import data_dir
from ..workspaces import Workspace, add_workspace, get_workspace, repo_dir, update_workspace
from .git import RepoError, check_remote_url, head, run_git
from .layout import (
    GOVERNANCE_FILE,
    META_FILE,
    Governance,
    WorkspaceMeta,
    read_governance,
    read_meta,
)


def _dump(data: dict) -> str:
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=100)


def _ensure_new(workspace_id: str) -> Path:
    repo = repo_dir(workspace_id)
    if get_workspace(workspace_id) is not None or repo.exists():
        raise RepoError("workspace_exists", f"L'espace « {workspace_id} » existe déjà.")
    return repo


def current_user() -> str:
    """Nom Git de l'utilisateur, à défaut « referent »."""
    try:
        return run_git(["config", "user.name"]).strip() or "referent"
    except RepoError:
        return "referent"


def create_workspace(meta: WorkspaceMeta, creator: str | None = None) -> Workspace:
    """Initialise un dépôt local : `atlas.yaml`, `governance.yaml` (le créateur est
    référent) et un commit initial. Le dépôt distant viendra avec le plan 0006."""
    repo = _ensure_new(meta.id)
    creator = creator or current_user()
    governance = Governance(referents=[creator])
    try:
        repo.mkdir(parents=True)
        run_git(["init", "--quiet", f"--initial-branch={meta.main_branch}"], repo)
        (repo / META_FILE).write_text(_dump(meta.model_dump()), encoding="utf-8")
        (repo / GOVERNANCE_FILE).write_text(_dump(governance.model_dump()), encoding="utf-8")
        run_git(["add", META_FILE, GOVERNANCE_FILE], repo)
        run_git(["commit", "--quiet", "-m", f"Création de l'espace {meta.name}"], repo)
    except BaseException:
        shutil.rmtree(repo, ignore_errors=True)
        raise
    return add_workspace(Workspace(
        id=meta.id, name=meta.name, sector=meta.sector, role="referent",
        domains=governance.domains, entities=meta.entities,
    ))


def join_workspace(remote_url: str) -> Workspace:
    """Clone le dépôt, lit son `atlas.yaml` et ajoute l'espace au registre, en lecteur :
    les rôles viendront de `governance.yaml` avec le plan 0006."""
    check_remote_url(remote_url)
    staging = Path(tempfile.mkdtemp(prefix="clone-", dir=data_dir()))
    try:
        clone = staging / "repo"
        run_git(["clone", "--quiet", "--no-recurse-submodules", "--", remote_url, str(clone)],
                error_code="clone_failed")
        try:
            meta = read_meta(clone)
            governance = read_governance(clone)
        except (OSError, ValueError, ValidationError) as error:
            raise RepoError("invalid_workspace", "Ce dépôt n'est pas un espace Atlas : "
                            f"« {META_FILE} » absent ou invalide.") from error
        target = _ensure_new(meta.id)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(clone, target)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return add_workspace(Workspace(
        id=meta.id, name=meta.name, sector=meta.sector, git_remote=remote_url, role="lecteur",
        domains=governance.domains, entities=meta.entities,
    ))


def _is_ancestor(repo: Path, ancestor: str, descendant: str) -> bool:
    try:
        run_git(["merge-base", "--is-ancestor", ancestor, descendant], repo)
    except RepoError:
        return False
    return True


def sync_workspace(workspace_id: str) -> dict:
    """`git fetch` puis avance rapide de la branche principale. Un historique divergent
    lève `sync_conflict` sans toucher au clone : aucune résolution automatique."""
    workspace = get_workspace(workspace_id)
    if workspace is None:
        raise RepoError("not_found", f"Espace « {workspace_id} » inconnu.")
    repo = repo_dir(workspace_id)
    branch = read_meta(repo).main_branch
    if not run_git(["remote"], repo).split():
        raise RepoError("no_remote", "Cet espace n'a pas encore de dépôt distant.")
    run_git(["fetch", "--quiet", "--prune", "origin"], repo, error_code="fetch_failed")
    local = head(repo)
    remote = run_git(["rev-parse", "--verify", f"refs/remotes/origin/{branch}"], repo).strip()
    if local == remote:
        return {"status": "up_to_date", "commit": local}
    if _is_ancestor(repo, remote, local):
        return {"status": "ahead", "commit": local}
    if not _is_ancestor(repo, local, remote):
        raise RepoError("sync_conflict", "L'historique local et celui du dépôt distant ont "
                        "divergé : rien n'a été modifié, la résolution se fait à la main.")
    run_git(["merge", "--quiet", "--ff-only", remote], repo, error_code="sync_conflict")
    meta, governance = read_meta(repo), read_governance(repo)
    update_workspace(workspace.model_copy(update={
        "name": meta.name, "sector": meta.sector, "entities": meta.entities,
        "domains": governance.domains,
    }))
    return {"status": "fast_forward", "commit": remote}
