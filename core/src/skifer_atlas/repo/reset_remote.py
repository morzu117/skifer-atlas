"""Réinitialiser le rattachement d'un espace resté local (plan 0034, ADR 0038).

Un rattachement interrompu (push accepté puis échec local, push ambigu, erreur de saisie) peut
laisser le clone dans un état que l'utilisateur ne corrige pas depuis Atlas : un `origin`
résiduel, des références distantes, un suivi de branche, un commit d'identité du créateur déjà
fusionné. La réinitialisation remet le clone dans l'état d'un espace local neuf.

Effet local uniquement : le dépôt distant n'est jamais contacté, ni lu, ni modifié. Elle ne
détache jamais un espace rattaché (`git_remote` renseigné dans le registre) et ne perd aucun
commit de l'utilisateur.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import yaml

from ..governance.model import Governance, dump_governance, rename_account, space_referents
from ..workspaces import Workspace, repo_dir
from .git import RepoError, clone_lock, clone_lock_if_free, run_git
from .layout import GOVERNANCE_FILE, read_governance
from .sync import (
    _identity_commit,
    _identity_message,
    _require_clean_governance,
    _require_main_checked_out,
    _require_no_operation_in_progress,
    _valid_meta,
    _workspace,
)

logger = logging.getLogger(__name__)

DONE = "reset"
NOTHING = "nothing_to_do"
INTERRUPTED = "interrupted"  # `attachment` d'un espace resté local dont le rattachement a laissé des restes

# Ce que la réinitialisation dit pour chaque garde : « puis réinitialiser le rattachement ».
_THEN = "réinitialiser le rattachement"
# Les dépôts temporaires de l'inspection (`_require_empty`) vivent dans le dossier temporaire du
# système et sont retirés à la sortie ; seul un processus tué en laisse un. Une heure dépasse
# de loin la durée d'un rattachement : aucun ne peut encore servir.
_STAGING_PREFIX = "atlas-attach-"
_STAGING_MAX_AGE = 3600


def _restore_message(published: str, local: str) -> str:
    """Message du commit de retour de la réinitialisation : sa signature, écrite par
    `_undo_identity` et reconnue par `_identity_to_undo` (même chaîne des deux côtés)."""
    return (f"Identité du créateur : {published} redevient {local}\n\n"
            f"Le rattachement de l'espace a été réinitialisé : « {local} » est de nouveau "
            "l'identité locale du créateur, avec ses rôles.")


def _is_restore_commit(repo: Path, commit: str, local_account: str) -> bool:
    """Le commit de retour d'une réinitialisation précédente (message exact, quel que soit le
    compte publié que son sujet nomme)."""
    message = run_git(["log", "-1", "--format=%B", commit], repo).strip()
    prefix, separator, _rest = message.partition(" redevient ")
    published = prefix.removeprefix("Identité du créateur : ")
    if not separator or published == prefix or not published or " " in published:
        return False
    return message == _restore_message(published, local_account).strip()


@dataclass(frozen=True)
class ResetResult:
    workspace: Workspace
    status: str  # DONE ou NOTHING
    reverted_account: str | None = None  # le compte que la gouvernance désignait, remis au local


@dataclass(frozen=True)
class _Identity:
    published: str  # le login de l'hébergeur, inscrit par le commit d'identité
    governance: Governance  # celle de la tête (et de l'arbre de travail, propre)


def reset_remote(workspace_id: str) -> ResetResult:
    """Remet le clone d'un espace local dans l'état d'un espace neuf, prêt à être rattaché à
    n'importe quelle adresse. Sous le verrou du clone, comme le rattachement."""
    repo = repo_dir(workspace_id)
    _workspace(workspace_id)  # `not_found` avant de prendre le verrou
    with clone_lock(repo):
        workspace = _workspace(workspace_id)  # relu : un rattachement vient peut-être de finir
        if workspace.git_remote:
            raise RepoError("remote_exists", "Cet espace est rattaché à son dépôt distant : "
                            "Atlas ne le détache pas. Rien n'a été modifié.")
        return _reset(workspace, repo)


def _config(repo: Path, pattern: str) -> list[tuple[str, str]]:
    """Clés et valeurs de la configuration du dépôt seul (pas celle de l'utilisateur) dont le
    nom correspond à `pattern`."""
    try:
        output = run_git(["config", "--local", "--get-regexp", pattern], repo)
    except RepoError:
        return []  # git sort en erreur quand rien ne correspond
    return [(key, value) for key, _, value in (line.partition(" ") for line in output.splitlines())]


