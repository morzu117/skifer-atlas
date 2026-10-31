"""Administration de l'espace (plan 0017) : réservée aux référents d'espace, enregistrée
en proposition « Gouvernance », fusionnée aussitôt par un référent seul (ADR 0008)."""

import copy

import yaml
from test_proposals import AUTH, WS, as_, client, code, joined
from workspace_helpers import atlas_env, commit_all, git, remote

from skifer_atlas.governance.rules import NO_REVIEW_MENTION

__all__ = ["as_", "atlas_env", "client", "joined", "remote"]  # fixtures importées

ADMIN = f"{WS}/admin"


def save(client, state, change):
    governance = copy.deepcopy(state["governance"])
    change(governance)
    return client.post(f"{ADMIN}/governance", json={"governance": governance,
                                                    "base_digest": state["base_digest"]})


def main_governance(bare):
    return yaml.safe_load(git(bare, "show", "main:governance.yaml"))


def test_admin_is_for_space_referents_only(client, joined, as_):
    """Critère 1 : un référent de domaine, un contributeur ou un inconnu reçoivent 403."""
    as_("julien.h")
    state = client.get(ADMIN).json()
    listed = {w["id"]: w for w in client.get("/api/workspaces").json()}
    assert listed["groupe-nordis"]["space_referent"] is True
    for account in ("claire.m", "anna.k", "inconnu.z"):
        as_(account)
        assert code(client.get(ADMIN)) == (403, "forbidden"), account
        assert code(save(client, state, lambda g: g.update(allowed_platforms=[]))) == (
            403, "forbidden")


def test_state_lists_what_the_screen_shows_and_no_secret(client, joined, as_):
    as_("julien.h")
    state = client.get(ADMIN).json()
    assert [d["label"] for d in state["governance"]["domains"]] == [
        "Finance", "Ventes", "Supply chain", "Marketing"]
    assert state["warnings"] == ["Marketing"]  # domaine sans référent (critère 2)
    assert (state["space_referents"], state["single_referent"]) == (["julien.h"], True)
    assert state["kpi_counts"]["finance"] >= 1
    assert [(p["id"], p["auth"]) for p in state["platforms"]] == [
        ("databricks", "OAuth · token personnel"), ("snowflake", "SSO · paire de clés"),
        ("bigquery", "OAuth Google"), ("fabric", "Entra ID"), ("redshift", "IAM")]
    repository = state["repository"]
    assert repository["url"] == str(joined[0])
    assert repository["main_branch"] == "main"
    assert repository["synced_at"]
    # Critère 6 : aucune clé de jeton ; « token » n'apparaît que dans les modes d'auth.
    keys = yaml.safe_dump(state).lower().replace("token personnel", "")
    assert "token" not in keys and "secret" not in keys


def test_single_referent_saves_and_merges_with_the_mention(client, joined, as_):
    """Critères 2, 4, 5 et 8 : domaine sans référent, renommage par le libellé seul,
    diff limité à governance.yaml et CODEOWNERS, fusion sans revue."""
    bare, _ = joined
    as_("julien.h")
    state = client.get(ADMIN).json()
    before = git(bare, "rev-parse", "main").strip()

    def change(governance):
        governance["domains"][2]["label"] = "Supply"
        governance["domains"].append({"id": "data", "label": "Data", "referents": [],
                                      "validators": [], "validators_required": None})
        governance["validators_required"]["canonical"] = 3

    response = save(client, state, change)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert (saved["merged"], saved["mention"]) == (True, NO_REVIEW_MENTION)
    assert saved["changes"] == [
        "Validateurs requis : canonique 2 · déclinaisons 1 → canonique 3 · déclinaisons 1.",
        "Domaine « Supply chain » renommé « Supply ».",
        "Domaine « Data » ajouté."]
    assert git(bare, "diff", "--name-only", before, "main").split() == [
        ".github/CODEOWNERS", "governance.yaml"]
    body = git(bare, "log", "-1", "--format=%B", "main")
    assert "Domaine « Data » ajouté." in body
    assert "Atlas-Review: none (no other eligible approver)" in body

    merged = main_governance(bare)
    assert [d["id"] for d in merged["domains"]] == ["finance", "ventes", "supply", "marketing",
                                                    "data"]
    assert merged["domains"][2]["label"] == "Supply"
    assert merged["validators_required"]["canonical"] == 3
    after = client.get(ADMIN).json()
    assert after["warnings"] == ["Marketing", "Data"]
    assert code(save(client, state, lambda g: None)) == (409, "stale_base")
    assert code(save(client, after, lambda g: None)) == (422, "no_change")


def test_zero_validators_is_refused(client, joined, as_):
    """Critère 3 : minimum 1, sur l'espace comme sur un domaine."""
    bare, _ = joined
    as_("julien.h")
    state = client.get(ADMIN).json()
    refused = save(client, state, lambda g: g["validators_required"].update(variants=0))
    assert code(refused) == (422, "invalid_governance")
    override = save(client, state, lambda g: g["domains"][0].update(
        validators_required={"canonical": 0, "variants": 1}))
    assert code(override) == (422, "invalid_governance")
    assert git(bare, "branch", "--list", "prop/*").split() == []


def test_second_referent_ends_merging_alone(client, joined, as_):
    """Critère 8 : après l'ajout d'un deuxième référent, l'enregistrement attend une revue."""
    bare, _ = joined
    as_("julien.h")
    state = client.get(ADMIN).json()
    promoted = save(client, state, lambda g: g["members"][1].update(
        roles=[{"role": "referent", "domains": []}]))
    assert promoted.json()["merged"] is True
    state = client.get(ADMIN).json()
    assert (state["space_referents"], state["single_referent"]) == (
        ["claire.m", "julien.h"], False)

    pending = save(client, state, lambda g: g.update(allowed_platforms=["databricks"])).json()
    assert (pending["merged"], pending["ready_to_merge"], pending["mention"]) == (
        False, False, None)
    assert main_governance(bare)["allowed_platforms"] == ["databricks", "snowflake"]
    as_("claire.m")
    assert client.get(ADMIN).status_code == 200


def test_sync_updates_the_date_and_reindexes(client, joined, as_):
    """Critère 7."""
    _, work = joined
    as_("julien.h")
    first = client.get(ADMIN).json()["repository"]["synced_at"]
    path = work / "kpis" / "revenu-net.yaml"
    path.write_text(path.read_text(encoding="utf-8").replace(
        "label: Revenu net", "label: Revenu net consolidé", 1), encoding="utf-8")
    commit_all(work, "Libellé")
    git(work, "push", "--quiet", "origin", "main")

    synced = client.post(f"{WS}/sync").json()
    assert (synced["status"], synced["reindexed"]) == ("fast_forward", True)
    assert synced["synced_at"] >= first
    repository = client.get(ADMIN).json()["repository"]
    assert (repository["synced_at"], repository["index_fresh"]) == (synced["synced_at"], True)
    labels = [k["label"] for k in client.get(f"{WS}/catalog?q=consolidé").json()]
    assert labels == ["Revenu net consolidé"]
    assert client.post(f"{WS}/sync").json()["reindexed"] is False


def test_api_requires_the_session_token(client, joined):
    assert client.get(ADMIN, headers={**AUTH, "Authorization": "Bearer faux"}).status_code == 401
