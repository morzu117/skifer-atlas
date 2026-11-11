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


def test_merge_reports_success_when_follow_up_sync_fails(client, joined, as_, monkeypatch):
    from skifer_atlas.proposals import merge as proposals_merge
    from skifer_atlas.repo.git import RepoError

    bare, _ = joined
    as_("claire.m")
    assert propose(client, revenu_net(), 4).status_code == 201
    for account in ("marc.d", "julien.h"):
        as_(account)
        assert client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"}).status_code == 200

    original_sync = proposals_merge.sync_workspace

    def fail_after_merge(workspace_id):
        raise RepoError("fetch_failed", "Échec simulé")
    monkeypatch.setattr(proposals_merge, "sync_workspace", fail_after_merge)
    response = client.post(f"{PROPOSALS}/1/merge")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["tag"] == "doc/revenu-net/v5"
    assert [warning["code"] for warning in result["warnings"]] == ["post_merge_sync_failed"]
    assert git(bare, "rev-parse", "main").strip() == result["commit"]
    monkeypatch.setattr(proposals_merge, "sync_workspace", original_sync)
    synced = client.post(f"{WS}/sync")
    assert synced.status_code == 200, synced.text
    assert git(bare, "rev-parse", "doc/revenu-net/v5^{commit}").strip() == result["commit"]


def test_sync_retries_tag_after_its_creation_failed_following_fast_forward(
        client, joined, as_, monkeypatch):
    from skifer_atlas.repo import sync as repo_sync
    from skifer_atlas.repo.git import RepoError

    bare, _ = joined
    as_("claire.m")
    assert propose(client, revenu_net(), 4).status_code == 201
    for account in ("marc.d", "julien.h"):
        as_(account)
        assert client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"}).status_code == 200

    original_run_git = repo_sync.run_git
    failed = False

    def fail_once(args, *rest, **options):
        nonlocal failed
        if args[:2] == ["tag", "doc/revenu-net/v5"] and not failed:
            failed = True
            raise RepoError("tag_failed", "Échec simulé après l'avance rapide")
        return original_run_git(args, *rest, **options)

    monkeypatch.setattr(repo_sync, "run_git", fail_once)
    response = client.post(f"{PROPOSALS}/1/merge")
    assert response.status_code == 200, response.text
    merged = response.json()
    assert [warning["code"] for warning in merged["warnings"]] == ["post_merge_sync_failed"]
    assert git(bare, "rev-parse", "main").strip() == merged["commit"]
    assert git(bare, "tag", "--list", "doc/revenu-net/v5").strip() == ""

    synced = client.post(f"{WS}/sync")
    assert synced.status_code == 200, synced.text
    assert git(bare, "rev-parse", "doc/revenu-net/v5^{commit}").strip() == merged["commit"]


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


def test_moving_a_kpi_keeps_its_original_domain_reviewers(client, joined, as_):
    as_("julien.h")  # seul habilité dans Marketing, mais pas dans Finance
    changed = revenu_net().replace("domain: finance", "domain: marketing", 1)
    proposal = propose(client, changed, 4)
    assert proposal.status_code == 201, proposal.text
    assert proposal.json()["domain"] == "marketing"
    assert proposal.json()["merge_mode"] == "reviewed"
    assert not proposal.json()["ready_to_merge"]
    assert code(client.post(f"{PROPOSALS}/1/merge")) == (409, "not_ready")
    as_("marc.d")  # validateur du domaine initial Finance
    review = client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"})
    assert review.status_code == 200, review.text
    assert review.json()["approvals"]["obtained"] == 1


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


