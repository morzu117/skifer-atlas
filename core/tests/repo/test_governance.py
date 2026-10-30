"""Gouvernance : schéma, règles de décompte (ADR 0008 comprise), CODEOWNERS."""

import copy

import pytest
import yaml
from workspace_helpers import EXAMPLE

from skifer_atlas.governance.codeowners import OwnedDocument, generate, has_drifted
from skifer_atlas.governance.model import (
    account_from_name,
    domain_approvers,
    member_domains,
    role_of,
    space_referents,
    validate_governance,
)
from skifer_atlas.governance.rules import (
    CANONICAL_MENTION,
    NO_REVIEW_MENTION,
    Review,
    decide,
    requirement,
)

RAW = yaml.safe_load((EXAMPLE / "governance.yaml").read_text(encoding="utf-8"))
HEAD = "c0ffee"


def governance(raw=None):
    found, issues = validate_governance(copy.deepcopy(raw or RAW))
    assert found is not None, issues
    return found


def codes(raw):
    return [i.code for i in validate_governance(raw)[1]]


def approve(account, commit=HEAD):
    return Review(account, "approved", commit)


# --- schéma et cohérence (critère 10) -----------------------------------------------------

def test_demo_governance_is_valid_with_a_warning():
    found, issues = validate_governance(RAW)
    assert found is not None
    assert [(i.code, i.severity) for i in issues] == [("domain_without_referent", "warning")]
    assert "Marketing" in issues[0].message


def test_a_governance_without_referent_is_refused():
    raw = copy.deepcopy(RAW)
    raw["members"][0]["roles"] = [{"role": "contributeur"}]
    assert "no_referent" in codes(raw)
    assert validate_governance(raw)[0] is None


@pytest.mark.parametrize(("change", "code"), [
    (lambda r: r["domains"][0]["validators"].append("inconnu"), "unknown_member"),
    (lambda r: r["members"][2]["roles"][0]["domains"].append("rh"), "unknown_domain"),
    (lambda r: r["members"].append(copy.deepcopy(r["members"][0])), "duplicate_member"),
    (lambda r: r["domains"].append(copy.deepcopy(r["domains"][0])), "duplicate_domain"),
])
def test_consistency_errors(change, code):
    raw = copy.deepcopy(RAW)
    change(raw)
    assert code in codes(raw)


@pytest.mark.parametrize("change", [
    lambda r: r["validators_required"].update(canonical=0),
    lambda r: r["members"][0]["roles"][0].update(role="administrateur"),
    lambda r: r.update(allowed_platforms=["oracle"]),
    lambda r: r.update(inconnu=True),
])
def test_schema_errors(change):
    raw = copy.deepcopy(RAW)
    change(raw)
    assert validate_governance(raw)[0] is None


def test_roles():
    found = governance()
    assert space_referents(found) == {"julien.h"}
    # marc.d est validateur par son rôle, référent de « ventes » par la liste du domaine
    assert [role_of(found, a) for a in ("julien.h", "claire.m", "marc.d", "anna.k", "visiteur")] \
        == ["referent", "referent", "referent", "contributeur", "lecteur"]
    assert domain_approvers(found, "finance") == {"julien.h", "claire.m", "marc.d"}
    assert domain_approvers(found, "supply") == {"julien.h", "sami.b"}
    assert member_domains(found, "marc.d") == {"finance", "ventes"}
    assert member_domains(found, "julien.h") == {"finance", "ventes", "supply", "marketing"}
    assert account_from_name("Julien H.") == "julien-h"


# --- nombre de validations requises (critère 1) -------------------------------------------

@pytest.mark.parametrize(("nature", "domain", "required", "mention"), [
    ("new_version", "finance", 2, None),
    ("declared_point", "finance", 1, None),
    ("undeclared", "finance", 2, CANONICAL_MENTION),
    ("from_scratch", "finance", 2, CANONICAL_MENTION),
    ("new_version", "supply", 1, None),  # surcharge du domaine
    ("governance", None, 1, None),
])
def test_requirement(nature, domain, required, mention):
    need = requirement(governance(), nature, domain)
    assert (need.required, need.mention) == (required, mention)


# --- décompte (critères 2 et 3) -----------------------------------------------------------

