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


def test_two_files_cannot_share_a_document_id(client, joined):
    repo = repo_dir("groupe-nordis")
    original = (repo / REVENU_NET).read_text(encoding="utf-8")
    (repo / "kpis/revenu-net--nordis-fr.yaml").write_text(
        original.replace("id: revenu-net", "id: revenu-net--nordis-fr", 1),
        encoding="utf-8")
    commit_all(repo, "Identifiant ambigu")
    response = client.get(f"{WS}/catalog")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "ambiguous_document_id"


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


def test_document_content_comes_from_the_indexed_commit(client, joined):
    original = client.get(f"{WS}/documents/revenu-net").json()["content"]
    assert "déduction des taxes" in original
    path = repo_dir("groupe-nordis") / REVENU_NET
    path.write_text(original.replace("Revenu net", "Valeur non commitée", 1),
                    encoding="utf-8")
    found = client.get(f"{WS}/documents/revenu-net")
    assert found.status_code == 200
    assert found.json()["content"] == original


def test_invalid_atlas_yaml_after_sync_has_a_business_error(client, joined):
    (joined / "atlas.yaml").write_text("schema_version: [\n", encoding="utf-8")
    commit_all(joined, "Atlas YAML invalide")
    git(joined, "push", "--quiet", "origin", "main")
    response = client.post(f"{WS}/sync")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_workspace"


def test_invalid_local_atlas_yaml_on_sync_has_a_business_error(client, joined):
    (repo_dir("groupe-nordis") / "atlas.yaml").write_text(
        "schema_version: [\n", encoding="utf-8")
    response = client.post(f"{WS}/sync")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_workspace"


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
    assert client.post(f"{WS}/sync/auto").json()["status"] == "conflict"
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


def test_a_busy_base_does_not_delay_the_workspace_list(client, joined, perf_factor):
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
    assert elapsed < 3 * perf_factor


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
    assert elapsed < 1.5  # l'une après l'autre : 1,8 s ; pas de facteur CI, il effacerait l'écart


def test_a_rebuild_in_progress_does_not_delay_the_workspace_list(client, joined):
    """ADR 0032 : pendant qu'une requête reconstruit l'index, les compteurs n'attendent pas
    la fin de la reconstruction ; ils reviennent ensuite."""
    import threading

    import duckdb

    from skifer_atlas.index import build

    assert client.get(f"{WS}/catalog").status_code == 200  # index construit
    db = index_path("groupe-nordis")
    with duckdb.connect(str(db)) as connection:  # puis périmé : à reconstruire
        connection.execute('UPDATE "index".index_meta SET "commit" = \'ancien\'')
    with build._locks_guard:
        lock = build._locks.setdefault(db.resolve(), threading.Lock())
    responses = []
    listing = threading.Thread(target=lambda: responses.append(client.get("/api/workspaces")))
    with lock:  # une reconstruction en cours
        listing.start()
        listing.join(3)
        answered_during_rebuild = bool(responses)
    listing.join()
    assert answered_during_rebuild
    counts = responses[0].json()[0]["counts"]
    assert (counts["kpi"], counts["concept"]) == (None, None)
    counts = client.get("/api/workspaces").json()[0]["counts"]
    assert counts["kpi"] > 0


def test_auto_sync_updates_catalog_sheet_and_next_draft(client, joined):
    work = joined
    path = work / REVENU_NET
    path.write_text(path.read_text().replace("version: 4", "version: 5", 1))
    commit_all(work, "Version suivante")
    git(work, "push", "origin", "main")
    assert client.post(f"{WS}/sync/auto").json()["status"] == "fast_forward"
    rows = client.get(f"{WS}/catalog").json()
    assert next(row for row in rows if row["id"] == "revenu-net")["version"] == 5
    assert client.get(f"{WS}/documents/revenu-net/sheet").json()["version"] == 5
    assert client.get(f"{WS}/documents/revenu-net/draft").json()["version"] == 6


def test_auto_sync_throttles_failures_and_keeps_local_reads(client, joined, monkeypatch):
    from skifer_atlas.api.routes import workspaces as routes
    from skifer_atlas.repo import RepoError

    calls = []

    def offline(_workspace, **_options):
        calls.append(1)
        raise RepoError("fetch_failed", "inaccessible")

    monkeypatch.setattr(routes, "sync_workspace", offline)
    assert client.post(f"{WS}/sync/auto").json()["status"] == "offline"
    assert client.post(f"{WS}/sync/auto").json()["status"] == "offline"
    assert len(calls) == 1
    assert client.get(f"{WS}/catalog").status_code == 200


