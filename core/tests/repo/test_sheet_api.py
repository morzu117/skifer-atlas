"""Fiche KPI (plan 0012), de bout en bout sur le dépôt de démonstration avec son
historique (`examples/depot-nordis.sh` : Revenu net v1 à v4)."""

import difflib
import subprocess

import pytest
from fastapi.testclient import TestClient
from workspace_helpers import EXAMPLE, atlas_env

from skifer_atlas.api.app import create_app
from skifer_atlas.repo.git import RepoError
from skifer_atlas.sheet import next_version

__all__ = ["atlas_env"]  # fixture importée

AUTH = {"Authorization": "Bearer secret"}
DOCS = "/api/workspaces/groupe-nordis/documents"
SCRIPT = EXAMPLE.parent / "depot-nordis.sh"


@pytest.fixture
def client(atlas_env, tmp_path):
    subprocess.run(["bash", str(SCRIPT), str(tmp_path / "demo")], check=True,
                   capture_output=True)
    client = TestClient(create_app(token="secret"), headers=AUTH)
    joined = client.post("/api/workspaces/join",
                         json={"remote_url": str(tmp_path / "demo" / "distant.git")})
    assert joined.status_code == 201, joined.text
    return client


def test_sheet_header_and_counters(client):
    """Critère 2 : trois déclinaisons, quatre versions."""
    sheet = client.get(f"{DOCS}/revenu-net/sheet").json()
    assert (sheet["label"], sheet["kind"], sheet["domain_label"], sheet["version"]) == (
        "Revenu net", "kpi", "Finance", 4)
    assert (sheet["owner_name"], sheet["validators_required"], sheet["synonyms"]) == (
        "Claire M.", 2, ["CA net", "net revenue"])
    assert sheet["validated_at"].startswith("2026-10-12")
    assert (len(sheet["variants"]), sheet["version_count"]) == (3, 4)
    de = next(v for v in sheet["variants"] if v["entity"] == "nordis-de")
    assert (de["mode"], de["override_count"], de["undeclared_count"]) == ("override", 3, 2)
    assert de["justification"].startswith("En Allemagne")
    assert [(s["key"], s["value"], s["variation"]) for s in sheet["semantics"]] == [
        ("calendar", "fiscal-nordis 2026.1", False), ("timezone", "Europe/Paris", False),
        ("currency", "EUR", False)]
    deps = sheet["dependencies"]
    assert [(r["label"], r["domain_label"]) for r in deps["references"]] == [
        ("Commande", "Ventes"), ("Date de référence", "Finance")]
    assert [(r["label"], r["domain_label"]) for r in deps["referenced_by"]] == [
        ("Marge brute", "Finance"), ("Panier moyen", "Ventes")]
    assert deps["impact"] == 2
    [implementation] = sheet["implementations"]
    assert (implementation["path"], implementation["extractable"]) == (
        "implementations/revenu-net/nordis-fr/databricks.sql", True)
    assert [s["id"] for s in sheet["scopes"]] == ["fy2026-mois-entite", "fy2026-t4"]
    assert (sheet["tolerance"], sheet["workspace_tolerance"]) == (
        {"percent": 1.5}, {"percent": 1.0})
    versions = client.get(f"{DOCS}/revenu-net/versions").json()
    assert [(v["version"], v["author"]) for v in versions] == [
        (1, "Claire M."), (2, "Claire M."), (3, "Marc D."), (4, "Claire M.")]


def test_layout_shows_variation_points(client):
    """Critères 1 et 6 : n01 à n07, n03 et n04 en points de variation, même disposition
    d'un chargement à l'autre."""
    first = client.get(f"{DOCS}/revenu-net/layout").json()
    assert first == client.get(f"{DOCS}/revenu-net/layout").json()
    nodes = {n["id"]: n for n in first["nodes"]}
    assert sorted(nodes) == ["n01", "n02", "n03", "n04", "n05", "n06", "n07"]
    assert [n for n in nodes if nodes[n]["variation"]] == ["n03", "n04"]
    assert first["output"] == "n05" and nodes["n05"]["output"]
    assert {n: (nodes[n]["layer"], nodes[n]["rank"]) for n in nodes} == {
        "n01": (0, 0), "n06": (0, 1), "n02": (1, 0), "n03": (2, 0), "n07": (3, 0),
        "n04": (4, 0), "n05": (5, 0)}
    assert nodes["n02"]["detail"] == "statut = validée · nulls exclus"
    assert nodes["n05"]["detail"] == "SUM(montant_ht) par mois_fiscal, entite"
    assert {(e["source"], e["target"], e["side"]) for e in first["edges"]} >= {
        ("n03", "n07", "left"), ("n06", "n07", "right")}
    older = client.get(f"{DOCS}/revenu-net/layout", params={"version": 1}).json()
    assert [n["id"] for n in older["nodes"]] == ["n01", "n02", "n03", "n04", "n05"]
    assert not any(n["variation"] for n in older["nodes"])
    variant = client.get(f"{DOCS}/revenu-net--nordis-de/layout").json()
    assert variant["overrides"] == ["n02", "n03", "semantics.timezone"]


