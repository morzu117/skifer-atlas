"""Un espace enregistré reste visible lorsque sa copie locale a disparu."""

import shutil

import pytest
from test_proposals import client, joined
from workspace_helpers import atlas_env, commit_all, git, remote

from skifer_atlas.workspaces import repo_dir

__all__ = ["atlas_env", "client", "joined", "remote"]

MESSAGE = ("Le dossier local de l'espace ou son fichier atlas.yaml est introuvable. "
           "Restaurez-les, puis réessayez.")
DETAIL = {"detail": {"code": "local_repo_missing", "message": MESSAGE}}
WS = "/api/workspaces/groupe-nordis"


@pytest.mark.parametrize("missing", ["repo", "meta"])
def test_missing_repo_is_a_business_error(client, joined, missing):
    created = client.post("/api/workspaces", json={"id": "autre-espace", "name": "Autre"})
    assert created.status_code == 201
    repo = repo_dir("groupe-nordis")
    if missing == "repo":
        shutil.rmtree(repo)
    else:
        (repo / "atlas.yaml").unlink()
    for route in ("/proposals", "/editor/documents/revenu-net", "/admin", "/catalog",
                  "/index", "/comparisons/setup?kpi=revenu-net", "/comparisons/matrix",
                  "/comparisons", "/governance", "/connections", ""):
        response = client.get(WS + route)
        assert (response.status_code, response.json()) == (409, DETAIL), route
    response = client.get("/api/workspaces")
    assert response.status_code == 200
    assert {space["id"] for space in response.json()} == {"groupe-nordis", "autre-espace"}


@pytest.mark.parametrize("missing", ["repo", "meta"])
def test_read_meta_reports_missing_local_repo(tmp_path, missing):
    from skifer_atlas.repo import RepoError
    from skifer_atlas.repo.layout import read_meta

    repo = tmp_path / "repo"
    if missing == "meta":
        repo.mkdir()
    with pytest.raises(RepoError) as caught:
        read_meta(repo)
    assert (caught.value.code, caught.value.message) == ("local_repo_missing", MESSAGE)


def test_open_context_reports_missing_meta(client, joined):
    from skifer_atlas.proposals.common import open_context
    from skifer_atlas.repo import RepoError

    (repo_dir("groupe-nordis") / "atlas.yaml").unlink()
    with pytest.raises(RepoError) as caught:
        open_context("groupe-nordis", fetch=False)
    assert (caught.value.code, caught.value.message) == ("local_repo_missing", MESSAGE)


def test_sync_reports_invalid_workspace_when_remote_removes_meta(client, joined):
    from skifer_atlas.repo import RepoError
    from skifer_atlas.repo.sync import sync_workspace

    _, work = joined
    (work / "atlas.yaml").unlink()
    commit_all(work, "Supprimer les métadonnées")
    git(work, "push", "origin", "main")
    with pytest.raises(RepoError) as caught:
        sync_workspace("groupe-nordis")
    assert (caught.value.code, caught.value.message) == (
        "invalid_workspace", "« atlas.yaml » absent ou invalide dans le dépôt de cet espace.")


def test_sync_reports_missing_local_repo_before_fetch(client, joined):
    from skifer_atlas.repo import RepoError
    from skifer_atlas.repo.sync import sync_workspace

    shutil.rmtree(repo_dir("groupe-nordis"))
    with pytest.raises(RepoError) as caught:
        sync_workspace("groupe-nordis")
    assert (caught.value.code, caught.value.message) == ("local_repo_missing", MESSAGE)


def test_valid_meta_preserves_other_repo_errors(tmp_path, monkeypatch):
    from skifer_atlas.repo import RepoError, sync

    error = RepoError("other_error", "Autre erreur")

    def fail_read_meta(repo):
        raise error

    monkeypatch.setattr(sync, "read_meta", fail_read_meta)
    with pytest.raises(RepoError) as caught:
        sync._valid_meta(tmp_path)
    assert caught.value is error
