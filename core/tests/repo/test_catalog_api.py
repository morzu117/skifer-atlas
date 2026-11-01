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
    # julien.h est référent d'espace dans le governance.yaml de la démonstration
    assert (workspace["id"], workspace["account"], workspace["role"]) == (
        "groupe-nordis", "julien.h", "referent")
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


def test_facets_list_index_values_with_labels(client, joined):
    """Plan 0011 : filtres alimentés par l'index, libellés de la gouvernance."""
    facets = client.get(f"{WS}/catalog/facets").json()
    assert facets["domain"] == [{"value": "finance", "label": "Finance"},
                                {"value": "supply", "label": "Supply chain"},
                                {"value": "ventes", "label": "Ventes"}]
    assert {"value": "claire.m", "label": "Claire M."} in facets["owner"]
    assert (facets["status"], facets["kind"]) == (["validated"], ["concept", "kpi"])


def test_summary_aggregates_index_governance_and_comparisons(client, joined):
    """Plan 0011, critère 4 : références et points de variation dans l'aperçu."""
    found = client.get(f"{WS}/documents/revenu-net/summary").json()
    assert {k: found[k] for k in ("label", "domain_label", "version", "owner_name")} == {
        "label": "Revenu net", "domain_label": "Finance", "version": 4,
        "owner_name": "Claire M."}
    assert [p["node_id"] for p in found["variation_points"]] == ["n03", "n04"]
    assert found["variation_points"][0]["label"] == "déduction des taxes"
    assert [(v["entity"], v["mode"]) for v in found["variants"]] == [
        ("nordis-de", "override"), ("nordis-es", "from_scratch"), ("nordis-fr", "override")]
    assert [r["label"] for r in found["referenced_by"]] == ["Marge brute", "Panier moyen"]
    assert found["last_comparison"] is None
    concept = client.get(f"{WS}/documents/commande/summary").json()
    assert concept["variation_points"] == [] and concept["last_comparison"] is None
    assert "Revenu net" in [r["label"] for r in concept["referenced_by"]]
    assert client.get(f"{WS}/documents/absent/summary").status_code == 404


def test_index_state_says_when_the_catalog_will_rebuild(client, joined):
    assert client.get(f"{WS}/index").json() == {"fresh": False}  # clone neuf, pas d'index
    client.get(f"{WS}/catalog")
    assert client.get(f"{WS}/index").json() == {"fresh": True}
    clone = repo_dir("groupe-nordis")
    (clone / "note.md").write_text("Note.\n")
    commit_all(clone, "Note")
    assert client.get(f"{WS}/index").json() == {"fresh": False}


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
    f"{WS}/documents/%2E%2E/summary",
    "/api/workspaces/inconnu/catalog/facets",
    "/api/workspaces/inconnu/index",
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


def test_a_base_held_by_another_process_answers_index_busy(client, joined, monkeypatch):
    """ADR 0032 : la CLI garde la base ouverte trop longtemps, l'API le dit."""
    import subprocess
    import sys

    from skifer_atlas import dbfile

    monkeypatch.setattr(dbfile, "WAIT_SECONDS", 0.3)
    holder = subprocess.Popen(
        [sys.executable, "-c", ("import sys, time, duckdb; c = duckdb.connect(sys.argv[1]); "
                                "print('ouverte', flush=True); time.sleep(30)"),
         str(index_path("groupe-nordis"))],
        stdout=subprocess.PIPE, text=True)
    try:
        assert holder.stdout.readline().strip() == "ouverte"
        response = client.get(f"{WS}/catalog")
    finally:
        holder.kill()
        holder.wait()
    assert response.status_code == 503 and response.json()["detail"]["code"] == "index_busy"
    assert client.get(f"{WS}/catalog").status_code == 200


def test_a_busy_base_does_not_delay_the_workspace_list(client, joined):
    """ADR 0032 : les compteurs de la liste des espaces n'attendent pas une base occupée ;
    sinon la coque de chaque écran attendrait `WAIT_SECONDS` avant d'afficher l'écran."""
    import subprocess
    import sys
    import time

    holder = subprocess.Popen(
        [sys.executable, "-c", ("import sys, time, duckdb; c = duckdb.connect(sys.argv[1]); "
                                "print('ouverte', flush=True); time.sleep(30)"),
         str(index_path("groupe-nordis"))],
        stdout=subprocess.PIPE, text=True)
    try:
        assert holder.stdout.readline().strip() == "ouverte"
        started = time.monotonic()
        response = client.get("/api/workspaces")
        elapsed = time.monotonic() - started
    finally:
        holder.kill()
        holder.wait()
    assert response.status_code == 200
    counts = response.json()[0]["counts"]
    assert (counts["kpi"], counts["concept"]) == (None, None)
    assert elapsed < 3


def test_requests_waiting_for_a_busy_base_wait_side_by_side(joined, monkeypatch):
    """ADR 0032 : l'écran du catalogue lit l'index par trois requêtes à la fois ; chacune
    attend au plus `WAIT_SECONDS`, pas la somme des attentes de celles d'avant."""
    import subprocess
    import sys
    import threading
    import time

    from skifer_atlas import dbfile
    from skifer_atlas.index import ensure_index
    from skifer_atlas.repo.git import RepoError

    monkeypatch.setattr(dbfile, "WAIT_SECONDS", 0.6)
    repo, db = repo_dir("groupe-nordis"), index_path("groupe-nordis")
    ensure_index(repo, db).close()
    codes = []

    def read():
        try:
            ensure_index(repo, db).close()
            codes.append("ok")
        except RepoError as error:
            codes.append(error.code)

    holder = subprocess.Popen(
        [sys.executable, "-c", ("import sys, time, duckdb; c = duckdb.connect(sys.argv[1]); "
                                "print('ouverte', flush=True); time.sleep(30)"), str(db)],
        stdout=subprocess.PIPE, text=True)
    try:
        assert holder.stdout.readline().strip() == "ouverte"
        started = time.monotonic()
        threads = [threading.Thread(target=read) for _ in range(3)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        elapsed = time.monotonic() - started
    finally:
        holder.kill()
        holder.wait()
    assert codes == ["index_busy"] * 3
    assert elapsed < 1.5  # l'une après l'autre : 1,8 s
