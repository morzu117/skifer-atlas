"""Contrats des droits et opérations sur les propositions."""

import pytest
from test_proposals import PROPOSALS, as_, client, joined, propose, revenu_net
from workspace_helpers import atlas_env, git, remote

from skifer_atlas.proposals import status
from skifer_atlas.repo import RepoError

__all__ = ["as_", "atlas_env", "client", "joined", "remote"]


@pytest.fixture(autouse=True)
def memory_vault(monkeypatch):
    monkeypatch.setenv("ATLAS_VAULT", "memory")


def test_viewer_rights_and_domain_referent_close(client, joined, as_):
    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    assert client.get(f"{PROPOSALS}/1").json()["viewer"] == {
        "account": "anna.k", "can_revise": True, "can_close": True,
        "can_review": False,
        "review_reason": "Vous êtes l'auteur de cette proposition : un autre compte doit l'approuver.",
        "can_merge": False, "merge_reason": "0 validation(s) sur 2.",
    }
    as_("claire.m")
    assert client.get(f"{PROPOSALS}/1").json()["viewer"] == {
        "account": "claire.m", "can_revise": False, "can_close": True,
        "can_review": True, "review_reason": None, "can_merge": False,
        "merge_reason": "0 validation(s) sur 2.",
    }
    result = client.post(f"{PROPOSALS}/1/close", json={"reason": "  Doublon  "})
    assert result.status_code == 200
    assert result.json()["state"] == "closed"
    detail = client.get(f"{PROPOSALS}/1").json()
    assert [c["body"] for c in detail["comments"]] == ["Proposition retirée : Doublon"]
    assert detail["viewer"] == {
        "account": "claire.m", "can_revise": False, "can_close": False,
        "can_review": False, "review_reason": "La proposition n'est plus ouverte.",
        "can_merge": False, "merge_reason": "Validations insuffisantes.",
    }


def test_revision_contract_and_commit(client, joined, as_):
    import yaml

    from skifer_atlas.proposals.common import open_context

    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    pull_before = open_context("groupe-nordis").host.get_pull_request(1)
    as_("sami.b")
    denied = client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net()})
    assert denied.json()["detail"] == {
        "code": "forbidden", "message": "Seul l'auteur peut modifier la proposition."}
    denied = client.post(f"{PROPOSALS}/1/close", json={})
    assert denied.json()["detail"] == {
        "code": "forbidden", "message": "Seul l'auteur ou un référent peut retirer la proposition."}
    as_("anna.k")
    invalid = client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": "[]"})
    assert invalid.json()["detail"] == {
        "code": "invalid_document", "message": "Le document n'est pas un YAML lisible.", "issues": []}
    revised = client.post(f"{PROPOSALS}/1/revisions", json={
        "document_yaml": revenu_net("Définition révisée"), "note": "  Précision  "})
    assert revised.status_code == 201, revised.text
    assert revised.json()["branch"] == "prop/revenu-net-canonical-1"
    assert git(joined[0], "cat-file", "commit", revised.json()["head"]).split("\n\n", 1)[1] == \
        "Révision de la proposition\n\nPrécision\n"
    content = git(joined[0], "show", f'{revised.json()["head"]}:kpis/revenu-net.yaml')
    expected_document = yaml.safe_load(revenu_net("Définition révisée"))
    expected_document["data_product"]["version"] = 5
    assert yaml.safe_load(content) == expected_document
    assert content == client.get(f"{PROPOSALS}/1").json()["content"]
    pull_after = open_context("groupe-nordis").host.get_pull_request(1)
    assert (pull_after.title, pull_after.body, pull_after.branch) == (
        "Revenu net v5", pull_before.body, "prop/revenu-net-canonical-1")


def test_review_and_closed_errors(client, joined, as_):
    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    with pytest.raises(RepoError) as error:
        status.review("groupe-nordis", 1, "request_changes", "  ")
    assert (error.value.code, str(error.value)) == (
        "comment_required", "Une demande de changements s'accompagne d'un commentaire qui dit quoi changer.")
    assert client.post(f"{PROPOSALS}/1/close", json={}).status_code == 200
    with pytest.raises(RepoError) as error:
        status.review("groupe-nordis", 1, "approve", "")
    assert (error.value.code, str(error.value)) == ("not_open", "La proposition #1 n'est plus ouverte.")
    result = client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revenu_net()})
    assert result.json()["detail"] == {"code": "not_open", "message": "La proposition #1 n'est plus ouverte."}


def test_non_atlas_pull_request_errors(client, joined, as_):
    from skifer_atlas.proposals.common import open_context

    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    open_context("groupe-nordis").host.update_body(1, "Proposition libre")
    for suffix, payload in (("/revisions", {"document_yaml": revenu_net()}), ("/close", {})):
        response = client.post(f"{PROPOSALS}/1{suffix}", json=payload)
        assert response.json()["detail"] == {
            "code": "not_found", "message": "Cette proposition n'est pas une proposition Atlas."}
    response = client.get(f"{PROPOSALS}/1")
    assert response.json()["detail"] == {
        "code": "not_found", "message": "La pull request #1 n'est pas une proposition Atlas."}
    response = client.get(f"{PROPOSALS}/1/graphs")
    assert response.json()["detail"] == {
        "code": "not_found", "message": "La pull request #1 n'est pas une proposition Atlas."}


