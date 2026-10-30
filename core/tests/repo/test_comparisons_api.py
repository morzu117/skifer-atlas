"""API des comparaisons chiffrées (plan 0009), sur un espace Git temporaire.

`ATLAS_COMPARE_DATA` fait tourner les comparaisons en local dans DuckDB ; sans lui, elles
passent par les points d'accès et le coffre (plan 0008).
"""

import threading
import time
from pathlib import Path

import duckdb
import pytest
import yaml
from fastapi.testclient import TestClient
from workspace_helpers import atlas_env, remote

from skifer_atlas.api.app import create_app
from skifer_atlas.compare import service, store
from skifer_atlas.repo.git import RepoError
from skifer_atlas.vault import Credential, Vault, keyring_vault
from skifer_atlas.workspaces import index_path, repo_dir

__all__ = ["atlas_env", "remote"]  # fixtures importées

AUTH = {"Authorization": "Bearer secret"}
WS = "/api/workspaces/groupe-nordis"
COMPARISONS = f"{WS}/comparisons"
DATA = Path(__file__).parents[1] / "fixtures" / "compare" / "revenu-net"
BODY = {"kpi_id": "revenu-net", "variants": ["nordis-de", "nordis-fr"],
        "scope_id": "fy2026-mois-entite"}


@pytest.fixture
def client(atlas_env, monkeypatch):
    monkeypatch.setenv("ATLAS_VAULT", "memory")
    keyring_vault._memory._items.clear()
    yield TestClient(create_app(token="secret"), headers=AUTH)
    keyring_vault._memory._items.clear()


@pytest.fixture
def joined(client, remote, monkeypatch):
    monkeypatch.setenv("ATLAS_ACCOUNT", "julien.h")
    response = client.post("/api/workspaces/join", json={"remote_url": str(remote[0])})
    assert response.status_code == 201, response.text
    return remote


@pytest.fixture
def local(monkeypatch):
    monkeypatch.setenv("ATLAS_COMPARE_DATA", str(DATA))


def finished(client, number, url=COMPARISONS):
    for _ in range(500):
        found = client.get(f"{url}/{number}").json()
        if found["status"] != "running":
            return found
        time.sleep(0.01)
    raise AssertionError("comparaison toujours en cours")


def code(response):
    return response.status_code, response.json()["detail"]["code"]


def test_compare_then_read_history_matrix_and_catalog(client, joined, local):
    catalog = {k["id"]: k for k in client.get(f"{WS}/catalog").json()}
    assert catalog["revenu-net"]["convergence"] == "never_compared"
    created = client.post(COMPARISONS, json=BODY)
    assert created.status_code == 202, created.text
    assert created.json()["id"] == 1
    assert [a["code"] for a in created.json()["alerts"]] == ["undeclared_override"]
    found = finished(client, 1)
    assert (found["status"], found["user_account"], found["tolerance_pct"]) == (
        "done", "julien.h", 1.5)
    assert [(r["entity"], round(r["validation_pct"]), r["divergent_node"])
            for r in found["results"]] == [("nordis-de", 94, "n02"), ("nordis-fr", 100, None)]
    assert found["scope"]["id"] == "fy2026-mois-entite" and len(found["runs"]) == 4

    [listed] = client.get(COMPARISONS, params={"kpi": "revenu-net"}).json()
    assert listed["id"] == 1 and "cells" not in listed["results"][0]
    assert client.get(COMPARISONS, params={"kpi": "marge-brute"}).json() == []

    matrix = {k["kpi_id"]: k for k in client.get(f"{COMPARISONS}/matrix",
                                                 params={"domain": "finance"}).json()}
    cells = {v["entity"]: v for v in matrix["revenu-net"]["variants"]}
    assert (cells["nordis-de"]["validation_pct"], cells["nordis-de"]["stale"]) == (93.75, False)
    assert cells["nordis-fr"]["max_gap_pct"] == 0 and cells["nordis-es"]["compared"] is False
    assert all(k["domain"] == "finance" for k in matrix.values())

    catalog = {k["id"]: k for k in client.get(f"{WS}/catalog").json()}
    assert catalog["revenu-net"]["convergence"] == "divergences:1"


def test_needs_auth_before_any_execution(client, joined):
    """Critère 6 : sans accès valide, `needs_auth` et rien d'exécuté ni d'enregistré."""
    assert code(client.post(COMPARISONS, json=BODY)) == (422, "no_access_point")
    points = [{"id": f"dbx-{e[-2:]}", "platform": "databricks",
               "host": "https://adb-1.2.azuredatabricks.net", "warehouse_id": "abc",
               "entity": e, "owner": "claire.m"} for e in ("nordis-de", "nordis-fr")]
    (repo_dir("groupe-nordis") / "access_points.yaml").write_text(
        yaml.safe_dump({"schema_version": 1, "access_points": points}), encoding="utf-8")
    response = client.post(COMPARISONS, json=BODY)
    assert code(response) == (409, "needs_auth")
    assert [(i["access_point"], i["code"]) for i in response.json()["detail"]["issues"]] == [
        ("dbx-de", "not_connected"), ("dbx-fr", "not_connected")]
    Vault().put("groupe-nordis", "dbx-de", Credential("pat", "dapi-de"))
    Vault().put("groupe-nordis", "dbx-fr", Credential("pat", "dapi-fr", expires_at=1.0))
    response = client.post(COMPARISONS, json=BODY)
    assert [(i["access_point"], i["code"]) for i in response.json()["detail"]["issues"]] == [
        ("dbx-fr", "access_expired")]
    assert client.get(COMPARISONS).json() == []


