"""Contrats du contexte et de la lecture des propositions."""

from types import SimpleNamespace
from unittest.mock import Mock, call

import pytest
from test_proposals import PROPOSALS, VALID_BLOCK, as_, client, joined, propose, revenu_net
from workspace_helpers import atlas_env, commit_all, git, remote

from skifer_atlas.proposals import common, create, current, status
from skifer_atlas.repo.git import RepoError

__all__ = ["as_", "atlas_env", "client", "joined", "remote"]


@pytest.fixture(autouse=True)
def memory_vault(monkeypatch):
    monkeypatch.setenv("ATLAS_VAULT", "memory")


def test_open_context_options_and_credentials(client, joined, as_, monkeypatch):
    from skifer_atlas.workspaces import repo_dir

    as_("claire.m")
    host_for = Mock(wraps=common.host_for)
    token = Mock(return_value="secret-test")
    run = Mock(wraps=common.run_git)
    sync = Mock(wraps=common.sync_workspace)
    monkeypatch.setattr(common, "host_for", host_for)
    monkeypatch.setattr(common, "remote_token", token)
    monkeypatch.setattr(common, "run_git", run)
    monkeypatch.setattr(common, "sync_workspace", sync)
    repo = repo_dir("groupe-nordis")
    context = common.open_context("groupe-nordis")
    assert (context.repo, context.main_branch, context.token, context.account, context.base) == (
        repo, "main", "secret-test", "claire.m", git(joined[0], "rev-parse", "main").strip())
    host_for.assert_called_once_with(str(joined[0]), "main", "groupe-nordis")
    token.assert_called_once_with(str(joined[0]), "groupe-nordis")
    assert run.call_args_list == [
        call(["fetch", "--quiet", "--prune", "origin"], repo, error_code="fetch_failed", token="secret-test"),
        call(["rev-parse", "--verify", "refs/remotes/origin/main"], repo),
        call(["show", f"{context.base}:governance.yaml"], repo),
    ]
    run.reset_mock()
    common.open_context("groupe-nordis", fetch=False)
    assert [c.args[0][0] for c in run.call_args_list] == ["rev-parse", "show"]
    run.reset_mock()
    common.open_context("groupe-nordis", sync=True, fetch=True)
    sync.assert_called_once_with("groupe-nordis")
    assert [c.args[0][0] for c in run.call_args_list] == ["rev-parse", "show"]


def test_open_context_unknown(atlas_env):
    with pytest.raises(RepoError) as caught:
        common.open_context("absent")
    assert (caught.value.code, caught.value.message, caught.value.details) == (
        "not_found", "Espace « absent » inconnu.", None)


@pytest.mark.parametrize("text", [None, "members: ["])
def test_open_context_invalid_governance(client, joined, monkeypatch, text):
    run = common.run_git

    def show(args, *a, **kw):
        if args[0] == "show":
            if text is None:
                raise RepoError("missing", "absent")
            return text
        return run(args, *a, **kw)

    monkeypatch.setattr(common, "run_git", show)
    expected = common.parse_governance(text or "")[1]
    with pytest.raises(RepoError) as caught:
        common.open_context("groupe-nordis", fetch=False)
    assert (caught.value.code, caught.value.message, caught.value.details) == (
        "invalid_governance", "La gouvernance de la branche principale est absente ou invalide.",
        [issue.to_dict() for issue in expected])


@pytest.mark.parametrize(("text", "expected"), [
    (None, None), ("[]", None), ("data_product: []", None),
    ("data_product: {domain: 42}", None), ("data_product: {domain: finance}", "finance"),
])
def test_review_domain_existing_concept(text, expected):
    context = SimpleNamespace(show=Mock(return_value=text))
    target = {"kind": "concept", "path": "concepts/a.yaml"}
    assert common.review_domain(context, target, 1, "autre") == expected
    context.show.assert_called_once_with("concepts/a.yaml")


def test_mapping_and_require(client, joined, as_):
    assert create._mapping(None) == {}
    assert create._mapping({"a": 1}) == {"a": 1}
    as_("anna.k")
    context = common.open_context("groupe-nordis", fetch=False)
    with pytest.raises(RepoError) as caught:
        context.require("referent")
    assert (caught.value.code, caught.value.message) == (
        "forbidden", "Rôle « referent » requis ; « anna.k » est contributeur dans cet espace.")


