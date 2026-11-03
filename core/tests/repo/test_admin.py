"""Administration de l'espace (plan 0017) : réservée aux référents d'espace, enregistrée
en proposition « Gouvernance », fusionnée aussitôt par un référent seul (ADR 0008)."""

import copy

import yaml
from test_proposals import AUTH, WS, as_, client, code, joined
from workspace_helpers import atlas_env, commit_all, git, remote

from skifer_atlas import admin
from skifer_atlas.governance.model import Governance
from skifer_atlas.governance.rules import NO_REVIEW_MENTION
from skifer_atlas.repo import RepoError

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


def test_removing_a_member_a_domain_and_giving_several_roles(client, joined, as_):
    """Plan 0023 : retirer un membre (et ses mentions dans les domaines), retirer un domaine
    sans document, donner plusieurs rôles à un membre."""
    bare, _ = joined
    as_("julien.h")
    state = client.get(ADMIN).json()

    def change(governance):
        governance["domains"] = [d for d in governance["domains"] if d["id"] != "marketing"]
        finance = governance["domains"][0]
        finance["validators"] = [a for a in finance["validators"] if a != "marc.d"]
        ventes = governance["domains"][1]
        ventes["referents"], ventes["validators"] = ["anna.k"], ["anna.k"]
        governance["members"] = [m for m in governance["members"] if m["account"] != "marc.d"]
        anna = next(m for m in governance["members"] if m["account"] == "anna.k")
        anna["roles"] = [{"role": "contributeur", "domains": []},
                         {"role": "referent", "domains": ["ventes"]}]

    response = save(client, state, change)
    assert response.status_code == 201, response.text
    assert response.json()["changes"] == [
        "Validateurs de « Finance » : Claire M.",
        "Référents de « Ventes » : Anna K.",
        "Validateurs de « Ventes » : Anna K.",
        "Domaine « Marketing » retiré.",
        "Anna K. (anna.k) : contributeur, referent (ventes), entité nordis-de.",
        "Marc D. (marc.d) retiré."]
    merged = main_governance(bare)
    assert [d["id"] for d in merged["domains"]] == ["finance", "ventes", "supply"]
    assert "marc.d" not in [m["account"] for m in merged["members"]]
    assert next(m for m in merged["members"] if m["account"] == "anna.k")["roles"][1] == {
        "role": "referent", "domains": ["ventes"]}


def test_a_domain_that_still_has_documents_cannot_be_removed(client, joined, as_):
    as_("julien.h")
    state = client.get(ADMIN).json()

    def change(governance):
        governance["domains"] = [d for d in governance["domains"] if d["id"] != "supply"]
        sami = next(m for m in governance["members"] if m["account"] == "sami.b")
        sami["roles"] = [{"role": "lecteur", "domains": []}]

    response = save(client, state, change)
    assert code(response) == (422, "domain_in_use")
    assert "« Supply chain » (1 document)" in response.json()["detail"]["message"]


def test_a_domain_is_not_removed_when_the_index_cannot_count_its_documents(
        client, joined, as_, monkeypatch):
    """Faute d'index, le retrait d'un domaine est refusé au lieu
    de passer sans contrôle ; une modification qui ne retire aucun domaine passe."""
    as_("julien.h")
    state = client.get(ADMIN).json()

    def unavailable(*args):
        raise RepoError("index_busy", "L'index de l'espace est en cours de reconstruction.")

    def broken(*args):
        raise OSError("disque illisible")

    def invalid(*args):
        raise RepoError("invalid_document", "index invalide")

    def remove_marketing(governance):
        governance["domains"] = [d for d in governance["domains"] if d["id"] != "marketing"]

    monkeypatch.setattr(admin, "ensure_index", unavailable)
    assert code(save(client, state, remove_marketing)) == (503, "index_busy")  # réessayer
    monkeypatch.setattr(admin, "ensure_index", invalid)
    assert code(save(client, state, remove_marketing)) == (503, "index_unavailable")
    monkeypatch.setattr(admin, "ensure_index", broken)
    assert code(save(client, state, remove_marketing)) == (503, "index_unavailable")
    kept = save(client, state, lambda g: g.update(allowed_platforms=["databricks"]))
    assert kept.status_code == 201, kept.text


def test_a_reader_role_next_to_other_roles_is_dropped(client, joined, as_):
    """Le rôle lecteur est compris dans les autres : à côté d'eux, il n'est pas enregistré.
    Un rôle identique en double ne l'est qu'une fois (#88)."""
    bare, _ = joined
    as_("julien.h")
    state = client.get(ADMIN).json()

    def change(governance):
        anna = next(m for m in governance["members"] if m["account"] == "anna.k")
        anna["roles"] = [{"role": "lecteur", "domains": []},
                         {"role": "referent", "domains": ["ventes"]},
                         {"role": "referent", "domains": ["ventes"]}]
        sami = next(m for m in governance["members"] if m["account"] == "sami.b")
        sami["roles"] = [{"role": "lecteur", "domains": []}] * 2

    response = save(client, state, change)
    assert response.status_code == 201, response.text
    assert "Anna K. (anna.k) : referent (ventes), entité nordis-de." in response.json()[
        "changes"]
    members = {m["account"]: m for m in main_governance(bare)["members"]}
    assert members["anna.k"]["roles"] == [{"role": "referent", "domains": ["ventes"]}]
    assert members["sami.b"]["roles"] == [{"role": "lecteur", "domains": []}]


def test_a_name_ending_with_a_period_ends_the_sentence(client, joined, as_):
    """Un nom abrégé termine la phrase ; seul le point ajouté est retiré, si bien que des
    points de suspension restent entiers (#42)."""
    as_("julien.h")
    governance = client.get(ADMIN).json()["governance"]
    for name, sentence in (("Claire M.", "Validateurs de « Finance » : Claire M."),
                           ("Claire...", "Validateurs de « Finance » : Claire...")):
        old = copy.deepcopy(governance)
        next(m for m in old["members"] if m["account"] == "claire.m")["name"] = name
        new = copy.deepcopy(old)
        new["domains"][0]["validators"] = ["claire.m"]
        assert admin.describe_changes(Governance.model_validate(old),
                                      Governance.model_validate(new)) == [sentence]


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