def _origin_settings(repo: Path) -> list[str]:
    """Réglages du dépôt qui passent par `origin` : suivi des branches (la principale après un
    rattachement, avec sa fusion), envoi par défaut. `git remote remove` les retire aussi."""
    found = dict(_config(repo, r"^(branch\..*\.(remote|pushremote|merge)|remote\.pushdefault)$"))
    keys = []
    for key, value in found.items():
        if value != "origin" or key.endswith(".merge"):
            continue
        keys.append(key)
        merge = key.removesuffix(".remote") + ".merge"
        if key.endswith(".remote") and merge in found:
            keys.append(merge)
    return keys


def _tracking_refs(repo: Path) -> list[str]:
    output = run_git(["for-each-ref", "--format=%(refname)", "refs/remotes/origin"], repo)
    return output.split()


def _identity_to_undo(repo: Path, branch: str, local_account: str) -> _Identity | None:
    """Le commit d'identité du créateur déjà fusionné dans la branche locale, à défaire.

    Il y en a un quand la gouvernance ne contient plus le compte du registre (le compte local
    du créateur) mais contient celui qu'un commit d'identité reconnu a inscrit à sa place.
    Reconnaissance de `_require_empty` : parent unique connu du clone, seul `governance.yaml`
    change, contenu exactement égal au renommage. S'y ajoute la signature d'Atlas : le message
    exact que `_attach` écrit. Un renommage identique fait à la main, sous un autre message, est
    un commit de l'utilisateur : on n'y touche pas.

    La recherche remonte tous les commits qui touchent la gouvernance, du plus récent au plus
    ancien, sans borne : un commit d'identité caché derrière beaucoup d'enregistrements ne doit
    pas faire croire que la gouvernance est en ordre. Si la gouvernance n'a plus le compte du
    registre, qu'aucun commit d'identité ne l'explique et qu'un autre compte est référent de
    l'espace, la réinitialisation refuse (`identity_not_found`) plutôt que de réussir en
    laissant ce compte à la place du créateur. La recherche s'arrête au commit de retour d'une
    réinitialisation précédente : l'identité publiée est déjà défaite, un renommage fait ensuite
    par l'utilisateur ne l'est pas."""
    try:
        governance = read_governance(repo)
    except (OSError, ValueError, yaml.YAMLError):
        return None  # une gouvernance illisible n'est pas celle d'un rattachement interrompu
    if governance is None or any(m.account == local_account for m in governance.members):
        return None
    head = run_git(["rev-parse", f"refs/heads/{branch}"], repo).strip()
    history = run_git(["rev-list", head, "--", GOVERNANCE_FILE], repo).split()
    for commit in history:
        if _is_restore_commit(repo, commit, local_account):
            # Une réinitialisation précédente a déjà défait l'identité publiée : seule la plus récente
            # qui ne l'est pas encore compte. Ce qui suit est un renommage de l'utilisateur.
            break
        found = _identity_commit(repo, commit, local_account, repo)
        if found is None:
            continue
        _, published = found
        message = run_git(["log", "-1", "--format=%B", commit], repo).strip()
        if message != _identity_message(local_account, published).strip():
            continue  # le contenu est celui d'un renommage, mais le commit n'est pas celui d'Atlas
        if rename_account(governance, published, local_account) is governance:
            continue  # le compte publié n'est plus membre : ce n'est plus lui qu'il faut remettre
        return _Identity(published, governance)
    others = sorted(space_referents(governance))
    if others:
        raise RepoError(
            "identity_not_found",
            "La gouvernance de l'espace ne contient plus le compte du créateur "
            f"(« {local_account} ») et désigne « {others[0]} » comme référent, sans qu'un "
            "commit d'identité d'Atlas l'explique. Atlas ne devine pas quelle gouvernance "
            "garder : rien n'a été modifié. Remettez le compte du créateur dans "
            "« governance.yaml », enregistrez le changement, puis réinitialisez le rattachement.")
    return None


def _undo_identity(repo: Path, branch: str, local_account: str, identity: _Identity) -> None:
    from ..proposals.common import commit_files  # import tardif : proposals dépend de sync

    # L'historique n'est jamais réécrit, que le commit d'identité soit la tête ou plus profond : un
    # nouveau commit, créé sans toucher à l'index ni à l'arbre de travail, remet le compte local sur
    # la gouvernance de la tête, puis la branche avance en avance rapide. Seul `governance.yaml`,
    # propre grâce aux gardes, change dans l'arbre ; l'index des autres fichiers est conservé.
    head = run_git(["rev-parse", f"refs/heads/{branch}"], repo).strip()
    restored = commit_files(
        repo, head,
        {GOVERNANCE_FILE: dump_governance(rename_account(identity.governance, identity.published,
                                                         local_account))},
        _restore_message(identity.published, local_account))
    run_git(["merge", "--quiet", "--ff-only", restored], repo)