def test_commit_files_preserves_tree_and_identity(joined, monkeypatch):
    _, work = joined
    monkeypatch.chdir(work.parent)
    parent = git(work, "rev-parse", "HEAD").strip()
    commit = common.commit_files(work, parent, {"z.txt": "été\n", "a.txt": "alpha\n"},
                                 "Révision\n\nNote", "claire.m")
    assert git(work, "rev-parse", "HEAD").strip() == parent
    assert git(work, "show", "-s", "--format=%an%n%cn%n%B", commit).strip() == (
        "claire.m\nclaire.m\nRévision\n\nNote")
    assert git(work, "diff-tree", "--no-commit-id", "--name-only", "-r", commit).splitlines() == [
        "a.txt", "z.txt"]
    assert git(work, "show", f"{commit}:z.txt") == "été\n"
    assert git(work, "show", f"{commit}:a.txt") == "alpha\n"
    assert git(work, "rev-parse", f"{commit}^1").strip() == parent


def test_current_block_revised_and_base_moves(client, joined, as_):
    bare, work = joined
    as_("claire.m")
    assert propose(client, revenu_net(), 4).status_code == 201
    revised = client.post(f"{PROPOSALS}/1/revisions", json={
        "document_yaml": revenu_net("Définition révisée"), "note": "Correction"})
    assert revised.status_code == 201, revised.text
    before = client.get(f"{PROPOSALS}/1").json()["block"]
    path = work / "kpis/revenu-net.yaml"
    path.write_text(path.read_text(encoding="utf-8").replace(
        "expr: montant_ttc - montant_taxes - avoirs", "expr: montant_ttc - montant_taxes", 1),
        encoding="utf-8")
    commit_all(work, "Base modifiée")
    git(work, "push", "origin", "main")
    context = common.open_context("groupe-nordis")
    pull = context.host.get_pull_request(1)
    _, original = common.parse_body(pull.body)
    assert current.current_block(context, pull.head, original) == before
    analysis = current._analyzed(context.repo, pull.head)
    main_diff = create._diff(context, original["target"], analysis, analysis.entry("revenu-net"))
    assert (main_diff["identical"], [(d["node"], d["classification"])
                                     for d in main_diff["differences"]]) == (False, [("n03", "to_verify")])
    creation = {**original, "base_version": None}
    assert current.current_block(context, pull.head, creation) == {
        **before, "base_version": None, "diff": None}
    assert git(bare, "rev-parse", "prop/revenu-net-canonical-1").strip() == pull.head
    assert git(bare, "log", "-1", "--format=%an%n%B", pull.head).strip() == (
        "claire.m\nRévision de la proposition\n\nCorrection")


def test_current_block_invalid_entries(monkeypatch):
    issue = SimpleNamespace(severity="error", to_dict=lambda: {"severity": "error"})
    context = SimpleNamespace(repo="repo")
    target = {"kind": "kpi", "id": "a"}
    for entry, details in [(None, []), (SimpleNamespace(document=None, issues=[issue]),
                                        [{"severity": "error"}]),
                           (SimpleNamespace(document=object(), issues=[issue]),
                            [{"severity": "error"}])]:
        monkeypatch.setattr(current, "_analyzed", lambda repo, head, value=entry: SimpleNamespace(entry=lambda _: value))
        with pytest.raises(RepoError) as caught:
            current.current_block(context, "head", {"target": target})
        assert (caught.value.code, caught.value.message, caught.value.details) == (
            "invalid_document", "Le document proposé est invalide.", details)


def test_awaiting_uses_nature_and_domain(monkeypatch):
    context = SimpleNamespace(account="alice", governance=object())
    pull = SimpleNamespace(author="bob")
    decision = SimpleNamespace(approvers=[], changes_requested_by=[])
    block = {"target": {"kind": "variant"}, "nature": "new_variant", "domain": "finance"}
    requirement = Mock(return_value=SimpleNamespace(eligible={"alice"}))
    monkeypatch.setattr(status, "requirement", requirement)
    assert status._awaiting(context, pull, block, decision) is True
    requirement.assert_called_once_with(context.governance, "new_variant", "finance")