def test_access_point_is_declared_by_proposal(client, joined, as_, monkeypatch):
    """Plan 0008, critère 7 : plateforme hors `allowed_platforms` refusée à la déclaration ;
    le registre `access_points.yaml` passe par une proposition, sans aucun secret."""
    bare, _ = joined
    monkeypatch.setenv("ATLAS_VAULT", "memory")
    connections = f"{WS}/connections"
    point = {"id": "dbx-fr", "platform": "databricks",
             "host": "https://adb-1.2.azuredatabricks.net", "warehouse_id": "abc123",
             "schema": "gold.finance", "entity": "nordis-fr", "owner": "claire.m"}
    as_("claire.m")
    refused = client.post(connections, json={"access_point": {**point, "platform": "bigquery"},
                                             "justification": "BigQuery."})
    assert code(refused) == (422, "invalid_access_point")
    assert [i["code"] for i in refused.json()["detail"]["issues"]] == ["platform_not_allowed"]
    as_("inconnu.z")
    assert code(client.post(connections, json={"access_point": point,
                                               "justification": "x"})) == (403, "forbidden")

    as_("julien.h")
    created = client.post(connections, json={"access_point": point,
                                             "justification": "Entrepôt France."})
    assert created.status_code == 201, created.text
    proposal = created.json()
    assert (proposal["nature"], proposal["ready_to_merge"], proposal["merge_mode"],
            proposal["branch"]) == ("access_points", True, "no_other_eligible",
                                    "prop/access-point-dbx-fr-1")
    assert client.get(connections).json() == []
    merged = client.post(f"{PROPOSALS}/{proposal['id']}/merge").json()
    assert merged["tag"] is None
    stored = git(bare, "show", "main:access_points.yaml")
    assert "dbx-fr" in stored and "token" not in stored
    [listed] = client.get(connections).json()
    assert (listed["access_point"], listed["allowed"], listed["my_access"]) == (
        "dbx-fr", True, "never")


def test_awaiting_my_review(client, joined, as_):
    """La file personnelle alimente le compteur de l'accueil sans bloquer la liste."""
    as_("claire.m")
    assert propose(client, revenu_net(), 4).status_code == 201
    assert client.get(PROPOSALS, params={"for_me": 1}).json() == []  # l'autrice
    # L'accueil demande la file séparément ; la liste des espaces reste locale.
    assert client.get("/api/workspaces").json()[0]["counts"] == {
        "kpi": 4, "concept": 3, "open_proposals": None}
    as_("marc.d")
    [waiting] = client.get(PROPOSALS, params={"for_me": 1}).json()
    assert waiting["id"] == 1 and waiting["awaiting_me"] is True
    assert client.get("/api/workspaces").json()[0]["counts"]["open_proposals"] is None
    as_("anna.k")  # contributrice : son avis ne compte pas
    assert client.get(PROPOSALS, params={"for_me": 1}).json() == []
    as_("marc.d")
    client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"})
    assert client.get(PROPOSALS, params={"for_me": 1}).json() == []
    assert client.get(PROPOSALS).json()[0]["awaiting_me"] is False


def test_counts_of_a_local_workspace(client):
    created = client.post("/api/workspaces", json={"id": "acme", "name": "Acme"})
    assert created.status_code == 201 and "counts" not in created.json()
    assert client.get("/api/workspaces").json()[0]["counts"] == {
        "kpi": 0, "concept": 0, "open_proposals": 0}


def test_atlas_merge_between_auto_and_manual_sync(client, joined, as_):
    bare, work = joined
    git(work, "commit", "--allow-empty", "-m", "Avance distante")
    git(work, "push", "origin", "main")
    assert client.post(f"{WS}/sync/auto").json()["status"] == "fast_forward"
    as_("claire.m")
    assert propose(client, revenu_net(), 4).status_code == 201
    for account in ("marc.d", "julien.h"):
        as_(account)
        assert client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"}).status_code == 200
    as_("claire.m")
    merged = client.post(f"{PROPOSALS}/1/merge")
    assert merged.status_code == 200, merged.text
    assert git(bare, "rev-parse", "doc/revenu-net/v5^{commit}").strip()
    result = client.post(f"{WS}/sync").json()
    assert not any(w["code"] == "versions_tagged" for w in result["warnings"])


