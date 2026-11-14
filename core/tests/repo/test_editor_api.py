"""Éditeur de graphe (plan 0013), de bout en bout sur le dépôt de démonstration
(`examples/depot-nordis.sh` : Revenu net v1 à v4, trois déclinaisons)."""

import copy
import json
import statistics
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml
from fastapi.testclient import TestClient
from workspace_helpers import EXAMPLE, atlas_env

from skifer_atlas.api.app import create_app
from skifer_atlas.model.io import read_yaml
from skifer_atlas.paths import workspace_dir
from skifer_atlas.workspaces import get_workspace, repo_dir, update_workspace

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


def test_concept_without_graph_is_not_applicable_and_can_be_proposed(client):
    document = opened(client, "commande")["document"]
    result = check(client, document)
    assert result["submittable"]
    assert all(value == {"status": "not_applicable"}
               for value in result["status"]["compilable"].values())
    assert client.post(f"{EDITOR}/preview", json={"document": document}).status_code == 200
    invalid = copy.deepcopy(document)
    invalid["label"] = ""
    assert not check(client, invalid)["submittable"]
    document["graph"] = {"nodes": []}
    result = check(client, document)
    assert not result["submittable"]
    assert result["status"]["compilable"]["databricks"] == {"status": "blocked"}


@pytest.mark.parametrize("document_id", ["a", "a" * 65, "-ab", "ab\n"])
def test_new_document_rejects_invalid_identifiers(client, document_id):
    response = client.post(f"{EDITOR}/documents", json={"kind": "concept", "id": document_id,
                           "label": "Concept", "domain": "finance", "owner": "anna.k"})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_document"


@pytest.mark.parametrize("document_id", ["ab", "a" * 64])
def test_new_document_accepts_identifier_length_boundaries(client, document_id):
    response = client.post(f"{EDITOR}/documents", json={"kind": "concept", "id": document_id,
                           "label": "Concept", "domain": "finance", "owner": "anna.k"})
    assert response.status_code == 201


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


@pytest.mark.parametrize("mode", ["override", "from_scratch"])
def test_new_variant_starts_a_local_draft_for_the_current_canonical(client, mode):
    repo = repo_dir("groupe-nordis")
    meta = yaml.safe_load((repo / "atlas.yaml").read_text(encoding="utf-8"))
    meta["entities"].append("nordis-it")
    (repo / "atlas.yaml").write_text(yaml.safe_dump(meta), encoding="utf-8")
    body = {"kpi_id": "revenu-net", "entity": "nordis-it", "mode": mode,
            "owner": "anna.k", "justification": "Définition locale italienne."}
    created = client.post(f"{EDITOR}/variants", json=body)
    assert created.status_code == 201, created.text
    info = created.json()
    assert (info["id"], info["mode"], info["base_version"]) == (
        "revenu-net--nordis-it", mode, None)
    document = info["document"]
    assert document["variant_of"] == {"id": "revenu-net", "version": 4}
    assert document["data_product"] == {"id": "revenu-net--nordis-it", "version": 1,
                                        "owner": "anna.k"}
    assert info["canonical"]["data_product"]["version"] == 4
    assert info["draft"]["document"] == document
    assert not check(client, document)["submittable"]
    if mode == "override":
        assert document["overrides"] == []
        replaced = copy.deepcopy(node(info["canonical"], "n02"))
        replaced["condition"] = "statut:in:validée,expédiée"
        document["overrides"].append({"node": "n02", "justification": "Expédiées comprises.",
                                      "replace": replaced})
    else:
        assert document["graph"] == {"nodes": []}
        assert "commande" in document["concepts"]
        document["graph"] = copy.deepcopy(info["canonical"]["graph"])
    checked = check(client, document)
    assert checked["submittable"], checked["issues"]
    proposal = client.post("/api/workspaces/groupe-nordis/proposals", json={
        "document_yaml": checked["yaml"], "justification": "Déclinaison locale.",
        "base_version": None,
    })
    assert proposal.status_code == 201, proposal.text
    assert proposal.json()["document_id"] == "revenu-net--nordis-it"
    duplicate = client.post(f"{EDITOR}/variants", json=body)
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["code"] == "draft_exists"