def test_current_block_real_other_natures(client, joined, as_, monkeypatch):
    from workspace_helpers import EXAMPLE

    as_("julien.h")
    variant = (EXAMPLE / "variants/revenu-net/nordis-fr.yaml").read_text(encoding="utf-8")
    response = propose(client, variant, 2)
    assert response.status_code == 201, response.text
    governance = client.get("/api/workspaces/groupe-nordis/governance").json()["governance"]
    governance["domains"][3]["referents"] = ["claire.m"]
    response = client.post("/api/workspaces/groupe-nordis/governance", json={
        "governance": governance, "justification": "Gouvernance"})
    assert response.status_code == 201, response.text
    point = {"id": "dbx-fr", "platform": "databricks",
             "host": "https://adb-1.2.azuredatabricks.net", "warehouse_id": "abc123",
             "schema": "gold.finance", "entity": "nordis-fr", "owner": "claire.m"}
    response = client.post("/api/workspaces/groupe-nordis/connections", json={
        "access_point": point, "justification": "Entrepôt"})
    assert response.status_code == 201, response.text
    context = common.open_context("groupe-nordis")
    review_domain = Mock(wraps=current.review_domain)
    monkeypatch.setattr(current, "review_domain", review_domain)
    for number, kind, branch in [(1, "variant", "prop/revenu-net-nordis-fr-1"),
                                  (2, "governance", "prop/governance-1"),
                                  (3, "access_points", "prop/access-point-dbx-fr-1")]:
        pull = context.host.get_pull_request(number)
        _, block = common.parse_body(pull.body)
        assert block["target"]["kind"] == kind
        assert pull.branch == branch
        stale = {**block, "nature": "périmée", "domain": "périmé"} if kind == "variant" else block
        assert current.current_block(context, pull.head, stale) == block
        if kind == "variant":
            review_domain.assert_called_once_with(context, block["target"], 2, "finance")


def test_describe_review_order_and_mention(monkeypatch):
    from skifer_atlas.githost.base import PullRequest

    block = {"target": {"id": "g", "kind": "governance", "path": "governance.yaml"},
             "nature": "governance", "version": None, "mention": "Mention spéciale"}
    pull = PullRequest(number=1, title="Gouvernance", branch="prop/g-1", author="alice",
                       state="open", created_at="2026-01-01T00:00:00Z", head="abc",
                       merged_commit=None, body=common.render_body("Motif", block))
    reviews = [SimpleNamespace(account="bob", state="changes_requested", commit="abc",
                               submitted_at="2026-01-01T00:00:00Z", body="Corriger"),
               SimpleNamespace(account="bob", state="commented", commit="abc",
                               submitted_at="2026-01-02T00:00:00Z", body="Précision"),
               SimpleNamespace(account="carol", state="approved", commit="abc",
                               submitted_at="2026-01-03T00:00:00Z", body="Validé")]
    decision = SimpleNamespace(merge_mode="reviewed", approvers=[], changes_requested_by=["bob"],
                               to_dict=lambda: {"merge_mode": "reviewed", "mention": None,
                                                "changes_requested_by": ["bob"]})
    context = SimpleNamespace(host=SimpleNamespace(get_reviews=lambda _: reviews,
                                                   list_comments=lambda _: []),
                              governance=None, account="alice", show=lambda *args: "contenu")
    monkeypatch.setattr(status, "decide", lambda *args: decision)
    monkeypatch.setattr(status, "_awaiting", lambda *args: False)
    monkeypatch.setattr(status, "_revisions", lambda *args: [])
    result = status.describe(context, pull, detail=True)
    assert result == {
        "id": 1, "title": "Gouvernance", "branch": "prop/g-1", "author": "alice",
        "state": "open", "created_at": "2026-01-01T00:00:00Z", "head": "abc",
        "merged_commit": None, "atlas": True, "document_id": "g", "document_kind": "governance",
        "document_label": "Gouvernance de l'espace", "kpi_id": None, "entity": None,
        "nature": "governance", "domain": None, "base_version": None, "version": None,
        "merge_mode": "reviewed", "mention": "Mention spéciale", "changes_requested_by": ["bob"],
        "awaiting_me": False, "justification": "Motif", "block": block,
        "reviews": [{"account": "bob", "state": "changes_requested", "commit": "abc",
                     "submitted_at": "2026-01-01T00:00:00Z", "body": "Corriger",
                     "outdated": False, "blocking": True},
                    {"account": "bob", "state": "commented", "commit": "abc",
                     "submitted_at": "2026-01-02T00:00:00Z", "body": "Précision",
                     "outdated": False, "blocking": False},
                    {"account": "carol", "state": "approved", "commit": "abc",
                     "submitted_at": "2026-01-03T00:00:00Z", "body": "Validé",
                     "outdated": False, "blocking": False}],
        "comments": [], "revisions": [], "content": "contenu"}


