"""Créer, rejoindre et synchroniser l'espace (plans 0005 et 0006).

Le registre local (`workspaces.yaml`) n'est modifié qu'une fois le dépôt en place : une
opération qui échoue ne laisse ni espace fantôme ni clone à moitié écrit. Exception,
`set_remote` : il publie avant de modifier le clone, car Git n'a pas de transaction sur un
dépôt distant. Une étape qui échoue après la publication laisse le dépôt publié, `origin`
configuré et l'espace encore local (`attach_incomplete`) ; un nouvel essai termine alors le
rattachement sans rien republier (ADR 0037). Le rôle de l'utilisateur se lit dans
`governance.yaml`, pour son compte sur l'hébergeur.
"""

from __future__ import annotations

import logging
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
    rename_account,
    role_of,
)
from ..paths import data_dir
from ..workspaces import Workspace, add_workspace, get_workspace, repo_dir, update_workspace
from .git import (
    RepoError,
    check_remote_url,
    clone_lock,
    head,
    mask_remote_url,
    normalize_remote_url,
    run_git,
)
from .layout import GOVERNANCE_FILE, META_FILE, WorkspaceMeta, read_governance, read_meta
from .versions import missing_tags

logger = logging.getLogger(__name__)


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
    # Le jeton va au coffre avant de lire le compte, qui s'en sert. Si une étape échoue
    # ensuite, le clone est retiré et l'ancien jeton éventuel est restauré ; le flux
    # garde son nouveau jeton, et l'adhésion se retente sans refaire la connexion.
    stored = False
    previous = None
    try:
        if credential is not None:
            previous = device.stored(meta.id)
            device.store(meta.id, credential)
            stored = True
        account = _host_account(remote_url, meta.main_branch, meta.id)
        joined = add_workspace(Workspace(
            id=meta.id, name=meta.name, sector=meta.sector, git_remote=remote_url,
            account=account, entities=meta.entities, synced_at=_now(),
            **_profile(governance, account),
        ))
    except BaseException:
        shutil.rmtree(target, ignore_errors=True)
        if stored:
            try:
                if previous is None:
                    device.forget(meta.id)
                else:
                    device.store(meta.id, previous)
            except BaseException as restore_error:  # noqa: BLE001 — préserver l'échec initial
                # La restauration ne doit jamais masquer l'échec de l'adhésion.
                # Ne pas journaliser l'exception : elle pourrait contenir un secret.
                logger.warning("Restauration du coffre GitHub impossible (%s).",
                               type(restore_error).__name__)
        raise
    if github_flow is not None:
        device.release(github_flow)
    return joined


# Marqueurs de la sortie d'erreur de git (LC_ALL=C), pour dire pourquoi un dépôt ne convient pas.
_NOT_FOUND = ("not found", "does not exist", "does not appear to be a git repository",
              "no such file or directory", "returned error: 404")
_AUTH = ("authentication failed", "could not read username", "could not read password",
         "permission denied (publickey", "invalid credentials", "returned error: 401")
_DENIED = ("permission to", "denied to", "returned error: 403", "protected branch",
           "access denied", "insufficient permission")
_STALE = ("non-fast-forward", "fetch first", "[rejected]")


# Ajouté aux refus qu'une réinitialisation du rattachement (plan 0034) peut lever.
_RESET_HINT = (" Vous pouvez aussi réinitialiser le rattachement : seule la copie locale "
               "change, le dépôt distant n'est pas modifié.")