@pytest.mark.parametrize("kind, expected", [
    ("kpi", True), ("concept", True), ("variant", True),
    ("governance", False), ("access_point", False),
])
def test_viewer_revision_depends_on_document_kind(client, joined, as_, kind, expected):
    from skifer_atlas.proposals.common import open_context
    from skifer_atlas.proposals.view import viewer

    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    found = client.get(f"{PROPOSALS}/1").json()
    found["document_kind"] = kind
    assert viewer(open_context("groupe-nordis"), found) == {
        "account": "anna.k", "can_revise": expected, "can_close": True,
        "can_review": False,
        "review_reason": "Vous êtes l'auteur de cette proposition : un autre compte doit l'approuver.",
        "can_merge": False, "merge_reason": "0 validation(s) sur 2.",
    }


def test_list_filters_and_comment_contract(client, joined, as_):
    from skifer_atlas.proposals.common import open_context

    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    items = status.list_proposals("groupe-nordis")
    assert len(items) == 1
    for arguments in ({"domain": "finance"}, {"author": "anna.k"},
                      {"kpi": "revenu-net"}):
        assert status.list_proposals("groupe-nordis", **arguments) == items
    for arguments in ({"domain": "supply"}, {"author": "claire.m"},
                      {"kpi": "absent"}, {"entity": "nordis-fr"}):
        assert status.list_proposals("groupe-nordis", **arguments) == []
    comment = status.comment("groupe-nordis", 1, "Une précision")
    saved = open_context("groupe-nordis").host.list_comments(1)[0]
    assert comment == {"account": "anna.k", "body": "Une précision",
                       "created_at": status._utc(saved.created_at)}


def test_revision_rejects_changed_identity(client, joined, as_):
    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    response = client.post(f"{PROPOSALS}/1/revisions", json={
        "document_yaml": revenu_net().replace("id: revenu-net", "id: autre", 1)})
    assert response.json()["detail"] == {
        "code": "invalid_document", "message": "Le document doit conserver son identité."}


def test_local_queue_rejects_missing_governance(atlas_env):
    from skifer_atlas.proposals.view import queue
    from skifer_atlas.repo import sync
    from skifer_atlas.repo.layout import WorkspaceMeta
    from skifer_atlas.workspaces import repo_dir

    sync.create_workspace(WorkspaceMeta(id="local", name="Local"))
    (repo_dir("local") / "governance.yaml").unlink()
    with pytest.raises(RepoError) as error:
        queue("local")
    assert (error.value.code, str(error.value)) == (
        "invalid_governance", "La gouvernance locale est absente ou invalide.")


def test_default_revision_and_close_without_note(client, joined, as_):
    import importlib

    revision = importlib.import_module("skifer_atlas.proposals.revise")
    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    result = revision.revise("groupe-nordis", 1, revenu_net("Une révision"))
    assert git(joined[0], "cat-file", "commit", result["head"]).split("\n\n", 1)[1] == \
        "Révision de la proposition\n"
    assert revision.close("groupe-nordis", 1)["state"] == "closed"
    assert [c["body"] for c in client.get(f"{PROPOSALS}/1").json()["comments"]] == ["Proposition retirée"]


def test_revision_history_preserves_multiline_note(client, joined, as_, monkeypatch):
    as_("anna.k")
    monkeypatch.setenv("GIT_AUTHOR_DATE", "2026-11-11T14:05:00+01:00")
    monkeypatch.setenv("GIT_COMMITTER_DATE", "2026-11-11T14:05:00+01:00")
    created = propose(client, revenu_net(), 4).json()
    revised = client.post(f"{PROPOSALS}/1/revisions", json={
        "document_yaml": revenu_net().replace("Factures validées", "Factures contrôlées"),
        "note": "Premier paragraphe\n\nSecond paragraphe"})
    assert revised.status_code == 201
    assert client.get(f"{PROPOSALS}/1").json()["revisions"] == [
        {"rank": 1, "commit": created["head"], "date": "2026-11-11T13:05:00Z",
         "author": "anna.k", "note": "", "differences": 0},
        {"rank": 2, "commit": revised.json()["head"], "date": "2026-11-11T13:05:00Z",
         "author": "anna.k", "note": "Premier paragraphe\n\nSecond paragraphe", "differences": 1},
    ]


def test_label_fallbacks_and_shared_documents(client, joined, as_, monkeypatch):
    from skifer_atlas.proposals.common import open_context

    as_("anna.k")
    context = open_context("groupe-nordis")
    assert status._label(context, {"kind": "governance"}, context.base) == "Gouvernance de l'espace"
    assert status._label(context, {"kind": "access_point", "id": "warehouse"}, context.base) == \
        "Point d'accès warehouse"
    target = {"kind": "kpi", "id": "revenu-net", "path": "kpis/revenu-net.yaml"}
    assert status._label(context, target, context.base) == "Revenu net"
    assert status._label(context, {"kind": "concept", "id": "commande",
                                   "path": "concepts/commande.yaml"}, context.base) == "Commande"
    for text in (None, "[]", "label: ''", "label: 42"):
        monkeypatch.setattr(context, "show", lambda *args, value=text: value)
        assert status._label(context, target, context.base) == "revenu-net"
    assert status._label(context, {"kind": "variant", "kpi_id": "revenu-net"}, context.base) == \
        "revenu-net"


def test_review_body_is_recorded(client, joined, as_):
    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    as_("claire.m")
    status.review("groupe-nordis", 1, "request_changes", "Veuillez corriger le calcul.")
    reviews = client.get(f"{PROPOSALS}/1").json()["reviews"]
    assert [(r["account"], r["state"], r["body"], r["blocking"]) for r in reviews] == [
        ("claire.m", "changes_requested", "Veuillez corriger le calcul.", True)]