def test_only_eligible_approvals_on_the_head_count():
    found = governance()
    reviews = [approve("claire.m"),             # auteur : ne compte pas
               approve("anna.k"),               # contributeur
               approve("sami.b"),               # validateur d'un autre domaine
               approve("marc.d", "ancien")]     # sur un commit dépassé
    decision = decide(found, "new_version", "finance", "claire.m", reviews, HEAD)
    assert (decision.obtained, decision.required, decision.ready_to_merge) == (0, 2, False)
    reviews += [approve("marc.d"), approve("julien.h")]
    decision = decide(found, "new_version", "finance", "claire.m", reviews, HEAD)
    assert (decision.obtained, decision.ready_to_merge, decision.merge_mode) == (
        2, True, "reviewed")
    assert decision.approvers == ["julien.h", "marc.d"]


def test_a_new_commit_resets_the_count():
    reviews = [approve("marc.d"), approve("julien.h")]
    decision = decide(governance(), "new_version", "finance", "claire.m", reviews, "nouveau")
    assert (decision.obtained, decision.ready_to_merge) == (0, False)


def test_changes_requested_block_until_reapproved():
    found = governance()
    reviews = [approve("marc.d"), approve("julien.h"),
               Review("marc.d", "changes_requested", HEAD)]
    decision = decide(found, "new_version", "finance", "claire.m", reviews, HEAD)
    assert not decision.ready_to_merge and decision.changes_requested_by == ["marc.d"]
    decision = decide(found, "new_version", "finance", "claire.m", [*reviews, approve("marc.d")],
                      HEAD)
    assert decision.ready_to_merge


# --- ADR 0008 : personne d'autre n'est habilité --------------------------------------------

def test_single_referent_merges_governance_without_review():
    decision = decide(governance(), "governance", None, "julien.h", [], HEAD)
    assert (decision.ready_to_merge, decision.merge_mode, decision.mention) == (
        True, "no_other_eligible", NO_REVIEW_MENTION)
    other = decide(governance(), "governance", None, "claire.m", [], HEAD)
    assert (other.ready_to_merge, other.merge_mode) == (False, "reviewed")


def test_the_required_count_is_never_lowered():
    raw = copy.deepcopy(RAW)
    raw["domains"][2]["validators_required"] = {"canonical": 2, "variants": 1}
    raw["domains"][2]["validators"] = ["sami.b"]
    raw["members"][0]["roles"] = [{"role": "referent", "domains": ["finance"]}]
    raw["members"][1]["roles"] = [{"role": "referent"}]
    found = governance(raw)
    # supply : sami.b et claire.m (référente d'espace) ; sami.b est l'auteur
    decision = decide(found, "new_version", "supply", "sami.b", [approve("claire.m")], HEAD)
    assert (decision.obtained, decision.required, decision.ready_to_merge) == (1, 2, False)
    assert "1 seul(s) autre(s) compte(s) habilité(s)" in decision.explanation


def test_solo_workspace_documents():
    raw = {"members": [{"account": "solo", "name": "Solo", "roles": [{"role": "referent"}]}],
           "domains": [{"id": "finance", "label": "Finance"}]}
    decision = decide(governance(raw), "new_version", "finance", "solo", [], HEAD)
    assert (decision.ready_to_merge, decision.merge_mode) == (True, "no_other_eligible")


# --- CODEOWNERS ---------------------------------------------------------------------------

DOCUMENTS = [OwnedDocument("kpis/revenu-net.yaml", "kpi", "finance"),
             OwnedDocument("concepts/commande.yaml", "concept", "ventes"),
             OwnedDocument("kpis/sans-domaine.yaml", "kpi", None)]


def test_codeowners_is_deterministic_and_ordered():
    text = generate(governance(), DOCUMENTS)
    assert text == generate(governance(), list(reversed(DOCUMENTS)))
    lines = [line for line in text.splitlines() if line and not line.startswith("#")]
    assert lines[0].startswith("/concepts/ @claire.m @julien.h @marc.d @sami.b")
    assert "/kpis/revenu-net.yaml @claire.m @julien.h @marc.d" in lines
    assert "/variants/revenu-net/ @claire.m @julien.h @marc.d" in lines
    assert "/concepts/commande.yaml @julien.h @marc.d" in lines
    assert lines[-3:] == ["/governance.yaml @julien.h", "/access_points.yaml @julien.h",
                          "/.github/CODEOWNERS @julien.h"]


def test_codeowners_drift():
    text = generate(governance(), DOCUMENTS)
    assert not has_drifted(text)
    assert has_drifted(text.replace("@marc.d", "@intrus"))
    assert has_drifted("/kpis/ @quelqu-un\n")