def _explain_git(error: RepoError, push: bool = False) -> RepoError:
    """Le `RepoError` d'une commande git sur le dépôt distant, avec un code qui dit
    pourquoi (plan 0033). La sortie de git ne remonte jamais à l'API."""
    output = error.output.lower()
    if any(marker in output for marker in _NOT_FOUND):
        return RepoError("remote_not_found", "Dépôt introuvable : l'adresse est fausse, ou le "
                         "compte connecté n'y a pas accès.")
    if any(marker in output for marker in _AUTH):
        return RepoError("host_auth_failed", "Le dépôt refuse l'authentification : se "
                         "connecter à GitHub dans Atlas, ou charger la clé SSH de l'agent.")
    if any(marker in output for marker in _DENIED):
        return RepoError("remote_not_writable", "Le compte n'a pas le droit de pousser sur "
                         "ce dépôt.")
    if push and any(marker in output for marker in _STALE):
        return RepoError("remote_not_empty", "Le dépôt a reçu des commits entre-temps : "
                         "il n'est plus vide.")
    if push:
        return error  # `push_failed`, avec la dernière ligne de git
    return RepoError("host_unreachable", "Le dépôt distant est injoignable : vérifier "
                     "l'adresse et la connexion, puis réessayer.")


def _remote_refs(remote_url: str, token: str | None) -> list[list[str]]:
    try:
        output = run_git(["ls-remote", "--refs", "--", remote_url], token=token,
                         error_code="remote_unreachable")
    except RepoError as error:
        raise _explain_git(error) from None
    return [line.split() for line in output.splitlines()]


def _has_commit(repo: Path, commit: str) -> bool:
    try:
        run_git(["cat-file", "-e", f"{commit}^{{commit}}"], repo)
    except RepoError:
        return False
    return True


def _blob_id(repo: Path, text: str) -> str:
    """Identifiant d'objet que Git donnerait à ce texte, sans rien écrire dans le dépôt."""
    with tempfile.TemporaryDirectory(prefix="atlas-hash-") as folder:
        source = Path(folder) / "blob"
        source.write_bytes(text.encode("utf-8"))
        return run_git(["hash-object", "--no-filters", str(source)], repo).strip()


def _identity_message(local: str, published: str) -> str:
    """Message du commit d'identité du créateur : sa signature, que la réinitialisation exige
    (plan 0034) pour ne défaire que les commits créés par `_attach`."""
    return (f"Identité du créateur : {local} devient {published}\n\n"
            f"« {local} » était l'identité locale du créateur de l'espace ; "
            f"l'hébergeur l'authentifie sous « {published} ». Ses rôles sont conservés.")


def _identity_commit(repo: Path, commit: str, old_account: str, known_repo: Path,
                     preferred: str | None = None,
                     token: str | None = None) -> tuple[str, str] | None:
    """Reconnaît un renommage exact, sans déduire l'identité du message de commit.

    Le contenu publié se compare par identifiant d'objet à celui que donnerait le
    renommage vers le compte attendu (`preferred`) : aucun blob n'est lu, ce qui laisse
    l'inspection se faire sur un fetch filtré (`blob:limit`). Un autre compte publié
    demande de lire le fichier ; s'il a été omis par le filtre, Git le récupère seul."""
    parents = run_git(["rev-list", "--parents", "-n", "1", commit], repo).split()
    if len(parents) != 2:
        return None
    parent = parents[1]
    if not _has_commit(known_repo, parent):
        return None
    changed = run_git(["diff-tree", "--no-commit-id", "--name-only", "-r",
                       parent, commit], repo).splitlines()
    if changed != [GOVERNANCE_FILE]:
        return None
    try:
        before = Governance.model_validate(yaml.safe_load(run_git(
            ["show", f"{parent}:{GOVERNANCE_FILE}"], known_repo)))
        listing = run_git(["ls-tree", commit, "--", GOVERNANCE_FILE], repo).split()
        if len(listing) < 3 or listing[1] != "blob":
            return None
        if preferred:
            renamed = rename_account(before, old_account, preferred)
            if renamed is not before and _blob_id(known_repo, dump_governance(renamed)) == listing[2]:
                return parent, preferred
        content = run_git(["cat-file", "blob", listing[2]], repo, token=token, encoding="utf-8")
        after = Governance.model_validate(yaml.safe_load(content))
    except (RepoError, ValueError, ValidationError, yaml.YAMLError):
        return None
    for member in after.members:
        renamed = rename_account(before, old_account, member.account)
        if renamed is not before and dump_governance(renamed) == content:
            return parent, member.account
    return None