def test_naive_dates_are_utc(monkeypatch):
    import time

    if not hasattr(time, "tzset"):
        pytest.skip("Le fuseau du processus ne peut pas être modifié sur cette plateforme")
    try:
        with monkeypatch.context() as environment:
            environment.setenv("TZ", "UTC-02")
            time.tzset()
            assert status._utc("2026-11-11T14:05:00") == "2026-11-11T14:05:00Z"
    finally:
        time.tzset()


def test_governance_proposal_has_no_graph(client, joined, as_):
    from test_admin import ADMIN, save

    as_("julien.h")
    state = client.get(ADMIN).json()
    response = save(client, state, lambda g: g["domains"][0].update(label="Finance révisée"))
    assert response.status_code == 201, response.text
    assert client.get(f"{PROPOSALS}/1/graphs").json() == {
        "base": None, "proposed": None, "report": None, "undeclared": [], "recurring": []}
    assert client.get(f"{PROPOSALS}/1").json()["document_label"] == "Gouvernance de l'espace"


def test_variant_without_data_product_is_refused(client, joined, as_):
    import yaml
    from test_proposals import NORDIS_FR, edited

    as_("anna.k")
    text = edited(NORDIS_FR, "TVA française à 20 %.", "TVA française, taux normal.")
    assert propose(client, text, 2).status_code == 201
    raw = yaml.safe_load(text)
    del raw["data_product"]
    response = client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": yaml.safe_dump(raw)})
    assert response.json()["detail"] == {
        "code": "invalid_document", "message": "Le document doit contenir data_product."}


def test_revision_domain_is_checked_against_main(client, joined, as_):
    as_("anna.k")
    changed = revenu_net().replace("domain: finance", "domain: supply", 1)
    assert propose(client, changed, 4).status_code == 201
    as_("claire.m")
    viewer = client.get(f"{PROPOSALS}/1").json()["viewer"]
    assert viewer == {"account": "claire.m", "can_revise": False, "can_close": True,
                      "can_review": True, "review_reason": None, "can_merge": False,
                      "merge_reason": "0 validation(s) sur 2."}
    response = client.post(f"{PROPOSALS}/1/close", json={"reason": "Domaine déplacé"})
    assert response.status_code == 200
    assert [c["body"] for c in client.get(f"{PROPOSALS}/1").json()["comments"]] == [
        "Proposition retirée : Domaine déplacé"]


def test_viewer_reasons_for_other_account_and_ready_proposal(client, joined, as_):
    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    as_("sami.b")
    assert client.get(f"{PROPOSALS}/1").json()["viewer"] == {
        "account": "sami.b", "can_revise": False, "can_close": False, "can_review": False,
        "review_reason": "Votre approbation ne compterait pas ici. Comptes habilités : claire.m, julien.h, marc.d.",
        "can_merge": False, "merge_reason": "0 validation(s) sur 2."}
    for account in ("claire.m", "marc.d"):
        as_(account)
        assert client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"}).status_code == 200
    as_("anna.k")
    assert client.get(f"{PROPOSALS}/1").json()["viewer"] == {
        "account": "anna.k", "can_revise": True, "can_close": True, "can_review": False,
        "review_reason": "Vous êtes l'auteur de cette proposition : un autre compte doit l'approuver.",
        "can_merge": True, "merge_reason": None}


def test_viewer_reader_cannot_merge(client, joined, as_):
    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    as_("inconnu")
    assert client.get(f"{PROPOSALS}/1").json()["viewer"] == {
        "account": "inconnu", "can_revise": False, "can_close": False, "can_review": False,
        "review_reason": "Votre approbation ne compterait pas ici. Comptes habilités : claire.m, julien.h, marc.d.",
        "can_merge": False, "merge_reason": "Rôle contributeur requis pour fusionner."}


def test_queue_includes_entity_only_seen_in_a_proposal(client, joined, as_):
    from skifer_atlas.proposals.common import open_context
    from skifer_atlas.proposals.view import _queue

    as_("claire.m")
    context = open_context("groupe-nordis")
    item = {"entity": "nouvelle-entite"}
    result = _queue(context.workspace, context.governance, context.account, [item])
    assert result == {
        "account": "claire.m", "role": "referent", "review_domains": ["finance"],
        "domains": [{"id": "finance", "label": "Finance"}, {"id": "ventes", "label": "Ventes"},
                    {"id": "supply", "label": "Supply chain"}, {"id": "marketing", "label": "Marketing"}],
        "entities": ["groupe", "nordis-de", "nordis-es", "nordis-fr", "nouvelle-entite"],
        "members": {"julien.h": "Julien H.", "claire.m": "Claire M.", "marc.d": "Marc D.",
                    "sami.b": "Sami B.", "anna.k": "Anna K.", "sofia.r": "Sofia R."},
        "items": [item]}


def test_base_missing_variant_canonical(client, joined, as_):
    from test_proposals import NORDIS_FR, edited

    from skifer_atlas.index.build import analyze
    from skifer_atlas.model.io import validate_text
    from skifer_atlas.proposals.common import open_context
    from skifer_atlas.proposals.view import _base

    as_("anna.k")
    context = open_context("groupe-nordis")
    text = edited(NORDIS_FR, "version: 4}", "version: 99}")
    document = validate_text(text).document
    with pytest.raises(RepoError) as error:
        _base(context, analyze(context.repo), {"target": {}}, document)
    assert (error.value.code, str(error.value)) == (
        "invalid_document", "Le canonique de la variante est introuvable.")