def test_new_variant_rejects_unknown_entity_and_existing_variant(client):
    body = {"kpi_id": "revenu-net", "entity": "inconnue", "mode": "override",
            "owner": "anna.k", "justification": "Local"}
    unknown = client.post(f"{EDITOR}/variants", json=body)
    assert unknown.status_code == 422
    assert unknown.json()["detail"]["code"] == "invalid_entity"
    existing = client.post(f"{EDITOR}/variants", json={**body, "entity": "nordis-fr"})
    assert existing.status_code == 409
    invalid = client.post(f"{EDITOR}/variants", json={**body, "entity": "../secret"})
    assert invalid.status_code == 422


def test_document_id_with_trailing_newline_is_invalid(client):
    body = {"kind": "kpi", "id": "nouveau-id\n", "label": "Nouveau", "domain": "finance",
            "owner": "anna.k"}
    response = client.post(f"{EDITOR}/documents", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_document"


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


def test_draft_keeps_the_unfinished_yaml_text_and_stays_valid_without_it(client):
    """Plan 0013, critère 14 : le texte YAML inachevé revient tel quel à la relecture ; un
    brouillon sans `yaml_text` (ancien ou venu d'un autre usage) reste valide."""
    path = f"{EDITOR}/documents/revenu-net/draft"
    document = opened(client)["document"]
    unfinished = "schema_version: 1\nlabel: [ouvert\n"
    saved = client.put(path, json={"document": document, "positions": {}, "highest": 7,
                                   "base_version": 4, "yaml_text": unfinished})
    assert saved.status_code == 200, saved.text
    draft = opened(client)["draft"]
    assert draft["yaml_text"] == unfinished and draft["document"] == document

    without = client.put(path, json={"document": document, "positions": {}, "highest": 7,
                                     "base_version": 4})
    assert without.status_code == 200, without.text
    assert opened(client)["draft"]["yaml_text"] is None

    legacy = workspace_dir("groupe-nordis") / ".atlas/drafts/ancien.json"
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_text(json.dumps({"document": document, "positions": {}, "highest": 7,
                                  "base_version": None,
                                  "saved_at": "2026-01-01T00:00:00+00:00"}), encoding="utf-8")
    assert opened(client, "ancien")["draft"]["document"] == document


def test_corrupt_document_in_draft_is_reported(client):
    draft = workspace_dir("groupe-nordis") / ".atlas/drafts/nouveau-corrompu.json"
    draft.parent.mkdir(parents=True, exist_ok=True)
    draft.write_text('{"document": ["not", "an", "object"]}', encoding="utf-8")
    response = client.get(f"{EDITOR}/documents/nouveau-corrompu")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_document"


def test_reader_cannot_change_draft(client):
    workspace = get_workspace("groupe-nordis")
    update_workspace(workspace.model_copy(update={"role": "lecteur"}))
    path = f"{EDITOR}/documents/revenu-net/draft"
    assert client.put(path, json={"document": {"kind": "kpi"}}).status_code == 403
    assert client.delete(path).status_code == 403


def test_oversized_draft_is_rejected_before_writing(client):
    path = f"{EDITOR}/documents/revenu-net/draft"
    response = client.put(path, json={"document": {"label": "x" * (2 * 1024 * 1024)}})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_document"
    assert not (workspace_dir("groupe-nordis") / ".atlas/drafts/revenu-net.json").exists()


def test_editor_analysis_cache_evicts_old_workspaces(monkeypatch, tmp_path):
    from skifer_atlas.api.routes import editor as editor_routes

    calls = []
    monkeypatch.setattr(editor_routes, "workspace_or_404", lambda ws: SimpleNamespace(id=ws))
    monkeypatch.setattr(editor_routes, "repo_dir", lambda ws: tmp_path / ws)
    monkeypatch.setattr(editor_routes, "head", lambda repo: "same-commit")
    monkeypatch.setattr(editor_routes, "analyze", lambda repo: calls.append(repo) or object())
    monkeypatch.setattr(editor_routes.editor, "calendars_of", lambda repo: {})
    previous = editor_routes._cache.copy()
    try:
        editor_routes._cache.clear()
        for number in range(editor_routes.MAX_CACHED_WORKSPACES + 1):
            editor_routes._context(f"space-{number}")
        assert len(editor_routes._cache) == editor_routes.MAX_CACHED_WORKSPACES
        editor_routes._context("space-0")
        assert calls[-1] == tmp_path / "space-0"
        assert len(calls) == editor_routes.MAX_CACHED_WORKSPACES + 2
    finally:
        editor_routes._cache.clear()
        editor_routes._cache.update(previous)


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


def test_validation_of_50_nodes_under_150_ms(client, perf_factor):
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
    assert median < 150 * perf_factor


def test_creation_draft_can_be_listed_resumed_and_discarded(client):
    body = {"kind": "kpi", "id": "stock-moyen", "label": "Stock moyen",
            "domain": "finance", "owner": "anna.k"}
    assert client.post(f"{EDITOR}/documents", json=body).status_code == 201
    assert {"id": "stock-moyen", "label": "Stock moyen"} in client.get(f"{EDITOR}/drafts").json()
    duplicate = client.post(f"{EDITOR}/documents", json=body)
    assert duplicate.json()["detail"]["code"] == "draft_exists"
    assert opened(client, "stock-moyen")["draft"] is not None
    assert client.delete(f"{EDITOR}/documents/stock-moyen/draft").status_code == 204
    assert client.get(f"{EDITOR}/drafts").json() == []
    assert client.post(f"{EDITOR}/documents", json=body).status_code == 201


def test_unknown_source_concept_blocks_validation(client):
    document = opened(client)["document"]
    node(document, "n01")["concept"] = "visiteur-inconnu"
    result = check(client, document)
    assert not result["submittable"]
    assert any(i["node_id"] == "n01" and i["severity"] == "error" and
               "visiteur-inconnu" in i["message"] for i in result["issues"])
    node(document, "n01")["concept"] = "commande"
    assert check(client, document)["submittable"]


def test_invalid_window_frame_is_node_error(client):
    document = opened(client)["document"]
    document["graph"]["nodes"].append({"id": "n08", "type": "temporal", "inputs": ["n01"],
        "operation": "window", "column": "montant_ttc", "target": "glissant", "function": "sum",
        "frame": "3 rows preceding", "order_by": [["montant_ttc", "asc"]]})
    result = check(client, document)
    assert not result["submittable"]
    assert any(i["node_id"] == "n08" and i["severity"] == "error" for i in result["issues"])


def test_unknown_concept_in_resolved_variant_is_reported(client):
    document = opened(client, "revenu-net--nordis-fr")["document"]
    source = copy.deepcopy(node(opened(client)["document"], "n01"))
    source["concept"] = "visiteur-inconnu"
    document["overrides"].append({"node": "n01", "justification": "Source locale.",
                                  "replace": source})
    result = check(client, document)
    assert not result["submittable"]
    assert any(i["node_id"] == "n01" and i["code"] == "unknown_concept"
               for i in result["issues"])


@pytest.mark.parametrize("expression", ["(", "SUM(", "x +", "(" * 50 + "x" + ")" * 50])
def test_invalid_editor_expression_returns_validation_error(client, expression):
    document = opened(client)["document"]
    node(document, "n03")["expr"] = expression
    result = check(client, document)
    assert not result["submittable"]
    assert any(i["node_id"] == "n03" and i["severity"] == "error" for i in result["issues"])


def test_draft_inventory_handles_corruption_collision_and_layout(client):
    folder = workspace_dir("groupe-nordis") / ".atlas"
    drafts = folder / "drafts"
    drafts.mkdir(parents=True, exist_ok=True)
    (drafts / "illisible.json").write_text("{", encoding="utf-8")
    (drafts / "revenu-net.json").write_text(json.dumps({"base_version": None,
        "document": {"kind": "kpi", "label": []}}), encoding="utf-8")
    (drafts / "commande.json").write_text(json.dumps({"base_version": 1,
        "document": {"kind": "concept", "label": "Commande"}}), encoding="utf-8")
    result = client.get(f"{EDITOR}/drafts").json()
    assert {"id": "illisible", "label": "illisible", "resumable": False} in result
    assert {"id": "revenu-net", "label": "revenu-net"} in result
    assert not any(item["id"] == "commande" for item in result)
    layout = folder / "layout" / "illisible.json"
    layout.parent.mkdir(parents=True, exist_ok=True)
    layout.write_text('{}', encoding="utf-8")
    assert client.delete(f"{EDITOR}/documents/illisible/draft?discard_layout=true").status_code == 204
    assert not layout.exists()
    assert client.delete(f"{EDITOR}/documents/invalid_id/draft").status_code == 404


def test_reader_draft_inventory_is_empty(client):
    workspace = get_workspace("groupe-nordis")
    update_workspace(workspace.model_copy(update={"role": "lecteur"}))
    assert client.get(f"{EDITOR}/drafts").json() == []


@pytest.mark.parametrize("field,value", [
    ("variant_id", []), ("variant_id", {}), ("replacement_id", []),
    ("kind", []), ("mode", {}), ("nodes", {}), ("node_id", []),
])
def test_malformed_yaml_values_do_not_crash_check(client, field, value):
    document = opened(client, "revenu-net--nordis-fr")["document"]
    if field == "variant_id":
        document["variant_of"]["id"] = value
    elif field == "replacement_id":
        document["overrides"] = [{"node": "n01", "replace": {"id": value}}]
    elif field == "nodes":
        document = opened(client)["document"]
        document["graph"]["nodes"] = value
    elif field == "node_id":
        document = opened(client)["document"]
        document["graph"]["nodes"][0]["id"] = value
    else:
        document[field] = value
    result = check(client, document)
    assert not result["submittable"]
    assert any(issue["severity"] == "error" for issue in result["issues"])


def test_empty_draft_inventory_does_not_analyze_repository(client, monkeypatch):
    from skifer_atlas.api.routes import editor as routes

    def unexpected(_ws):
        raise AssertionError("repository analysis should not run")

    monkeypatch.setattr(routes, "_context", unexpected)
    assert client.get(f"{EDITOR}/drafts").json() == []


def test_compiler_expression_reports_parse_errors():
    from skifer_atlas.compile import CompileError
    from skifer_atlas.compile.builder import _Builder, _Unit
    from skifer_atlas.model.graph import Library

    builder = _Unit.__new__(_Unit)
    builder.builder = _Builder("databricks", Library(), {})
    builder.dialect = "databricks"
    with pytest.raises(CompileError) as error:
        builder.expression("(", "n03", {})
    assert error.value.issues[0].node_id == "n03"


@pytest.mark.parametrize("document_id", ["a", "a" * 65, "-ab", "ab_", "stock--moyen"])
def test_new_document_rejects_invalid_ids(client, document_id):
    body = {"kind": "kpi", "id": document_id, "label": "Stock",
            "domain": "finance", "owner": "anna.k"}
    response = client.post(f"{EDITOR}/documents", json=body)
    assert response.json()["detail"]["code"] == "invalid_document"


def test_creation_draft_deletion_preserves_layout_unless_discarded(client):
    body = {"kind": "kpi", "id": "stock-moyen", "label": "Stock moyen",
            "domain": "finance", "owner": "anna.k"}
    assert client.post(f"{EDITOR}/documents", json=body).status_code == 201
    layout = workspace_dir("groupe-nordis") / ".atlas/layout/stock-moyen.json"
    layout.write_text('{"n01": {"x": 24, "y": 48}}', encoding="utf-8")
    path = f"{EDITOR}/documents/stock-moyen/draft"
    assert client.delete(path).status_code == 204
    assert json.loads(layout.read_text(encoding="utf-8")) == {"n01": {"x": 24, "y": 48}}
    assert client.post(f"{EDITOR}/documents", json=body).status_code == 201
    assert client.delete(f"{path}?discard_layout=true").status_code == 204
    assert not layout.exists()