def test_current_block_recalculates_domain_and_warnings(monkeypatch):
    issue = SimpleNamespace(severity="warning", to_dict=lambda: {"message": "Attention"})
    entry = SimpleNamespace(document=object(), issues=[issue])
    analysis = SimpleNamespace(entry=lambda _: entry)
    context = SimpleNamespace(repo="repo", governance="gouvernance", show=lambda _: "data_product: {domain: ancien}")
    target = {"kind": "kpi", "id": "a", "path": "kpis/a.yaml"}
    block = {"target": target, "base_version": 1, "nature": "ancienne", "domain": "ancien",
             "mention": "ancienne", "diff": None, "warnings": []}
    monkeypatch.setattr(current, "_analyzed", lambda *args: analysis)
    monkeypatch.setattr(current, "_nature", lambda *args: "new_version")
    monkeypatch.setattr(current, "_domain", lambda *args: "nouveau")
    need = Mock(return_value=SimpleNamespace(mention="mention"))
    monkeypatch.setattr(current, "requirement", need)
    monkeypatch.setattr(current, "run_git", Mock(side_effect=RepoError("missing", "absent")))
    monkeypatch.setattr(current, "_diff", lambda *args: {"résultat": 1})
    assert current.current_block(context, "head", block) == {
        "target": target, "base_version": 1, "nature": "new_version", "domain": "nouveau",
        "mention": "mention", "diff": {"résultat": 1}, "warnings": [{"message": "Attention"}]}
    need.assert_called_once_with("gouvernance", "new_version", "ancien")


def test_current_block_new_concept(client, joined, as_):
    from workspace_helpers import EXAMPLE

    as_("claire.m")
    text = (EXAMPLE / "concepts/client-actif.yaml").read_text(encoding="utf-8")
    text = text.replace("id: client-actif", "id: client-nouveau", 1)
    response = propose(client, text, None)
    assert response.status_code == 201, response.text
    context = common.open_context("groupe-nordis")
    pull = context.host.get_pull_request(1)
    _, block = common.parse_body(pull.body)
    assert pull.branch == "prop/client-nouveau-canonical-1"
    stale = {**block, "nature": "périmée", "domain": "périmé"}
    assert current.current_block(context, pull.head, stale) == block


@pytest.mark.parametrize("block", [
    {**VALID_BLOCK, "target": {**VALID_BLOCK["target"], "entity": 42}},
    {**VALID_BLOCK, "target": {**VALID_BLOCK["target"], "kpi_id": []}},
    {**VALID_BLOCK, "version": None},
    {**VALID_BLOCK, "diff": "invalide"},
    {**VALID_BLOCK, "diff": {"differences": "invalide"}},
    {**VALID_BLOCK, "diff": {"differences": [{"classification": 42}]}},
    {**VALID_BLOCK, "mention": []},
    {**VALID_BLOCK, "base_digest": 42},
    {**VALID_BLOCK, "base_governance": {}},
])
def test_parse_body_rejects_invalid_optional_fields(block):
    body = common.render_body("Motif", block)
    assert common.parse_body(body) == (body.strip(), None)


def test_parse_body_accepts_diff_without_differences():
    block = {**VALID_BLOCK, "diff": {}}
    assert common.parse_body(common.render_body("Motif", block)) == ("Motif", block)


@pytest.mark.parametrize(("body", "expected"), [
    (None, ("", None)),
    ("", ("", None)),
    ("  PR ordinaire  ", ("PR ordinaire", None)),
])
def test_parse_body_without_block(body, expected):
    assert common.parse_body(body) == expected