def test_recurring_undeclared_override_in_main(client, joined, as_):
    import yaml
    from test_proposals import NORDIS_FR

    from skifer_atlas.index.build import analyze
    from skifer_atlas.proposals.common import open_context
    from skifer_atlas.proposals.view import _recurring

    as_("anna.k")
    work = joined[1]
    path = work / NORDIS_FR
    variant = yaml.safe_load(path.read_text(encoding="utf-8"))
    variant["overrides"].insert(0, {
        "node": "n02", "justification": "Filtre local",
        "replace": {"id": "n02", "type": "filter", "label": "Factures locales",
                    "inputs": ["n01"], "condition": "statut:equals:validée", "nulls": "drop"}})
    path.write_text(yaml.safe_dump(variant, allow_unicode=True), encoding="utf-8")
    outdated = yaml.safe_load(yaml.safe_dump(variant))
    outdated["data_product"]["id"] = "revenu-net--aaa"
    outdated["entity"] = "aaa"
    outdated["variant_of"]["version"] = 99
    (path.parent / "aaa.yaml").write_text(yaml.safe_dump(outdated, allow_unicode=True), encoding="utf-8")
    canonical = yaml.safe_load((work / "kpis/revenu-net.yaml").read_text(encoding="utf-8"))
    canonical["data_product"]["id"] = "revenu-autre"
    (work / "kpis/revenu-autre.yaml").write_text(
        yaml.safe_dump(canonical, allow_unicode=True), encoding="utf-8")
    variant["data_product"]["id"] = "revenu-autre--nordis-es"
    variant["variant_of"]["id"] = "revenu-autre"
    variant["entity"] = "nordis-es"
    foreign = work / "variants/revenu-autre/nordis-es.yaml"
    foreign.parent.mkdir()
    foreign.write_text(yaml.safe_dump(variant, allow_unicode=True), encoding="utf-8")
    context = open_context("groupe-nordis")
    analysis = analyze(work, context.repo)
    block = {"target": {"entity": "nordis-de", "kpi_id": "revenu-net"}}
    assert _recurring(context, analysis, block, 99, [{"node": "n02", "label": "Factures validées"}]) == [
        {"node": "n02", "label": "Factures validées", "entities": ["nordis-de", "nordis-fr"]}]


@pytest.mark.parametrize("remote_head, expected", [
    ("changed", ("head_changed", "La branche a changé depuis sa lecture.")),
    ("missing", ("head_changed", "La branche a changé depuis sa lecture.")),
    ("unchanged", ("push_failed", "Échec du push.")),
])
def test_revision_push_failure_distinguishes_remote_head(client, joined, as_, monkeypatch,
                                                         remote_head, expected):
    import importlib

    revision = importlib.import_module("skifer_atlas.proposals.revise")
    as_("anna.k")
    created = propose(client, revenu_net(), 4).json()
    original = revision.run_git

    def fail_push(args, *pos, **kwargs):
        if args[0] == "push":
            raise RepoError("push_failed", "Échec du push.")
        if args[0] == "ls-remote" and remote_head != "unchanged":
            return "" if remote_head == "missing" else "f" * 40 + "\trefs/heads/changed\n"
        return original(args, *pos, **kwargs)

    monkeypatch.setattr(revision, "run_git", fail_push)
    with pytest.raises(RepoError) as error:
        revision.revise("groupe-nordis", 1, revenu_net("Révision"))
    assert (error.value.code, str(error.value)) == expected
    assert git(joined[0], "rev-parse", created["branch"]).strip() == created["head"]


def test_describe_non_atlas_pull_has_exact_metadata(client, joined, as_):
    from dataclasses import replace

    from skifer_atlas.proposals.common import open_context

    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    context = open_context("groupe-nordis")
    pull = replace(context.host.get_pull_request(1), title="Demande libre", body="Sans bloc Atlas",
                   created_at="2026-01-02T13:20:00+01:00")
    assert status.describe(context, pull) == {
        "id": 1, "title": "Demande libre", "branch": "prop/revenu-net-canonical-1",
        "author": "anna.k", "state": "open", "created_at": "2026-01-02T12:20:00Z",
        "head": pull.head, "merged_commit": None, "atlas": False}


def test_domain_referent_can_close_variant(client, joined, as_):
    from test_proposals import NORDIS_FR, edited

    as_("anna.k")
    text = edited(NORDIS_FR, "TVA française à 20 %.", "TVA française, taux normal.")
    assert propose(client, text, 2).status_code == 201
    as_("claire.m")
    items = status.list_proposals("groupe-nordis")
    assert [{key: item[key] for key in ("document_id", "kpi_id", "entity")} for item in items] == [
        {"document_id": "revenu-net--nordis-fr", "kpi_id": "revenu-net", "entity": "nordis-fr"}]
    assert status.list_proposals("groupe-nordis", entity="nordis-fr") == items
    assert status.list_proposals("groupe-nordis", entity="nordis-de") == []
    assert client.get(f"{PROPOSALS}/1").json()["viewer"] == {
        "account": "claire.m", "can_revise": False, "can_close": True, "can_review": True,
        "review_reason": None, "can_merge": False, "merge_reason": "0 validation(s) sur 1."}
    response = client.post(f"{PROPOSALS}/1/close", json={"reason": "Doublon"})
    assert response.status_code == 200
    assert response.json()["state"] == "closed"
    assert [c["body"] for c in client.get(f"{PROPOSALS}/1").json()["comments"]] == [
        "Proposition retirée : Doublon"]