def test_version_diff(client):
    """Critère 3 : v3 → v4, écarts classés du plan 0003."""
    report = client.get(f"{DOCS}/revenu-net/diff", params={"base": 3, "other": 4}).json()
    assert (report["relation"], report["identical"]) == ("version", False)
    assert [(d["kind"], d["node_ref"], d["classification"], d["severity"])
            for d in report["differences"]] == [
        ("modified", {"base": "n04", "other": "n04"}, "to_verify", "warn"),
        ("added", {"base": None, "other": "n06"}, "critical", "critical"),
        ("added", {"base": None, "other": "n07"}, "critical", "critical"),
    ]
    same = client.get(f"{DOCS}/revenu-net/diff", params={"base": 4, "other": 4}).json()
    assert same["identical"]


def test_extract_implementation(client):
    """Critère 4 : le SQL de nordis-fr extrait (0004), puis comparé au canonique (0003)."""
    response = client.post(f"{DOCS}/revenu-net/implementations/nordis-fr/databricks/extract")
    assert response.status_code == 200, response.text
    found = response.json()
    assert found["file"] == "implementations/revenu-net/nordis-fr/databricks.sql"
    [statement] = found["statements"]
    assert (statement["status"], statement["roundtrip"]["status"]) == ("draft", "verified")
    assert "montant_ttc / 1.2 - avoirs" in statement["draft"]
    assert statement["diff"]["relation"] == "free"
    assert statement["diff"]["base"]["id"] == "revenu-net"
    assert statement["diff"]["summary"]["by_severity"]["critical"] > 0


def test_draft_increments_version_only(client):
    """Critère 5 : copie de la version courante, `version` incrémentée, rien d'autre."""
    draft = client.get(f"{DOCS}/revenu-net/draft").json()
    assert (draft["base_version"], draft["version"], draft["kind"]) == (4, 5, "kpi")
    current = (EXAMPLE / "kpis" / "revenu-net.yaml").read_text(encoding="utf-8")
    changed = [line for line in difflib.ndiff(current.splitlines(), draft["content"].splitlines())
               if line[:1] in "+-"]
    assert changed == ["-   version: 4", "+   version: 5"]


def test_concept_sheet(client):
    """Critère 7 : un concept n'a ni déclinaisons, ni implémentations, ni scopes."""
    sheet = client.get(f"{DOCS}/commande/sheet").json()
    assert (sheet["kind"], sheet["has_graph"], sheet["version_count"]) == ("concept", False, 1)
    assert (sheet["variants"], sheet["implementations"], sheet["scopes"]) == ([], [], [])
    assert sheet["entity"]["key"] == ["commande_id"]
    assert sheet["validators_required"] == 2  # Ventes : niveau canonique de l'espace
    response = client.get(f"{DOCS}/commande/layout")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_document"


@pytest.mark.parametrize("method,path", [
    ("get", "/inconnu/sheet"),
    ("get", "/revenu-net/layout?version=9"),
    ("get", "/revenu-net/diff?base=3&other=9"),
    ("post", "/revenu-net/implementations/nordis-fr/oracle/extract"),
    ("post", "/revenu-net/implementations/nordis-de/databricks/extract"),
    ("post", "/revenu-net/implementations/..%2Fnordis-fr/databricks/extract"),
    ("get", "/inconnu/draft"),
])
def test_not_found(client, method, path):
    assert getattr(client, method)(f"{DOCS}{path}").status_code == 404


def test_next_version_compact_product():
    text = "schema_version: 1\nkind: concept\ndata_product: {id: c, version: 2, owner: a}\n"
    content, before, after = next_version(text)
    assert (before, after) == (2, 3)
    assert "version: 3" in content
    with pytest.raises(RepoError):
        next_version("kind: concept\n")