def test_auto_sync_preserves_existing_draft(client, joined):
    editor = f"{WS}/editor/documents/revenu-net"
    document = client.get(editor).json()["document"]
    document["label"] = "Brouillon conservé"
    saved = client.put(f"{editor}/draft", json={"document": document, "positions": {},
                                               "highest": 8, "base_version": 4})
    assert saved.status_code == 200
    path = joined / REVENU_NET
    path.write_text(path.read_text().replace("version: 4", "version: 5", 1))
    commit_all(joined, "Version suivante")
    git(joined, "push", "origin", "main")
    result = client.post(f"{WS}/sync/auto").json()
    assert result["status"] == "fast_forward"
    assert "previous_commit" not in result
    assert client.get(editor).json()["draft"]["document"]["label"] == "Brouillon conservé"


def test_auto_sync_refuses_other_branch(client, joined):
    repo = repo_dir("groupe-nordis")
    git(repo, "checkout", "-b", "autre")
    before = git(repo, "rev-parse", "HEAD")
    manual = client.post(f"{WS}/sync")
    assert manual.status_code == 409
    assert manual.json()["detail"]["code"] == "sync_wrong_branch"
    assert client.post(f"{WS}/sync/auto").json()["status"] == "wrong_branch"
    assert git(repo, "rev-parse", "HEAD") == before
    assert git(repo, "branch", "--show-current").strip() == "autre"


def test_auto_sync_local_and_errors(client, joined, monkeypatch):
    from skifer_atlas.api.routes import workspaces as routes
    from skifer_atlas.repo import RepoError

    for code, status in [("sync_conflict", "conflict"), ("no_remote", "local"),
                         ("invalid_meta", "error"), ("clone_busy", "busy"),
                         ("git_timeout", "offline"), ("host_unreachable", "offline"),
                         ("git_missing", "offline"), ("sync_wrong_branch", "wrong_branch"),
                         ("fetch_failed", "offline")]:
        routes._auto_attempts.clear()

        def fail(_workspace, code=code, **_options):
            raise RepoError(code, "échec")

        monkeypatch.setattr(routes, "sync_workspace", fail)
        assert client.post(f"{WS}/sync/auto").json()["status"] == status
        if status == "busy":
            assert not routes._auto_attempts