def test_variant_label_uses_main_canonical_not_proposed_head(client, joined, as_):
    from skifer_atlas.proposals.common import open_context

    as_("anna.k")
    changed = revenu_net().replace("label: Revenu net", "label: Revenu modifié", 1)
    response = propose(client, changed, 4)
    assert response.status_code == 201
    assert response.json()["document_label"] == "Revenu modifié"
    context = open_context("groupe-nordis")
    target = {"kind": "variant", "kpi_id": "revenu-net"}
    assert status._label(context, target, response.json()["head"]) == "Revenu net"
    assert status._label(context, {"kind": "kpi", "id": "revenu-net",
                                   "path": "kpis/revenu-net.yaml"}, response.json()["head"]) == \
        "Revenu modifié"


def test_revision_rejects_invalid_graph_without_pushing(client, joined, as_):
    as_("anna.k")
    created = propose(client, revenu_net(), 4).json()
    invalid = revenu_net().replace("nulls: drop", "nulls: invalid", 1)
    response = client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": invalid})
    assert response.json()["detail"] == {
        "code": "invalid_document", "message": "Le document est refusé.",
        "issues": [{"path": "/graph/nodes/1/nulls", "node_id": "n02", "code": "invalid_value",
                    "message": "Valeur « invalid » non admise pour « nulls ». Valeurs admises : 'keep' ou 'drop'.",
                    "severity": "error"}]}
    assert git(joined[0], "rev-parse", created["branch"]).strip() == created["head"]


def test_new_document_graph_has_no_base_or_report(client, joined, as_):
    as_("anna.k")
    text = revenu_net().replace("id: revenu-net", "id: revenu-nouveau", 1)
    response = propose(client, text, None)
    assert response.status_code == 201, response.text
    graph = client.get(f"{PROPOSALS}/1/graphs")
    assert graph.status_code == 200, graph.text
    result = graph.json()
    assert {key: result[key] for key in ("base", "report", "undeclared", "recurring")} == {
        "base": None, "report": None, "undeclared": [], "recurring": []}
    assert result["proposed"]["label"] == "Proposition v1 (proposée)"


def test_list_status_and_for_me_override(client, joined, as_):
    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    assert client.post(f"{PROPOSALS}/1/close", json={}).status_code == 200
    assert propose(client, revenu_net("Autre proposition"), 4).status_code == 201
    as_("claire.m")
    open_items = status.list_proposals("groupe-nordis", status="open")
    closed_items = status.list_proposals("groupe-nordis", status="closed")
    assert [item["id"] for item in open_items] == [2]
    assert [item["id"] for item in closed_items] == [1]
    assert status.list_proposals("groupe-nordis", status=None) == open_items + closed_items
    assert status.list_proposals("groupe-nordis", status="closed", for_me=True) == open_items


def test_list_and_queue_fetch_contract(client, joined, as_, monkeypatch):
    from skifer_atlas.proposals import common, view

    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    original = common.run_git
    fetches = []

    def record(args, *pos, **kwargs):
        if args[0] == "fetch":
            fetches.append(args)
        return original(args, *pos, **kwargs)

    monkeypatch.setattr(common, "run_git", record)
    items = status.list_proposals("groupe-nordis", fetch=False)
    assert fetches == []
    assert status.list_proposals("groupe-nordis") == items
    assert view.queue("groupe-nordis")["items"] == items
    assert fetches == [["fetch", "--quiet", "--prune", "origin"],
                       ["fetch", "--quiet", "--prune", "origin"]]


def test_viewer_when_author_is_only_eligible_reviewer(client, joined, as_):
    import yaml
    from test_admin import ADMIN
    from test_proposals import WS
    from workspace_helpers import commit_all

    from skifer_atlas.proposals.create import create_governance_proposal

    work = joined[1]
    path = work / "governance.yaml"
    governance = yaml.safe_load(path.read_text(encoding="utf-8"))
    marc = next(member for member in governance["members"] if member["account"] == "marc.d")
    marc["roles"] = [{"role": "validateur", "domains": []}]
    path.write_text(yaml.safe_dump(governance, allow_unicode=True), encoding="utf-8")
    commit_all(work, "Validateur de l'espace")
    git(work, "push", "origin", "main")
    assert client.post(f"{WS}/sync").status_code == 200
    as_("julien.h")
    governance = client.get(ADMIN).json()["governance"]
    governance["domains"][0]["label"] = "Finance modifiée"
    created = create_governance_proposal("groupe-nordis", governance, "Mise à jour")
    assert (created["state"], created["merge_mode"], created["mention"]) == (
        "open", "no_other_eligible", "Fusionnée sans revue : aucun autre compte habilité")
    as_("anna.k")
    assert client.get(f"{PROPOSALS}/1").json()["viewer"] == {
        "account": "anna.k", "can_revise": False, "can_close": False, "can_review": False,
        "review_reason": "Votre approbation ne compterait pas ici. Comptes habilités : aucun autre compte.",
        "can_merge": True, "merge_reason": None}