def _fetch_tip(staging: Path, remote_url: str, branch: str, token: str | None) -> None:
    """Récupère la pointe de la branche et son parent dans un dépôt temporaire, sans leurs
    gros fichiers (`blob:limit=1k`) : sur un gros dépôt étranger, le téléchargement complet
    pouvait dépasser le délai et masquer `remote_not_empty` par `host_unreachable`. Un
    serveur qui ne prend pas en charge le filtre l'ignore avec un avertissement et envoie
    tout. Le dépôt temporaire a un `origin` nommé : Git refuse un filtre quand l'adresse
    seule, un chemin local par exemple, sert de nom au dépôt « promisor »."""
    run_git(["init", "--bare", "--quiet"], staging)
    run_git(["remote", "add", "origin", "--", remote_url], staging)
    fetch = ["fetch", "--quiet", "--depth=2", "--no-tags"]
    try:
        run_git([*fetch, "--filter=blob:limit=1k", "origin", f"refs/heads/{branch}"], staging,
                token=token)
        return
    except RepoError as error:
        explained = _explain_git(error)
        # Repli : un refus du filtre lui-même. Après un délai dépassé, on n'attend pas deux fois.
        if explained.code != "host_unreachable" or error.code == "git_timeout":
            raise explained from None
    try:
        run_git([*fetch, "origin", f"refs/heads/{branch}"], staging, token=token)
    except RepoError as error:
        raise _explain_git(error) from None


def _require_empty(remote_url: str, token: str | None, repo: Path, branch: str,
                   old_account: str, account: str) -> tuple[str | None, str]:
    """Classe une publication reconnaissable sans modifier le clone."""
    refs = _remote_refs(remote_url, token)
    if not refs:
        return None, "empty"
    local = run_git(["rev-parse", f"refs/heads/{branch}"], repo).strip()
    if len(refs) == 1 and len(refs[0]) == 2 and refs[0][1] == f"refs/heads/{branch}":
        remote = refs[0][0]
        if _has_commit(repo, remote):
            identity = _identity_commit(repo, remote, old_account, repo, account, token)
        else:
            with tempfile.TemporaryDirectory(prefix="atlas-attach-") as folder:
                staging = Path(folder)
                _fetch_tip(staging, remote_url, branch, token)
                fetched = run_git(["rev-parse", "FETCH_HEAD"], staging).strip()
                if fetched != remote:
                    raise RepoError("remote_partial", "La branche distante a changé pendant la "
                                    "vérification : réessayer le rattachement.")
                identity = _identity_commit(staging, remote, old_account, repo, account, token)
        if identity:
            parent, published_account = identity
            if not _is_ancestor(repo, parent, local):
                raise RepoError(
                    "remote_partial", "Clone divergé : la publication partielle repose sur un "
                    "commit qui n'est plus dans la branche locale (après un « git commit "
                    "--amend » ou un « git reset »). Rétablissez la branche locale sur ce "
                    "commit, ou récupérez la publication avec « git fetch origin » et "
                    "rebasez vos commits dessus, avant de réessayer." + _RESET_HINT)
            if published_account != account:
                raise RepoError("remote_partial", "L'espace a été publié sous le compte "
                                f"« {published_account} » : reconnectez-vous à GitHub "
                                f"avec {published_account}, puis réessayez." + _RESET_HINT)
            if parent == local:
                return remote, "identity"
            if remote != local and not _is_ancestor(repo, remote, local):
                raise RepoError(
                    "remote_partial", "Le clone a évolué depuis la publication partielle. "
                    "Récupérez-la avec « git fetch origin », puis rebasez vos commits "
                    "locaux dessus ou annulez-les, avant de réessayer." + _RESET_HINT)
        if remote == local:
            return remote, "same"
        if _is_ancestor(repo, remote, local):
            return remote, "ahead"
    raise RepoError("remote_not_empty", "Ce dépôt n'est pas vide : Atlas ne rattache "
                    "qu'un dépôt vierge, créé sans README, licence ni .gitignore.")


