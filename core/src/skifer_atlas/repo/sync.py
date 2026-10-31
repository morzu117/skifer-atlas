"""Créer, rejoindre et synchroniser l'espace (plans 0005 et 0006).

Le registre local (`workspaces.yaml`) n'est modifié qu'une fois le dépôt en place : une
opération qui échoue ne laisse ni espace fantôme ni clone à moitié écrit. Le rôle de
l'utilisateur se lit dans `governance.yaml`, pour son compte sur l'hébergeur.
"""

from __future__ import annotations

import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import yaml
from pydantic import ValidationError

from ..governance.codeowners import PATH as CODEOWNERS_PATH
from ..governance.codeowners import has_drifted
from ..governance.model import (
    Governance,
    account_from_name,
    dump_governance,
    initial_governance,
    role_of,
)
from ..paths import data_dir
from ..workspaces import Workspace, add_workspace, get_workspace, repo_dir, update_workspace
from .git import RepoError, check_remote_url, head, run_git
from .layout import GOVERNANCE_FILE, META_FILE, WorkspaceMeta, read_governance, read_meta
from .versions import missing_tags


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


def _host_account(remote_url: str, main_branch: str, workspace_id: str | None = None) -> str:
    from ..githost import host_for  # import tardif : githost dépend de repo

    try:
        return host_for(remote_url, main_branch, workspace_id).current_account()
    except RepoError:
        return ""  # pas de jeton, hôte injoignable : lecteur jusqu'au prochain sync


def _token(remote_url: str, workspace_id: str | None = None) -> str | None:
    from ..githost import remote_token

    return remote_token(remote_url, workspace_id)


def _profile(governance: Governance | None, account: str) -> dict:
    if governance is None:
        return {"role": "lecteur", "domains": []}
    return {"role": role_of(governance, account), "domains": [d.id for d in governance.domains]}


def create_workspace(meta: WorkspaceMeta, creator: str | None = None) -> Workspace:
    """Initialise un dépôt local : `atlas.yaml`, `governance.yaml` (le créateur est
    référent) et un commit initial. Le dépôt distant se rattache ensuite (`set_remote`)."""
    from ..githost.local import local_account

    repo = _ensure_new(meta.id)
    account = creator or local_account()
    governance = initial_governance(account, current_user() if creator is None else creator)
    try:
        repo.mkdir(parents=True)
        run_git(["init", "--quiet", f"--initial-branch={meta.main_branch}"], repo)
        (repo / META_FILE).write_text(_dump(meta.model_dump()), encoding="utf-8")
        (repo / GOVERNANCE_FILE).write_text(dump_governance(governance), encoding="utf-8")
        run_git(["add", META_FILE, GOVERNANCE_FILE], repo)
        run_git(["commit", "--quiet", "-m", f"Création de l'espace {meta.name}"], repo)
    except BaseException:
        shutil.rmtree(repo, ignore_errors=True)
        raise
    return add_workspace(Workspace(
        id=meta.id, name=meta.name, sector=meta.sector, account=account,
        entities=meta.entities, **_profile(governance, account),
    ))


def join_workspace(remote_url: str, github_flow: str | None = None) -> Workspace:
    """Clone le dépôt, lit son `atlas.yaml` et ajoute l'espace au registre, avec le rôle
    que `governance.yaml` donne au compte de l'utilisateur sur l'hébergeur.

    `github_flow` : connexion GitHub faite avant l'adhésion, pour un dépôt privé (plan
    0025). Son jeton sert au clonage, puis va au coffre sous l'identifiant de l'espace."""
    from ..githost import device

    check_remote_url(remote_url)
    credential = device.pending(github_flow) if github_flow else None
    token = credential.access_token if credential else _token(remote_url)
    staging = Path(tempfile.mkdtemp(prefix="clone-", dir=data_dir()))
    try:
        clone = staging / "repo"
        run_git(["clone", "--quiet", "--no-recurse-submodules", "--", remote_url, str(clone)],
                error_code="clone_failed", token=token)
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
    if credential is not None and github_flow is not None:
        device.store(meta.id, credential)
        device.release(github_flow)
    account = _host_account(remote_url, meta.main_branch, meta.id)
    return add_workspace(Workspace(
        id=meta.id, name=meta.name, sector=meta.sector, git_remote=remote_url,
        account=account, entities=meta.entities, synced_at=_now(),
        **_profile(governance, account),
    ))


def set_remote(workspace_id: str, remote_url: str) -> Workspace:
    """Rattache un espace créé localement à son dépôt distant (vide) et y pousse."""
    workspace = _workspace(workspace_id)
    if workspace.git_remote:
        raise RepoError("workspace_exists", "Cet espace a déjà un dépôt distant.")
    check_remote_url(remote_url)
    repo = repo_dir(workspace_id)
    branch = read_meta(repo).main_branch
    run_git(["remote", "add", "origin", "--", remote_url], repo)
    try:
        run_git(["push", "--quiet", "--set-upstream", "origin", branch], repo,
                error_code="push_failed", token=_token(remote_url, workspace_id))
    except RepoError:
        run_git(["remote", "remove", "origin"], repo)
        raise
    account = _host_account(remote_url, branch, workspace_id) or workspace.account
    updated = workspace.model_copy(update={
        "git_remote": remote_url, "account": account,
        **_profile(read_governance(repo), account)})
    update_workspace(updated)
    return updated


