"""Comparaison entre deux dialectes (plan 0018, critères 3 et 4) : Revenu net avec FR sur
Databricks et DE sur Snowflake. DE passe par le vrai connecteur Snowflake, contre un faux
compte local qui exécute le SQL Snowflake dans DuckDB ; FR rejoue son SQL Databricks en
DuckDB, comme `test_comparisons_api.py`."""

import sys
from pathlib import Path

import pytest
import yaml
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from test_comparisons_api import AUTH, BODY, COMPARISONS, DATA, finished
from workspace_helpers import atlas_env, commit_all, remote

from skifer_atlas import connections
from skifer_atlas.compare import service
from skifer_atlas.compare.orchestrate import LocalRunner
from skifer_atlas.compile import SourceTable
from skifer_atlas.connectors import snowflake as connector
from skifer_atlas.run.duckdb_local import open_database
from skifer_atlas.vault import Credential, Vault, keyring_vault
from skifer_atlas.workspaces import repo_dir

sys.path.insert(0, str(Path(__file__).parents[1] / "connections"))
from fake_snowflake import FakeSnowflake

__all__ = ["atlas_env", "remote"]  # fixtures importées

PASSPHRASE = "pass-de"
SOURCES = ("n01", "n06")  # factures et jours comptables


@pytest.fixture
def snow(monkeypatch):
    monkeypatch.setattr(connector, "POLL_SECONDS", 0.01)
    server = FakeSnowflake()
    yield server
    server.close()


@pytest.fixture
def client(atlas_env, monkeypatch):
    from fastapi.testclient import TestClient

    from skifer_atlas.api.app import create_app

    monkeypatch.setenv("ATLAS_VAULT", "memory")
    keyring_vault._memory._items.clear()
    yield TestClient(create_app(token="secret"), headers=AUTH)
    keyring_vault._memory._items.clear()


def de_on_snowflake(repo: Path) -> list[SourceTable]:
    """La déclinaison DE lit ses sources sur Snowflake : surcharge des deux nœuds source
    du canonique, à la plateforme près. Rend les tables à charger côté Snowflake."""
    canonical = yaml.safe_load((repo / "kpis" / "revenu-net.yaml").read_text(encoding="utf-8"))
    path = repo / "variants" / "revenu-net" / "nordis-de.yaml"
    variant = yaml.safe_load(path.read_text(encoding="utf-8"))
    tables = []
    for node in canonical["graph"]["nodes"]:
        if node["id"] in SOURCES:
            variant["overrides"].append({"node": node["id"], "justification":
                                         "Entrepôt allemand sur Snowflake.",
                                         "replace": {**node, "platform": "snowflake"}})
            tables.append(SourceTable(node["table"], tuple(
                (c["name"], c["type"]) for c in node["columns"])))
    path.write_text(yaml.safe_dump(variant, allow_unicode=True, sort_keys=False),
                    encoding="utf-8")
    return tables


