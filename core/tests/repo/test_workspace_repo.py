"""Dépôt d'un espace : disposition, Git, création, adhésion, synchronisation, versions."""

import pytest
import yaml
from workspace_helpers import EXAMPLE, REVENU_NET, USER, atlas_env, commit_all, git, remote

from skifer_atlas.repo import RepoError
from skifer_atlas.repo import git as repo_git
from skifer_atlas.repo.layout import WorkspaceMeta, document_files, read_meta
from skifer_atlas.repo.sync import create_workspace, join_workspace, sync_workspace
from skifer_atlas.repo.versions import document_at, versions
from skifer_atlas.workspaces import get_workspace, list_workspaces, repo_dir

__all__ = ["atlas_env", "remote"]  # fixtures importées


# --- disposition --------------------------------------------------------------------------

def test_layout_of_the_demo_workspace():
    assert read_meta(EXAMPLE).entities == ["nordis-fr", "nordis-de", "nordis-es"]
    files = [(f.kind, f.expected_id, f.path) for f in document_files(EXAMPLE)]
    assert files[0] == ("concept", "client-actif", "concepts/client-actif.yaml")
    assert [f[1] for f in files if f[0] == "variant"] == [
        "revenu-net--nordis-de", "revenu-net--nordis-es", "revenu-net--nordis-fr",
    ]
    assert len(files) == 10


# --- Git ----------------------------------------------------------------------------------

@pytest.mark.parametrize(("url", "code"), [
    ("https://jeton@github.com/nordis/annuaire.git", "credentials_in_url"),
    ("https://moi:secret@github.com/nordis/annuaire.git", "credentials_in_url"),
    ("--upload-pack=touch /tmp/x", "invalid_remote"),
    ("  ", "invalid_remote"),
])
def test_remote_urls_never_carry_credentials(url, code):
    with pytest.raises(RepoError) as error:
        repo_git.check_remote_url(url)
    assert error.value.code == code


def test_missing_git_is_explained(monkeypatch):
    monkeypatch.setattr(repo_git.shutil, "which", lambda _: None)
    repo_git.git_version.cache_clear()
    try:
        with pytest.raises(RepoError) as error:
            repo_git.run_git(["status"])
        assert error.value.code == "git_missing" and "2.30" in error.value.message
    finally:
        repo_git.git_version.cache_clear()


# --- création (critère 1) -----------------------------------------------------------------

def test_create_workspace(atlas_env):
    meta = WorkspaceMeta(id="groupe-nordis", name="Groupe Nordis", sector="Distribution",
                         entities=["nordis-fr"])
    created = create_workspace(meta)
    assert (created.role, created.git_remote) == ("referent", "")
    repo = repo_dir("groupe-nordis")
    assert read_meta(repo) == meta
    governance = yaml.safe_load((repo / "governance.yaml").read_text(encoding="utf-8"))
    assert governance["members"] == [{"account": USER, "name": USER,
                                      "roles": [{"role": "referent", "domains": []}]}]
    assert git(repo, "log", "--format=%s").splitlines() == ["Création de l'espace Groupe Nordis"]
    assert git(repo, "status", "--porcelain") == ""
    assert [w.id for w in list_workspaces()] == ["groupe-nordis"]
    with pytest.raises(RepoError) as error:
        create_workspace(meta)
    assert error.value.code == "workspace_exists"


# --- adhésion (critère 2) -----------------------------------------------------------------

def test_join_clones_and_registers(remote):
    bare, _ = remote
    joined = join_workspace(str(bare))
    assert (joined.id, joined.role, joined.git_remote) == ("groupe-nordis", "referent", str(bare))
    assert joined.domains == ["finance", "ventes", "supply", "marketing"]
    repo = repo_dir("groupe-nordis")
    assert (repo / "kpis" / "revenu-net.yaml").exists()
    with pytest.raises(RepoError) as error:
        join_workspace(str(bare))
    assert error.value.code == "workspace_exists"


def test_join_refuses_a_repository_that_is_not_a_workspace(atlas_env, tmp_path):
    other = tmp_path / "autre"
    other.mkdir()
    git(other, "init", "--quiet")
    (other / "README.md").write_text("Pas un espace.\n")
    commit_all(other, "init")
    with pytest.raises(RepoError) as error:
        join_workspace(str(other))
    assert error.value.code == "invalid_workspace"
    assert list_workspaces() == []
    assert [p.name for p in atlas_env.iterdir()] == []


def test_join_with_an_unreachable_remote(atlas_env, tmp_path):
    with pytest.raises(RepoError) as error:
        join_workspace(str(tmp_path / "absent.git"))
    assert error.value.code == "clone_failed"
    assert list_workspaces() == []


# --- synchronisation (critère 11) ---------------------------------------------------------

def test_sync_fast_forwards(remote):
    bare, work = remote
    join_workspace(str(bare))
    assert sync_workspace("groupe-nordis")["status"] == "up_to_date"
    meta = yaml.safe_load((work / "atlas.yaml").read_text(encoding="utf-8"))
    meta["entities"].append("nordis-it")
    (work / "atlas.yaml").write_text(yaml.safe_dump(meta, sort_keys=False), encoding="utf-8")
    pushed = commit_all(work, "Nouvelle entité : Italie")
    git(work, "push", "--quiet", "origin", "main")
    assert sync_workspace("groupe-nordis") == {"status": "fast_forward", "commit": pushed,
                                               "warnings": []}
    assert git(repo_dir("groupe-nordis"), "rev-parse", "HEAD").strip() == pushed
    assert get_workspace("groupe-nordis").entities[-1] == "nordis-it"


