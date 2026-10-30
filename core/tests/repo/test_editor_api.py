"""Éditeur de graphe (plan 0013), de bout en bout sur le dépôt de démonstration
(`examples/depot-nordis.sh` : Revenu net v1 à v4, trois déclinaisons)."""

import copy
import statistics
import subprocess
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from workspace_helpers import EXAMPLE, atlas_env

from skifer_atlas.api.app import create_app
from skifer_atlas.model.io import read_yaml

__all__ = ["atlas_env"]  # fixture importée

AUTH = {"Authorization": "Bearer secret"}
EDITOR = "/api/workspaces/groupe-nordis/editor"
SCRIPT = EXAMPLE.parent / "depot-nordis.sh"
FIXTURE = Path(__file__).parents[1] / "fixtures" / "documents" / "revenu-net.yaml"


@pytest.fixture
def client(atlas_env, tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_ACCOUNT", "anna.k")  # contributrice de Groupe Nordis
    subprocess.run(["bash", str(SCRIPT), str(tmp_path / "demo")], check=True,
                   capture_output=True)
    client = TestClient(create_app(token="secret"), headers=AUTH)
    joined = client.post("/api/workspaces/join",
                         json={"remote_url": str(tmp_path / "demo" / "distant.git")})
    assert joined.status_code == 201, joined.text
    return client


def opened(client, document_id="revenu-net") -> dict:
    response = client.get(f"{EDITOR}/documents/{document_id}")
    assert response.status_code == 200, response.text
    return response.json()


def check(client, document, node_id=None) -> dict:
    response = client.post(f"{EDITOR}/check", json={"document": document, "node_id": node_id})
    assert response.status_code == 200, response.text
    return response.json()


def node(document, node_id) -> dict:
    return next(n for n in document["graph"]["nodes"] if n["id"] == node_id)


def test_open_gives_next_version_and_closed_vocabulary(client):
    info = opened(client)
    assert (info["mode"], info["kind"], info["base_version"]) == ("canonical", "kpi", 4)
    assert info["document"]["data_product"]["version"] == 5
    assert info["highest"] == 7 and info["draft"] is None
    vocabulary = info["vocabulary"]
    assert "sql" not in {o["name"] for o in vocabulary["operators"]}
    assert not {"first", "last"} & set(vocabulary["aggregates"])
    assert vocabulary["platforms"][:2] == ["databricks", "snowflake"]
    assert {"key": "fiscal-nordis", "version": "2026.1"} in info["calendars"]
    assert {"id": "finance", "label": "Finance"} in info["domains"]


def test_check_valid_document_compiles_for_both_dialects(client):
    """Critère 8 : SQL du nœud sélectionné, pour Databricks et Snowflake."""
    result = check(client, opened(client)["document"], "n03")
    assert result["submittable"]
    assert result["status"]["schema"] and result["status"]["acyclic"]
    assert not [i for i in result["issues"] if i["severity"] != "info"]
    for dialect in ("databricks", "snowflake"):
        compiled = result["status"]["compilable"][dialect]
        assert compiled["status"] == "ok"
        assert "montant_ht" in compiled["node_sql"] and compiled["node_sql"] != compiled["sql"]
    assert ["montant_ht", "decimal"] in result["columns"]["n03"]
    assert "id: revenu-net\n  version: 5\n" in result["yaml"]
    assert result["fragments"]["n03"].startswith("- id: n03\n  type: compute\n")
    [info] = [i for i in result["issues"] if i["code"] == "variation_points"]
    assert "n03, n04" in info["message"]


def test_filter_without_nulls_blocks_submission(client):
    """Critère 4 : le problème désigne le nœud ; le SQL attend la correction."""
    document = opened(client)["document"]
    del node(document, "n02")["nulls"]
    result = check(client, document)
    errors = [i for i in result["issues"] if i["severity"] == "error"]
    assert [i["node_id"] for i in errors] == ["n02"]
    assert not result["submittable"]
    assert result["status"]["compilable"]["databricks"] == {"status": "blocked"}
    # Validation partielle : l'amont garde ses colonnes, la suite de la chaîne aussi.
    assert ["statut", "string"] in result["columns"]["n01"]
    assert ["montant_ht", "decimal"] in result["columns"]["n03"]
    assert ["mois_fiscal", "date"] in result["columns"]["n04"]


def test_disappeared_upstream_column_is_reported_downstream(client):
    """Critère 2 : une colonne retirée de la source remonte sur le nœud qui l'utilise."""
    document = opened(client)["document"]
    source = node(document, "n01")
    source["columns"] = [c for c in source["columns"] if c["name"] != "statut"]
    result = check(client, document)
    assert any(i["node_id"] == "n02" and i["severity"] == "error" and "statut" in i["message"]
               for i in result["issues"])
    assert "statut" not in {name for name, _ in result["columns"]["n01"]}


def test_cycle_is_reported(client):
    document = opened(client)["document"]
    node(document, "n02")["inputs"] = ["n05"]
    status = check(client, document)["status"]
    assert not status["acyclic"]
    assert {"n02", "n05"} <= set(status["cycle"])


def test_override_outside_declared_points(client):
    """Critère 7 : surcharger n02, hors points déclarés, demande la validation canonique."""
    info = opened(client, "revenu-net--nordis-fr")
    assert (info["mode"], info["kind"]) == ("override", "variant")
    assert info["canonical"]["variation_points"] == ["n03", "n04"]
    document = info["document"]
    replaced = copy.deepcopy(node(info["canonical"], "n02"))
    replaced["condition"] = "statut:in:validée,expédiée"
    document["overrides"].append({"node": "n02", "justification": "Expédiées comprises.",
                                  "replace": replaced})
    result = check(client, document)
    assert result["submittable"]
    assert any(i["node_id"] == "n02" and i["severity"] == "warning" for i in result["issues"])
    preview = client.post(f"{EDITOR}/preview", json={"document": document}).json()
    assert preview["nature"] == "undeclared"
    assert preview["required"] >= 1 and preview["diff"] is not None


def test_new_document_and_existing_id(client):
    body = {"kind": "kpi", "id": "revenu-net", "label": "Revenu net", "domain": "finance",
            "owner": "anna.k"}
    refused = client.post(f"{EDITOR}/documents", json=body)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "document_exists"
    created = client.post(f"{EDITOR}/documents", json={**body, "id": "revenu-net-2"})
    assert created.status_code == 201, created.text
    info = created.json()
    assert (info["mode"], info["base_version"], info["highest"]) == ("canonical", None, 0)
    assert info["document"]["semantics"] == {"calendar": "TODO", "timezone": "TODO"}
    assert info["draft"]["document"] == info["document"]
    again = client.post(f"{EDITOR}/documents", json={**body, "id": "revenu-net-2"})
    assert again.status_code == 409
    assert opened(client, "revenu-net-2")["document"]["label"] == "Revenu net"


def test_draft_survives_and_is_deleted(client):
    """Critère 9 : le brouillon et les positions sont relus à la réouverture."""
    document = opened(client)["document"]
    document["label"] = "Revenu net corrigé"
    saved = client.put(f"{EDITOR}/documents/revenu-net/draft",
                       json={"document": document, "positions": {"n01": {"x": 24, "y": 48}},
                             "highest": 8, "base_version": 4})
    assert saved.status_code == 200 and saved.json()["saved_at"]
    info = opened(client)
    assert info["draft"]["document"]["label"] == "Revenu net corrigé"
    assert (info["draft"]["highest"], info["positions"]) == (8, {"n01": {"x": 24, "y": 48}})
    assert client.delete(f"{EDITOR}/documents/revenu-net/draft").status_code == 204
    assert opened(client)["draft"] is None


def test_parse_reports_the_line(client):
    """Critère 6 : un YAML illisible empêche le retour au canevas."""
    broken = client.post(f"{EDITOR}/parse", json={"text": "label: [ouvert\nkind: kpi\n"}).json()
    assert broken["document"] is None and broken["issues"]
    good = client.post(f"{EDITOR}/parse", json={"text": FIXTURE.read_text()}).json()
    assert good["document"]["label"] == "Revenu net" and good["issues"] == []


def test_server_yaml_is_canonical(client):
    """Critère 1 : le YAML produit par l'éditeur est, à l'octet près, celui du dépôt,
    quel que soit l'ordre des clés du document édité."""
    text = FIXTURE.read_text(encoding="utf-8")
    raw, _ = read_yaml(text)
    shuffled = {key: raw[key] for key in reversed(list(raw))}
    shuffled["graph"]["nodes"] = [dict(reversed(list(n.items()))) for n in raw["graph"]["nodes"]]
    assert check(client, shuffled)["yaml"] == text


def test_submission_creates_a_proposal(client):
    """Critère 10 : la proposition part de la copie éditée, sur l'hébergeur local."""
    document = opened(client)["document"]
    node(document, "n02")["label"] = "Factures validées seulement"
    result = check(client, document)
    created = client.post("/api/workspaces/groupe-nordis/proposals",
                          json={"document_yaml": result["yaml"], "justification": "Libellé.",
                                "base_version": 4})
    assert created.status_code == 201, created.text
    proposal = created.json()
    assert (proposal["version"], proposal["state"]) == (5, "open")
    listed = client.get("/api/workspaces/groupe-nordis/proposals").json()
    assert proposal["id"] in [p["id"] for p in listed]


def _long_kpi(count: int) -> dict:
    raw, _ = read_yaml(FIXTURE.read_text(encoding="utf-8"))
    source = node(raw, "n01")
    nodes = [source]
    for index in range(2, count):
        nodes.append({"id": f"n{index:02d}", "type": "compute", "inputs": [nodes[-1]["id"]],
                      "column": f"c{index}", "expr": "montant_ttc - montant_taxes",
                      "column_type": "decimal"})
    nodes.append({"id": f"n{count:02d}", "type": "aggregate", "inputs": [nodes[-1]["id"]],
                  "group_by": ["entite"], "measures": [[f"c{count - 1}", "total", "sum"]]})
    raw["graph"] = {"nodes": nodes, "output": nodes[-1]["id"]}
    raw.pop("variation_points")
    return raw


def test_validation_of_50_nodes_under_150_ms(client):
    """Critère 11 : validation (sans le SQL du nœud) sous 150 ms sur 50 nœuds. La mesure
    est consignée dans la section « Mise en œuvre » du plan 0013."""
    document = _long_kpi(50)
    assert len(document["graph"]["nodes"]) == 50
    first = check(client, document)  # met en cache l'analyse de l'espace
    assert first["submittable"], first["issues"]
    timings = []
    for _ in range(5):
        start = time.perf_counter()
        check(client, document)
        timings.append((time.perf_counter() - start) * 1000)
    median = statistics.median(timings)
    print(f"\nvalidation de 50 nœuds : médiane {median:.0f} ms ({', '.join(f'{t:.0f}' for t in timings)})")
    assert median < 150