@dataclass(frozen=True)
class _Found:
    """Ce que le clone garde d'un rattachement : lecture seule, aucune écriture."""
    has_config: bool  # une section `remote.origin`
    tracking: list[str]  # références `refs/remotes/origin/*`
    settings: list[str]  # clés de configuration qui passent par `origin`
    identity: _Identity | None  # commit d'identité du créateur à défaire

    @property
    def pending(self) -> bool:
        return bool(self.has_config or self.tracking or self.settings or self.identity)


def _inspect(repo: Path, branch: str, local_account: str, strict: bool = True) -> _Found:
    """`strict` laisse remonter `identity_not_found` ; sinon une gouvernance inexpliquée n'est
    pas un rattachement interrompu (elle ne compte pas)."""
    try:
        identity = _identity_to_undo(repo, branch, local_account)
    except RepoError as error:
        if strict or error.code != "identity_not_found":
            raise
        identity = None
    return _Found(bool(_config(repo, r"^remote\.origin\.")), _tracking_refs(repo),
                  _origin_settings(repo), identity)


def attachment_state(workspace: Workspace) -> str | None:
    """`"interrupted"` quand l'espace n'est pas rattaché au registre mais que le clone garde un
    `origin`, des références distantes, un suivi ou un commit d'identité d'Atlas non défait : la
    réinitialisation a quelque chose à faire. Sinon `None`.

    Calcul local (quelques lectures git, aucun réseau) avec la logique de la réinitialisation.
    Sans attente : une opération en cours sur le clone (un rattachement) n'est pas un état
    interrompu. Un clone illisible n'est pas signalé."""
    if workspace.git_remote:
        return None
    repo = repo_dir(workspace.id)
    try:
        with clone_lock_if_free(repo) as free:
            if not free:
                return None
            branch = _valid_meta(repo).main_branch
            return INTERRUPTED if _inspect(repo, branch, workspace.account, strict=False).pending else None
    except (RepoError, OSError, ValueError, yaml.YAMLError):
        return None


def _reset(workspace: Workspace, repo: Path) -> ResetResult:
    branch = _valid_meta(repo).main_branch
    # Mêmes gardes que le rattachement, et avant toute écriture : défaire le commit d'identité
    # réécrit `governance.yaml` et déplace la branche principale, qui doit être extraite.
    _require_main_checked_out(repo, branch, _THEN)
    _require_no_operation_in_progress(repo, _THEN)
    _require_clean_governance(repo, _THEN)

    found = _inspect(repo, branch, workspace.account)
    has_config, tracking, settings, identity = found.has_config, found.tracking, found.settings, found.identity
    nothing = not found.pending

    step = "compte du créateur"
    try:
        if identity:
            _undo_identity(repo, branch, workspace.account, identity)
        step = "suivi des branches"
        for key in settings:
            run_git(["config", "--local", "--unset-all", key], repo)
        step = "références distantes"
        for ref in tracking:
            run_git(["update-ref", "--no-deref", "-d", ref], repo)
        step = "adresse d'origin"
        if has_config:
            run_git(["config", "--local", "--remove-section", "remote.origin"], repo)
        if _config(repo, r"^remote\.origin\.") or "origin" in run_git(["remote"], repo).split():
            raise RepoError("git_failed", "origin est défini hors de la configuration du dépôt")
    except (RepoError, OSError, ValueError, yaml.YAMLError) as error:
        # Aucune sortie de git dans le message : elle peut montrer une adresse configurée.
        logger.warning("Réinitialisation du rattachement inachevée (%s, %s).", step,
                       getattr(error, "code", type(error).__name__))
        raise RepoError(
            "reset_incomplete", "La réinitialisation n'a pas pu aller au bout "
            f"(étape : {step}). Aucun commit n'est perdu et le dépôt distant n'a pas été "
            "touché : un nouvel essai la reprend.") from error
    _forget_leftovers()
    if nothing:
        return ResetResult(workspace, NOTHING)
    return ResetResult(workspace, DONE, identity.published if identity else None)


def _forget_leftovers() -> None:
    """Reste sans valeur, retiré au mieux : les dépôts temporaires d'inspection laissés par un
    processus tué. `FETCH_HEAD` n'est pas touché : il peut venir d'une récupération sans rapport
    avec le rattachement. Un échec ici n'est pas celui de la réinitialisation."""
    now = time.time()
    owner = os.getuid() if hasattr(os, "getuid") else None
    for folder in Path(tempfile.gettempdir()).glob(f"{_STAGING_PREFIX}*"):
        try:
            info = folder.lstat()
            if (folder.is_dir() and not folder.is_symlink() and now - info.st_mtime > _STAGING_MAX_AGE
                    and (owner is None or info.st_uid == owner)):
                shutil.rmtree(folder, ignore_errors=True)
        except OSError:
            continue


__all__ = ["DONE", "INTERRUPTED", "NOTHING", "ResetResult", "attachment_state", "reset_remote"]