def set_remote(workspace_id: str, remote_url: str) -> Workspace:
    """Rattache un espace créé localement à son dépôt distant, vide, et y pousse (plan 0033).

    Tout est vérifié avant d'écrire : adresse, hébergeur, compte, droits d'écriture, dépôt
    vide. Le créateur est inscrit dans la gouvernance sous son identité locale ; sous
    l'identité authentifiée de l'hébergeur (le login GitHub), il perdrait son rôle de
    référent. Son compte est donc réécrit dans un commit dédié, poussé avec l'historique
    (ADR 0037). Une publication interrompue peut être reprise sans nouveau push."""
    workspace = _workspace(workspace_id)
    if workspace.git_remote:
        raise RepoError("remote_exists", "Cet espace a déjà un dépôt distant.")
    check_remote_url(remote_url)
    repo = repo_dir(workspace_id)
    with clone_lock(repo):
        return _attach(workspace, repo, remote_url)


def _require_main_checked_out(repo: Path, branch: str,
                              then: str = "rattacher le dépôt") -> None:
    """Atlas ne change jamais de branche dans le clone ; après un `git checkout` à la main,
    l'avance rapide qui suit le push ferait avancer une autre branche que la principale.
    `then` complète le message : ce qu'il faut faire une fois la branche rétablie."""
    try:
        current = run_git(["symbolic-ref", "-q", "HEAD"], repo).strip()
    except RepoError:
        current = ""  # HEAD détachée
    if current != f"refs/heads/{branch}":
        shown = current.removeprefix("refs/heads/") or "aucune (HEAD détachée)"
        raise RepoError("wrong_branch", f"La branche « {shown} » est extraite dans le clone de "
                        f"l'espace : revenir sur « {branch} », puis {then}.")


# Fichiers que git pose dans son dossier pendant une opération inachevée.
_OPERATIONS = ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply")


def _require_no_operation_in_progress(repo: Path, then: str = "rattacher le dépôt") -> None:
    """Ni conflit non résolu ni fusion, cherry-pick, revert ou rebase en cours : l'avance
    rapide qui suit le push échouerait, après la publication."""
    unmerged = run_git(["ls-files", "-u"], repo).strip()
    running = [name for name in _OPERATIONS
               if (repo / run_git(["rev-parse", "--git-path", name], repo).strip()).exists()]
    if unmerged or running:
        raise RepoError("workspace_dirty", "Une fusion (ou une opération git) est en cours "
                        "dans le clone de l'espace, ou un conflit n'y est pas résolu : la "
                        f"terminer ou l'abandonner, puis {then}.")


def _require_clean_governance(repo: Path, then: str = "rattacher le dépôt") -> None:
    """`governance.yaml` n'a aucun changement local, enregistré dans l'index ou non. Toujours
    vérifié, qu'il y ait un compte à réécrire ou non : l'avance rapide qui suit le push
    réécrit ce fichier et échouerait, après la publication, sur un fichier modifié ; et la
    gouvernance lue plus bas (renommage, rôle) doit être celle du commit publié, non celle
    d'un fichier modifié à la main. Une fois ce contrôle passé, arbre et branche coïncident."""
    if run_git(["status", "--porcelain", "--", GOVERNANCE_FILE], repo).strip():
        raise RepoError("workspace_dirty", f"« {GOVERNANCE_FILE} » a des modifications non "
                        "enregistrées dans le clone de l'espace : les enregistrer ou les "
                        f"annuler, puis {then}.")