def test_first_revision_has_no_preceding_proposal_difference(client, joined, as_, monkeypatch):
    as_("anna.k")
    monkeypatch.setenv("GIT_AUTHOR_DATE", "2026-11-11T14:05:00+01:00")
    monkeypatch.setenv("GIT_COMMITTER_DATE", "2026-11-11T14:05:00+01:00")
    text = revenu_net().replace("Factures validées", "Factures contrôlées", 1)
    created = propose(client, text, 4)
    assert created.status_code == 201
    assert client.get(f"{PROPOSALS}/1").json()["revisions"] == [{
        "rank": 1, "commit": created.json()["head"], "date": "2026-11-11T13:05:00Z",
        "author": "anna.k", "note": "", "differences": 0}]


def test_revision_variant_can_reference_a_tagged_older_canonical(client, joined, as_):
    import yaml
    from test_proposals import NORDIS_FR, edited

    as_("anna.k")
    original = edited(NORDIS_FR, "TVA française à 20 %.", "TVA française, taux normal.")
    assert propose(client, original, 2).status_code == 201
    revised = original.replace("version: 4}", "version: 3}", 1).replace(
        "label: déduction des taxes", "label: déduction modifiée", 1)
    response = client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revised})
    assert response.status_code == 201, response.text
    detail = client.get(f"{PROPOSALS}/1").json()
    assert detail["document_id"] == "revenu-net--nordis-fr"
    assert yaml.safe_load(detail["content"])["variant_of"] == {"id": "revenu-net", "version": 3}
    assert [r["differences"] for r in detail["revisions"]] == [0, 1]


def test_new_concept_graph_is_displayed(client, joined, as_):
    from test_proposals import edited

    as_("anna.k")
    text = edited("concepts/client-actif.yaml", "id: client-actif", "id: client-recent")
    response = propose(client, text, None)
    assert response.status_code == 201, response.text
    graphs = client.get(f"{PROPOSALS}/1/graphs")
    assert graphs.status_code == 200, graphs.text
    result = graphs.json()
    assert {key: result[key] for key in ("base", "report", "undeclared", "recurring")} == {
        "base": None, "report": None, "undeclared": [], "recurring": []}
    assert result["proposed"]["label"] == "Proposition v1 (proposée)"


def test_revision_reports_real_push_rejection(client, joined, as_):
    import importlib

    revision = importlib.import_module("skifer_atlas.proposals.revise")
    as_("anna.k")
    created = propose(client, revenu_net(), 4).json()
    hook = joined[0] / "hooks" / "pre-receive"
    hook.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
    hook.chmod(0o755)
    with pytest.raises(RepoError) as error:
        revision.revise("groupe-nordis", 1, revenu_net("Révision rejetée"))
    assert (error.value.code, str(error.value)) == (
        "push_failed", f"git push a échoué : error: failed to push some refs to '{joined[0]}'")
    assert git(joined[0], "rev-parse", created["branch"]).strip() == created["head"]


def test_describe_open_proposal_summary_contract(client, joined, as_):
    from dataclasses import replace

    from skifer_atlas.proposals.common import open_context

    as_("anna.k")
    created = propose(client, revenu_net(), 4).json()
    context = open_context("groupe-nordis")
    pull = replace(context.host.get_pull_request(1), created_at="2026-01-02T13:20:00+01:00")
    assert status.describe(context, pull) == {
        "id": 1, "title": "Revenu net v5", "branch": "prop/revenu-net-canonical-1",
        "author": "anna.k", "state": "open", "created_at": "2026-01-02T12:20:00Z",
        "head": created["head"], "merged_commit": None, "atlas": True,
        "document_id": "revenu-net", "document_kind": "kpi", "document_label": "Revenu net",
        "kpi_id": "revenu-net", "entity": None, "nature": "new_version", "domain": "finance",
        "base_version": 4, "version": 5, "approvals": {"obtained": 0, "required": 2},
        "approvers": [], "changes_requested_by": [], "ready_to_merge": False,
        "merge_mode": "reviewed", "mention": None, "explanation": "0 validation(s) sur 2.",
        "awaiting_me": False}


def test_revision_reports_errors_without_unrelated_warnings(client, joined, as_):
    from test_proposals import NORDIS_FR, edited

    as_("anna.k")
    original = edited(NORDIS_FR, "TVA française à 20 %.", "TVA française, taux normal.")
    assert propose(client, original, 2).status_code == 201
    revised = original.replace("version: 4}", "version: 3}", 1).replace("  - node: n03", "  - node: n99", 1)
    revised = revised.replace("      id: n03", "      id: n99", 1)
    response = client.post(f"{PROPOSALS}/1/revisions", json={"document_yaml": revised})
    assert response.json()["detail"] == {
        "code": "invalid_document", "message": "Le document est refusé.",
        "issues": [{"path": "/overrides/0/node", "node_id": "n99", "code": "unknown_override_target",
                    "message": "Le canonique n'a pas de nœud n99.", "severity": "error"}]}


