"""Réinitialiser le rattachement d'un espace resté local (plan 0034, ADR 0038).

Les états laissés par un rattachement interrompu sont fabriqués avec les mêmes dépôts nus
locaux et les mêmes échecs simulés que `test_set_remote.py`. Chaque test vérifie le clone, le
registre, et les références du dépôt distant avant et après : il n'est jamais touché.
"""

import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_set_remote import (
    AUTH,
    META,
    bare_repository,
    failing_step,
    github,
    identity_host,
    interrupted_identity,
    workspace_state,
)
from workspace_helpers import atlas_env, commit_all, git

from skifer_atlas.api.app import create_app
from skifer_atlas.files import remove_tree
from skifer_atlas.governance.model import role_of
from skifer_atlas.repo import RepoError
from skifer_atlas.repo import reset_remote as reset_module
from skifer_atlas.repo import sync as repo_sync
from skifer_atlas.repo.git import clone_lock
from skifer_atlas.repo.layout import read_governance
from skifer_atlas.repo.reset_remote import (
    DONE,
    INTERRUPTED,
    NOTHING,
    attachment_state,
    reset_remote,
)
from skifer_atlas.repo.sync import create_workspace, set_remote
from skifer_atlas.workspaces import get_workspace, repo_dir

__all__ = ["atlas_env", "github", "identity_host"]  # fixtures importées


def published(bare):
    """Les références du dépôt distant et ce qu'elles pointent : sa seule vérité visible."""
    return git(bare, "for-each-ref", "--format=%(refname) %(objectname)")


def settings(repo):
    """Tout ce que le clone dit d'`origin` : remotes, configuration du dépôt, références."""
    config = git(repo, "config", "--local", "--list")
    return {
        "remotes": git(repo, "remote").split(),
        "origin_config": [line for line in config.splitlines()
                          if line.startswith(("remote.origin.", "branch.main.remote",
                                              "branch.main.merge"))],
        "tracking": git(repo, "for-each-ref", "refs/remotes/origin").split(),
    }


def assert_like_a_new_local_space(repo):
    assert settings(repo) == {"remotes": [], "origin_config": [], "tracking": []}
    with pytest.raises(Exception, match="no upstream|upstream"):
        git(repo, "rev-parse", "--abbrev-ref", "main@{upstream}")


def creator_role(repo, account="ancien"):
    governance = read_governance(repo)
    return role_of(governance, account), [m.account for m in governance.members]


# --- états laissés par un rattachement interrompu ------------------------------------------

@pytest.mark.parametrize(("step", "merged"), [("merge", False), ("branch", True)])
def test_reset_after_a_publication_interrupted_after_the_push(
        identity_host, tmp_path, monkeypatch, step, merged):
    """Le dépôt est publié, `origin` configuré, et soit la fusion, soit le suivi a échoué.
    Fusionné, le commit d'identité désigne `nouveau` dans la gouvernance locale alors que le
    registre garde `ancien` : un commit de retour remet `ancien` sans réécrire l'historique, le
    créateur reste référent."""
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    before_head = git(repo, "rev-parse", "main").strip()
    interrupted_identity(bare, monkeypatch, step)
    assert (git(repo, "rev-parse", "main").strip() != before_head) is merged
    assert "nouveau" in git(bare, "show", "main:governance.yaml")
    remote_before, registry = published(bare), get_workspace(META.id).model_dump()

    result = reset_remote(META.id)

    assert result.status == DONE
    assert result.reverted_account == ("nouveau" if merged else None)
    assert_like_a_new_local_space(repo)
    assert git(repo, "status", "--porcelain") == ""
    assert creator_role(repo) == ("referent", ["ancien"])
    if merged:
        # Jamais de réécriture : l'état d'avant revient par un commit de plus, en avance rapide.
        assert git(repo, "log", "-1", "--format=%s", "main").strip() == (
            "Identité du créateur : nouveau redevient ancien")
        assert git(repo, "merge-base", "--is-ancestor", before_head, "main") == ""
        assert git(repo, "rev-parse", "main^{tree}").strip() == git(
            repo, "rev-parse", f"{before_head}^{{tree}}").strip()
    else:
        assert git(repo, "rev-parse", "main").strip() == before_head
    assert published(bare) == remote_before  # le dépôt distant garde sa publication partielle
    assert get_workspace(META.id).model_dump() == registry
    assert not get_workspace(META.id).git_remote


