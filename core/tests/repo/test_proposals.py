"""Propositions de bout en bout sur `LocalHost` : un dépôt nu, sans réseau (plan 0006).

L'identité change avec `ATLAS_ACCOUNT` : chaque requête la relit, comme si plusieurs
membres partageaient le même dépôt distant.
"""

import pytest
from fastapi.testclient import TestClient
from workspace_helpers import EXAMPLE, REVENU_NET, atlas_env, commit_all, git, remote

from skifer_atlas.api.app import create_app
from skifer_atlas.governance.rules import CANONICAL_MENTION, NO_REVIEW_MENTION

__all__ = ["atlas_env", "remote"]  # fixtures importées

AUTH = {"Authorization": "Bearer secret"}
WS = "/api/workspaces/groupe-nordis"
PROPOSALS = f"{WS}/proposals"
NORDIS_FR = "variants/revenu-net/nordis-fr.yaml"


@pytest.fixture
def client(atlas_env):
    return TestClient(create_app(token="secret"), headers=AUTH)


@pytest.fixture
def joined(client, remote, monkeypatch):
    monkeypatch.setenv("ATLAS_ACCOUNT", "julien.h")
    response = client.post("/api/workspaces/join", json={"remote_url": str(remote[0])})
    assert response.status_code == 201, response.text
    return remote


@pytest.fixture
def as_(monkeypatch):
    def switch(account):
        monkeypatch.setenv("ATLAS_ACCOUNT", account)
    return switch


def edited(path, old, new):
    text = (EXAMPLE / path).read_text(encoding="utf-8")
    assert old in text
    return text.replace(old, new, 1)


def revenu_net(description="Chiffre d'affaires facturé hors taxes"):
    return edited(REVENU_NET, "Chiffre d'affaires facturé, taxes déduites", description)


def propose(client, text, base_version, justification="Précision de la définition."):
    return client.post(PROPOSALS, json={"document_yaml": text, "justification": justification,
                                        "base_version": base_version})


def code(response):
    return response.status_code, response.json()["detail"]["code"]


def branches(bare):
    return git(bare, "branch", "--list", "prop/*").split()


def test_full_cycle(client, joined, as_):
    """Critères 2, 4 et 7 : créer, commenter, approuver deux fois, fusionner."""
    bare, _ = joined
    as_("claire.m")
    created = propose(client, revenu_net(), 4)
    assert created.status_code == 201, created.text
    proposal = created.json()
    assert {k: proposal[k] for k in ("id", "document_id", "nature", "domain", "author",
                                     "base_version", "version", "branch")} == {
        "id": 1, "document_id": "revenu-net", "nature": "new_version", "domain": "finance",
        "author": "claire.m", "base_version": 4, "version": 5,
        "branch": "prop/revenu-net-canonical-1"}
    assert (proposal["approvals"], proposal["ready_to_merge"]) == (
        {"obtained": 0, "required": 2}, False)

    as_("anna.k")
    assert client.post(f"{PROPOSALS}/1/comments", json={"body": "Et les avoirs ?"}) \
        .status_code == 201
    as_("claire.m")
    own = client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"})
    assert code(own) == (422, "cannot_review_own")
    for account in ("anna.k", "sami.b"):  # contributrice ; référent d'un autre domaine
        as_(account)
        approved = client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"}).json()
        assert approved["approvals"]["obtained"] == 0
    as_("claire.m")
    assert code(client.post(f"{PROPOSALS}/1/merge")) == (409, "not_ready")
    for account, obtained in (("marc.d", 1), ("julien.h", 2)):
        as_(account)
        approved = client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"}).json()
        assert approved["approvals"]["obtained"] == obtained
    assert approved["ready_to_merge"] and approved["merge_mode"] == "reviewed"

    detail = client.get(f"{PROPOSALS}/1").json()
    assert detail["justification"] == "Précision de la définition."
    assert [c["account"] for c in detail["comments"]] == ["anna.k"]
    assert [r["account"] for r in detail["reviews"]] == ["anna.k", "sami.b", "marc.d",
                                                         "julien.h"]
    assert "version: 5" in detail["content"]
    assert detail["block"]["diff"]["relation"] == "version"

    as_("claire.m")
    merged = client.post(f"{PROPOSALS}/1/merge")
    assert merged.status_code == 200, merged.text
    assert {k: merged.json()[k] for k in ("tag", "version", "merge_mode")} == {
        "tag": "doc/revenu-net/v5", "version": 5, "merge_mode": "reviewed"}
    message = git(bare, "log", "-1", "--format=%B", "main")
    assert "Atlas-Proposal: #1\nAtlas-Review: approved by julien.h, marc.d" in message
    assert git(bare, "rev-parse", "doc/revenu-net/v5^{commit}") == git(bare, "rev-parse",
                                                                       "main")
    document = client.get(f"{WS}/documents/revenu-net").json()
    assert document["version"] == 5 and "hors taxes" in document["content"]
    versions = client.get(f"{WS}/documents/revenu-net/versions").json()
    assert [v["version"] for v in versions] == [3, 4, 5]
    assert client.get(PROPOSALS).json() == []
    assert [p["id"] for p in client.get(PROPOSALS, params={"status": "merged"}).json()] == [1]
    assert code(client.post(f"{PROPOSALS}/1/merge")) == (409, "not_open")


