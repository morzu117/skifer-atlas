"""Contrats précis des propositions."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import yaml
from test_proposals import as_, client, joined, propose, revenu_net
from workspace_helpers import atlas_env, git, remote

from skifer_atlas.proposals import common, create, merge
from skifer_atlas.repo.git import RepoError

__all__ = ["as_", "atlas_env", "client", "joined", "remote"]


@pytest.fixture(autouse=True)
def memory_vault(monkeypatch):
    monkeypatch.setenv("ATLAS_VAULT", "memory")


@pytest.mark.parametrize(("raw", "expected"), [
    ({"kind": "concept", "data_product": {"id": "client"}},
     {"kind": "concept", "id": "client", "path": "concepts/client.yaml", "entity": None,
      "kpi_id": None}),
    ({"kind": "kpi", "data_product": {"id": "revenu-net"}},
     {"kind": "kpi", "id": "revenu-net", "path": "kpis/revenu-net.yaml", "entity": None,
      "kpi_id": "revenu-net"}),
    ({"kind": "variant", "variant_of": {"id": "revenu-net"}, "entity": "nordis-fr"},
     {"kind": "variant", "id": "revenu-net--nordis-fr",
      "path": "variants/revenu-net/nordis-fr.yaml", "entity": "nordis-fr",
      "kpi_id": "revenu-net"}),
])
def test_target(raw, expected):
    assert create._target(raw) == expected


@pytest.mark.parametrize(("raw", "message"), [
    ({"kind": "kpi", "data_product": {"id": "../x"}}, "Identifiant de document invalide."),
    ({"kind": "variant", "variant_of": {"id": "ok"}, "entity": "../x"},
     "Une variante doit désigner son KPI (`variant_of.id`) et son entité (`entity`)."),
    ({"kind": "autre"}, "Type de document inconnu : concept, kpi ou variant."),
])
def test_invalid_target(raw, message):
    with pytest.raises(RepoError) as caught:
        create._target(raw)
    assert (caught.value.code, caught.value.message) == ("invalid_document", message)


@pytest.mark.parametrize(("current", "base", "message"), [
    (None, 2, "« revenu » n'existe plus sur la branche principale."),
    (4, None, "« revenu » existe déjà (v4) : partir de cette version."),
    (4, 3, "La base v3 de « revenu » n'est plus la version courante (v4) : repartir de la version courante."),
])
def test_stale_base_messages(current, base, message):
    with pytest.raises(RepoError) as caught:
        create._check_base(current, base, "revenu")
    assert (caught.value.code, caught.value.message) == ("stale_base", message)


def test_render_body_exact():
    assert common.render_body("  Justification é  ", {"z": "été", "a": 1}) == (
        'Justification é\n\n<!-- Bloc lu par Atlas : ne pas modifier. -->\n'
        '```atlas-proposal\n{\n  "a": 1,\n  "z": "été"\n}\n```\n')


def test_git_helpers_pass_credentials_and_error_code(monkeypatch, tmp_path):
    run = Mock(return_value="abc\trefs/heads/prop/a-1\ndef\trefs/heads/prop/a-2\n")
    monkeypatch.setattr(common, "run_git", run)
    context = SimpleNamespace(repo=tmp_path, token="token-test")
    assert common.remote_branches(context, "prop/a-") == {"prop/a-1", "prop/a-2"}
    run.assert_called_once_with(["ls-remote", "--heads", "origin", "refs/heads/prop/a-*"],
                                tmp_path, token="token-test")
    run.reset_mock()
    common.push(context, "abc:refs/heads/prop/a-1")
    run.assert_called_once_with(["push", "--quiet", "origin", "abc:refs/heads/prop/a-1"],
                                tmp_path, error_code="push_failed", token="token-test")


def test_create_and_merge_commit(client, joined, as_):
    bare, _ = joined
    as_("claire.m")
    response = propose(client, revenu_net(), 4, "  Définition revue.  ")
    assert response.status_code == 201, response.text
    assert response.json()["branch"] == "prop/revenu-net-canonical-1"
    assert git(bare, "log", "-1", "--format=%B", "prop/revenu-net-canonical-1").strip() == (
        "revenu-net v5\n\nDéfinition revue.")
    raw = yaml.safe_load(revenu_net())
    raw["data_product"]["version"] = 5
    assert git(bare, "show", "prop/revenu-net-canonical-1:kpis/revenu-net.yaml") == create.dump_data(raw)
    for account in ("marc.d", "julien.h"):
        as_(account)
        assert client.post("/api/workspaces/groupe-nordis/proposals/1/reviews",
                           json={"event": "approve"}).status_code == 200
    result = client.post("/api/workspaces/groupe-nordis/proposals/1/merge")
    assert result.status_code == 200, result.text
    assert result.json() == {"id": 1, "commit": git(bare, "rev-parse", "main").strip(),
                             "tag": "doc/revenu-net/v5", "version": 5,
                             "merge_mode": "reviewed", "mention": None, "warnings": [{
                                 "code": "versions_tagged", "message": "Version fusionnée hors d'Atlas, taguée au sync : revenu-net v5."}]}
    assert git(bare, "log", "-1", "--format=%B", "main").strip() == (
        "Fusion de la proposition #1 : Revenu net v5\n\nDéfinition revue.\n\n"
        "Atlas-Proposal: #1\nAtlas-Review: approved by julien.h, marc.d")


def test_merge_error_messages(monkeypatch):
    host = SimpleNamespace(get_pull_request=Mock(return_value=SimpleNamespace(state="closed")))
    context = SimpleNamespace(host=host, require=Mock())
    open_context = Mock(return_value=context)
    monkeypatch.setattr(merge, "open_context", open_context)
    with pytest.raises(RepoError) as caught:
        merge.merge_proposal("workspace", 7)
    assert (caught.value.code, caught.value.message) == (
        "not_open", "La proposition #7 n'est plus ouverte.")
    open_context.assert_called_once_with("workspace", sync=True)
    host.get_pull_request.return_value = SimpleNamespace(state="open", body="PR ordinaire")
    with pytest.raises(RepoError) as caught:
        merge.merge_proposal("workspace", 7)
    assert (caught.value.code, caught.value.message) == (
        "not_found", "La pull request #7 n'est pas une proposition Atlas.")


def test_access_point_proposal_block_and_commit(client, joined, as_):
    import hashlib

    bare, _ = joined
    as_("julien.h")
    original = ""
    point = {"id": "dbx-fr", "platform": "databricks",
             "host": "https://adb-1.2.azuredatabricks.net", "warehouse_id": "abc123",
             "schema": "gold.finance", "entity": "nordis-fr", "owner": "claire.m"}
    response = client.post("/api/workspaces/groupe-nordis/connections", json={
        "access_point": point, "justification": "  Entrepôt France.  "})
    assert response.status_code == 201, response.text
    assert response.json()["branch"] == "prop/access-point-dbx-fr-1"
    detail = client.get("/api/workspaces/groupe-nordis/proposals/1").json()
    assert detail["title"] == "Point d'accès dbx-fr (databricks)"
    assert detail["block"] == {
        "schema_version": 1,
        "target": {"kind": "access_points", "id": "dbx-fr", "path": "access_points.yaml",
                   "entity": "nordis-fr", "kpi_id": None},
        "nature": "access_points", "domain": None, "base_version": None, "version": None,
        "base_digest": hashlib.sha256(original.encode()).hexdigest(), "mention": None,
        "diff": None, "replaced": False, "warnings": [],
    }
    assert git(bare, "log", "-1", "--format=%B", "prop/access-point-dbx-fr-1").strip() == (
        "Point d'accès dbx-fr (databricks)\n\nEntrepôt France.")
    assert yaml.safe_load(git(bare, "show", "prop/access-point-dbx-fr-1:access_points.yaml")) == {
        "schema_version": 1, "access_points": [point]}


def test_branch_uses_first_available_suffix(monkeypatch):
    lookup = Mock(return_value={"prop/doc-1", "prop/doc-2", "prop/doc-4"})
    monkeypatch.setattr(create, "remote_branches", lookup)
    context = object()
    assert create._branch(context, "doc") == "prop/doc-3"
    lookup.assert_called_once_with(context, "prop/doc-")


def test_owned_documents_keeps_order_and_domains():
    from skifer_atlas.governance.codeowners import OwnedDocument

    def entry(kind, path, domain):
        return SimpleNamespace(file=SimpleNamespace(kind=kind, path=path),
                               raw={"data_product": {"domain": domain}})

    analysis = SimpleNamespace(entries=[entry("concept", "concepts/a.yaml", "finance"),
                                        entry("variant", "variants/b.yaml", "supply"),
                                        entry("kpi", "kpis/c.yaml", "supply")])
    assert create.owned_documents(analysis) == [
        OwnedDocument("concepts/a.yaml", "concept", "finance"),
        OwnedDocument("kpis/c.yaml", "kpi", "supply"),
    ]


def test_current_version_ignores_non_integer():
    context = SimpleNamespace(show=Mock(return_value="data_product:\n  version: '4'\n"))
    assert create.current_version(context, "kpis/a.yaml") is None
    context.show.assert_called_once_with("kpis/a.yaml")


def test_governance_proposal_block_and_commit(client, joined, as_):
    import hashlib

    bare, _ = joined
    as_("julien.h")
    original = git(bare, "show", "main:governance.yaml")
    governance = client.get("/api/workspaces/groupe-nordis/governance").json()["governance"]
    governance["domains"][3]["referents"] = ["claire.m"]
    response = client.post("/api/workspaces/groupe-nordis/governance", json={
        "governance": governance, "justification": "  Marketing à Claire.  "})
    assert response.status_code == 201, response.text
    assert response.json()["branch"] == "prop/governance-1"
    detail = client.get("/api/workspaces/groupe-nordis/proposals/1").json()
    assert detail["title"] == "Gouvernance de l'espace"
    assert detail["block"] == {
        "schema_version": 1,
        "target": {"kind": "governance", "id": "governance", "path": "governance.yaml",
                   "entity": None, "kpi_id": None},
        "nature": "governance", "domain": None, "base_version": None, "version": None,
        "base_digest": hashlib.sha256(original.encode()).hexdigest(), "mention": None,
        "diff": None, "warnings": [],
    }
    assert git(bare, "log", "-1", "--format=%B", "prop/governance-1").strip() == (
        "Gouvernance\n\nMarketing à Claire.")
    assert git(bare, "diff-tree", "--no-commit-id", "--name-only", "-r", "prop/governance-1").splitlines() == [
        ".github/CODEOWNERS", "governance.yaml"]


def test_variant_title_and_domain_use_canonical():
    canonical = SimpleNamespace(raw={"label": "Chiffre d'affaires", "data_product": {"domain": "finance"}})
    variant = SimpleNamespace(raw={"label": "Variante", "data_product": {"domain": "autre"}})
    analysis = SimpleNamespace(entry=Mock(return_value=canonical))
    target = {"kind": "variant", "kpi_id": "revenu-net", "entity": "fr"}
    assert create._title(target, variant, analysis, 3) == "Chiffre d'affaires — fr v3"
    assert create._domain(target, analysis, variant) == "finance"
    analysis.entry.return_value = None
    assert create._title(target, variant, analysis, 3) == "revenu-net — fr v3"
    assert create._domain(target, analysis, variant) is None


def test_canonical_title_and_domain():
    entry = SimpleNamespace(raw={"label": "Revenu", "data_product": {"domain": "finance"}})
    analysis = SimpleNamespace(entry=Mock())
    target = {"kind": "kpi", "id": "revenu"}
    assert create._title(target, entry, analysis, 5) == "Revenu v5"
    assert create._domain(target, analysis, entry) == "finance"
    analysis.entry.assert_not_called()
    entry.raw = {"data_product": {"domain": 42}}
    assert create._title(target, entry, analysis, 5) == "revenu v5"
    assert create._domain(target, analysis, entry) is None


def test_governance_rejections_have_exact_messages(client, joined, as_):
    as_("julien.h")
    governance = client.get("/api/workspaces/groupe-nordis/governance").json()["governance"]
    response = client.post("/api/workspaces/groupe-nordis/governance", json={
        "governance": governance, "justification": "Inchangée"})
    assert response.json()["detail"]["code"] == "no_change"
    assert response.json()["detail"]["message"] == (
        "La gouvernance proposée est identique à la gouvernance en vigueur.")
    with pytest.raises(RepoError) as caught:
        create.create_governance_proposal("groupe-nordis", governance, "Ancienne", "0" * 64)
    assert caught.value.code == "stale_base"
    assert caught.value.message == (
        "governance.yaml a changé sur la branche principale depuis son ouverture : "
        "recharger les paramètres.")
    governance["members"][0]["roles"] = [{"role": "contributeur", "domains": []}]
    response = client.post("/api/workspaces/groupe-nordis/governance", json={
        "governance": governance, "justification": "Invalide"})
    assert response.json()["detail"]["code"] == "invalid_governance"
    assert response.json()["detail"]["message"] == "La gouvernance proposée est refusée."


def test_not_ready_merge_message(client, joined, as_):
    as_("claire.m")
    assert propose(client, revenu_net(), 4).status_code == 201
    response = client.post("/api/workspaces/groupe-nordis/proposals/1/merge")
    assert response.json()["detail"]["code"] == "not_ready"
    assert response.json()["detail"]["message"] == "0 validation(s) sur 2."


def test_invalid_access_point_message(client, joined, as_):
    as_("julien.h")
    point = {"id": "dbx-fr", "platform": "bigquery", "host": "https://example.com",
             "warehouse_id": "abc123", "schema": "gold.finance", "entity": "nordis-fr",
             "owner": "claire.m"}
    response = client.post("/api/workspaces/groupe-nordis/connections", json={
        "access_point": point, "justification": "Invalide"})
    assert response.json()["detail"]["code"] == "invalid_access_point"
    assert response.json()["detail"]["message"] == "Le point d'accès est refusé."


def test_branch_skips_only_occupied_suffixes(monkeypatch):
    monkeypatch.setattr(create, "remote_branches", lambda context, prefix: {
        "prop/doc-1", "prop/doc-3"})
    assert create._branch(None, "doc") == "prop/doc-2"


def test_remote_branch_containing_refs_heads(monkeypatch, tmp_path):
    monkeypatch.setattr(common, "run_git", lambda *args, **kwargs:
                        "abc\trefs/heads/prop/refs/heads/example\n")
    assert common.remote_branches(SimpleNamespace(repo=tmp_path, token=None), "prop/") == {
        "prop/refs/heads/example"}


def test_variant_title_looks_up_the_designated_kpi():
    analysis = SimpleNamespace(entry=Mock(return_value=SimpleNamespace(raw={"label": "Ventes"})))
    assert create._title({"kind": "variant", "kpi_id": "ventes", "entity": "fr"},
                         SimpleNamespace(raw={}), analysis, 2) == "Ventes — fr v2"
    analysis.entry.assert_called_once_with("ventes")


def test_proposal_block_exact(client, joined, as_, monkeypatch):
    from skifer_atlas.workspaces import repo_dir

    analyze = Mock(wraps=create.analyze)
    monkeypatch.setattr(create, "analyze", analyze)
    captured = []
    original = create._open_pull

    def record(context, stem, commit, title, justification, block):
        captured.append(block)
        return original(context, stem, commit, title, justification, block)

    monkeypatch.setattr(create, "_open_pull", record)
    as_("claire.m")
    assert propose(client, revenu_net(), 4).status_code == 201
    assert analyze.call_args.args[1] == repo_dir("groupe-nordis")
    assert captured == [{
        "schema_version": 1,
        "target": {"kind": "kpi", "id": "revenu-net", "path": "kpis/revenu-net.yaml",
                   "entity": None, "kpi_id": "revenu-net"},
        "nature": "new_version", "domain": "finance", "base_version": 4, "version": 5,
        "mention": None, "warnings": [],
        "diff": {"relation": "version", "identical": True,
                 "summary": {"by_classification": {"override_declared": 0,
                             "override_undeclared": 0, "from_scratch": 0, "critical": 0,
                             "cosmetic": 0, "to_verify": 0},
                             "by_severity": {"info": 0, "warn": 0, "critical": 0}},
                 "differences": [], "truncated": False},
    }]
    import json

    state = json.loads((joined[0] / "atlas/proposals/1.json").read_text(encoding="utf-8"))
    assert state["branch"] == "prop/revenu-net-canonical-1"
    assert state["title"] == "Revenu net v5"
    assert state["body"] == (
        "Précision de la définition.\n\n<!-- Bloc lu par Atlas : ne pas modifier. -->\n"
        "```atlas-proposal\n" + json.dumps(captured[0], ensure_ascii=False, indent=2, sort_keys=True)
        + "\n```\n")


def test_new_document_starts_at_version_one(client, joined, as_):
    from workspace_helpers import EXAMPLE

    bare, _ = joined
    as_("claire.m")
    text = (EXAMPLE / "concepts/client-actif.yaml").read_text(encoding="utf-8")
    text = text.replace("id: client-actif", "id: client-nouveau", 1)
    response = propose(client, text, None, "Nouveau concept.")
    assert response.status_code == 201, response.text
    assert response.json()["version"] == 1
    assert response.json()["branch"] == "prop/client-nouveau-canonical-1"
    committed = yaml.safe_load(git(bare, "show", "prop/client-nouveau-canonical-1:concepts/client-nouveau.yaml"))
    expected = yaml.safe_load(text)
    expected["data_product"]["version"] = 1
    assert committed == expected
    assert git(bare, "log", "-1", "--format=%B", "prop/client-nouveau-canonical-1").strip() == (
        "client-nouveau v1\n\nNouveau concept.")


def test_create_fetches_latest_remote_before_checking_base(client, joined, as_):
    from workspace_helpers import REVENU_NET, commit_all

    bare, work = joined
    as_("claire.m")
    path = work / REVENU_NET
    path.write_text(path.read_text(encoding="utf-8").replace("version: 4", "version: 5", 1),
                    encoding="utf-8")
    commit_all(work, "Nouvelle version distante")
    git(work, "push", "--quiet", "origin", "main")
    response = propose(client, revenu_net(), 4)
    from skifer_atlas.workspaces import repo_dir

    assert git(repo_dir("groupe-nordis"), "rev-parse", "HEAD") == git(bare, "rev-parse", "main")
    assert response.json()["detail"]["code"] == "stale_base"
    assert response.json()["detail"]["message"] == (
        "La base v4 de « revenu-net » n'est plus la version courante (v5) : "
        "repartir de la version courante.")


def test_merge_legacy_governance_and_sync_failure(monkeypatch):
    import hashlib

    block = {"target": {"kind": "governance", "path": "governance.yaml", "id": "governance"},
             "base_governance": hashlib.sha256(b"ancien").hexdigest(),
             "nature": "governance", "version": None}
    pull = SimpleNamespace(state="open", body=common.render_body("", block), head="head",
                           author="alice", title="Gouvernance")
    host = SimpleNamespace(get_pull_request=Mock(return_value=pull), get_reviews=Mock(return_value=[]),
                           merge=Mock(return_value="commit"))
    context = SimpleNamespace(host=host, require=Mock(), show=Mock(return_value="ancien"),
                              governance=None)
    monkeypatch.setattr(merge, "open_context", lambda workspace_id, sync: context)
    monkeypatch.setattr(merge, "current_block", lambda context, head, block: block)
    monkeypatch.setattr(merge, "review_domain", lambda *args: None)
    monkeypatch.setattr(merge, "decide", lambda *args: SimpleNamespace(
        ready_to_merge=True, merge_mode="no_other_eligible", approvers=[], mention="mention"))

    def failed_sync(workspace_id):
        raise RepoError("fetch_failed", "indisponible")

    monkeypatch.setattr(merge, "sync_workspace", failed_sync)
    assert merge.merge_proposal("workspace", 7) == {
        "id": 7, "commit": "commit", "tag": None, "version": None,
        "merge_mode": "no_other_eligible", "mention": "mention", "warnings": [{
            "code": "post_merge_sync_failed", "message":
            "La proposition est fusionnée ; la synchronisation a échoué (fetch_failed). "
            "Relancer la synchronisation pour publier le tag."}]}
    host.merge.assert_called_once_with(
        7, "head", "Fusion de la proposition #7 : Gouvernance",
        "Atlas-Proposal: #7\nAtlas-Review: none (no other eligible approver)")
    context.show.return_value = "modifié"
    with pytest.raises(RepoError) as caught:
        merge.merge_proposal("workspace", 7)
    assert (caught.value.code, caught.value.message) == (
        "stale_base", "governance.yaml a changé depuis la proposition : la reproposer.")


def test_merge_document_stale_base_exact(monkeypatch):
    block = {"target": {"kind": "kpi", "path": "kpis/test.yaml", "id": "test"},
             "base_version": 1, "nature": "new_version"}
    pull = SimpleNamespace(state="open", body=common.render_body("Motif", block), head="head",
                           author="alice")
    host = SimpleNamespace(get_pull_request=Mock(return_value=pull), get_reviews=Mock(return_value=[]))
    context = SimpleNamespace(host=host, require=Mock(), governance=None)
    monkeypatch.setattr(merge, "open_context", lambda workspace_id, sync: context)
    monkeypatch.setattr(merge, "current_block", lambda context, head, block: block)
    monkeypatch.setattr(merge, "review_domain", lambda *args: "finance")
    monkeypatch.setattr(merge, "decide", lambda *args: SimpleNamespace(ready_to_merge=True))
    monkeypatch.setattr(merge, "current_version", lambda context, path: 2)
    with pytest.raises(RepoError) as caught:
        merge.merge_proposal("workspace", 7)
    assert (caught.value.code, caught.value.message) == (
        "stale_base", ("« test » a changé depuis la proposition : "
                       "la reproposer à partir de la version courante."))


def test_diff_serializes_differences_and_limit(monkeypatch):
    previous = SimpleNamespace(graph=object())
    document = SimpleNamespace(graph=object())
    library = object()
    analysis = SimpleNamespace(library=library)
    context = SimpleNamespace(show=Mock(return_value="kind: kpi"))
    entry = SimpleNamespace(document=document)
    monkeypatch.setattr(create, "validate_data", lambda raw: SimpleNamespace(document=previous))
    monkeypatch.setattr(create, "ResolvedGraph", lambda doc: doc)
    difference = SimpleNamespace(node_ref=SimpleNamespace(base="n01"), node_type="source",
                                 kind="changed", classification="critical", severity="warn",
                                 message="Source modifiée")
    report = SimpleNamespace(identical=False, summary=SimpleNamespace(model_dump=lambda: {"critical": 200}),
                             differences=[difference] * 200)
    diff_call = Mock(return_value=report)
    monkeypatch.setattr(create, "diff", diff_call)
    expected_difference = {"node": "n01", "node_type": "source", "kind": "changed",
                           "classification": "critical", "severity": "warn",
                           "message": "Source modifiée"}
    assert create._diff(context, {"kind": "kpi", "path": "kpis/a.yaml"}, analysis, entry) == {
        "relation": "version", "identical": False, "summary": {"critical": 200},
        "differences": [expected_difference] * 200, "truncated": False}
    assert diff_call.call_args.args[0:2] == (previous, document)
    assert diff_call.call_args.args[2].library is library
    report.differences.append(difference)
    assert create._diff(context, {"kind": "kpi", "path": "kpis/a.yaml"}, analysis, entry) == {
        "relation": "version", "identical": False, "summary": {"critical": 200},
        "differences": [expected_difference] * 200, "truncated": True}


def test_diff_missing_previous_or_graph_returns_none(monkeypatch):
    analysis = SimpleNamespace(library=None)
    target = {"kind": "kpi", "path": "kpis/a.yaml"}
    context = SimpleNamespace(show=Mock(return_value=None))
    assert create._diff(context, target, analysis, SimpleNamespace(document=SimpleNamespace(graph=1))) is None
    context.show.return_value = "kind: kpi"
    monkeypatch.setattr(create, "validate_data", lambda raw: SimpleNamespace(document=None))
    assert create._diff(context, target, analysis, SimpleNamespace(document=SimpleNamespace(graph=1))) is None
    monkeypatch.setattr(create, "validate_data", lambda raw: SimpleNamespace(document=SimpleNamespace(graph=None)))
    assert create._diff(context, target, analysis, SimpleNamespace(document=SimpleNamespace(graph=1))) is None
    monkeypatch.setattr(create, "validate_data", lambda raw: SimpleNamespace(document=SimpleNamespace(graph=1)))
    assert create._diff(context, target, analysis, SimpleNamespace(document=SimpleNamespace(graph=None))) is None


def test_invalid_document_reports_exact_issues(client, joined, as_):
    as_("claire.m")
    response = propose(client, "kind: [", None)
    assert response.json()["detail"] == {
        "code": "invalid_document", "message": "Le document n'est pas un YAML lisible.",
        "issues": [{"path": "", "node_id": None, "code": "invalid_yaml",
                    "message": "YAML illisible : did not find expected node content (ligne 2, colonne 1)",
                    "severity": "error"}]}
    response = propose(client, "- un\n- deux\n", None)
    assert response.json()["detail"] == {"code": "invalid_document",
        "message": "Le document n'est pas un YAML lisible.", "issues": []}
    response = propose(client, revenu_net().replace("type: source", "type: inconnu", 1), 4)
    assert response.json()["detail"] == {
        "code": "invalid_document",
        "message": "Le document est refusé : corriger les erreurs avant de proposer.",
        "issues": [{"path": "/graph/nodes/0/type", "node_id": "n01",
                    "code": "unknown_node_type", "severity": "error",
                    "message": "Type de nœud inconnu « inconnu ». Types admis : 'source', 'filter', "
                               "'join', 'union', 'compute', 'deduplicate', 'aggregate', "
                               "'temporal', 'kpi_ref', 'metric_op'."}]}


def test_invalid_access_point_registry_reports_issues(client, joined, as_):
    from workspace_helpers import commit_all

    bare, work = joined
    as_("julien.h")
    (work / "access_points.yaml").write_text("schema_version: [\n", encoding="utf-8")
    commit_all(work, "Registre invalide")
    git(work, "push", "--quiet", "origin", "main")
    response = client.post("/api/workspaces/groupe-nordis/connections", json={
        "access_point": {"id": "test"}, "justification": "Correction"})
    from skifer_atlas.workspaces import repo_dir

    assert git(repo_dir("groupe-nordis"), "rev-parse", "HEAD") == git(bare, "rev-parse", "main")
    assert response.json()["detail"] == {
        "code": "invalid_access_points",
        "message": "access_points.yaml de la branche principale est invalide.",
        "issues": [{"path": "", "node_id": None, "code": "invalid_yaml",
                    "message": "access_points.yaml n'est pas un YAML lisible.",
                    "severity": "error"}]}


def test_governance_proposal_refreshes_changed_remote(client, joined, as_):
    import hashlib

    from workspace_helpers import commit_all

    bare, work = joined
    as_("julien.h")
    governance = client.get("/api/workspaces/groupe-nordis/governance").json()["governance"]
    path = work / "governance.yaml"
    old = path.read_text(encoding="utf-8")
    path.write_text(old + "\n# changement distant\n", encoding="utf-8")
    commit_all(work, "Gouvernance distante")
    git(work, "push", "--quiet", "origin", "main")
    with pytest.raises(RepoError) as caught:
        create.create_governance_proposal("groupe-nordis", governance, "Ancienne",
                                          hashlib.sha256(old.encode()).hexdigest())
    from skifer_atlas.workspaces import repo_dir

    assert git(repo_dir("groupe-nordis"), "rev-parse", "HEAD") == git(bare, "rev-parse", "main")
    assert (caught.value.code, caught.value.message) == (
        "stale_base", ("governance.yaml a changé sur la branche principale depuis son ouverture : "
                       "recharger les paramètres."))


def test_replacing_access_point_preserves_other_points(client, joined, as_):
    from workspace_helpers import commit_all

    bare, work = joined
    as_("julien.h")
    point = {"id": "dbx-fr", "platform": "databricks",
             "host": "https://adb-1.2.azuredatabricks.net", "warehouse_id": "abc123",
             "schema": "gold.finance", "entity": "nordis-fr", "owner": "claire.m"}
    other = {**point, "id": "dbx-autre", "warehouse_id": "autre"}
    (work / "access_points.yaml").write_text(yaml.safe_dump({"schema_version": 1,
        "access_points": [point, other]}, sort_keys=False), encoding="utf-8")
    commit_all(work, "Registre existant")
    git(work, "push", "--quiet", "origin", "main")
    replacement = {**point, "warehouse_id": "nouveau"}
    response = client.post("/api/workspaces/groupe-nordis/connections", json={
        "access_point": replacement, "justification": "Changement"})
    assert response.status_code == 201, response.text
    detail = client.get("/api/workspaces/groupe-nordis/proposals/1").json()
    assert detail["block"]["replaced"] is True
    stored = yaml.safe_load(git(bare, "show", "prop/access-point-dbx-fr-1:access_points.yaml"))
    assert stored == {"schema_version": 1, "access_points": [other, replacement]}


def test_governance_proposal_keeps_validation_warnings(client, joined, as_, monkeypatch):
    from skifer_atlas.workspaces import repo_dir

    analyze = Mock(wraps=create.analyze)
    monkeypatch.setattr(create, "analyze", analyze)
    captured = []
    original = create._open_pull

    def record(context, stem, commit, title, justification, block):
        captured.append(block["warnings"])
        return original(context, stem, commit, title, justification, block)

    monkeypatch.setattr(create, "_open_pull", record)
    as_("julien.h")
    governance = client.get("/api/workspaces/groupe-nordis/governance").json()["governance"]
    governance["domains"][0]["label"] = "Finance modifiée"
    response = client.post("/api/workspaces/groupe-nordis/governance", json={
        "governance": governance, "justification": "Libellé"})
    assert response.status_code == 201, response.text
    assert analyze.call_args.args[1] == repo_dir("groupe-nordis")
    assert captured == [[{"path": "/domains/3", "node_id": None,
                         "code": "domain_without_referent",
                         "message": "Le domaine « Marketing » n'a pas de référent.",
                         "severity": "warning"}]]


def test_document_proposal_keeps_warning_severity(client, joined, as_, monkeypatch):
    from workspace_helpers import EXAMPLE

    captured = []
    original = create._open_pull

    def record(context, stem, commit, title, justification, block):
        captured.append(block["warnings"])
        return original(context, stem, commit, title, justification, block)

    monkeypatch.setattr(create, "_open_pull", record)
    as_("claire.m")
    raw = yaml.safe_load((EXAMPLE / "concepts/client-actif.yaml").read_text(encoding="utf-8"))
    import copy

    orphan = copy.deepcopy(raw["graph"]["nodes"][0])
    orphan["id"] = "n99"
    raw["graph"]["nodes"].append(orphan)
    response = propose(client, yaml.safe_dump(raw, allow_unicode=True), 3)
    assert response.status_code == 201, response.text
    assert captured == [[{"path": "/graph/nodes/2", "node_id": "n99", "code": "orphan_node",
                         "message": "Le nœud n99 ne mène pas à la sortie n02 : il est ignoré.",
                         "severity": "warning"}]]


def test_variant_diff_uses_canonical_and_library(monkeypatch):
    canonical = object()
    library = SimpleNamespace(kpi=Mock(return_value=canonical))
    document = SimpleNamespace(variant_of=SimpleNamespace(id="ventes", version=2), mode="override")
    entry = SimpleNamespace(document=document)
    resolved = object()
    resolver = Mock(return_value=resolved)
    monkeypatch.setattr(create, "resolve", resolver)
    monkeypatch.setattr(create, "ResolvedGraph", lambda doc: doc)
    report = SimpleNamespace(identical=True, differences=[],
                             summary=SimpleNamespace(model_dump=lambda: {"count": 0}))
    calculate = Mock(return_value=report)
    monkeypatch.setattr(create, "diff", calculate)
    assert create._diff(None, {"kind": "variant"}, SimpleNamespace(library=library), entry) == {
        "relation": "override", "identical": True, "summary": {"count": 0},
        "differences": [], "truncated": False}
    library.kpi.assert_called_once_with("ventes", 2)
    resolver.assert_called_once_with(document, canonical, library)
    assert calculate.call_args.args[0:2] == (canonical, resolved)
    assert calculate.call_args.args[2].library is library


def test_non_mapping_access_point_is_refused(client, joined, as_):
    as_("julien.h")
    with pytest.raises(RepoError) as caught:
        create.create_access_point_proposal("groupe-nordis", ["incorrect"], "Motif")
    assert (caught.value.code, caught.value.message, caught.value.details) == (
        "invalid_access_point", "Le point d'accès est refusé.", [{
            "path": "/access_points/0", "node_id": None, "code": "invalid_value",
            "message": "« access_points » doit être un mapping (clé: valeur).", "severity": "error"}])


def test_variant_without_data_product_reports_validation_errors(client, joined, as_):
    from workspace_helpers import EXAMPLE

    as_("claire.m")
    raw = yaml.safe_load((EXAMPLE / "variants/revenu-net/nordis-fr.yaml").read_text(encoding="utf-8"))
    del raw["data_product"]
    response = propose(client, yaml.safe_dump(raw, allow_unicode=True), 2)
    assert response.json()["detail"] == {
        "code": "invalid_document",
        "message": "Le document est refusé : corriger les erreurs avant de proposer.",
        "issues": [{"path": "/data_product/id", "node_id": None, "code": "missing_field",
                    "message": "Champ requis manquant : « id ».", "severity": "error"},
                   {"path": "/data_product/owner", "node_id": None, "code": "missing_field",
                    "message": "Champ requis manquant : « owner ».", "severity": "error"}]}


def test_undeclared_variant_block_carries_mention(client, joined, as_, monkeypatch):
    from test_proposals import edited

    captured = []
    original = create._open_pull

    def record(context, stem, commit, title, justification, block):
        captured.append(block)
        return original(context, stem, commit, title, justification, block)

    monkeypatch.setattr(create, "_open_pull", record)
    as_("anna.k")
    text = edited("variants/revenu-net/nordis-de.yaml", "TVA allemande à 19 %.",
                  "TVA allemande, taux normal.")
    response = propose(client, text, 3)
    assert response.status_code == 201, response.text
    assert captured[0]["nature"] == "undeclared"
    assert captured[0]["domain"] == "finance"
    assert captured[0]["mention"] == "Validation canonique exigée"


def test_rejected_document_reports_errors_without_warnings(client, joined, as_):
    import copy

    from workspace_helpers import EXAMPLE

    as_("claire.m")
    raw = yaml.safe_load((EXAMPLE / "concepts/client-actif.yaml").read_text(encoding="utf-8"))
    orphan = copy.deepcopy(raw["graph"]["nodes"][0])
    orphan["id"] = "n99"
    raw["graph"]["nodes"].append(orphan)
    raw["data_product"]["description"] = "TODO"
    raw["status"] = "draft"
    raw["extraction"] = {"source_file": "revenu.sql", "line": 3, "dialect": "databricks",
                         "sql_sha256": "0" * 64,
                         "residues": [{"code": "window_function", "message": "Fenêtre.",
                                       "blocking": True}]}
    response = propose(client, yaml.safe_dump(raw, allow_unicode=True), 3)
    assert response.json()["detail"] == {
        "code": "invalid_document",
        "message": "Le document est refusé : corriger les erreurs avant de proposer.",
        "issues": [{"path": "/extraction/residues/0", "node_id": None,
                    "code": "blocking_residue", "severity": "error",
                    "message": "Résidu bloquant « window_function » non levé : le traiter, puis le retirer de la liste."}]}


def test_graph_error_rejects_otherwise_valid_document(client, joined, as_):
    import copy

    from workspace_helpers import EXAMPLE

    as_("claire.m")
    raw = yaml.safe_load((EXAMPLE / "concepts/client-actif.yaml").read_text(encoding="utf-8"))
    branch = copy.deepcopy(raw["graph"]["nodes"][1])
    branch["id"] = "n99"
    raw["graph"]["nodes"].append(branch)
    response = propose(client, yaml.safe_dump(raw, allow_unicode=True), 3)
    assert response.json()["detail"] == {
        "code": "invalid_document", "message": "Le document est refusé : corriger les erreurs avant de proposer.",
        "issues": [{"path": "/graph/nodes/0", "node_id": "n01", "code": "branch_not_merged",
                    "message": "La sortie de n01 part vers n02, n99 ; la branche n99 ne rejoint "
                               "pas les autres par une jointure ou une union.", "severity": "error"}]}