def test_revision_and_close(client, joined, as_):
    as_("claire.m")
    assert propose(client, revenu_net(), 4).status_code == 201
    as_("marc.d")
    assert client.post(f"{PROPOSALS}/1/reviews", json={"event": "request_changes", "body": "À revoir"}).status_code == 200
    assert code(client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net()})) == (403, "forbidden")
    assert code(client.post(f"{PROPOSALS}/1/close", json={})) == (403, "forbidden")
    as_("julien.h")
    assert client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"}).status_code == 200
    as_("claire.m")
    before = client.get(f"{PROPOSALS}/1").json()["head"]
    invalid = client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net().replace("nulls: drop", "nulls: invalid", 1)})
    assert code(invalid) == (422, "invalid_document")
    assert invalid.json()["detail"]["issues"]
    assert client.get(f"{PROPOSALS}/1").json()["head"] == before
    result = client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net("Définition révisée"), "note": "Correction"})
    assert result.status_code == 201, result.text
    detail = client.get(f"{PROPOSALS}/1").json()
    assert all(review["outdated"] for review in detail["reviews"])
    assert detail["approvals"]["obtained"] == 0
    assert detail["changes_requested_by"] == ["marc.d"]
    assert code(client.post(f"{PROPOSALS}/1/merge")) == (409, "not_ready")
    assert len(detail["revisions"]) == 2
    as_("marc.d")
    assert client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"}).status_code == 200
    as_("julien.h")
    assert client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"}).status_code == 200
    assert client.post(f"{PROPOSALS}/1/merge").status_code == 200
    assert code(client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net()})) == (409, "not_open")
    assert code(client.post(f"{PROPOSALS}/1/close", json={})) == (409, "not_open")


def test_close_by_referent(client, joined, as_):
    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    as_("julien.h")
    result = client.post(f"{PROPOSALS}/1/close", json={"reason": "À reprendre"})
    assert result.status_code == 200, result.text
    assert result.json()["state"] == "closed"
    assert "À reprendre" in client.get(f"{PROPOSALS}/1").json()["comments"][-1]["body"]
    assert branches(joined[0])


def test_github_close_and_update_body(monkeypatch):
    from skifer_atlas.githost.github import GitHubHost

    host = GitHubHost("owner", "repo", "token")
    calls = []

    def request(method, path, payload=None):
        calls.append((method, path, payload))
        if path.endswith("/comments"):
            return {"user": {"login": "anna"}, "body": payload["body"], "created_at": "now"}
        return {}
    monkeypatch.setattr(host, "_request", request)
    host.update_body(7, "bloc mis à jour")
    host.close(7, "doublon")
    assert calls == [
        ("PATCH", "/repos/owner/repo/pulls/7", {"body": "bloc mis à jour"}),
        ("POST", "/repos/owner/repo/issues/7/comments", {"body": "Proposition retirée : doublon"}),
        ("PATCH", "/repos/owner/repo/pulls/7", {"state": "closed"}),
    ]


def test_revision_head_changed(client, joined, as_, monkeypatch):
    import importlib

    from skifer_atlas.repo.git import RepoError

    revision = importlib.import_module("skifer_atlas.proposals.revise")
    run = revision.run_git

    def concurrent(args, *pos, **kwargs):
        if args[0] == "push":
            raise RepoError("push_failed", "rejet")
        if args[0] == "ls-remote":
            return "a" * 40 + "\trefs/heads/prop/revenu-net-canonical-1\n"
        return run(args, *pos, **kwargs)

    as_("claire.m")
    assert propose(client, revenu_net(), 4).status_code == 201
    before = client.get(f"{PROPOSALS}/1").json()["head"]
    monkeypatch.setattr(revision, "run_git", concurrent)
    result = client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net("Révision")})
    assert code(result) == (409, "head_changed")
    assert client.get(f"{PROPOSALS}/1").json()["head"] == before


@pytest.mark.parametrize("account", ["anna.k", "claire.m", "julien.h"])
def test_close_author_or_referent(client, joined, as_, account):
    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    as_(account)
    result = client.post(f"{PROPOSALS}/1/close", json={"reason": "Doublon"})
    assert result.status_code == 200, result.text
    assert "Doublon" in client.get(f"{PROPOSALS}/1").json()["comments"][-1]["body"]


def test_revision_draft_is_isolated(client, joined, as_):
    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    endpoint = f"{WS}/editor/proposals/1"
    opened = client.get(endpoint)
    assert opened.status_code == 200, opened.text
    assert "hors taxes" in str(opened.json()["document"])
    draft = {"document": opened.json()["document"], "positions": {}, "highest": 1,
             "base_version": 4}
    assert client.put(f"{endpoint}/draft", json=draft).status_code == 200
    assert client.get(endpoint).json()["draft"] is not None
    assert client.get(f"{WS}/editor/documents/revenu-net").json()["draft"] is None
    as_("claire.m")
    assert code(client.get(endpoint)) == (403, "forbidden")