def test_auto_sync_interval_and_force_are_per_workspace(client, joined, monkeypatch):
    from skifer_atlas.api.routes import workspaces as routes

    now = [100.0]
    calls = []
    monkeypatch.setattr(routes.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(routes, "sync_workspace", lambda ws, **_options: calls.append(ws) or
                        {"status": "up_to_date", "commit": "abc"})
    routes._auto_attempts.clear()
    assert client.post(f"{WS}/sync/auto").json()["status"] == "up_to_date"
    now[0] += 4
    client.post(f"{WS}/sync/auto")
    assert len(calls) == 1
    client.post(f"{WS}/sync/auto?force=true")
    assert len(calls) == 2
    now[0] += 31
    client.post(f"{WS}/sync/auto")
    assert len(calls) == 3
    created = client.post("/api/workspaces", json={"id": "autre", "name": "Autre"})
    assert created.status_code == 201
    from skifer_atlas.workspaces import get_workspace, update_workspace
    other = get_workspace("autre")
    update_workspace(other.model_copy(update={"git_remote": "https://example.com/repo"}))
    client.post("/api/workspaces/autre/sync/auto")
    assert calls == ["groupe-nordis"] * 3 + ["autre"]


def test_auto_sync_waits_for_clone_and_route_lock_is_nonblocking(client, joined, monkeypatch):
    import threading

    from skifer_atlas import filelock
    from skifer_atlas.api.routes import workspaces as routes
    from skifer_atlas.repo.git import clone_lock

    repo = repo_dir("groupe-nordis")
    monkeypatch.setattr(routes, "_AUTO_CLONE_WAIT", 0.15)
    held, release, waiting = threading.Event(), threading.Event(), threading.Event()
    acquire = filelock._acquire

    def observed_acquire(path, lock, timeout, create_parent=True):
        if timeout == routes._AUTO_CLONE_WAIT:
            waiting.set()
        return acquire(path, lock, timeout, create_parent)

    monkeypatch.setattr(filelock, "_acquire", observed_acquire)

    def operation():
        with clone_lock(repo):
            held.set()
            release.wait()

    thread = threading.Thread(target=operation)
    thread.start()
    try:
        assert held.wait(2)
        response = []
        request = threading.Thread(target=lambda: response.append(client.post(f"{WS}/sync/auto")))
        request.start()
        assert waiting.wait(5)
        request.join(5)
        assert not request.is_alive()
        assert response[0].json()["status"] == "busy"
    finally:
        release.set()
        thread.join()
    held.clear()
    release.clear()
    waiting.clear()
    monkeypatch.setattr(routes, "_AUTO_CLONE_WAIT", 2.0)
    thread = threading.Thread(target=operation)
    thread.start()
    try:
        assert held.wait(2)
        response = []
        request = threading.Thread(target=lambda: response.append(client.post(f"{WS}/sync/auto")))
        request.start()
        assert waiting.wait(5)
        release.set()
        request.join(5)
        assert not request.is_alive()
        assert response[0].json()["status"] == "up_to_date"
    finally:
        release.set()
        thread.join()
    key = str(repo.resolve())
    with routes._auto_lock:
        lock = routes._auto_locks[key]
    with lock:
        assert client.post(f"{WS}/sync/auto").json()["status"] == "pending"


def test_auto_sync_local_and_removed_origin(client, joined):
    created = client.post("/api/workspaces", json={"id": "local", "name": "Local"})
    assert created.status_code == 201
    assert client.post("/api/workspaces/local/sync/auto").json() == {"status": "local"}
    repo = repo_dir("groupe-nordis")
    git(repo, "remote", "remove", "origin")
    assert client.post(f"{WS}/sync/auto").json() == {"status": "local"}


def test_auto_sync_reports_advance_before_error(client, joined, monkeypatch):
    from skifer_atlas.api.routes import workspaces as routes
    from skifer_atlas.repo import RepoError

    repo = repo_dir("groupe-nordis")

    def advance_then_fail(_workspace, **_options):
        git(repo, "commit", "--allow-empty", "-m", "Avance")
        raise RepoError("invalid_meta", "invalide")

    monkeypatch.setattr(routes, "sync_workspace", advance_then_fail)
    result = client.post(f"{WS}/sync/auto").json()
    assert result == {"status": "error", "advanced": True, "commit": git(repo, "rev-parse", "HEAD").strip()}


@pytest.mark.parametrize("existing_marker", [False, True])
def test_auto_sync_defers_tagging_to_manual_sync(client, joined, remote, existing_marker):
    bare, work = remote
    repo = repo_dir("groupe-nordis")
    old = git(repo, "rev-parse", "HEAD").strip()
    if existing_marker:
        git(repo, "update-ref", "refs/atlas/tags-checked", old)
    git(work, "switch", "-c", "pr")
    path = work / REVENU_NET
    path.write_text(path.read_text().replace("version: 4", "version: 5", 1))
    commit_all(work, "Version 5")
    git(work, "switch", "main")
    git(work, "merge", "--no-ff", "-m", "Fusion version 5", "pr")
    merged = git(work, "rev-parse", "HEAD").strip()
    git(work, "push", "origin", "main")

    assert client.post(f"{WS}/sync/auto").json()["status"] == "fast_forward"
    assert git(repo, "rev-parse", "refs/atlas/tags-checked").strip() == old
    assert git(repo, "tag", "--list", "doc/revenu-net/v5") == ""
    assert git(bare, "tag", "--list", "doc/revenu-net/v5") == ""
    manual = client.post(f"{WS}/sync").json()
    assert [warning["code"] for warning in manual["warnings"]] == ["versions_tagged"]
    assert git(bare, "rev-parse", "doc/revenu-net/v5^{commit}").strip() == merged


def test_auto_sync_workspace_removed_during_request(client, joined, monkeypatch):
    import shutil

    from skifer_atlas.api.routes import workspaces as routes
    from skifer_atlas.workspaces import load_registry, save_registry

    lookup = routes.workspace_or_404

    def remove_after_lookup(ws):
        workspace = lookup(ws)
        registry = load_registry()
        registry.workspaces = []
        save_registry(registry)
        shutil.rmtree(repo_dir(ws).parent)
        return workspace

    monkeypatch.setattr(routes, "workspace_or_404", remove_after_lookup)
    response = client.post(f"{WS}/sync/auto")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"
    assert not repo_dir("groupe-nordis").parent.exists()


def test_auto_sync_fetches_published_version_for_sheet(client, joined, remote):
    bare, work = remote
    before = client.get(WS).json()["synced_at"]
    git(work, "switch", "-c", "pr-published")
    path = work / REVENU_NET
    path.write_text(path.read_text().replace("version: 4", "version: 5", 1))
    commit_all(work, "Version 5")
    git(work, "switch", "main")
    git(work, "merge", "--no-ff", "-m", "Fusion version 5", "pr-published")
    git(work, "tag", "doc/revenu-net/v5")
    git(work, "push", "origin", "main", "doc/revenu-net/v5")
    assert client.post(f"{WS}/sync/auto").json()["status"] == "fast_forward"
    assert client.get(WS).json()["synced_at"] == before
    sheet = client.get(f"{WS}/documents/revenu-net/sheet").json()
    assert sheet["version_count"] == 3 and sheet["validated_at"]
    assert client.get(f"{WS}/documents/revenu-net/layout?version=5").status_code == 200
    assert [v["version"] for v in client.get(f"{WS}/documents/revenu-net/versions").json()] == [3, 4, 5]
    assert client.post(f"{WS}/sync").json()["warnings"] == []
    assert git(bare, "rev-parse", "doc/revenu-net/v5^{commit}").strip()


def test_auto_sync_removal_between_check_and_lock(client, joined, monkeypatch):
    import shutil

    from skifer_atlas.api.routes import workspaces as routes
    from skifer_atlas.workspaces import load_registry, save_registry

    original = routes.clone_lock

    def remove_before_lock(repo, **kwargs):
        registry = load_registry()
        registry.workspaces = []
        save_registry(registry)
        shutil.rmtree(repo.parent)
        return original(repo, **kwargs)

    monkeypatch.setattr(routes, "clone_lock", remove_before_lock)
    response = client.post(f"{WS}/sync/auto")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"
    assert not repo_dir("groupe-nordis").parent.exists()


@pytest.mark.parametrize(("method", "path"), [
    ("get", ""),
    ("get", "/proposals"),
    ("get", "/proposals?for_me=true"),
    ("get", "/proposals/queue"),
    ("get", "/catalog"),
    ("get", "/catalog/facets"),
    ("get", "/index"),
    ("get", "/documents/revenu-net"),
    ("get", "/documents/revenu-net/summary"),
    ("get", "/documents/revenu-net/versions"),
    ("get", "/documents/revenu-net/versions/4"),
    ("get", "/documents/revenu-net/dependencies"),
    ("get", "/documents/revenu-net/sheet"),
    ("get", "/documents/revenu-net/layout"),
    ("get", "/documents/revenu-net/draft"),
    ("post", "/sync/auto"),
])
@pytest.mark.parametrize("during", [False, True])
def test_removed_clone_is_not_found(client, joined, monkeypatch, method, path, during):
    import shutil

    from skifer_atlas.api.routes import catalog, proposals, sheet, workspaces

    repo = repo_dir("groupe-nordis")
    if during:
        module = (workspaces if path in ("", "/sync/auto") else proposals
                  if path.startswith("/proposals") else sheet
                  if path.endswith(("/sheet", "/layout", "/draft")) else catalog)
        lookup = module.workspace_or_404

        def remove_after_lookup(ws):
            workspace = lookup(ws)
            shutil.rmtree(repo)
            return workspace

        monkeypatch.setattr(module, "workspace_or_404", remove_after_lookup)
    else:
        shutil.rmtree(repo)
    response = getattr(client, method)(f"{WS}{path}")
    # Ces lectures peuvent réussir sans autre accès au clone après le retrait.
    if during and path in ("", "/index", "/sync/auto"):
        assert response.status_code == 200
        return
    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "not_found", "message": "Espace « groupe-nordis » inconnu."}


