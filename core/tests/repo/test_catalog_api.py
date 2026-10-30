"""API des espaces et du catalogue, de bout en bout sur des dépôts Git temporaires."""

import pytest
from fastapi.testclient import TestClient
from workspace_helpers import REVENU_NET, atlas_env, commit_all, git, remote

from skifer_atlas.api.app import create_app
from skifer_atlas.workspaces import index_path, repo_dir

__all__ = ["atlas_env", "remote"]  # fixtures importées

AUTH = {"Authorization": "Bearer secret"}
WS = "/api/workspaces/groupe-nordis"


@pytest.fixture
def client(atlas_env):
    return TestClient(create_app(token="secret"), headers=AUTH)


@pytest.fixture
def joined(client, remote):
    bare, work = remote
    response = client.post("/api/workspaces/join", json={"remote_url": str(bare)})
    assert response.status_code == 201, response.text
    return work


def test_create_then_list(client):
    """Critère 1."""
    body = {"id": "groupe-nordis", "name": "Groupe Nordis", "sector": "Distribution",
            "entities": ["nordis-fr", "nordis-de"]}
    created = client.post("/api/workspaces", json=body)
    assert created.status_code == 201, created.text
    assert (created.json()["role"], created.json()["role_label"]) == (
        "referent", "Référent d'annuaire")
    assert [w["id"] for w in client.get("/api/workspaces").json()] == ["groupe-nordis"]
    assert git(repo_dir("groupe-nordis"), "ls-files").split() == ["atlas.yaml",
                                                                 "governance.yaml"]
    again = client.post("/api/workspaces", json=body)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "workspace_exists"
    assert client.get(f"{WS}/catalog").json() == []


@pytest.mark.parametrize("body", [
    {"id": "../evasion", "name": "x"},
    {"id": "groupe-nordis", "name": "x", "role": "referent"},
])
def test_create_validates_its_body(client, body):
    assert client.post("/api/workspaces", json=body).status_code == 422


def test_join_rejects_credentials_in_url(client):
    response = client.post("/api/workspaces/join",
                           json={"remote_url": "https://jeton@github.com/nordis/annuaire.git"})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "credentials_in_url"


def test_join_indexes_and_lists(client, joined):
    """Critère 2."""
    [workspace] = client.get("/api/workspaces").json()
    assert (workspace["id"], workspace["role"]) == ("groupe-nordis", "lecteur")
    rows = client.get(f"{WS}/catalog").json()
    assert len(rows) == 7
    assert index_path("groupe-nordis").exists()
    revenu = next(row for row in rows if row["id"] == "revenu-net")
    assert {key: revenu[key] for key in ("kind", "label", "domain", "version", "variant_count",
                                         "convergence")} == {
        "kind": "kpi", "label": "Revenu net", "domain": "finance", "version": 4,
        "variant_count": 3, "convergence": "never_compared",
    }


def test_search_and_filters(client, joined):
    """Critères 3 et 4."""
    def ids(**params):
        return [row["id"] for row in client.get(f"{WS}/catalog", params=params).json()]

    assert ids(q="ca net") == ["revenu-net"]
    assert ids(q="REVENU")[0] == "revenu-net"
    assert ids(q="révenu") == ids(q="Revenu")
    assert ids(domain="ventes", kind="kpi", owner="marc.d", status="validated") == [
        "panier-moyen"]


def test_document_versions_and_dependencies(client, joined):
    """Critères 7 et 8."""
    document = client.get(f"{WS}/documents/revenu-net").json()
    assert (document["status"], document["issues"]) == ("validated", [])
    assert document["content"] == (repo_dir("groupe-nordis") / REVENU_NET).read_text(
        encoding="utf-8")
    assert [v["entity"] for v in document["variants"]] == ["nordis-de", "nordis-es",
                                                           "nordis-fr"]
    versions = client.get(f"{WS}/documents/revenu-net/versions").json()
    assert [(v["version"], v["author"]) for v in versions] == [(3, "julien.h"), (4, "julien.h")]
    for version in (3, 4):
        found = client.get(f"{WS}/documents/revenu-net/versions/{version}").json()
        assert found["content"] == git(joined, "show", f"doc/revenu-net/v{version}:{REVENU_NET}")
        assert found["version"] == version
    assert client.get(f"{WS}/documents/revenu-net/versions/7").status_code == 404
    dependencies = client.get(f"{WS}/documents/revenu-net/dependencies").json()
    assert [r["label"] for r in dependencies["references"]] == ["Commande", "Date de référence"]
    assert [r["label"] for r in dependencies["referenced_by"]] == ["Marge brute",
                                                                  "Panier moyen"]
    assert dependencies["impact"] == 2
    variant = client.get(f"{WS}/documents/revenu-net--nordis-fr").json()
    assert variant["variant"]["kpi_id"] == "revenu-net"


@pytest.mark.parametrize("path", [
    "/api/workspaces/inconnu/catalog",
    "/api/workspaces/inconnu/sync",
    "/api/workspaces/%2E%2E/catalog",
    "/api/workspaces/..%2F..%2Fetc/catalog",
    f"{WS}/documents/absent",
    f"{WS}/documents/%2E%2E",
    f"{WS}/documents/..%2F..%2Fatlas/versions",
    f"{WS}/documents/revenu-net--..%2Fx/versions/1",
    f"{WS}/documents/absent/dependencies",
])
def test_unknown_workspace_or_dot_dot_is_404(client, joined, path):
    """Critère 9."""
    method = client.post if path.endswith("/sync") else client.get
    response = method(path)
    assert response.status_code == 404, (path, response.text)


def test_sync_conflict(client, joined):
    """Critère 11."""
    assert client.post(f"{WS}/sync").json()["status"] == "up_to_date"
    clone = repo_dir("groupe-nordis")
    (clone / "local.md").write_text("Local.\n")
    local = commit_all(clone, "Local")
    (joined / "distant.md").write_text("Distant.\n")
    commit_all(joined, "Distant")
    git(joined, "push", "--quiet", "origin", "main")
    response = client.post(f"{WS}/sync")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "sync_conflict"
    assert git(clone, "rev-parse", "HEAD").strip() == local


def test_sync_refreshes_the_catalog(client, joined):
    assert len(client.get(f"{WS}/catalog").json()) == 7
    (joined / "kpis" / "taux-de-service.yaml").unlink()
    commit_all(joined, "Retrait du taux de service")
    git(joined, "push", "--quiet", "origin", "main")
    assert client.post(f"{WS}/sync").json()["status"] == "fast_forward"
    assert "taux-de-service" not in [r["id"] for r in client.get(f"{WS}/catalog").json()]