def test_declared_point_needs_one_validation(client, joined, as_):
    """Critère 1 : une surcharge déclarée exige une validation du domaine du KPI."""
    as_("anna.k")
    text = edited(NORDIS_FR, "TVA française à 20 %.", "TVA française, taux normal.")
    proposal = propose(client, text, 2).json()
    assert (proposal["nature"], proposal["domain"], proposal["approvals"]["required"],
            proposal["branch"]) == ("declared_point", "finance", 1,
                                    "prop/revenu-net-nordis-fr-1")
    as_("marc.d")
    assert client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"}).json()[
        "ready_to_merge"]
    merged = client.post(f"{PROPOSALS}/1/merge").json()
    assert merged["tag"] == "doc/revenu-net--nordis-fr/v3"


def test_undeclared_override_requires_canonical_validation(client, joined, as_):
    """Critère 1 : la variante allemande surcharge n02, hors des points déclarés."""
    as_("anna.k")
    text = edited("variants/revenu-net/nordis-de.yaml", "TVA allemande à 19 %.",
                  "TVA allemande, taux normal.")
    proposal = propose(client, text, 3).json()
    assert (proposal["nature"], proposal["approvals"]["required"], proposal["mention"]) == (
        "undeclared", 2, CANONICAL_MENTION)
    detail = client.get(f"{PROPOSALS}/{proposal['id']}").json()
    assert detail["block"]["diff"]["relation"] == "override"


def test_a_new_commit_resets_the_count(client, joined, as_):
    """Critère 3."""
    _, work = joined
    as_("claire.m")
    branch = propose(client, revenu_net(), 4).json()["branch"]
    for account in ("marc.d", "julien.h"):
        as_(account)
        assert client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"}).status_code \
            == 200
    git(work, "fetch", "--quiet", "origin", branch)
    git(work, "checkout", "--quiet", "-b", "suite", "FETCH_HEAD")
    path = work / REVENU_NET
    path.write_text(path.read_text(encoding="utf-8").replace("hors taxes", "HT"),
                    encoding="utf-8")
    commit_all(work, "Reprise")
    git(work, "push", "--quiet", "origin", f"HEAD:{branch}")
    detail = client.get(f"{PROPOSALS}/1").json()
    assert (detail["approvals"]["obtained"], detail["ready_to_merge"]) == (0, False)
    assert all(r["outdated"] for r in detail["reviews"])
    assert code(client.post(f"{PROPOSALS}/1/merge")) == (409, "not_ready")


def test_stale_base(client, joined, as_):
    """Critère 5 : à la création comme à la fusion."""
    bare, _ = joined
    as_("claire.m")
    assert code(propose(client, revenu_net(), 3)) == (409, "stale_base")
    assert code(propose(client, revenu_net(), None)) == (409, "stale_base")
    assert branches(bare) == []
    assert propose(client, revenu_net(), 4).status_code == 201
    as_("julien.h")
    assert propose(client, revenu_net("Revenu facturé"), 4).status_code == 201
    for account in ("marc.d", "julien.h"):
        as_(account)
        client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"})
    for account in ("marc.d", "claire.m"):
        as_(account)
        client.post(f"{PROPOSALS}/2/reviews", json={"event": "approve"})
    assert client.post(f"{PROPOSALS}/1/merge").status_code == 200
    assert code(client.post(f"{PROPOSALS}/2/merge")) == (409, "stale_base")
    assert code(propose(client, revenu_net("Autre"), 4)) == (409, "stale_base")


@pytest.mark.parametrize("text", [
    "kind: [",  # YAML illisible
    revenu_net().replace("type: source", "type: inconnu", 1),  # schéma
    revenu_net().replace("id: revenu-net", "id: ../evasion", 1),  # identifiant
])
def test_an_invalid_proposal_is_never_pushed(client, joined, as_, text):
    """Critère 6."""
    bare, _ = joined
    as_("claire.m")
    assert code(propose(client, text, 4)) == (422, "invalid_document")
    assert branches(bare) == []
    assert not (bare / "atlas").exists()