@pytest.mark.parametrize("autocrlf", ["true", "false"])
def test_reset_restores_the_exact_tree_with_windows_newlines(atlas_env, tmp_path, monkeypatch,
                                                              autocrlf):
    from skifer_atlas.githost.local import LocalHost

    git(tmp_path, "config", "--global", "core.autocrlf", autocrlf)
    monkeypatch.setattr(LocalHost, "current_account", lambda self: "nouveau")
    original_write = Path.write_text

    def windows_write(path, data, *args, **kwargs):
        if path.name in {"atlas.yaml", "governance.yaml"}:
            kwargs.setdefault("newline", "\r\n")
        return original_write(path, data, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", windows_write)
    create_workspace(META, creator="ancien")
    repo = repo_dir(META.id)
    before = git(repo, "rev-parse", "main^{tree}").strip()
    original = subprocess.run(["git", "show", "main:governance.yaml"], cwd=repo,
                              capture_output=True, check=True).stdout
    assert b"\r\n" not in original
    meta = subprocess.run(["git", "show", "main:atlas.yaml"], cwd=repo,
                          capture_output=True, check=True).stdout
    assert b"\r\n" not in meta
    bare = bare_repository(tmp_path)
    interrupted_identity(bare, monkeypatch, "branch")
    assert reset_remote(META.id).status == DONE
    assert git(repo, "rev-parse", "main^{tree}").strip() == before
    restored = subprocess.run(["git", "show", "main:governance.yaml"], cwd=repo,
                              capture_output=True, check=True).stdout
    assert restored == original


@pytest.mark.parametrize("step", ["merge", "branch"])
def test_a_new_attachment_to_another_empty_repository_follows_the_reset(
        identity_host, tmp_path, monkeypatch, step):
    bare = bare_repository(tmp_path)
    interrupted_identity(bare, monkeypatch, step)
    abandoned = published(bare)
    reset_remote(META.id)
    other = bare_repository(tmp_path, "autre.git")

    attached = set_remote(META.id, str(other))

    assert (attached.git_remote, attached.account, attached.role) == (str(other), "nouveau",
                                                                     "referent")
    repo = repo_dir(META.id)
    # Fusionnée, la publication abandonnée et son commit de retour restent dans l'historique du clone
    # (il n'est jamais réécrit) et partent avec lui vers le nouveau dépôt, avant la nouvelle identité.
    history = ["Identité du créateur : ancien devient nouveau"]
    if step == "branch":
        history += ["Identité du créateur : nouveau redevient ancien",
                    "Identité du créateur : ancien devient nouveau"]
    assert git(other, "log", "--format=%s", "main").splitlines() == [
        *history, "Création de l'espace Maison Perrault"]
    assert git(repo, "rev-parse", "main").strip() == git(other, "rev-parse", "main").strip()
    assert creator_role(repo, "nouveau") == ("referent", ["nouveau"])
    assert published(bare) == abandoned


def test_a_new_attachment_to_the_same_repository_resumes_after_the_reset(
        identity_host, tmp_path, monkeypatch):
    """La publication partielle est celle d'Atlas : la même adresse se reprend, le dépôt avance
    en avance rapide (le commit de retour, puis l'identité), jamais par un push forcé."""
    bare = bare_repository(tmp_path)
    interrupted_identity(bare, monkeypatch, "branch")
    remote_head = git(bare, "rev-parse", "main").strip()
    reset_remote(META.id)
    attached = set_remote(META.id, str(bare))
    repo = repo_dir(META.id)
    assert (attached.account, attached.role) == ("nouveau", "referent")
    assert git(bare, "merge-base", "--is-ancestor", remote_head, "main") == ""
    assert git(repo, "rev-parse", "main").strip() == git(bare, "rev-parse", "main").strip()
    assert creator_role(repo, "nouveau") == ("referent", ["nouveau"])


def test_a_residual_origin_with_the_requested_url_is_removed(atlas_env, tmp_path):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", str(bare))
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
    git(repo, "branch", "--set-upstream-to=origin/main", "main")
    remote_before = published(bare)

    result = reset_remote(META.id)

    assert (result.status, result.reverted_account) == (DONE, None)
    assert_like_a_new_local_space(repo)
    assert published(bare) == remote_before == ""


def test_an_origin_with_another_url_is_removed_and_the_space_attaches_elsewhere(
        atlas_env, tmp_path):
    create_workspace(META)
    first = bare_repository(tmp_path, "premier.git")
    second = bare_repository(tmp_path, "second.git")
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", str(first))
    with pytest.raises(RepoError) as conflict:
        set_remote(META.id, str(second))
    assert conflict.value.code == "origin_conflict"
    assert "réinitialisez le rattachement" in conflict.value.message

    reset_remote(META.id)

    assert_like_a_new_local_space(repo)
    assert set_remote(META.id, str(second)).git_remote == str(second)
    assert published(first) == ""


def test_several_urls_and_push_urls_are_all_removed(atlas_env, tmp_path):
    create_workspace(META)
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", str(tmp_path / "a.git"))
    git(repo, "config", "--add", "remote.origin.url", str(tmp_path / "b.git"))
    git(repo, "config", "--add", "remote.origin.pushurl", str(tmp_path / "c.git"))
    git(repo, "config", "--add", "remote.origin.pushurl", str(tmp_path / "d.git"))
    git(repo, "config", "remote.origin.tagopt", "--no-tags")

    assert reset_remote(META.id).status == DONE

    assert_like_a_new_local_space(repo)
    assert "origin" not in git(repo, "config", "--local", "--list")


def test_an_origin_without_url_is_removed(atlas_env):
    create_workspace(META)
    repo = repo_dir(META.id)
    git(repo, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*")
    assert reset_remote(META.id).status == DONE
    assert_like_a_new_local_space(repo)


def test_other_remotes_branches_and_tags_are_left_alone(atlas_env, tmp_path):
    create_workspace(META)
    repo = repo_dir(META.id)
    other = bare_repository(tmp_path, "autre.git")
    git(repo, "remote", "add", "origin", str(tmp_path / "residu.git"))
    git(repo, "remote", "add", "miroir", str(other))
    git(repo, "branch", "travail")
    git(repo, "update-ref", "refs/remotes/miroir/main", "HEAD")
    git(repo, "branch", "--set-upstream-to=miroir/main", "travail")
    git(repo, "tag", "doc/revenu-net/v1")

    reset_remote(META.id)

    assert git(repo, "remote").split() == ["miroir"]
    assert git(repo, "rev-parse", "--abbrev-ref", "travail@{upstream}").strip() == "miroir/main"
    assert git(repo, "tag", "--list").split() == ["doc/revenu-net/v1"]
    assert "travail" in git(repo, "branch", "--list")


# --- le commit d'identité et les commits de l'utilisateur ------------------------------------

def merged_identity(bare, monkeypatch):
    """Rattachement interrompu après la fusion du commit d'identité : `main` = identité."""
    interrupted_identity(bare, monkeypatch, "branch")
    repo = repo_dir(META.id)
    assert "nouveau" in (repo / "governance.yaml").read_text(encoding="utf-8")
    return repo


def test_user_commits_after_the_identity_commit_are_kept(identity_host, tmp_path, monkeypatch):
    """La tête n'est pas le commit d'identité : la branche n'est pas reculée (rien ne serait
    perdu pour autant) ; un commit de plus remet le compte local, et tout reste dans l'historique."""
    bare = bare_repository(tmp_path)
    repo = merged_identity(bare, monkeypatch)
    (repo / "notes.md").write_text("suite locale\n", encoding="utf-8")
    mine = commit_all(repo, "suite locale")
    before = git(repo, "rev-list", "main").split()
    remote_before = published(bare)

    result = reset_remote(META.id)

    assert (result.status, result.reverted_account) == (DONE, "nouveau")
    assert_like_a_new_local_space(repo)
    after = git(repo, "rev-list", "main").split()
    assert set(before) <= set(after)  # aucun commit n'a disparu de l'historique
    assert git(repo, "merge-base", "--is-ancestor", mine, "main") == ""
    assert (repo / "notes.md").read_text(encoding="utf-8") == "suite locale\n"
    assert git(repo, "log", "-1", "--format=%s", "main").strip() == (
        "Identité du créateur : nouveau redevient ancien")
    assert creator_role(repo) == ("referent", ["ancien"])
    assert git(repo, "status", "--porcelain") == ""
    assert published(bare) == remote_before


def test_a_new_attachment_after_user_commits_pushes_them_with_a_new_identity(
        identity_host, tmp_path, monkeypatch):
    bare = bare_repository(tmp_path)
    repo = merged_identity(bare, monkeypatch)
    (repo / "notes.md").write_text("suite locale\n", encoding="utf-8")
    commit_all(repo, "suite locale")
    reset_remote(META.id)
    other = bare_repository(tmp_path, "autre.git")

    attached = set_remote(META.id, str(other))

    assert (attached.account, attached.role) == ("nouveau", "referent")
    assert "suite locale" in git(other, "log", "--format=%s", "main")
    assert creator_role(repo, "nouveau") == ("referent", ["nouveau"])


def test_a_new_attachment_to_the_same_repository_after_user_commits_resumes_it(
        identity_host, tmp_path, monkeypatch):
    """Les commits de l'utilisateur suivent la publication partielle : avance rapide du
    distant, jamais de push forcé ; le créateur reste référent sous le login."""
    bare = bare_repository(tmp_path)
    repo = merged_identity(bare, monkeypatch)
    (repo / "notes.md").write_text("suite locale\n", encoding="utf-8")
    mine = commit_all(repo, "suite locale")
    reset_remote(META.id)

    attached = set_remote(META.id, str(bare))

    assert (attached.account, attached.role) == ("nouveau", "referent")
    assert git(bare, "merge-base", "--is-ancestor", mine, "main") == ""  # poussé sans écraser
    assert creator_role(repo, "nouveau") == ("referent", ["nouveau"])
    assert git(repo, "rev-parse", "main").strip() == git(bare, "rev-parse", "main").strip()


def test_changes_outside_the_governance_survive_and_the_index_is_kept(
        identity_host, tmp_path, monkeypatch):
    """Le commit de retour ne touche ni l'index ni l'arbre de travail : seul `governance.yaml`
    (propre, par les gardes) change. Un fichier sans rapport, mis dans l'index avant la
    réinitialisation, y reste, avec ses autres modifications et les fichiers non suivis."""
    repo = repo_dir(META.id)
    (repo / "notes.md").write_text("v1\n", encoding="utf-8")
    (repo / "plan.md").write_text("v1\n", encoding="utf-8")
    commit_all(repo, "notes et plan")
    bare = bare_repository(tmp_path)
    merged_identity(bare, monkeypatch)
    (repo / "notes.md").write_text("v2 non enregistré\n", encoding="utf-8")
    (repo / "plan.md").write_text("v2 dans l'index\n", encoding="utf-8")
    git(repo, "add", "plan.md")
    (repo / "brouillon.txt").write_text("non suivi\n", encoding="utf-8")

    result = reset_remote(META.id)

    assert result.reverted_account == "nouveau"
    assert (repo / "notes.md").read_text(encoding="utf-8") == "v2 non enregistré\n"
    assert (repo / "plan.md").read_text(encoding="utf-8") == "v2 dans l'index\n"
    assert (repo / "brouillon.txt").read_text(encoding="utf-8") == "non suivi\n"
    assert git(repo, "diff", "--cached", "--name-only").split() == ["plan.md"]  # toujours indexé
    assert git(repo, "diff", "--name-only").split() == ["notes.md"]
    assert git(repo, "status", "--porcelain", "--", "governance.yaml") == ""
    assert creator_role(repo) == ("referent", ["ancien"])


def test_a_manual_rename_with_the_same_content_but_another_message_is_not_undone(
        identity_host, tmp_path, monkeypatch):
    """Provenance : seul un commit d'identité à la signature d'Atlas (son message exact) est
    défait. Le même renommage fait à la main est un commit de l'utilisateur : la gouvernance
    désigne alors un autre référent que le créateur du registre, la réinitialisation refuse."""
    bare = bare_repository(tmp_path)
    repo = merged_identity(bare, monkeypatch)
    git(repo, "commit", "--quiet", "--amend", "-m", "je renomme le compte à la main")
    head = git(repo, "rev-parse", "main").strip()
    before = settings(repo)

    with pytest.raises(RepoError) as error:
        reset_remote(META.id)

    assert error.value.code == "identity_not_found"
    assert git(repo, "rev-parse", "main").strip() == head
    assert settings(repo) == before and before["remotes"] == ["origin"]
    assert "nouveau" in (repo / "governance.yaml").read_text(encoding="utf-8")


def test_an_identity_shaped_commit_with_other_changes_is_refused_and_nothing_moves(
        identity_host, tmp_path, monkeypatch):
    """Même règle que la reprise : un commit qui change autre chose que le renommage n'est
    pas celui d'Atlas, on n'y touche pas. Comme la gouvernance désigne alors un autre référent
    que le créateur du registre, la réinitialisation refuse (`identity_not_found`) au lieu de
    réussir en laissant ce compte : rien n'est modifié, `origin` compris."""
    bare = bare_repository(tmp_path)
    repo = merged_identity(bare, monkeypatch)
    path = repo / "governance.yaml"
    path.write_text(path.read_text(encoding="utf-8") + "# modifié à la main\n", encoding="utf-8")
    git(repo, "add", "-A")
    git(repo, "commit", "--quiet", "--amend", "-m", "identité retouchée à la main")
    head = git(repo, "rev-parse", "main").strip()
    before = settings(repo)

    with pytest.raises(RepoError) as error:
        reset_remote(META.id)

    assert error.value.code == "identity_not_found"
    assert "ancien" in error.value.message and "nouveau" in error.value.message
    assert git(repo, "rev-parse", "main").strip() == head
    assert settings(repo) == before and before["remotes"] == ["origin"]
    assert git(repo, "status", "--porcelain") == ""


def test_a_user_rename_after_a_first_reset_is_not_undone_by_a_second_one(
        identity_host, tmp_path, monkeypatch):
    """Seule l'identité la plus récente qui n'a pas encore été défaite compte. Après un premier
    retour (commit « redevient »), le renommage que l'utilisateur fait lui-même vers le même
    login n'est pas celui d'Atlas : la recherche s'arrête au commit de retour, et la gouvernance,
    qui désigne alors un autre référent, fait refuser la seconde réinitialisation."""
    bare = bare_repository(tmp_path)
    repo = merged_identity(bare, monkeypatch)
    assert reset_remote(META.id).status == DONE
    assert creator_role(repo) == ("referent", ["ancien"])
    # Le renommage à la main, au même contenu que celui d'Atlas, sous son propre message.
    path = repo / "governance.yaml"
    path.write_text(path.read_text(encoding="utf-8").replace("ancien", "nouveau"), encoding="utf-8")
    git(repo, "commit", "--quiet", "-am", "je renomme mon compte")
    git(repo, "remote", "add", "origin", str(bare))
    head = git(repo, "rev-parse", "main").strip()

    with pytest.raises(RepoError) as error:
        reset_remote(META.id)

    assert error.value.code == "identity_not_found"
    assert git(repo, "rev-parse", "main").strip() == head
    assert creator_role(repo, "nouveau") == ("referent", ["nouveau"])  # le choix de l'utilisateur
    assert git(repo, "remote").split() == ["origin"]
    assert git(repo, "status", "--porcelain") == ""


def test_a_governance_without_the_creator_and_without_referent_is_not_blocked(atlas_env):
    """Garde-fou limité : sans aucun autre référent, rien n'est à deviner, `origin` se retire."""
    create_workspace(META)
    repo = repo_dir(META.id)
    path = repo / "governance.yaml"
    governance = read_governance(repo)
    only = governance.model_copy(update={"members": [
        m.model_copy(update={"account": "autre", "roles": []}) for m in governance.members]})
    from skifer_atlas.governance.model import dump_governance
    path.write_text(dump_governance(only), encoding="utf-8")
    commit_all(repo, "gouvernance sans référent")
    git(repo, "remote", "add", "origin", str(repo))

    assert reset_remote(META.id).status == DONE
    assert git(repo, "remote").split() == []


def test_the_identity_commit_is_found_far_back_in_the_history(identity_host, tmp_path, monkeypatch):
    """Plus de borne de 200 commits : plus de 200 enregistrements de gouvernance après le
    commit d'identité ne le cachent pas. Le compte local revient, aucun commit n'est perdu."""
    bare = bare_repository(tmp_path)
    repo = merged_identity(bare, monkeypatch)
    path = repo / "governance.yaml"
    for number in range(210):
        path.write_text(path.read_text(encoding="utf-8") + f"# révision {number}\n", encoding="utf-8")
        git(repo, "commit", "--quiet", "-am", f"révision {number}")
    before = git(repo, "rev-list", "main").split()
    remote_before = published(bare)

    result = reset_remote(META.id)

    assert (result.status, result.reverted_account) == (DONE, "nouveau")
    assert_like_a_new_local_space(repo)
    assert creator_role(repo) == ("referent", ["ancien"])
    assert set(before) <= set(git(repo, "rev-list", "main").split())
    assert git(repo, "status", "--porcelain") == ""
    assert published(bare) == remote_before


# --- idempotence, refus, gardes --------------------------------------------------------------

def test_nothing_to_reset_is_a_success_and_changes_nothing(atlas_env):
    create_workspace(META)
    before = workspace_state()
    first = reset_remote(META.id)
    second = reset_remote(META.id)
    assert (first.status, second.status) == (NOTHING, NOTHING)
    assert workspace_state() == before


def test_a_second_reset_has_nothing_left_to_do(identity_host, tmp_path, monkeypatch):
    bare = bare_repository(tmp_path)
    interrupted_identity(bare, monkeypatch, "branch")
    assert reset_remote(META.id).status == DONE
    after_first = workspace_state()
    assert reset_remote(META.id).status == NOTHING
    assert workspace_state() == after_first


def test_an_attached_workspace_is_never_detached(atlas_env, tmp_path):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    set_remote(META.id, str(bare))
    before, remote_before = workspace_state(), published(bare)
    with pytest.raises(RepoError) as error:
        reset_remote(META.id)
    assert error.value.code == "remote_exists"
    assert "ne le détache pas" in error.value.message
    assert workspace_state() == before and published(bare) == remote_before
    assert git(repo_dir(META.id), "remote").split() == ["origin"]


def test_an_unknown_workspace_is_not_found(atlas_env):
    with pytest.raises(RepoError) as error:
        reset_remote("inconnu")
    assert error.value.code == "not_found"


def partial_state(bare, monkeypatch):
    """Publication partielle, commit d'identité fusionné, `origin` configuré."""
    return merged_identity(bare, monkeypatch)


def edit_governance(repo):
    path = repo / "governance.yaml"
    path.write_text(path.read_text(encoding="utf-8") + "# non enregistré\n", encoding="utf-8")


def stage_governance(repo):
    edit_governance(repo)
    git(repo, "add", "governance.yaml")


def conflict(repo):
    git(repo, "branch", "autre", "HEAD~1")
    git(repo, "checkout", "--quiet", "autre")
    (repo / "governance.yaml").write_text("autre contenu\n", encoding="utf-8")
    commit_all(repo, "autre gouvernance")
    git(repo, "checkout", "--quiet", "main")
    with pytest.raises(Exception, match="conflict|CONFLICT|exit status"):
        git(repo, "merge", "autre")


def merge_head(repo):
    git(repo, "rev-parse", "HEAD")  # un MERGE_HEAD suffit, sans conflit réel
    (repo / ".git" / "MERGE_HEAD").write_text(git(repo, "rev-parse", "HEAD"), encoding="utf-8")


def other_branch(repo):
    git(repo, "checkout", "--quiet", "-b", "travail")


def detached(repo):
    git(repo, "checkout", "--quiet", "--detach")


@pytest.mark.parametrize(("make", "code"), [
    (edit_governance, "workspace_dirty"), (stage_governance, "workspace_dirty"),
    (conflict, "workspace_dirty"), (merge_head, "workspace_dirty"),
    (other_branch, "wrong_branch"), (detached, "wrong_branch"),
])
def test_guards_refuse_before_any_write(identity_host, tmp_path, monkeypatch, make, code):
    bare = bare_repository(tmp_path)
    repo = partial_state(bare, monkeypatch)
    make(repo)
    before = {**workspace_state(), **settings(repo)}
    branches = git(repo, "branch", "--list")
    remote_before = published(bare)

    with pytest.raises(RepoError) as error:
        reset_remote(META.id)

    assert error.value.code == code
    assert "réinitialiser le rattachement" in error.value.message
    assert {**workspace_state(), **settings(repo)} == before  # `origin` et la branche aussi
    assert git(repo, "branch", "--list") == branches
    assert published(bare) == remote_before
    assert settings(repo)["remotes"] == ["origin"]


# --- le dépôt distant n'est jamais touché ----------------------------------------------------

def test_the_reset_never_talks_to_the_remote(github, monkeypatch):
    """Ni l'API de l'hébergeur, ni `push`, `fetch`, `ls-remote` ou `clone` : la réinitialisation
    marche même quand le dépôt distant n'existe plus."""
    create_workspace(META)
    url, bare = github["repository"]("vide")
    with monkeypatch.context() as patch:
        patch.setattr(repo_sync, "run_git", failing_step("merge"))
        with pytest.raises(RepoError) as interrupted:
            set_remote(META.id, url)
    assert interrupted.value.code == "attach_incomplete"
    assert published(bare) != ""
    calls = list(github["calls"])
    remove_tree(bare)  # le dépôt distant disparaît : rien à contacter
    original = reset_module.run_git
    network = []

    def watching(args, *a, **kw):
        network.append(args[0])
        return original(args, *a, **kw)

    with monkeypatch.context() as patch:
        patch.setattr(reset_module, "run_git", watching)
        assert reset_remote(META.id).status == DONE
    assert not {"push", "fetch", "ls-remote", "clone", "pull"} & set(network)
    assert github["calls"] == calls  # pas un seul appel à l'API
    repo = repo_dir(META.id)
    assert_like_a_new_local_space(repo)
    assert creator_role(repo, "anna-k") == ("referent", ["anna-k"])


# --- restes, secrets, reprise, verrou, route --------------------------------------------------

def test_temporary_staging_repositories_are_forgotten_and_fetch_head_is_left(atlas_env, tmp_path):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", str(bare))
    git(repo, "push", "--quiet", "origin", "main")
    git(repo, "fetch", "--quiet", "origin")
    fetch_head = (repo / ".git" / "FETCH_HEAD")
    assert fetch_head.exists()
    fetch_head.write_text("0" * 40 + "\t\tbranch 'main' of un-autre-depot\n", encoding="utf-8")
    temp = tmp_path / "temp"
    old, recent, other = (temp / "atlas-attach-vieux", temp / "atlas-attach-recent",
                          temp / "autre-dossier")
    for folder in (old, recent, other):
        (folder / "objects").mkdir(parents=True)
    hour_ago = time.time() - 2 * 3600
    os.utime(old, (hour_ago, hour_ago))
    os.utime(other, (hour_ago, hour_ago))
    with monkeypatch_tempdir(temp):
        assert tempfile.gettempdir() == str(temp)
        reset_remote(META.id)

    # FETCH_HEAD peut venir d'une récupération sans rapport avec le rattachement : intact.
    assert fetch_head.read_text(encoding="utf-8") == "0" * 40 + "\t\tbranch 'main' of un-autre-depot\n"
    assert not old.exists()  # le dépôt temporaire d'un processus tué
    assert recent.exists()  # peut servir à un rattachement en cours
    assert other.exists()  # n'est pas à Atlas


class monkeypatch_tempdir:
    """Le dossier temporaire du système, redirigé le temps d'un test (sans `undo`)."""

    def __init__(self, folder):
        self.folder = str(folder)

    def __enter__(self):
        self.previous = tempfile.tempdir
        tempfile.tempdir = self.folder

    def __exit__(self, *exc):
        tempfile.tempdir = self.previous


def test_an_interrupted_reset_names_the_step_without_git_output_then_resumes(
        identity_host, tmp_path, monkeypatch):
    bare = bare_repository(tmp_path)
    repo = partial_state(bare, monkeypatch)
    secret = "gho_SECRET-de-git"
    original = reset_module.run_git
    done = []

    def failing(args, *a, **kw):
        if args[0] == "update-ref" and not done:
            done.append(True)
            raise RepoError("git_failed", "échec simulé",
                            output=f"fatal: https://x-access-token:{secret}@github.com/")
        return original(args, *a, **kw)

    with monkeypatch.context() as patch:
        patch.setattr(reset_module, "run_git", failing)
        with pytest.raises(RepoError) as error:
            reset_remote(META.id)
    assert error.value.code == "reset_incomplete"
    assert "références distantes" in error.value.message
    assert secret not in error.value.message and "fatal" not in error.value.message
    assert creator_role(repo) == ("referent", ["ancien"])  # l'identité a déjà été remise
    assert reset_remote(META.id).status == DONE
    assert_like_a_new_local_space(repo)


@pytest.mark.parametrize("failing_write", ["update-ref", "--remove-section"])
def test_a_retry_after_an_interrupted_reset_keeps_the_governance_under_the_local_account(
        identity_host, tmp_path, monkeypatch, failing_write):
    """Le retour du compte du créateur a réussi, une étape de nettoyage échoue : le nouvel essai
    ne trouve plus d'identité à défaire (`reverted_account` vide), et la gouvernance du clone reste
    au compte local. L'écran la relit toujours après un succès : rien ne remet l'ancien compte."""
    bare = bare_repository(tmp_path)
    repo = partial_state(bare, monkeypatch)
    remote_before = published(bare)
    original = reset_module.run_git
    failures = []

    def failing(args, *a, **kw):
        if failing_write in args and not failures:  # une écriture après le retour du compte
            failures.append(True)
            raise RepoError("git_failed", "échec simulé")
        return original(args, *a, **kw)

    with monkeypatch.context() as patch:
        patch.setattr(reset_module, "run_git", failing)
        with pytest.raises(RepoError) as error:
            reset_remote(META.id)
    assert failures and error.value.code == "reset_incomplete"
    assert creator_role(repo) == ("referent", ["ancien"])  # remis avant l'étape qui a échoué
    head = git(repo, "rev-parse", "main").strip()

    retry = reset_remote(META.id)

    assert (retry.status, retry.reverted_account) == (DONE, None)
    assert_like_a_new_local_space(repo)
    assert creator_role(repo) == ("referent", ["ancien"])
    assert "nouveau" not in (repo / "governance.yaml").read_text(encoding="utf-8")
    assert git(repo, "rev-parse", "main").strip() == head  # pas de second retour en arrière
    assert published(bare) == remote_before


def test_the_reset_takes_the_clone_lock(atlas_env):
    create_workspace(META)
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", "/chemin/inexistant.git")
    finished = threading.Event()
    results = []

    def run():
        results.append(reset_remote(META.id))
        finished.set()

    with clone_lock(repo):
        thread = threading.Thread(target=run)
        thread.start()
        assert not finished.wait(0.5)  # attend le verrou d'un rattachement ou d'un fetch
        assert git(repo, "remote").split() == ["origin"]
    thread.join(10)
    assert finished.is_set() and results[0].status == DONE


def test_a_reset_waiting_for_an_attachment_then_refuses_the_attached_space(atlas_env, tmp_path):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    errors = []

    def run():
        try:
            reset_remote(META.id)
        except RepoError as error:
            errors.append(error.code)

    with clone_lock(repo):
        thread = threading.Thread(target=run)
        thread.start()
        time.sleep(0.2)
        set_remote(META.id, str(bare))  # le verrou est réentrant : le même fil rattache
    thread.join(10)
    assert errors == ["remote_exists"]
    assert get_workspace(META.id).git_remote == str(bare)


def test_the_route_resets_and_describes_the_workspace(identity_host, tmp_path, monkeypatch):
    bare = bare_repository(tmp_path)
    repo = partial_state(bare, monkeypatch)
    client = TestClient(create_app(token="secret"), headers=AUTH)
    url = f"/api/workspaces/{META.id}/remote/reset"

    answer = client.post(url)

    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["git_remote"] == "" and body["account"] == "ancien"
    assert (body["role"], body["space_referent"]) == ("referent", True)
    assert body["reset"] == {"status": "reset", "identity_reverted": True,
                             "reverted_account": "nouveau"}
    assert_like_a_new_local_space(repo)
    again = client.post(url)
    assert again.status_code == 200
    assert again.json()["reset"] == {"status": "nothing_to_do", "identity_reverted": False,
                                     "reverted_account": None}
    assert TestClient(create_app(token="secret")).post(url).status_code == 401
    assert client.post("/api/workspaces/inconnu/remote/reset").status_code == 404


# --- l'indicateur `attachment` et la route sans rôle de référent (écran d'un espace rouvert) ---

def test_the_attachment_indicator_for_each_state(identity_host, tmp_path, monkeypatch):
    """`interrupted` quand l'espace est local et que le clone garde un reste de rattachement
    (origin, commit d'identité fusionné) ; rien sinon. Calcul local, sans réseau."""
    assert attachment_state(get_workspace(META.id)) is None  # un espace neuf
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", str(tmp_path / "residu.git"))
    assert attachment_state(get_workspace(META.id)) == INTERRUPTED  # origin résiduel
    git(repo, "remote", "remove", "origin")
    assert attachment_state(get_workspace(META.id)) is None
    bare = bare_repository(tmp_path)
    merged_identity(bare, monkeypatch)
    assert attachment_state(get_workspace(META.id)) == INTERRUPTED  # identité fusionnée
    reset_remote(META.id)
    assert attachment_state(get_workspace(META.id)) is None  # rien après la réinitialisation


def test_the_attachment_indicator_ignores_an_attached_workspace_and_an_unexplained_governance(
        atlas_env, tmp_path):
    create_workspace(META)
    repo = repo_dir(META.id)
    other = bare_repository(tmp_path)
    attached = set_remote(META.id, str(other))
    assert attachment_state(attached) is None  # rattaché : jamais « interrompu », origin ou non
    # Gouvernance sans le créateur et sans commit d'identité d'Atlas, hors rattachement : le
    # refus `identity_not_found` n'est pas un rattachement interrompu.
    create_workspace(META.model_copy(update={"id": "autre-espace", "name": "Autre"}))
    folder = repo_dir("autre-espace")
    path = folder / "governance.yaml"
    creator = read_governance(folder).members[0].account
    path.write_text(path.read_text(encoding="utf-8").replace(creator, "quelquun"), encoding="utf-8")
    commit_all(folder, "gouvernance éditée à la main")
    assert attachment_state(get_workspace("autre-espace")) is None
    assert repo.exists()


def test_the_attachment_indicator_does_not_wait_for_an_operation_holding_the_clone(atlas_env, tmp_path):
    create_workspace(META)
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", str(tmp_path / "residu.git"))
    with clone_lock(repo):
        seen = []
        thread = threading.Thread(target=lambda: seen.append(attachment_state(get_workspace(META.id))))
        thread.start()
        thread.join(5)
        assert not thread.is_alive() and seen == [None]  # un rattachement en cours n'est pas « interrompu »
    assert attachment_state(get_workspace(META.id)) == INTERRUPTED


def test_a_reader_reopens_the_half_attached_workspace_and_resets_it_without_the_referent_role(
        identity_host, tmp_path, monkeypatch):
    """Rattachement interrompu après la fusion de l'identité : la gouvernance locale désigne le
    login, le créateur n'est plus référent (l'Administration est fermée). La route de lecture
    signale le reste, et celle de réinitialisation, sans garde de rôle (un espace local n'existe
    que sur ce poste), le défait et rend le rôle de référent."""
    bare = bare_repository(tmp_path)
    merged_identity(bare, monkeypatch)
    client = TestClient(create_app(token="secret"), headers=AUTH)
    detail = client.get(f"/api/workspaces/{META.id}").json()
    assert (detail["space_referent"], detail["attachment"]) == (False, "interrupted")
    assert client.get(f"/api/workspaces/{META.id}/admin").status_code == 403

    answer = client.post(f"/api/workspaces/{META.id}/remote/reset")

    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert (body["space_referent"], body["attachment"]) == (True, None)
    after = client.get(f"/api/workspaces/{META.id}").json()
    assert (after["space_referent"], after["attachment"]) == (True, None)
    assert client.get(f"/api/workspaces/{META.id}/admin").status_code == 200


def test_the_route_refuses_an_attached_workspace_and_a_dirty_governance(atlas_env, tmp_path):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    client = TestClient(create_app(token="secret"), headers=AUTH)
    url = f"/api/workspaces/{META.id}/remote/reset"
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", str(bare))
    edit_governance(repo)
    dirty = client.post(url)
    assert (dirty.status_code, dirty.json()["detail"]["code"]) == (409, "workspace_dirty")
    git(repo, "checkout", "--quiet", "--", "governance.yaml")
    set_remote(META.id, str(bare))
    attached = client.post(url)
    assert (attached.status_code, attached.json()["detail"]["code"]) == (409, "remote_exists")


def test_a_secret_in_the_configured_url_never_reaches_the_response_or_the_clone(atlas_env):
    create_workspace(META)
    repo = repo_dir(META.id)
    secret = "gho_SECRET-dans-origin"
    git(repo, "remote", "add", "origin", f"https://x-access-token:{secret}@github.com/n/d.git")
    git(repo, "config", "remote.origin.pushurl", f"https://u:{secret}@github.com/n/d.git")
    client = TestClient(create_app(token="secret"), headers=AUTH)

    answer = client.post(f"/api/workspaces/{META.id}/remote/reset")

    assert answer.status_code == 200 and secret not in answer.text
    assert secret not in git(repo, "config", "--local", "--list")
    assert secret not in (repo / ".git" / "config").read_text(encoding="utf-8")