def test_recurring_override_across_open_proposals(client, joined, as_):
    import yaml
    from test_proposals import NORDIS_FR, edited

    from skifer_atlas.proposals.common import open_context, render_body

    as_("anna.k")
    source = edited(NORDIS_FR, "TVA française à 20 %.", "TVA française, taux normal.")
    variant = yaml.safe_load(source)
    variant["overrides"].insert(0, {
        "node": "n02", "justification": "Filtre local",
        "replace": {"id": "n02", "type": "filter", "label": "Factures locales",
                    "inputs": ["n01"], "condition": "statut:equals:validée", "nulls": "drop"}})
    first = propose(client, yaml.safe_dump(variant, allow_unicode=True), 2)
    assert first.status_code == 201, first.text
    context = open_context("groupe-nordis")
    context.host.create_pull_request(first.json()["branch"], "Travail libre", "Sans bloc Atlas")
    incomplete = {"target": {"kind": "access_points", "kpi_id": "revenu-net",
                              "entity": "nordis-es"},
                  "nature": "undeclared", "diff": None}
    context.host.create_pull_request(first.json()["branch"], "Bloc édité", render_body("", incomplete))
    variant["data_product"]["id"] = "revenu-net--nordis-ca"
    variant["entity"] = "nordis-ca"
    variant["overrides"].append({"node": "semantics.timezone", "value": "Europe/Berlin",
                                 "justification": "Heure locale"})
    second = propose(client, yaml.safe_dump(variant, allow_unicode=True), None)
    assert second.status_code == 201, second.text
    graph = client.get(f"{PROPOSALS}/1/graphs")
    assert graph.status_code == 200, graph.text
    assert graph.json()["recurring"] == [{"node": "n02", "label": "Factures validées",
                                         "entities": ["nordis-ca", "nordis-de", "nordis-fr"]}]


def test_concept_without_graph_has_empty_graph_result(client, joined, as_):
    from test_proposals import edited

    as_("anna.k")
    text = edited("concepts/commande.yaml", "id: commande", "id: commande-bis")
    response = propose(client, text, None)
    assert response.status_code == 201, response.text
    assert client.get(f"{PROPOSALS}/1/graphs").json() == {
        "base": None, "proposed": None, "report": None, "undeclared": [], "recurring": []}


@pytest.mark.parametrize("reject", [False, True])
def test_revision_passes_credentials_and_lease_to_git(client, joined, as_, monkeypatch, reject):
    import importlib
    from dataclasses import replace

    from skifer_atlas.proposals.common import open_context

    revision = importlib.import_module("skifer_atlas.proposals.revise")
    as_("anna.k")
    created = propose(client, revenu_net(), 4).json()
    context = replace(open_context("groupe-nordis"), token="jeton-fictif")
    monkeypatch.setattr(revision, "open_context", lambda workspace_id: context)
    if reject:
        hook = joined[0] / "hooks" / "pre-receive"
        hook.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
        hook.chmod(0o755)
    original = revision.run_git
    calls = []

    def record(args, *pos, **kwargs):
        calls.append((args, pos, kwargs))
        return original(args, *pos, **kwargs)

    monkeypatch.setattr(revision, "run_git", record)
    if reject:
        with pytest.raises(RepoError) as error:
            revision.revise("groupe-nordis", 1, revenu_net("Révision"))
        assert (error.value.code, str(error.value)) == (
            "push_failed", f"git push a échoué : error: failed to push some refs to '{joined[0]}'")
        commit = calls[0][0][-1].split(":", 1)[0]
    else:
        result = revision.revise("groupe-nordis", 1, revenu_net("Révision"))
        commit = result["head"]
    branch = created["branch"]
    expected = [(["push", "--quiet", f'--force-with-lease=refs/heads/{branch}:{created["head"]}',
                  "origin", f"{commit}:refs/heads/{branch}"], (context.repo,),
                 {"error_code": "push_failed", "token": "jeton-fictif"})]
    if reject:
        expected.append((["ls-remote", "--heads", "origin", f"refs/heads/{branch}"],
                         (context.repo,), {"token": "jeton-fictif"}))
    assert calls == expected


def test_no_other_reviewer_mention_wins_over_canonical_mention(client, joined, as_):
    import yaml
    from test_proposals import NORDIS_FR, WS, edited
    from workspace_helpers import commit_all

    work = joined[1]
    path = work / "governance.yaml"
    governance = yaml.safe_load(path.read_text(encoding="utf-8"))
    finance = next(domain for domain in governance["domains"] if domain["id"] == "finance")
    finance["referents"] = []
    finance["validators"] = []
    for member in governance["members"]:
        for role in member.get("roles", []):
            if role.get("domains") and "finance" in role["domains"]:
                role["domains"].remove("finance")
                if not role["domains"]:
                    role["role"] = "contributeur"
    path.write_text(yaml.safe_dump(governance, allow_unicode=True), encoding="utf-8")
    commit_all(work, "Mettre à jour les validateurs")
    git(work, "push", "origin", "main")
    assert client.post(f"{WS}/sync").status_code == 200
    as_("julien.h")
    variant = yaml.safe_load(edited(NORDIS_FR, "TVA française à 20 %.", "TVA française, taux normal."))
    variant["overrides"].insert(0, {
        "node": "n02", "justification": "Filtre local",
        "replace": {"id": "n02", "type": "filter", "label": "Factures locales",
                    "inputs": ["n01"], "condition": "statut:equals:validée", "nulls": "drop"}})
    created = propose(client, yaml.safe_dump(variant, allow_unicode=True), 2)
    assert created.status_code == 201, created.text
    assert (created.json()["nature"], created.json()["merge_mode"], created.json()["mention"]) == (
        "undeclared", "no_other_eligible", "Fusionnée sans revue : aucun autre compte habilité")