def test_rights(client, joined, as_):
    as_("visiteur")
    assert code(propose(client, revenu_net(), 4)) == (403, "forbidden")
    for account in ("anna.k", "claire.m"):  # contributrice ; référente d'un seul domaine
        as_(account)
        assert code(client.post(f"{WS}/governance", json={
            "governance": {}, "justification": "x"})) == (403, "forbidden")


def governance_of(client):
    return client.get(f"{WS}/governance").json()


def test_single_referent_merges_governance_alone(client, joined, as_):
    """Critères 11 et 12 : CODEOWNERS régénéré ; fusion sans revue, mention et trailer."""
    bare, work = joined
    as_("julien.h")
    found = governance_of(client)
    assert (found["role"], found["single_referent"]) == ("referent", True)
    assert [i["code"] for i in found["issues"]] == ["domain_without_referent"]
    changed = found["governance"]
    changed["domains"][3]["referents"] = ["claire.m"]
    first = client.post(f"{WS}/governance", json={"governance": changed,
                                                  "justification": "Marketing à Claire."})
    assert first.status_code == 201, first.text
    proposal = first.json()
    assert (proposal["nature"], proposal["ready_to_merge"], proposal["merge_mode"],
            proposal["mention"]) == ("governance", True, "no_other_eligible", NO_REVIEW_MENTION)
    second = client.post(f"{WS}/governance", json={"governance": changed,
                                                   "justification": "Doublon."}).json()
    owners = [git(bare, "show", f"{p['branch']}:.github/CODEOWNERS") for p in (proposal, second)]
    assert owners[0] == owners[1] and "@claire.m" in owners[0]

    merged = client.post(f"{PROPOSALS}/1/merge").json()
    assert (merged["merge_mode"], merged["tag"], merged["mention"]) == (
        "no_other_eligible", None, NO_REVIEW_MENTION)
    assert "Atlas-Review: none (no other eligible approver)" in git(
        bare, "log", "-1", "--format=%B", "main")
    assert governance_of(client)["issues"] == []
    assert code(client.post(f"{PROPOSALS}/2/merge")) == (409, "stale_base")

    git(work, "pull", "--quiet", "origin", "main")
    path = work / ".github" / "CODEOWNERS"
    path.write_text(path.read_text(encoding="utf-8") + "/kpis/ @intrus\n", encoding="utf-8")
    commit_all(work, "CODEOWNERS à la main")
    git(work, "push", "--quiet", "origin", "main")
    synced = client.post(f"{WS}/sync").json()
    assert [w["code"] for w in synced["warnings"]] == ["codeowners_drift"]


def test_removing_the_other_referents_does_not_unlock_the_exception(client, joined, as_):
    """Critère 12 : les habilités se comptent sur la branche principale."""
    as_("julien.h")
    governance = governance_of(client)["governance"]
    governance["members"][1]["roles"] = [{"role": "referent", "domains": []}]
    client.post(f"{WS}/governance", json={"governance": governance, "justification": "Claire."})
    assert client.post(f"{PROPOSALS}/1/merge").status_code == 200
    assert not governance_of(client)["single_referent"]

    governance["members"][1]["roles"] = [{"role": "contributeur", "domains": []}]
    proposal = client.post(f"{WS}/governance", json={"governance": governance,
                                                     "justification": "Seul maître."}).json()
    assert (proposal["ready_to_merge"], proposal["merge_mode"],
            proposal["approvals"]["required"]) == (False, "reviewed", 1)
    assert code(client.post(f"{PROPOSALS}/{proposal['id']}/merge")) == (409, "not_ready")
    as_("claire.m")
    client.post(f"{PROPOSALS}/{proposal['id']}/reviews", json={"event": "approve"})
    as_("julien.h")
    assert client.post(f"{PROPOSALS}/{proposal['id']}/merge").status_code == 200
    assert governance_of(client)["single_referent"]


def test_governance_without_referent_is_refused(client, joined, as_):
    """Critère 10."""
    as_("julien.h")
    governance = governance_of(client)["governance"]
    governance["members"][0]["roles"] = [{"role": "contributeur", "domains": []}]
    response = client.post(f"{WS}/governance", json={"governance": governance,
                                                     "justification": "Oups."})
    assert code(response) == (422, "invalid_governance")
    assert "no_referent" in [i["code"] for i in response.json()["detail"]["issues"]]
    assert branches(joined[0]) == []