def test_revision_diff_is_cached(client, joined, as_, monkeypatch):
    from skifer_atlas.proposals import status

    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    assert client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net("Révisé")}).status_code == 201
    status._revision_difference.cache_clear()
    first = client.get(f"{PROPOSALS}/1")
    assert first.status_code == 200, first.text
    before = status._revision_difference.cache_info()
    second = client.get(f"{PROPOSALS}/1")
    after = status._revision_difference.cache_info()
    assert second.status_code == 200
    assert after.misses == before.misses and after.hits > before.hits


@pytest.mark.parametrize("closer", ["anna.k", "claire.m", "julien.h"])
def test_revision_on_github_host_double(client, joined, as_, monkeypatch, closer):
    from skifer_atlas.githost.github import GitHubHost
    from skifer_atlas.githost.local import LocalHost
    from skifer_atlas.proposals import common

    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    local = LocalHost(joined[0])
    calls = []

    def request(host, method, path, payload=None):
        calls.append((method, path, payload))
        if path == "/user":
            return {"login": local.current_account()}
        if "/reviews?" in path:
            return []
        if "/comments?" in path:
            return [{"user": {"login": c.account}, "body": c.body, "created_at": c.created_at}
                    for c in local.list_comments(1)]
        if "/comments" in path and method == "POST":
            c = local.add_comment(1, payload["body"])
            return {"user": {"login": c.account}, "body": c.body, "created_at": c.created_at}
        if method == "PATCH" and path.endswith("/pulls/1"):
            if payload.get("state") == "closed":
                local.close(1, "")
            return {}
        if path.endswith("/pulls/1"):
            p = local.get_pull_request(1)
            return {"number": 1, "head": {"ref": p.branch, "sha": p.head},
                    "title": p.title, "body": p.body, "state": p.state,
                    "user": {"login": p.author}, "created_at": p.created_at}
        raise AssertionError((method, path))

    monkeypatch.setattr(GitHubHost, "_request", request)
    monkeypatch.setattr(common, "host_for", lambda *args: GitHubHost("o", "r", "token"))
    for account in ("claire.m", "julien.h", "sofia.r"):
        as_(account)
        assert code(client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net()})) == (403, "forbidden")
    as_("sofia.r")
    assert code(client.post(f"{PROPOSALS}/1/close", json={})) == (403, "forbidden")
    as_("anna.k")
    head = local.get_pull_request(1).head
    assert code(client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": "kind: absent"})) == (422, "invalid_document")
    assert local.get_pull_request(1).head == head
    import importlib

    from skifer_atlas.repo.git import RepoError

    revision_module = importlib.import_module("skifer_atlas.proposals.revise")
    original_run = revision_module.run_git

    def concurrent(args, *pos, **kwargs):
        if args[0] == "push":
            raise RepoError("push_failed", "rejet")
        if args[0] == "ls-remote":
            return "a" * 40 + "\trefs/heads/branch\n"
        return original_run(args, *pos, **kwargs)

    with monkeypatch.context() as isolated:
        isolated.setattr(revision_module, "run_git", concurrent)
        assert code(client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net()})) == (409, "head_changed")
    response = client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net("GitHub révisé"), "note": "Correction"})
    assert response.status_code == 201, response.text
    detail = client.get(f"{PROPOSALS}/1").json()
    assert len(detail["revisions"]) == 2 and "GitHub révisé" in detail["content"]
    as_(closer)
    closed = client.post(f"{PROPOSALS}/1/close", json={"reason": "Doublon"})
    assert closed.status_code == 200, closed.text
    assert code(client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net()})) == (409, "not_open")
    assert "Doublon" in client.get(f"{PROPOSALS}/1").json()["comments"][0]["body"]
    assert any(method == "PATCH" and payload == {"state": "closed"} for method, _, payload in calls)
    assert any(method == "POST" and "Doublon" in payload["body"] for method, _, payload in calls)


