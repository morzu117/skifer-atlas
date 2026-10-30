"""Écran des propositions (plan 0014), sur le dépôt de démonstration et ses cinq
propositions (`examples/depot-nordis.sh` puis `examples/propositions-nordis.py`)."""

import subprocess
import sys

import pytest
from fastapi.testclient import TestClient
from workspace_helpers import EXAMPLE, atlas_env

from skifer_atlas.api.app import create_app

__all__ = ["atlas_env"]  # fixture importée

AUTH = {"Authorization": "Bearer secret"}
API = "/api/workspaces/groupe-nordis"
EXAMPLES = EXAMPLE.parent


@pytest.fixture
def client(atlas_env, tmp_path, monkeypatch):
    demo = tmp_path / "demo"
    subprocess.run(["bash", str(EXAMPLES / "depot-nordis.sh"), str(demo)], check=True,
                   capture_output=True)
    subprocess.run([sys.executable, str(EXAMPLES / "propositions-nordis.py"),
                    str(demo / "distant.git")], check=True, capture_output=True)
    monkeypatch.setenv("ATLAS_ACCOUNT", "claire.m")  # référente Finance
    client = TestClient(create_app(token="secret"), headers=AUTH)
    joined = client.post("/api/workspaces/join",
                         json={"remote_url": str(demo / "distant.git")})
    assert joined.status_code == 201, joined.text
    return client


def as_account(monkeypatch, account):
    monkeypatch.setenv("ATLAS_ACCOUNT", account)


def by_entity(items):
    return {(i["document_id"]): i for i in items}


def test_queue_reflects_the_demo_with_finance_first(client):
    """Critères 1 et 2 : badges et compteurs du dépôt ; Finance avant Supply."""
    queue = client.get(f"{API}/proposals/queue").json()
    assert (queue["account"], queue["review_domains"]) == ("claire.m", ["finance"])
    assert queue["members"]["anna.k"] == "Anna K."
    assert {"id": "finance", "label": "Finance"} in queue["domains"]
    assert {"nordis-de", "nordis-es", "nordis-fr"} <= set(queue["entities"])
    items = queue["items"]
    assert [i["id"] for i in items] == [5, 4, 3, 1, 2]  # Supply (n° 2) en dernier
    found = {i["id"]: (i["nature"], i["approvals"]["obtained"], i["approvals"]["required"],
                       i["mention"], i["ready_to_merge"]) for i in items}
    assert found == {
        5: ("undeclared", 0, 2, "Validation canonique exigée", False),
        4: ("undeclared", 0, 2, "Validation canonique exigée", False),
        3: ("new_version", 1, 2, None, False),
        1: ("from_scratch", 1, 2, "Validation canonique exigée", False),
        2: ("new_version", 1, 1, None, True),
    }


def test_viewer_explains_why_approval_is_disabled(client, monkeypatch):
    """Critère 4 : l'auteur ne peut pas approuver ; un compte habilité, si."""
    detail = client.get(f"{API}/proposals/5").json()
    assert detail["viewer"] == {"account": "claire.m", "can_review": True,
                                "review_reason": None, "can_merge": False,
                                "merge_reason": "0 validation(s) sur 2."}
    assert [c["body"][:10] for c in detail["comments"]] == ["Le statut "]
    as_account(monkeypatch, "anna.k")
    viewer = client.get(f"{API}/proposals/5").json()["viewer"]
    assert not viewer["can_review"] and "auteur" in viewer["review_reason"]
    as_account(monkeypatch, "sami.b")  # référent Supply : son approbation ne compte pas
    viewer = client.get(f"{API}/proposals/5").json()["viewer"]
    assert not viewer["can_review"]
    assert viewer["review_reason"].endswith("claire.m, julien.h, marc.d.")


def test_graphs_of_the_german_override(client):
    """Critère 3 : bandeau, n02 en divergence critique, n03 surchargé sur point déclaré ;
    n02 revient dans deux entités (DE et la proposition FR)."""
    graphs = client.get(f"{API}/proposals/5/graphs").json()
    assert graphs["base"]["label"] == "Canonique v4"
    assert graphs["proposed"]["label"] == "Déclinaison nordis-de v4 (proposée)"
    assert graphs["proposed"]["overrides"] == ["n02", "n03", "semantics.timezone"]
    assert [n["id"] for n in graphs["proposed"]["nodes"]] == \
        [n["id"] for n in graphs["base"]["nodes"]]
    verdicts = {d["node_ref"]["base"]: (d["classification"], d["severity"])
                for d in graphs["report"]["differences"] if d["node_ref"]}
    assert verdicts == {"n02": ("override_undeclared", "critical"),
                        "n03": ("override_declared", "warn")}
    assert graphs["undeclared"] == [{"node": "n02", "label": "Factures validées"},
                                    {"node": "semantics.timezone", "label": None}]
    assert graphs["recurring"] == [{"node": "n02", "label": "Factures validées",
                                    "entities": ["nordis-de", "nordis-fr"]}]


def test_graphs_of_a_new_version_and_a_from_scratch(client):
    canonical = client.get(f"{API}/proposals/3/graphs").json()
    assert canonical["base"]["label"] == "Version 4"
    assert canonical["report"]["relation"] == "version"
    assert canonical["undeclared"] == [] and canonical["recurring"] == []
    scratch = client.get(f"{API}/proposals/1/graphs").json()
    assert scratch["report"]["relation"] == "from_scratch"
    assert any(d["kind"] == "added" for d in scratch["report"]["differences"])


def test_request_changes_needs_a_comment(client):
    """Critère 5."""
    refused = client.post(f"{API}/proposals/5/reviews",
                          json={"event": "request_changes", "body": "  "})
    assert refused.status_code == 422
    assert refused.json()["detail"]["code"] == "comment_required"
    done = client.post(f"{API}/proposals/5/reviews",
                       json={"event": "request_changes", "body": "Chiffrer l'écart de 6 %."})
    assert done.status_code == 200 and done.json()["changes_requested_by"] == ["claire.m"]


def test_full_cycle_until_merge(client, monkeypatch):
    """Critères 4 et 6 : deux approbations, « Fusionner », la file se vide de la
    proposition et la fiche passe en v4."""
    approved = client.post(f"{API}/proposals/5/reviews", json={"event": "approve"}).json()
    assert approved["approvals"] == {"obtained": 1, "required": 2}
    as_account(monkeypatch, "marc.d")
    approved = client.post(f"{API}/proposals/5/reviews", json={"event": "approve"}).json()
    assert approved["ready_to_merge"]
    as_account(monkeypatch, "anna.k")  # l'auteure fusionne
    assert client.get(f"{API}/proposals/5").json()["viewer"]["can_merge"]
    merged = client.post(f"{API}/proposals/5/merge")
    assert merged.status_code == 200, merged.text
    assert merged.json()["tag"] == "doc/revenu-net--nordis-de/v4"
    assert 5 not in [i["id"] for i in client.get(f"{API}/proposals/queue").json()["items"]]
    merged_items = client.get(f"{API}/proposals/queue?status=merged").json()["items"]
    assert [i["id"] for i in merged_items] == [5]
    sheet = client.get(f"{API}/documents/revenu-net--nordis-de/sheet").json()
    assert (sheet["version"], sheet["version_count"]) == (4, 1)
    # Après la fusion, le diff se relit sur le commit fusionné.
    assert client.get(f"{API}/proposals/5/graphs").json()["base"]["label"] == "Canonique v4"