def _require_compatible_origin(repo: Path, remote_url: str) -> bool:
    """Vrai si `origin` existe déjà avec l'adresse demandée (à une écriture équivalente
    près : `.git` ou `/` final, casse de l'hôte), faux s'il n'existe pas. Toute autre
    configuration lève `origin_conflict`, avec l'adresse trouvée, sans identifiant.
    Contrôle local : il précède tout appel à l'hébergeur et à `ls-remote`."""
    if "origin" not in run_git(["remote"], repo).splitlines():
        return False
    # Les URL configurées se lisent littéralement, avant les règles insteadOf.
    config = run_git(["config", "--list"], repo).splitlines()
    configured = [line.partition("=")[2] for line in config
                  if line.startswith("remote.origin.url=")]
    push_urls = [line.partition("=")[2] for line in config
                 if line.startswith("remote.origin.pushurl=")]
    if (len(configured) == 1 and not push_urls
            and normalize_remote_url(configured[0]) == normalize_remote_url(remote_url)):
        return True
    if not configured:
        found = "origin n'a aucune adresse"
    elif len(configured) == 1:
        found = f"origin pointe sur {mask_remote_url(configured[0])}"
    else:
        found = "origin a plusieurs adresses : " + ", ".join(map(mask_remote_url, configured))
    if push_urls:
        found += " et une adresse d'envoi distincte (pushurl) : " + ", ".join(
            map(mask_remote_url, push_urls))
    raise RepoError("origin_conflict", f"Le clone de l'espace a déjà un « origin » qui diffère "
                    f"de l'adresse demandée ({mask_remote_url(remote_url)}) : {found}. "
                    "Corrigez-le, rattachez l'espace à l'adresse qu'il porte, ou réinitialisez le "
                    "rattachement : seule la copie locale change, le dépôt distant n'est "
                    "pas modifié.")


def _attach(workspace: Workspace, repo: Path, remote_url: str) -> Workspace:
    from ..githost import host_for  # import tardif : githost dépend de repo
    from ..githost.github import GitHubHost, github_token
    from ..proposals.common import commit_files  # idem : proposals dépend de ce module

    branch = _valid_meta(repo).main_branch
    _require_main_checked_out(repo, branch)
    _require_no_operation_in_progress(repo)
    _require_clean_governance(repo)
    host = host_for(remote_url, branch, workspace.id)  # `unsupported_host` avant tout
    has_origin = _require_compatible_origin(repo, remote_url)  # local : avant tout appel réseau
    if isinstance(host, GitHubHost) and not github_token(workspace.id):
        raise RepoError("host_auth_failed", "Aucun jeton GitHub pour cet espace : se "
                        "connecter à GitHub avant de rattacher le dépôt.")
    account = host.current_account()
    host.check_writable()
    token = _token(remote_url, workspace.id)
    governance = read_governance(repo)
    renamed = (rename_account(governance, workspace.account, account) if governance
               else governance)
    expected = dump_governance(renamed) if renamed is not governance else None
    published, state = _require_empty(remote_url, token, repo, branch, workspace.account, account)
    local = run_git(["rev-parse", f"refs/heads/{branch}"], repo).strip()
    commit = published if state == "identity" else local
    needs_push = state in ("empty", "ahead")
    if expected is not None and state != "identity":
        commit = commit_files(
            repo, local, {GOVERNANCE_FILE: expected},
            _identity_message(workspace.account, account))
        needs_push = True
    if not has_origin:
        run_git(["remote", "add", "origin", "--", remote_url], repo)
    if needs_push:
        try:
            run_git(["push", "--quiet", "origin", f"{commit}:refs/heads/{branch}"], repo,
                    error_code="push_failed", token=token)
        except RepoError as error:
            explained = _explain_git(error, push=True)
            confirmed = False
            ambiguous = explained.code in ("push_failed", "git_timeout")
            rejected = "[remote rejected]" in error.output.lower()
            if ambiguous and not rejected:
                try:
                    confirmed = _remote_refs(remote_url, token) == [
                        [commit, f"refs/heads/{branch}"]]
                except RepoError:
                    pass
            if not confirmed:
                if not has_origin:
                    run_git(["remote", "remove", "origin"], repo)
                raise explained from None
    # La publication est faite : tout échec d'ici à la fin laisse le dépôt publié et l'espace
    # local, et un nouvel essai termine le rattachement. L'erreur de git n'est jamais rendue.
    step = "récupération de la branche publiée"
    try:
        if state == "identity":
            run_git(["fetch", "--quiet", "--no-tags", "origin",
                     f"+refs/heads/{branch}:refs/remotes/origin/{branch}"], repo,
                    error_code="fetch_failed", token=token)
            fetched = run_git(["rev-parse", f"refs/remotes/origin/{branch}"], repo).strip()
            if fetched != commit:
                raise RepoError("remote_partial", "La branche distante a changé pendant le "
                                "rattachement : réessayer.")
        else:
            run_git(["update-ref", f"refs/remotes/origin/{branch}", commit], repo)
        step = "avance de la branche locale"
        run_git(["merge", "--quiet", "--ff-only", commit], repo)
        step = "branche suivie"
        run_git(["branch", f"--set-upstream-to=origin/{branch}", branch], repo)
        step = "lecture de la gouvernance"
        profile = _profile(read_governance(repo), account)
        step = "enregistrement de l'espace"
        updated = workspace.model_copy(update={
            "git_remote": remote_url, "account": account, **profile})
        update_workspace(updated)
    except (RepoError, OSError, ValueError, yaml.YAMLError) as error:
        if isinstance(error, RepoError) and error.code == "remote_partial":
            raise
        logger.warning("Rattachement inachevé après la publication (%s, %s).", step,
                       getattr(error, "code", type(error).__name__))
        raise RepoError(
            "attach_incomplete", "Le dépôt est publié, mais l'espace n'a pas pu finir de s'y "
            f"rattacher sur ce poste (étape : {step}). Un nouvel essai termine le "
            "rattachement, sans refaire la publication.") from error
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