def test_revision_recomputes_block_without_updating_pr_body(client, joined, as_, monkeypatch):
    from skifer_atlas.githost.local import LocalHost

    def fail_update(*args):
        raise AssertionError("La révision ne doit pas modifier le corps de la PR")

    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    original = client.get(f"{PROPOSALS}/1").json()["block"]["diff"]
    monkeypatch.setattr(LocalHost, "update_body", fail_update)
    revised = edited(REVENU_NET, "Factures validées", "Factures contrôlées")
    result = client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revised})
    assert result.status_code == 201, result.text
    detail = client.get(f"{PROPOSALS}/1").json()
    assert detail["block"]["diff"] != original
    assert "Factures contrôlées" in detail["content"]


@pytest.mark.parametrize("account", ["claire.m", "julien.h", "sofia.r"])
def test_only_author_may_revise(client, joined, as_, account):
    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    as_(account)
    assert code(client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net()})) == (403, "forbidden")


def test_revision_attribution_and_manual_commit_author(client, joined, as_, monkeypatch):
    bare, work = joined
    as_("julien.h")
    monkeypatch.setenv("GIT_AUTHOR_NAME", "Nom Git du poste")
    monkeypatch.setenv("GIT_COMMITTER_NAME", "Nom Git du poste")
    monkeypatch.setenv("GIT_AUTHOR_DATE", "2026-11-11T14:05:00+01:00")
    monkeypatch.setenv("GIT_COMMITTER_DATE", "2026-11-11T14:05:00+01:00")
    assert propose(client, revenu_net(), 4).status_code == 201
    result = client.post(f"{PROPOSALS}/1/revisions", json={
        "document_yaml": revenu_net("Révision Atlas"), "note": "Note visible"})
    assert result.status_code == 201, result.text
    from skifer_atlas.workspaces import repo_dir

    # Une mailmap du poste ne doit pas substituer un autre nom au compte enregistré.
    email = git(bare, "show", "-s", "--format=%ae", result.json()["head"]).strip()
    mailmap = bare.parent / "mailmap"
    mailmap.write_text(f"Nom remappé <{email}>\n", encoding="utf-8")
    git(repo_dir("groupe-nordis"), "config", "mailmap.file", str(mailmap))
    details = client.get(f"{PROPOSALS}/1").json()
    assert details["revisions"][0]["author"] == "julien.h"
    assert details["revisions"][1]["author"] == "julien.h"
    assert git(bare, "show", "-s", "--format=%an/%cn", details["revisions"][1]["commit"]).strip() == "julien.h/julien.h"
    assert details["revisions"][1]["date"] == "2026-11-11T13:05:00Z"
    assert details["revisions"][1]["note"] == "Note visible"
    branch = result.json()["branch"]
    git(work, "fetch", "origin", branch)
    git(work, "checkout", "-b", "revision-manuelle", "FETCH_HEAD")
    path = work / REVENU_NET
    path.write_text(path.read_text(encoding="utf-8").replace("Révision Atlas", "Révision manuelle"), encoding="utf-8")
    commit_all(work, "Révision de la proposition\n\nAtlas-Account: usurpe")
    git(work, "push", "origin", f"HEAD:{branch}")
    assert client.get(f"{PROPOSALS}/1").json()["revisions"][-1]["author"] == "Nom Git du poste"


def test_detail_dates_utc_and_latest_blocking_review(client, joined, as_):
    import json

    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    as_("claire.m")
    assert client.post(f"{PROPOSALS}/1/reviews", json={"event": "request_changes", "body": "À revoir"}).status_code == 200
    as_("anna.k")
    assert client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net("Révisé")}).status_code == 201
    as_("claire.m")
    before = client.get(f"{PROPOSALS}/1").json()
    assert before["reviews"][0]["blocking"] is True
    assert client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"}).status_code == 200
    assert client.post(f"{PROPOSALS}/1/comments", json={"body": "Merci"}).status_code == 201
    path = joined[0] / "atlas" / "proposals" / "1.json"
    state = json.loads(path.read_text(encoding="utf-8"))
    state["reviews"][0]["submitted_at"] = "2026-11-11T14:00:00+01:00"
    state["comments"][0]["created_at"] = "2026-11-11T14:10:00+01:00"
    path.write_text(json.dumps(state), encoding="utf-8")
    after = client.get(f"{PROPOSALS}/1").json()
    assert after["reviews"][0]["blocking"] is False
    assert after["reviews"][0]["submitted_at"] == "2026-11-11T13:00:00Z"
    assert after["comments"][0]["created_at"] == "2026-11-11T13:10:00Z"