def test_remote_comparison_uses_my_access(client, joined, monkeypatch):
    """Avec un accès valide, chaque déclinaison passe par le point d'accès de son entité."""
    from skifer_atlas import connections
    from skifer_atlas.compare.orchestrate import LocalRunner

    points = [{"id": "dbx-de", "platform": "databricks",
               "host": "https://adb-1.2.azuredatabricks.net", "warehouse_id": "abc",
               "entity": "nordis-de", "owner": "anna.k"}]
    (repo_dir("groupe-nordis") / "access_points.yaml").write_text(
        yaml.safe_dump({"schema_version": 1, "access_points": points}), encoding="utf-8")
    Vault().put("groupe-nordis", "dbx-de", Credential("pat", "dapi-de"))
    seen, local_for = [], {}
    runner = LocalRunner(DATA)

    def on_databricks(ws, ap, sql, cancel=None):
        seen.append(ap)
        return runner(*local_for[sql], cancel)

    original = service.prepare_in

    def spy(root, request, workspace_id, local):
        found = original(root, request, workspace_id, local)
        # Le SQL Databricks part vers la plateforme ; on rejoue son équivalent DuckDB.
        for remote_plan, local_plan in zip(found.plans, original(root, request, None, True).plans,
                                           strict=True):
            for side in ("canonical", "variant"):
                local_for[getattr(remote_plan, side).compiled.sql] = (
                    local_plan, getattr(local_plan, side).compiled)
        return found

    monkeypatch.setattr(service, "prepare_in", spy)
    monkeypatch.setattr(connections, "run_aggregate", on_databricks)
    created = client.post(COMPARISONS, json={**BODY, "variants": ["nordis-de"]})
    assert created.status_code == 202, created.text
    found = finished(client, created.json()["id"])
    assert found["status"] == "done" and seen == ["dbx-de", "dbx-de"]
    assert {r["access_point"] for r in found["runs"]} == {"dbx-de"}
    assert all("RAISE_ERROR" in r["sql_text"] for r in found["runs"])  # dialecte Databricks
    assert round(found["results"][0]["validation_pct"]) == 94


def test_spaces_never_share_results(client, joined, local):
    """Critère 8 : deux espaces, deux fichiers, aucun résultat de l'un dans l'autre."""
    created = client.post("/api/workspaces", json={"id": "autre-client", "name": "Autre"})
    assert created.status_code == 201
    finished(client, client.post(COMPARISONS, json=BODY).json()["id"])
    assert client.get("/api/workspaces/autre-client/comparisons").json() == []
    assert code(client.get("/api/workspaces/autre-client/comparisons/1")) == (404, "not_found")
    assert index_path("groupe-nordis") != index_path("autre-client")
    with duckdb.connect(str(index_path("autre-client"))) as connection:
        schemas = {s for (s,) in connection.execute(
            "SELECT schema_name FROM duckdb_schemas()").fetchall()}
    assert "results" not in schemas or not store.history(index_path("autre-client"))


def test_cancel_through_the_api(client, joined, local, monkeypatch):
    """Critère 10."""
    started = threading.Event()

    class Blocking:
        def __init__(self, data):
            pass

        def __call__(self, plan, compiled, cancel):
            started.set()
            cancel.wait(5)
            raise RepoError("query_canceled", "Requête annulée.")

    monkeypatch.setattr(service, "LocalRunner", Blocking)
    number = client.post(COMPARISONS, json=BODY).json()["id"]
    assert started.wait(5)
    running = client.get(f"{COMPARISONS}/{number}").json()
    assert running["status"] == "running"
    assert running["progress"] == [{"platform": "databricks",
                                     "entities": ["nordis-de", "nordis-fr"],
                                     "state": "running", "percent": 0}]
    assert client.post(f"{COMPARISONS}/{number}/cancel").json() == {
        "id": number, "status": "cancelling"}
    found = finished(client, number)
    assert found["status"] == "cancelled" and found["results"] == []
    assert code(client.post(f"{COMPARISONS}/{number}/cancel")) == (409, "not_running")
    assert code(client.get(f"{COMPARISONS}/99")) == (404, "not_found")


def test_comparison_left_running_by_a_stopped_process(client, joined):
    store.create(index_path("groupe-nordis"), "julien.h", "revenu-net", 4, {"id": "x"}, 1.0)
    assert client.get(f"{COMPARISONS}/1").json()["status"] == "interrupted"


def test_request_validation(client, joined, local):
    assert client.post(COMPARISONS, json={**BODY, "variants": []}).status_code == 422
    assert client.post(COMPARISONS, json={**BODY, "tolerance": -1}).status_code == 422
    assert code(client.post(COMPARISONS, json={**BODY, "scope_id": "x"})) == (
        422, "unknown_scope")
    assert code(client.post(COMPARISONS, json={**BODY, "variants": ["nordis-es"],
                                               "scope_id": "fy2026-t4"})) == (
        422, "canonical_not_rebindable")