def test_removed_clone_counts_are_unavailable(client, joined):
    import shutil

    shutil.rmtree(repo_dir("groupe-nordis"))
    [workspace] = client.get("/api/workspaces").json()
    assert workspace["counts"] == {"kpi": None, "concept": None, "open_proposals": None}


def test_io_error_with_existing_clone_is_not_hidden(client, joined, monkeypatch):
    from skifer_atlas.api.routes import catalog

    def fail(*args):
        raise PermissionError("accès refusé")

    monkeypatch.setattr(catalog, "ensure_index", fail)
    with pytest.raises(PermissionError, match="accès refusé"):
        client.get(f"{WS}/catalog")


def test_clone_removed_during_counts(client, joined, monkeypatch):
    import shutil

    from skifer_atlas.api.routes import workspaces

    def remove_before_index(repo, db):
        shutil.rmtree(repo)
        raise FileNotFoundError(str(repo))

    monkeypatch.setattr(workspaces, "ensure_index", remove_before_index)
    [workspace] = client.get("/api/workspaces").json()
    assert workspace["counts"] == {"kpi": None, "concept": None, "open_proposals": None}


def test_removed_clone_does_not_bypass_token(client, joined):
    import shutil

    shutil.rmtree(repo_dir("groupe-nordis"))
    response = client.get(f"{WS}/catalog", headers={"Authorization": "Bearer incorrect"})
    assert response.status_code == 401