def setup_space(client, remote, snow, monkeypatch, tmp_path) -> list[SourceTable]:
    monkeypatch.setenv("ATLAS_ACCOUNT", "julien.h")
    assert client.post("/api/workspaces/join",
                       json={"remote_url": str(remote[0])}).status_code == 201
    repo = repo_dir("groupe-nordis")
    tables = de_on_snowflake(repo)
    points = [
        {"id": "dbx-fr", "platform": "databricks", "host": "https://adb-1.2.azuredatabricks.net",
         "warehouse_id": "abc", "entity": "nordis-fr", "owner": "claire.m"},
        {"id": "snow-de", "platform": "snowflake", "host": snow.url, "account": "nordis-de",
         "warehouse": "WH_FINANCE", "auth": "keypair", "entity": "nordis-de",
         "owner": "anna.k"}]
    (repo / "access_points.yaml").write_text(
        yaml.safe_dump({"schema_version": 1, "access_points": points}), encoding="utf-8")
    commit_all(repo, "DE sur Snowflake")

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    snow.add_key_user("svc_de", key.public_key())
    path = tmp_path / "rsa_key.p8"
    path.write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.BestAvailableEncryption(PASSPHRASE.encode())))
    Vault().put("groupe-nordis", "dbx-fr", Credential("pat", "dapi-fr"))
    stored = client.put("/api/workspaces/groupe-nordis/connections/snow-de/key-pair", json={
        "user": "svc_de", "private_key_file": str(path), "passphrase": PASSPHRASE})
    assert stored.status_code == 200, stored.text

    # FR : le SQL Databricks part vers la plateforme ; on rejoue son équivalent DuckDB.
    runner, local_for, original = LocalRunner(DATA), {}, service.prepare_in

    def spy(root, request, workspace_id, local):
        found = original(root, request, workspace_id, local)
        for remote_plan, local_plan in zip(found.plans, original(root, request, None,
                                                                 True).plans, strict=True):
            for side in ("canonical", "variant"):
                local_for[getattr(remote_plan, side).compiled.sql] = (
                    local_plan, getattr(local_plan, side).compiled)
        return found

    on_platform = connections.run_aggregate

    def routed(ws, ap, sql, cancel=None, **kwargs):
        if ap == "dbx-fr":
            return runner(*local_for[sql], cancel)
        return on_platform(ws, ap, sql, cancel=cancel, **kwargs)

    monkeypatch.setattr(service, "prepare_in", spy)
    monkeypatch.setattr(connections, "run_aggregate", routed)
    return tables


def test_comparison_across_databricks_and_snowflake(client, remote, snow, monkeypatch,
                                                    tmp_path):
    """Critère 3 : FR sur Databricks, DE sur Snowflake, réconciliés au même seuil."""
    tables = setup_space(client, remote, snow, monkeypatch, tmp_path)
    snow.use_database(open_database(tables, DATA / "nordis-de"))
    created = client.post(COMPARISONS, json=BODY)
    assert created.status_code == 202, created.text
    found = finished(client, created.json()["id"])
    assert found["status"] == "done", found
    runs = {(r["variant_id"].rsplit("--", 1)[1], r["side"]): r for r in found["runs"]}
    assert {k: (r["platform"], r["access_point"]) for k, r in runs.items()} == {
        ("nordis-de", "canonical"): ("snowflake", "snow-de"),
        ("nordis-de", "variant"): ("snowflake", "snow-de"),
        ("nordis-fr", "canonical"): ("databricks", "dbx-fr"),
        ("nordis-fr", "variant"): ("databricks", "dbx-fr")}
    assert "AS INT)" in runs[("nordis-de", "variant")]["sql_text"]  # garde Snowflake
    assert "RAISE_ERROR" in runs[("nordis-fr", "variant")]["sql_text"]  # garde Databricks
    assert [(r["entity"], r["platform"], round(r["validation_pct"]), r["divergent_node"])
            for r in found["results"]] == [("nordis-de", "snowflake", 94, "n02"),
                                           ("nordis-fr", "databricks", 100, None)]
    assert len(snow.state.seen_sql) == 2 and snow.state.logins[-1]["LOGIN_NAME"] == "svc_de"


def test_cardinality_check_fails_on_snowflake(client, remote, snow, monkeypatch, tmp_path):
    """Critère 4 : jours comptables en double, la garde fait échouer la requête Snowflake
    avec le message d'Atlas ; DE n'a pas de résultat, FR si."""
    tables = setup_space(client, remote, snow, monkeypatch, tmp_path)
    database = open_database(tables, DATA / "nordis-de")
    database.execute("INSERT INTO gold.finance.dim_date SELECT * FROM gold.finance.dim_date")
    snow.use_database(database)
    found = finished(client, client.post(COMPARISONS, json=BODY).json()["id"])
    assert found["status"] == "partial"
    canonical = next(r for r in found["runs"]
                     if r["variant_id"].endswith("nordis-de") and r["side"] == "canonical")
    assert canonical["status"] == "failed"
    assert canonical["error"].startswith(
        "query_failed: atlas: cardinalité N:1 non respectée en n07, clés en double à droite")
    assert [r["entity"] for r in found["results"]] == ["nordis-fr"]
