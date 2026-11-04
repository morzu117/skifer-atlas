"""L'accueil lit les espaces locaux sans dépendre de l'hébergeur Git."""

from fastapi.testclient import TestClient
from workspace_helpers import atlas_env

from skifer_atlas.api.app import create_app
from skifer_atlas.repo.layout import WorkspaceMeta
from skifer_atlas.repo.sync import create_workspace
from skifer_atlas.workspaces import get_workspace, update_workspace

__all__ = ["atlas_env"]


def test_workspace_list_is_local_and_detail_has_current_role(atlas_env, monkeypatch):
    from skifer_atlas.githost.github import GitHubHost

    create_workspace(WorkspaceMeta(id="groupe-nordis", name="Groupe Nordis"))
    current = get_workspace("groupe-nordis")
    update_workspace(current.model_copy(update={"git_remote":
                                              "https://github.com/example/atlas.git"}))
    def unexpected_request(*args):
        raise AssertionError("unexpected GitHub request")

    monkeypatch.setattr(GitHubHost, "_request", unexpected_request)
    client = TestClient(create_app(token="secret"), headers={"Authorization": "Bearer secret"})
    listed = client.get("/api/workspaces")
    assert listed.status_code == 200, listed.text
    assert listed.json()[0]["counts"]["open_proposals"] is None
    assert "space_referent" not in listed.json()[0]
    monkeypatch.setattr(GitHubHost, "_request", lambda *args: {"login": current.account})
    detail = client.get("/api/workspaces/groupe-nordis")
    assert detail.status_code == 200, detail.text
    assert detail.json()["id"] == "groupe-nordis" and "counts" not in detail.json()
    missing = client.get("/api/workspaces/inconnu")
    assert missing.status_code == 404