def test_counts_permission_error_does_not_block_list(client, joined, monkeypatch):
    from skifer_atlas.api.routes import workspaces

    def fail(*args):
        raise PermissionError("accès refusé")

    monkeypatch.setattr(workspaces, "ensure_index", fail)
    response = client.get("/api/workspaces")
    assert response.status_code == 200
    assert response.json()[0]["counts"] == {
        "kpi": None, "concept": None, "open_proposals": None}


@pytest.mark.parametrize("outcome", ["success", "http_error", "repo_error"])
def test_registry_busy_after_route_does_not_replace_result(client, joined, monkeypatch, outcome):
    from fastapi import HTTPException

    from skifer_atlas.api.routes import common, proposals
    from skifer_atlas.repo.git import RepoError

    def busy(_ws):
        raise RepoError("registry_busy", "Registre occupé.")

    def create(*args):
        monkeypatch.setattr(common, "get_workspace", busy)
        if outcome == "http_error":
            raise HTTPException(status_code=409, detail="Conflit métier.")
        if outcome == "repo_error":
            raise RepoError("workspace_dirty", "Conflit métier.")
        return {"id": 42}

    monkeypatch.setattr(proposals.proposals, "create_proposal", create)
    response = client.post(f"{WS}/proposals", json={
        "document_yaml": "contenu", "justification": "raison"})
    if outcome == "success":
        assert response.status_code == 201
        assert response.json() == {"id": 42}
    elif outcome == "http_error":
        assert response.status_code == 409
        assert response.json()["detail"] == "Conflit métier."
    else:
        assert response.status_code == 409
        assert response.json()["detail"] == {"code": "workspace_dirty", "message": "Conflit métier."}


def test_registry_busy_preserves_original_io_error(client, joined, monkeypatch):
    from skifer_atlas.api.routes import catalog, common
    from skifer_atlas.repo.git import RepoError

    def busy(_ws):
        raise RepoError("registry_busy", "Registre occupé.")

    def fail(*args):
        monkeypatch.setattr(common, "get_workspace", busy)
        raise PermissionError("accès refusé")

    monkeypatch.setattr(catalog, "ensure_index", fail)
    with pytest.raises(PermissionError, match="accès refusé"):
        client.get(f"{WS}/catalog")


def test_registry_busy_after_successful_read_does_not_replace_result(client, joined, monkeypatch):
    from skifer_atlas.api.routes import catalog, common
    from skifer_atlas.repo.git import RepoError

    def busy(_ws):
        raise RepoError("registry_busy", "Registre occupé.")

    def search(*args):
        monkeypatch.setattr(common, "get_workspace", busy)
        return []

    monkeypatch.setattr(catalog, "search_catalog", search)
    response = client.get(f"{WS}/catalog")
    assert response.status_code == 200
    assert response.json() == []