def _valid_meta(repo: Path) -> WorkspaceMeta:
    try:
        return read_meta(repo)
    except (OSError, ValueError, ValidationError) as error:
        raise RepoError("invalid_workspace", "« atlas.yaml » absent ou invalide dans "
                        "le dépôt de cet espace.") from error


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
    with clone_lock(repo_dir(workspace_id)):
        return _sync(workspace_id)


def _sync(workspace_id: str) -> dict:
    workspace = _workspace(workspace_id)
    repo = repo_dir(workspace_id)
    branch = _valid_meta(repo).main_branch
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
    warnings = _catch_up_tags(repo, local, remote, workspace.git_remote, workspace_id)
    meta = _valid_meta(repo)
    account = workspace.account or _host_account(workspace.git_remote, branch, workspace_id)
    update_workspace(workspace.model_copy(update={
        "name": meta.name, "sector": meta.sector, "entities": meta.entities,
        "account": account, "synced_at": _now(), **_profile(read_governance(repo), account),
    }))
    return {**result, "warnings": warnings + _warnings(repo)}


def _catch_up_tags(repo: Path, before: str, after: str, remote_url: str,
                   workspace_id: str | None = None) -> list[dict]:
    """Rattrape les nouvelles versions et republie les tags locaux absents du distant."""
    # Le clone peut avoir avancé avant un échec de création du tag. Ce repère ne
    # progresse qu'une fois les tags locaux créés, pour que le prochain sync reprenne
    # le parcours même si HEAD est déjà à jour.
    unchecked = False
    try:
        checked = run_git(["rev-parse", "--verify", "refs/atlas/tags-checked"], repo).strip()
    except RepoError:
        checked = before
        unchecked = True
    found = missing_tags(repo, checked, after) if checked != after else []
    for name, commit in found:
        run_git(["tag", name, commit], repo)
    if unchecked or checked != after:
        run_git(["update-ref", "refs/atlas/tags-checked", after], repo)
    warnings = []
    if found:
        names = ", ".join(name.removeprefix("doc/").replace("/v", " v") for name, _ in found)
        warnings.append({"code": "versions_tagged", "message": "Version fusionnée hors "
                         f"d'Atlas, taguée au sync : {names}."})
    local = set(run_git(["tag", "--list", "doc/*"], repo).split())
    if not local:
        return warnings
    try:
        remote = {line.split()[1].removeprefix("refs/tags/") for line in run_git(
            ["ls-remote", "--tags", "--refs", "origin", "refs/tags/doc/*"], repo,
            token=_token(remote_url, workspace_id)).splitlines()}
        pending = sorted(local - remote)
        if pending:
            run_git(["push", "--quiet", "origin", *(f"refs/tags/{name}" for name in pending)],
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