def refresh_account(workspace_id: str) -> Workspace:
    """Compte et rôle relus sur l'hébergeur, après une connexion GitHub (plan 0025) : un
    espace rejoint sans jeton était en lecture seule jusqu'au prochain sync."""
    workspace = _workspace(workspace_id)
    if not workspace.git_remote:
        return workspace
    repo = repo_dir(workspace_id)
    account = _host_account(workspace.git_remote, read_meta(repo).main_branch, workspace_id)
    if not account or account == workspace.account:
        return workspace
    updated = workspace.model_copy(update={"account": account,
                                           **_profile(read_governance(repo), account)})
    update_workspace(updated)
    return updated


def _workspace(workspace_id: str) -> Workspace:
    workspace = get_workspace(workspace_id)
    if workspace is None:
        raise RepoError("not_found", f"Espace « {workspace_id} » inconnu.")
    return workspace


def _is_ancestor(repo: Path, ancestor: str, descendant: str) -> bool:
    try:
        run_git(["merge-base", "--is-ancestor", ancestor, descendant], repo)
    except RepoError:
        return False
    return True


def _warnings(repo: Path) -> list[dict]:
    codeowners = repo / CODEOWNERS_PATH
    if codeowners.exists() and has_drifted(codeowners.read_text(encoding="utf-8")):
        return [{"code": "codeowners_drift", "message": "CODEOWNERS a été modifié à la main : "
                 "il sera régénéré à la prochaine modification de la gouvernance."}]
    return []


def sync_workspace(workspace_id: str) -> dict:
    """`git fetch` puis avance rapide de la branche principale. Un historique divergent
    lève `sync_conflict` sans toucher au clone : aucune résolution automatique."""
    workspace = _workspace(workspace_id)
    repo = repo_dir(workspace_id)
    branch = read_meta(repo).main_branch
    if not run_git(["remote"], repo).split():
        raise RepoError("no_remote", "Cet espace n'a pas encore de dépôt distant.")
    run_git(["fetch", "--quiet", "--prune", "--tags", "origin"], repo,
            error_code="fetch_failed", token=_token(workspace.git_remote, workspace_id))
    local = head(repo)
    remote = run_git(["rev-parse", "--verify", f"refs/remotes/origin/{branch}"], repo).strip()
    if local == remote:
        result = {"status": "up_to_date", "commit": local}
    elif _is_ancestor(repo, remote, local):
        result = {"status": "ahead", "commit": local}
    elif not _is_ancestor(repo, local, remote):
        raise RepoError("sync_conflict", "L'historique local et celui du dépôt distant ont "
                        "divergé : rien n'a été modifié, la résolution se fait à la main.")
    else:
        run_git(["merge", "--quiet", "--ff-only", remote], repo, error_code="sync_conflict")
        result = {"status": "fast_forward", "commit": remote}
    warnings = []
    if result["status"] == "fast_forward":
        warnings = _catch_up_tags(repo, local, remote, workspace.git_remote, workspace_id)
    meta = read_meta(repo)
    account = workspace.account or _host_account(workspace.git_remote, branch, workspace_id)
    update_workspace(workspace.model_copy(update={
        "name": meta.name, "sector": meta.sector, "entities": meta.entities,
        "account": account, "synced_at": _now(), **_profile(read_governance(repo), account),
    }))
    return {**result, "warnings": warnings + _warnings(repo)}


def _catch_up_tags(repo: Path, before: str, after: str, remote_url: str,
                   workspace_id: str | None = None) -> list[dict]:
    """Tags des versions fusionnées hors d'Atlas (directement sur l'hébergeur), posés au
    clone puis poussés. Chaque membre calcule les mêmes : sans droit d'écriture, le tag
    reste local et le prochain membre qui en a le pousse."""
    found = missing_tags(repo, before, after)
    if not found:
        return []
    for name, commit in found:
        run_git(["tag", name, commit], repo)
    names = ", ".join(name.removeprefix("doc/").replace("/v", " v") for name, _ in found)
    warnings = [{"code": "versions_tagged", "message": f"Version fusionnée hors d'Atlas, "
                 f"taguée au sync : {names}."}]
    try:
        run_git(["push", "--quiet", "origin", *(f"refs/tags/{name}" for name, _ in found)],
                repo, error_code="push_failed", token=_token(remote_url, workspace_id))
    except RepoError:
        warnings.append({"code": "tags_not_pushed", "message": "Les tags n'ont pas pu être "
                         "poussés sur le dépôt distant : ils restent sur ce poste."})
    return warnings


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


host_account = _host_account


__all__ = ["account_from_name", "create_workspace", "host_account", "join_workspace",
           "refresh_account",
           "set_remote", "sync_workspace"]
