"""Écran de comparaison (plan 0015) : panneau de lancement, aperçu avant lancement,
nœud divergent nommé, diff d'une déclinaison à son canonique."""

import pytest
import yaml
from fastapi.testclient import TestClient
from test_comparisons_api import AUTH, BODY, COMPARISONS, DATA, WS, code, finished
from workspace_helpers import atlas_env, remote

from skifer_atlas.api.app import create_app
from skifer_atlas.vault import Credential, Vault, keyring_vault
from skifer_atlas.workspaces import repo_dir

__all__ = ["atlas_env", "remote"]  # fixtures importées


@pytest.fixture
def client(atlas_env, remote, monkeypatch):
    monkeypatch.setenv("ATLAS_VAULT", "memory")
    monkeypatch.setenv("ATLAS_ACCOUNT", "julien.h")
    keyring_vault._memory._items.clear()
    client = TestClient(create_app(token="secret"), headers=AUTH)
    assert client.post("/api/workspaces/join",
                       json={"remote_url": str(remote[0])}).status_code == 201
    yield client
    keyring_vault._memory._items.clear()


@pytest.fixture
def local(monkeypatch):
    monkeypatch.setenv("ATLAS_COMPARE_DATA", str(DATA))


def test_setup_lists_variants_scopes_granularities_and_tolerances(client, local):
    setup = client.get(f"{COMPARISONS}/setup?kpi=revenu-net").json()
    assert (setup["label"], setup["version"], setup["local"]) == ("Revenu net", 4, True)
    assert [(v["entity"], v["mode"], v["platform"], v["outdated"])
            for v in setup["variants"]] == [
        ("nordis-de", "override", "databricks", False),
        ("nordis-es", "from_scratch", "snowflake", False),
        ("nordis-fr", "override", "databricks", False)]
    # nordis-es, from scratch, se rebranche par ses binding (plan 0022).
    assert [v["unavailable"] for v in setup["variants"]] == [None, None, None]
    scope = setup["scopes"][0]
    assert scope["id"] == "fy2026-mois-entite"
    assert scope["period"] == {"from": "2026-02-01", "to": "2026-09-30"}
    assert scope["granularities"] == [["mois_fiscal", "entite"], ["mois_fiscal"], ["entite"]]
    assert setup["tolerance"] == {"kpi": 1.5, "workspace": 1.0}
    assert code(client.get(f"{COMPARISONS}/setup?kpi=commande")) == (404, "not_found")


def test_preview_reports_alerts_without_running_anything(client, local):
    """Critère 3 : l'aperçu signale le bypass avant tout lancement."""
    preview = client.post(f"{COMPARISONS}/preview", json=BODY).json()
    assert [(a["code"], a["entity"], a["nodes"]) for a in preview["alerts"]] == [
        ("undeclared_override", "nordis-de", ["semantics.timezone", "n02"])]
    assert preview["plans"] == [
        {"entity": "nordis-de", "platform": "databricks", "access_point": None},
        {"entity": "nordis-fr", "platform": "databricks", "access_point": None}]
    assert (preview["tolerance"], preview["granularity"]) == (1.5, ["mois_fiscal", "entite"])

    path = repo_dir("groupe-nordis") / "kpis" / "revenu-net.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    join = next(n for n in data["graph"]["nodes"] if n["type"] == "join")
    join.update(check="bypass", bypass_reason="Doublons connus.")
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    alerts = client.post(f"{COMPARISONS}/preview", json=BODY).json()["alerts"]
    assert {(a["code"], a["entity"]) for a in alerts} >= {
        ("cardinality_bypass", "nordis-de"), ("cardinality_bypass", "nordis-fr")}
    assert client.get(COMPARISONS).json() == []  # rien d'exécuté ni d'enregistré


def test_preview_lists_missing_access(client):
    """Critère 4 : l'écran sait, avant de lancer, à quels points d'accès se connecter."""
    points = [{"id": f"dbx-{e[-2:]}", "platform": "databricks",
               "host": "https://adb-1.2.azuredatabricks.net", "warehouse_id": "abc",
               "entity": e, "owner": "claire.m"} for e in ("nordis-de", "nordis-fr")]
    (repo_dir("groupe-nordis") / "access_points.yaml").write_text(
        yaml.safe_dump({"schema_version": 1, "access_points": points}), encoding="utf-8")
    Vault().put("groupe-nordis", "dbx-de", Credential("pat", "dapi-de"))
    preview = client.post(f"{COMPARISONS}/preview", json=BODY).json()
    assert [p["access_point"] for p in preview["plans"]] == ["dbx-de", "dbx-fr"]
    assert [(m["access_point"], m["code"]) for m in preview["missing_access"]] == [
        ("dbx-fr", "not_connected")]


def test_divergent_node_is_named_and_matrix_has_domain_labels(client, local):
    """Critère 2 : « Nœud divergent : n02 · Factures validées »."""
    number = client.post(COMPARISONS, json=BODY).json()["id"]
    found = finished(client, number)
    de = found["results"][0]
    assert de["divergent"]["node_id"] == "n02"
    assert de["divergent"]["label"] == "Factures validées"
    september = [c for c in de["cells"] if c["dims"] == {"mois_fiscal": "2026-09-01",
                                                         "entite": "DE"}]
    assert [(round(c["gap_pct"], 1), c["within_tolerance"]) for c in september] == [(6.1, False)]
    matrix = {row["kpi_id"]: row for row in client.get(f"{COMPARISONS}/matrix").json()}
    assert matrix["revenu-net"]["domain_label"] == "Finance"
    cells = {c["entity"]: c for c in matrix["revenu-net"]["variants"]}
    assert (cells["nordis-de"]["comparison_id"], round(cells["nordis-de"]["validation_pct"]),
            round(cells["nordis-de"]["max_gap_pct"], 1)) == (number, 94, 6.1)
    assert not cells["nordis-es"]["compared"]


def test_canonical_diff_of_a_variant(client):
    found = client.get(f"{WS}/documents/revenu-net--nordis-de/canonical-diff").json()
    assert found["base"]["label"] == "Canonique v4"
    assert found["other"]["label"].startswith("Déclinaison nordis-de v")
    assert "n02" in found["other"]["overrides"]
    verdicts = {d["node_ref"]["other"]: d["classification"]
                for d in found["report"]["differences"] if d["node_ref"]}
    assert verdicts["n02"] == "override_undeclared"
    assert code(client.get(f"{WS}/documents/revenu-net/canonical-diff")) == (
        422, "not_a_variant")