def test_merged_proposal_keeps_its_branch_revision_history(client, joined, as_, monkeypatch):
    monkeypatch.setenv("GIT_AUTHOR_DATE", "2026-11-11T14:05:00+01:00")
    monkeypatch.setenv("GIT_COMMITTER_DATE", "2026-11-11T14:05:00+01:00")
    as_("anna.k")
    created = propose(client, revenu_net(), 4).json()
    revised = client.post(f"{PROPOSALS}/1/revisions", json={
        "document_yaml": revenu_net().replace("Factures validées", "Factures contrôlées", 1),
        "note": "Correction"})
    assert revised.status_code == 201
    for account in ("claire.m", "marc.d"):
        as_(account)
        assert client.post(f"{PROPOSALS}/1/reviews", json={"event": "approve"}).status_code == 200
    as_("anna.k")
    assert client.post(f"{PROPOSALS}/1/merge").status_code == 200
    assert client.get(f"{PROPOSALS}/1").json()["revisions"] == [
        {"rank": 1, "commit": created["head"], "date": "2026-11-11T13:05:00Z",
         "author": "anna.k", "note": "", "differences": 0},
        {"rank": 2, "commit": revised.json()["head"], "date": "2026-11-11T13:05:00Z",
         "author": "anna.k", "note": "Correction", "differences": 1}]


def test_closed_summary_does_not_request_reviews(client, joined, as_, monkeypatch):
    from dataclasses import replace

    from skifer_atlas.proposals.common import open_context

    as_("anna.k")
    created = propose(client, revenu_net(), 4).json()
    assert client.post(f"{PROPOSALS}/1/close", json={}).status_code == 200
    context = open_context("groupe-nordis")
    pull = replace(context.host.get_pull_request(1), created_at="2026-01-02T13:20:00+01:00")

    def unexpected_reviews(number):
        pytest.fail("Une proposition fermée ne doit pas demander ses revues pour le résumé")

    monkeypatch.setattr(context.host, "get_reviews", unexpected_reviews)
    assert status.describe(context, pull) == {
        "id": 1, "title": "Revenu net v5", "branch": "prop/revenu-net-canonical-1",
        "author": "anna.k", "state": "closed", "created_at": "2026-01-02T12:20:00Z",
        "head": created["head"], "merged_commit": None, "atlas": True,
        "document_id": "revenu-net", "document_kind": "kpi", "document_label": "Revenu net",
        "kpi_id": "revenu-net", "entity": None, "nature": "new_version", "domain": "finance",
        "base_version": 4, "version": 5}


def test_graph_reports_broken_proposed_dependencies(client, joined, as_):
    from skifer_atlas.workspaces import repo_dir

    as_("anna.k")
    assert propose(client, revenu_net(), 4).status_code == 201
    (repo_dir("groupe-nordis") / "concepts/commande.yaml").unlink()
    response = client.get(f"{PROPOSALS}/1/graphs")
    assert response.json()["detail"] == {
        "code": "invalid_document", "message": "La proposition est à corriger d'abord (atlas check).",
        "issues": [{"path": "/graph/nodes/0/concept", "node_id": "n01", "code": "unknown_concept",
                    "message": "Concept « commande » rattaché à n01 introuvable.", "severity": "error"}]}


def test_graph_reports_broken_base_dependencies(client, joined, as_):
    import yaml

    from skifer_atlas.workspaces import repo_dir

    as_("anna.k")
    raw = yaml.safe_load(revenu_net())
    del raw["graph"]["nodes"][0]["concept"]
    del raw["graph"]["nodes"][0]["binding"]
    response = propose(client, yaml.safe_dump(raw, allow_unicode=True), 4)
    assert response.status_code == 201, response.text
    (repo_dir("groupe-nordis") / "concepts/commande.yaml").unlink()
    response = client.get(f"{PROPOSALS}/1/graphs")
    assert response.json()["detail"] == {
        "code": "invalid_document", "message": "La v4 est à corriger d'abord (atlas check).",
        "issues": [{"path": "/graph/nodes/0/concept", "node_id": "n01", "code": "unknown_concept",
                    "message": "Concept « commande » rattaché à n01 introuvable.", "severity": "error"}]}


def test_graph_diff_resolves_referenced_kpi_when_nodes_are_renamed(client, joined, as_):
    from workspace_helpers import EXAMPLE

    work = joined[1]
    git(work, "tag", "doc/marge-brute/v2")
    git(work, "push", "origin", "doc/marge-brute/v2")
    as_("anna.k")
    text = (EXAMPLE / "kpis/marge-brute.yaml").read_text(encoding="utf-8")
    response = propose(client, text.replace("n01", "n11"), 2)
    assert response.status_code == 201, response.text
    graphs = client.get(f"{PROPOSALS}/1/graphs")
    assert graphs.status_code == 200, graphs.text
    report = graphs.json()["report"]
    assert {key: report[key] for key in ("identical", "relation", "pairs", "differences")} == {
        "identical": True, "relation": "version", "pairs": [], "differences": []}


def test_graph_is_empty_if_proposed_file_is_unavailable(client, joined, as_, monkeypatch):
    from skifer_atlas.proposals.common import Context

    as_("anna.k")
    created = propose(client, revenu_net(), 4).json()
    original = Context.show

    def missing_proposed(context, path, revision=None):
        if path == "kpis/revenu-net.yaml" and revision == created["head"]:
            return None
        return original(context, path, revision)

    monkeypatch.setattr(Context, "show", missing_proposed)
    assert client.get(f"{PROPOSALS}/1/graphs").json() == {
        "base": None, "proposed": None, "report": None, "undeclared": [], "recurring": []}