NORDIS_FR = "variants/revenu-net/nordis-fr.yaml"


def merge_on_the_host(work, path, old, new, message):
    """Comme une pull request fusionnée sur GitHub sans Atlas : branche, commit, fusion."""
    git(work, "switch", "--quiet", "-c", "pr")
    text = (work / path).read_text(encoding="utf-8")
    (work / path).write_text(text.replace(old, new, 1), encoding="utf-8")
    commit_all(work, message)
    git(work, "switch", "--quiet", "main")
    git(work, "merge", "--quiet", "--no-ff", "-m", f"Merge pull request #7 : {message}", "pr")
    git(work, "branch", "--quiet", "-D", "pr")
    git(work, "push", "--quiet", "origin", "main")
    return git(work, "rev-parse", "HEAD").strip()


def test_sync_tags_a_version_merged_outside_atlas(remote):
    """Plan 0020 : la version arrivée par une fusion faite sur l'hébergeur reçoit son tag
    au sync, sur le commit de fusion, et le tag part sur le dépôt distant."""
    bare, work = remote
    join_workspace(str(bare))
    merged = merge_on_the_host(work, NORDIS_FR, "version: 2", "version: 3", "FR v3")
    (work / "notes.md").write_text("Sans changement de version.\n")
    head = commit_all(work, "Notes")
    git(work, "push", "--quiet", "origin", "main")
    result = sync_workspace("groupe-nordis")
    assert (result["status"], result["commit"]) == ("fast_forward", head)
    assert result["warnings"] == [{"code": "versions_tagged", "message": "Version fusionnée "
                                   "hors d'Atlas, taguée au sync : revenu-net--nordis-fr v3."}]
    clone = repo_dir("groupe-nordis")
    assert [(v.version, v.commit) for v in versions(clone, "revenu-net--nordis-fr")] == [
        (3, merged)]
    assert git(bare, "rev-parse", "doc/revenu-net--nordis-fr/v3^{commit}").strip() == merged
    assert sync_workspace("groupe-nordis")["warnings"] == []


def test_sync_leaves_versions_tagged_by_atlas_alone(remote):
    bare, work = remote
    join_workspace(str(bare))
    merged = merge_on_the_host(work, NORDIS_FR, "version: 2", "version: 3", "FR v3")
    git(work, "tag", "doc/revenu-net--nordis-fr/v3", merged)
    git(work, "push", "--quiet", "origin", "doc/revenu-net--nordis-fr/v3")
    assert sync_workspace("groupe-nordis")["warnings"] == []


def test_tags_stay_local_when_they_cannot_be_pushed(remote):
    bare, work = remote
    join_workspace(str(bare))
    merge_on_the_host(work, NORDIS_FR, "version: 2", "version: 3", "FR v3")
    hook = bare / "hooks" / "pre-receive"
    hook.write_text("#!/bin/sh\necho 'lecture seule' >&2\nexit 1\n")
    hook.chmod(0o755)
    codes = [w["code"] for w in sync_workspace("groupe-nordis")["warnings"]]
    assert codes == ["versions_tagged", "tags_not_pushed"]
    assert [v.version for v in versions(repo_dir("groupe-nordis"), "revenu-net--nordis-fr")] \
        == [3]


def test_divergent_history_is_a_conflict_and_leaves_the_clone_untouched(remote):
    bare, work = remote
    join_workspace(str(bare))
    clone = repo_dir("groupe-nordis")
    (clone / "notes.md").write_text("Modification locale.\n")
    local = commit_all(clone, "Commit local")
    (work / "autre.md").write_text("Modification distante.\n")
    commit_all(work, "Commit distant")
    git(work, "push", "--quiet", "origin", "main")
    with pytest.raises(RepoError) as error:
        sync_workspace("groupe-nordis")
    assert error.value.code == "sync_conflict"
    assert git(clone, "rev-parse", "HEAD").strip() == local
    assert git(clone, "status", "--porcelain") == ""
    assert not (clone / "autre.md").exists()


def test_sync_without_remote(atlas_env):
    create_workspace(WorkspaceMeta(id="local-seul", name="Local"))
    with pytest.raises(RepoError) as error:
        sync_workspace("local-seul")
    assert error.value.code == "no_remote"


# --- versions (critère 7) -----------------------------------------------------------------

def test_versions_restore_each_tag(remote):
    bare, work = remote
    join_workspace(str(bare))
    clone = repo_dir("groupe-nordis")
    found = versions(clone, "revenu-net")
    assert [(v.version, v.author) for v in found] == [(3, USER), (4, USER)]
    assert found[0].message == "Espace Groupe Nordis"
    assert found[1].commit == git(work, "rev-parse", "doc/revenu-net/v4").strip()
    for version in found:
        expected = git(work, "show", f"doc/revenu-net/v{version.version}:{REVENU_NET}")
        assert document_at(clone, "revenu-net", version.version, REVENU_NET) == expected
    assert "version: 3" in document_at(clone, "revenu-net", 3, REVENU_NET)
    assert versions(clone, "panier-moyen") == []
    with pytest.raises(RepoError) as error:
        document_at(clone, "revenu-net", 9, REVENU_NET)
    assert error.value.code == "not_found"
