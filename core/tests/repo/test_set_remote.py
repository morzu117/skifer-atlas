"""Rattacher un espace neuf à un dépôt distant vide (plan 0033, ADR 0037).

Les dépôts « distants » sont des dépôts nus locaux. Pour GitHub, un faux serveur répond à
l'API (`/user`, `/repos/…`) et `url.<dépôts>.insteadOf` redirige les adresses
`https://github.com/…` vers des dépôts nus : git pousse et lit pour de vrai, sans réseau.
"""

import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import yaml
from fastapi.testclient import TestClient
from workspace_helpers import USER, atlas_env, commit_all, git

from skifer_atlas.api.app import create_app
from skifer_atlas.governance.model import (
    Domain,
    Governance,
    Member,
    MemberRole,
    initial_governance,
    rename_account,
    role_of,
)
from skifer_atlas.proposals.common import open_context
from skifer_atlas.repo import RepoError
from skifer_atlas.repo import sync as repo_sync
from skifer_atlas.repo.layout import WorkspaceMeta
from skifer_atlas.repo.sync import create_workspace, set_remote
from skifer_atlas.vault import GITHUB_ENTRY, Credential, Vault
from skifer_atlas.vault.keyring_vault import _memory
from skifer_atlas.workspaces import get_workspace, repo_dir

__all__ = ["atlas_env"]  # fixture importée

AUTH = {"Authorization": "Bearer secret"}
TOKEN = "gho_jeton-de-rattachement"
META = WorkspaceMeta(id="maison-perrault", name="Maison Perrault", sector="Luxe",
                     entities=["perrault-fr"])


class FakeGitHub(BaseHTTPRequestHandler):
    """`/user` et `/repos/<propriétaire>/<dépôt>` ; les dépôts viennent de `state`."""

    state: dict

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.state["calls"].append(self.path)
        if self.headers["Authorization"] != f"Bearer {TOKEN}":
            return self._send(401, {"message": "Bad credentials"})
        if self.path == "/user":
            return self._send(200, {"login": self.state["login"]})
        found = self.state["repos"].get(self.path.removeprefix("/repos/"))
        return self._send(200, found) if found else self._send(404, {"message": "Not Found"})

    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def github(atlas_env, tmp_path, monkeypatch):
    """Faux GitHub (connecté en `claire-m`), jeton dans l'environnement, adresses
    `https://github.com/nordis/<nom>.git` redirigées vers `tmp_path/github/<nom>.git`."""
    state = {"login": "claire-m", "repos": {}, "calls": []}
    handler = type("Handler", (FakeGitHub,), {"state": state})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    folder = tmp_path / "github"
    folder.mkdir()
    count = int(os.environ["GIT_CONFIG_COUNT"])
    monkeypatch.setenv(f"GIT_CONFIG_KEY_{count}", f"url.{folder}/.insteadOf")
    monkeypatch.setenv(f"GIT_CONFIG_VALUE_{count}", "https://github.com/nordis/")
    monkeypatch.setenv("GIT_CONFIG_COUNT", str(count + 1))
    monkeypatch.setenv("ATLAS_GITHUB_API_URL", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setenv("ATLAS_GITHUB_TOKEN", TOKEN)
    monkeypatch.setenv("ATLAS_VAULT", "memory")
    monkeypatch.setenv("ATLAS_ACCOUNT", "anna-k")  # l'identité locale du créateur
    _memory._items.clear()

    def repository(name, *, push=True, archived=False, empty=True):
        bare = folder / f"{name}.git"
        git(folder, "init", "--bare", "--quiet", "--initial-branch=main", str(bare))
        state["repos"][f"nordis/{name}"] = {
            "permissions": {"push": push, "pull": True}, "archived": archived}
        if not empty:
            seed(bare, folder / f"{name}-graine")
        return f"https://github.com/nordis/{name}.git", bare

    state["repository"] = repository
    yield state
    server.shutdown()
    server.server_close()
    _memory._items.clear()


def seed(bare, work):
    """Un premier commit dans le dépôt nu : il n'est plus vide."""
    work.mkdir()
    git(work, "init", "--quiet", "--initial-branch=main")
    (work / "README.md").write_text("Déjà un dépôt.\n", encoding="utf-8")
    commit_all(work, "Premier commit")
    git(work, "push", "--quiet", str(bare), "main")


def bare_repository(tmp_path, name="distant.git"):
    bare = tmp_path / name
    git(tmp_path, "init", "--bare", "--quiet", "--initial-branch=main", str(bare))
    return bare


def workspace_state(workspace_id="maison-perrault"):
    """Ce que le clone et le registre portent : rien ne doit avoir bougé après un refus."""
    repo = repo_dir(workspace_id)
    return {"remotes": git(repo, "remote").split(), "head": git(repo, "rev-parse", "HEAD").strip(),
            "status": git(repo, "status", "--porcelain"),
            "registry": get_workspace(workspace_id).model_dump()}


# --- succès -------------------------------------------------------------------------------

def test_attaches_an_empty_repository_and_pushes(atlas_env, tmp_path):
    """Critère 1 : l'historique part sur le dépôt vide, la branche suit `origin`."""
    create_workspace(META)
    bare = bare_repository(tmp_path)
    attached = set_remote(META.id, str(bare))
    assert (attached.git_remote, attached.account, attached.role) == (str(bare), USER, "referent")
    repo = repo_dir(META.id)
    assert git(repo, "remote", "get-url", "origin").strip() == str(bare)
    assert git(repo, "rev-parse", "main").strip() == git(bare, "rev-parse", "main").strip()
    assert git(repo, "rev-parse", "--abbrev-ref", "main@{upstream}").strip() == "origin/main"
    assert git(bare, "log", "--format=%s", "main").splitlines() == [
        "Création de l'espace Maison Perrault"]  # même compte : aucun commit de plus
    assert git(repo, "status", "--porcelain") == ""
    assert get_workspace(META.id).git_remote == str(bare)
    context = open_context(META.id)  # la suite (gouvernance, propositions) fonctionne
    assert (context.account, context.role()) == (USER, "referent")


def test_the_route_attaches_and_describes_the_workspace(atlas_env, tmp_path):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    client = TestClient(create_app(token="secret"), headers=AUTH)
    answer = client.post(f"/api/workspaces/{META.id}/remote", json={"remote_url": str(bare)})
    assert answer.status_code == 200, answer.text
    assert answer.json()["git_remote"] == str(bare)
    assert (answer.json()["role"], answer.json()["role_label"], answer.json()["space_referent"]) \
        == ("referent", "Référent d'annuaire", True)
    assert TestClient(create_app(token="secret")).post(
        f"/api/workspaces/{META.id}/remote", json={"remote_url": str(bare)}).status_code == 401


# --- refus : rien ne reste ----------------------------------------------------------------

@pytest.mark.parametrize("seeded", ["main", "autre-branche", "tag"])
def test_refuses_a_repository_that_is_not_empty(atlas_env, tmp_path, seeded):
    """Critère 2 : dépôt avec commits, avec une autre branche ou avec un simple tag."""
    create_workspace(META)
    bare = bare_repository(tmp_path)
    work = tmp_path / "graine"
    seed(bare, work)
    if seeded == "autre-branche":
        git(bare, "branch", "-m", "main", "master")
    if seeded == "tag":
        git(work, "push", "--quiet", str(bare), "main:refs/tags/v1")
        git(bare, "update-ref", "-d", "refs/heads/main")
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, str(bare))
    assert error.value.code == "remote_not_empty"
    assert "vierge" in error.value.message
    assert workspace_state() == before and before["remotes"] == []


def test_a_missing_repository_is_not_found(atlas_env, tmp_path):
    create_workspace(META)
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, str(tmp_path / "absent.git"))
    assert error.value.code == "remote_not_found"
    assert str(tmp_path) not in error.value.message  # pas de chemin local ni de sortie de git
    assert workspace_state() == before


@pytest.mark.parametrize(("url", "code"), [
    ("pas une adresse", "invalid_remote"),
    ("--upload-pack=touch /tmp/x", "invalid_remote"),
    ("http://github.com/nordis/annuaire.git", "invalid_remote"),
    ("https://jeton@github.com/nordis/annuaire.git", "credentials_in_url"),
    ("https://gitlab.com/nordis/annuaire.git", "unsupported_host"),
])
def test_refuses_an_invalid_or_unsupported_address(atlas_env, url, code):
    create_workspace(META)
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, url)
    assert error.value.code == code
    assert workspace_state() == before


def test_refuses_a_second_attachment(atlas_env, tmp_path):
    create_workspace(META)
    first = bare_repository(tmp_path, "premier.git")
    set_remote(META.id, str(first))
    other = bare_repository(tmp_path, "second.git")
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, str(other))
    assert error.value.code == "remote_exists"
    assert workspace_state() == before
    assert git(other, "for-each-ref").strip() == ""  # le second dépôt n'a rien reçu
    client = TestClient(create_app(token="secret"), headers=AUTH)
    answer = client.post(f"/api/workspaces/{META.id}/remote", json={"remote_url": str(other)})
    assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "remote_exists")


def test_an_unknown_workspace_is_not_found(atlas_env, tmp_path):
    client = TestClient(create_app(token="secret"), headers=AUTH)
    answer = client.post("/api/workspaces/absent/remote", json={"remote_url": str(tmp_path)})
    assert answer.status_code == 404


def test_a_push_that_the_host_refuses_leaves_nothing_behind(atlas_env, tmp_path):
    """Un crochet de pré-réception refuse la poussée : `origin` est retiré, l'erreur dit
    que la poussée a échoué."""
    create_workspace(META)
    bare = bare_repository(tmp_path)
    hook = bare / "hooks" / "pre-receive"
    hook.write_text("#!/bin/sh\necho 'refus de test' >&2\nexit 1\n")
    hook.chmod(0o755)
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, str(bare))
    assert error.value.code == "push_failed"
    assert workspace_state() == before


def test_a_repository_filled_between_the_check_and_the_push_is_not_overwritten(
        atlas_env, tmp_path, monkeypatch):
    """La course : le dépôt reçoit un commit après la vérification. La poussée est refusée
    (non fast-forward), `origin` retiré, et le dépôt garde son historique."""
    create_workspace(META)
    bare = bare_repository(tmp_path)

    def fill_then_pass(url, token):
        seed(bare, tmp_path / "graine")

    monkeypatch.setattr(repo_sync, "_require_empty", fill_then_pass)
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, str(bare))
    assert error.value.code == "remote_not_empty"
    assert workspace_state() == before
    assert git(bare, "log", "--format=%s", "main").splitlines() == ["Premier commit"]


# --- GitHub : jeton, droits, identité -----------------------------------------------------

def test_a_github_repository_needs_a_connection(github):
    create_workspace(META)
    url, bare = github["repository"]("vide")
    os.environ.pop("ATLAS_GITHUB_TOKEN")
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, url)
    assert error.value.code == "host_auth_failed"
    assert workspace_state() == before and github["calls"] == []
    assert git(bare, "for-each-ref").strip() == ""


def test_a_refused_token_is_reported_as_an_authentication_failure(github):
    create_workspace(META)
    url, _ = github["repository"]("vide")
    Vault().put(META.id, GITHUB_ENTRY, Credential(kind="github", access_token="gho_refuse"))
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, url)
    assert error.value.code == "host_auth_failed"
    assert workspace_state() == before


@pytest.mark.parametrize(("name", "options", "code"), [
    ("inconnu", None, "remote_not_found"),
    ("lecture", {"push": False}, "remote_not_writable"),
    ("archive", {"archived": True}, "remote_not_writable"),
])
def test_github_says_why_the_repository_does_not_fit(github, name, options, code):
    create_workspace(META)
    if options is None:
        url = f"https://github.com/nordis/{name}.git"
    else:
        url, _ = github["repository"](name, **options)
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, url)
    assert error.value.code == code
    assert TOKEN not in error.value.message
    assert workspace_state() == before


def test_github_repository_with_content_is_refused(github):
    create_workspace(META)
    url, _ = github["repository"]("plein", empty=False)
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, url)
    assert error.value.code == "remote_not_empty"
    assert workspace_state() == before


def test_the_creator_keeps_the_referent_role_under_the_github_identity(github):
    """Critère 3 : inscrit sous `anna-k`, le créateur est `claire-m` pour GitHub. Sans
    réécriture il deviendrait lecteur et ne pourrait plus enregistrer la gouvernance."""
    created = create_workspace(META)
    assert (created.account, created.role) == ("anna-k", "referent")
    url, bare = github["repository"]("vide")
    attached = set_remote(META.id, url)
    assert (attached.account, attached.role, attached.git_remote) == (
        "claire-m", "referent", url)
    repo = repo_dir(META.id)
    published = yaml.safe_load(git(bare, "show", "main:governance.yaml"))
    assert [(m["account"], m["roles"]) for m in published["members"]] == [
        ("claire-m", [{"role": "referent", "domains": []}])]
    assert published["members"][0]["name"] == USER  # le nom affiché ne change pas
    commits = git(bare, "log", "--format=%s", "main").splitlines()
    assert commits == ["Identité du créateur : anna-k devient claire-m",
                       "Création de l'espace Maison Perrault"]
    assert git(repo, "rev-parse", "main").strip() == git(bare, "rev-parse", "main").strip()
    assert git(repo, "rev-parse", "origin/main").strip() == git(bare, "rev-parse", "main").strip()
    assert git(repo, "status", "--porcelain") == ""
    assert yaml.safe_load((repo / "governance.yaml").read_text(encoding="utf-8")) == published
    context = open_context(META.id)  # lit la gouvernance publiée avec l'identité de GitHub
    assert (context.account, context.role()) == ("claire-m", "referent")
    assert get_workspace(META.id).role == "referent"


def test_the_identity_is_rewritten_when_the_token_comes_from_the_vault(github):
    create_workspace(META)
    os.environ.pop("ATLAS_GITHUB_TOKEN")
    Vault().put(META.id, GITHUB_ENTRY, Credential(kind="github", access_token=TOKEN))
    url, _ = github["repository"]("vide")
    assert set_remote(META.id, url).account == "claire-m"


def test_a_refused_push_does_not_rewrite_the_creator_locally(github):
    """Le commit d'identité n'est appliqué qu'une fois la poussée réussie."""
    create_workspace(META)
    url, bare = github["repository"]("vide")
    hook = bare / "hooks" / "pre-receive"
    hook.write_text("#!/bin/sh\nexit 1\n")
    hook.chmod(0o755)
    repo = repo_dir(META.id)
    governance = (repo / "governance.yaml").read_text(encoding="utf-8")
    before = workspace_state()
    with pytest.raises(RepoError):
        set_remote(META.id, url)
    assert workspace_state() == before
    assert (repo / "governance.yaml").read_text(encoding="utf-8") == governance
    assert "anna-k" in governance
    assert get_workspace(META.id).role == "referent"  # toujours référent localement


def test_unsaved_changes_to_the_governance_are_refused_before_any_remote_write(github):
    """L'avance rapide qui suit le push réécrirait `governance.yaml` : sale, elle échouerait
    après la publication. Le refus vient donc avant le push, et le dépôt reste vide."""
    create_workspace(META)
    url, bare = github["repository"]("vide")
    repo = repo_dir(META.id)
    path = repo / "governance.yaml"
    path.write_text(path.read_text(encoding="utf-8") + "# modification locale\n", encoding="utf-8")
    before = workspace_state()
    with pytest.raises(RepoError) as refused:
        set_remote(META.id, url)
    assert refused.value.code == "workspace_dirty"
    assert "governance.yaml" in refused.value.message
    assert workspace_state() == before
    assert git(repo, "remote").split() == []  # aucun `origin` résiduel
    assert git(bare, "for-each-ref").strip() == ""  # le dépôt distant reste vide
    client = TestClient(create_app(token="secret"), headers=AUTH)
    answer = client.post(f"/api/workspaces/{META.id}/remote", json={"remote_url": url})
    assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "workspace_dirty")
    # Annulées, les modifications ne bloquent plus ; un autre fichier sale ne bloquait pas.
    git(repo, "checkout", "--", "governance.yaml")
    (repo / "notes.md").write_text("brouillon\n", encoding="utf-8")
    attached = set_remote(META.id, url)
    assert attached.git_remote == url and attached.role == "referent"
    assert (repo / "notes.md").exists()


def test_a_local_edit_that_removes_the_local_account_is_refused_too(github):
    """Sans le compte local, `rename_account` ne renomme rien : le contrôle de l'état sale ne
    dépend pas du renommage. Le push aurait publié la gouvernance commitée, pendant que le
    rôle aurait été calculé sur le fichier modifié."""
    create_workspace(META)
    url, bare = github["repository"]("vide")
    repo = repo_dir(META.id)
    path = repo / "governance.yaml"
    path.write_text(path.read_text(encoding="utf-8").replace("anna-k", "zoe"), encoding="utf-8")
    before = workspace_state()
    with pytest.raises(RepoError) as refused:
        set_remote(META.id, url)
    assert refused.value.code == "workspace_dirty"
    assert workspace_state() == before
    assert git(repo, "remote").split() == []
    assert git(bare, "for-each-ref").strip() == ""
    # Même sans compte GitHub à substituer (hébergeur local) : le fichier modifié bloque.
    local = bare_repository(repo.parent, "local.git")
    with pytest.raises(RepoError) as refused:
        set_remote(META.id, str(local))
    assert refused.value.code == "workspace_dirty"
    assert git(local, "for-each-ref").strip() == ""


def test_a_merge_in_progress_is_refused_before_any_remote_write(github):
    """Un conflit non résolu sur un autre fichier ferait échouer l'avance rapide après le push."""
    create_workspace(META)
    url, bare = github["repository"]("vide")
    repo = repo_dir(META.id)
    notes = repo / "notes.md"
    notes.write_text("base\n", encoding="utf-8")
    commit_all(repo, "notes")
    git(repo, "checkout", "--quiet", "-b", "autre")
    notes.write_text("autre\n", encoding="utf-8")
    commit_all(repo, "côté autre")
    git(repo, "checkout", "--quiet", "main")
    notes.write_text("principale\n", encoding="utf-8")
    commit_all(repo, "côté principal")
    with pytest.raises(subprocess.CalledProcessError):
        git(repo, "merge", "--no-edit", "autre")  # conflit : la fusion reste en cours
    assert git(repo, "ls-files", "-u").strip()
    before = workspace_state()
    with pytest.raises(RepoError) as refused:
        set_remote(META.id, url)
    assert refused.value.code == "workspace_dirty"
    assert "fusion" in refused.value.message
    assert workspace_state() == before
    assert git(repo, "remote").split() == []
    assert git(bare, "for-each-ref").strip() == ""
    # Conflit résolu mais fusion non conclue : MERGE_HEAD suffit à refuser.
    notes.write_text("résolu\n", encoding="utf-8")
    git(repo, "add", "notes.md")
    with pytest.raises(RepoError) as refused:
        set_remote(META.id, url)
    assert refused.value.code == "workspace_dirty"
    assert git(bare, "for-each-ref").strip() == ""
    git(repo, "commit", "--quiet", "--no-edit")
    assert set_remote(META.id, url).git_remote == url


@pytest.mark.parametrize("detach", [False, True])
def test_another_checked_out_branch_is_refused_before_any_remote_write(github, detach):
    """L'avance rapide ferait avancer la branche extraite, pas la principale."""
    create_workspace(META)
    url, bare = github["repository"]("vide")
    repo = repo_dir(META.id)
    git(repo, "checkout", "--quiet", "--detach" if detach else "-b", *([] if detach else ["autre"]))
    before = workspace_state()
    with pytest.raises(RepoError) as refused:
        set_remote(META.id, url)
    assert refused.value.code == "wrong_branch"
    assert "main" in refused.value.message
    assert ("détachée" if detach else "autre") in refused.value.message
    assert workspace_state() == before
    assert git(repo, "remote").split() == []
    assert git(bare, "for-each-ref").strip() == ""
    client = TestClient(create_app(token="secret"), headers=AUTH)
    answer = client.post(f"/api/workspaces/{META.id}/remote", json={"remote_url": url})
    assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "wrong_branch")
    git(repo, "checkout", "--quiet", "main")  # revenue sur la principale, le rattachement passe
    assert set_remote(META.id, url).git_remote == url


def test_the_route_reports_github_errors_with_stable_codes(github):
    create_workspace(META)
    url, _ = github["repository"]("lecture", push=False)
    client = TestClient(create_app(token="secret"), headers=AUTH)
    answer = client.post(f"/api/workspaces/{META.id}/remote", json={"remote_url": url})
    assert (answer.status_code, answer.json()["detail"]["code"]) == (422, "remote_not_writable")
    assert TOKEN not in answer.text
    full, _ = github["repository"]("plein", empty=False)
    answer = client.post(f"/api/workspaces/{META.id}/remote", json={"remote_url": full})
    assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "remote_not_empty")
    answer = client.post(f"/api/workspaces/{META.id}/remote",
                         json={"remote_url": "https://github.com/nordis/absent.git"})
    assert (answer.status_code, answer.json()["detail"]["code"]) == (422, "remote_not_found")
    answer = client.post(f"/api/workspaces/{META.id}/remote", json={"remote_url": "ça ne va pas"})
    assert (answer.status_code, answer.json()["detail"]["code"]) == (422, "invalid_remote")


# --- réécriture de l'identité -------------------------------------------------------------

def test_rename_account_follows_every_reference():
    governance = Governance(
        domains=[Domain(id="finance", label="Finance", referents=["anna-k"],
                        validators=["anna-k", "marc-d"])],
        members=[Member(account="anna-k", name="Anna", roles=[MemberRole(role="referent")]),
                 Member(account="marc-d", name="Marc", roles=[MemberRole(role="validateur")])])
    renamed = rename_account(governance, "anna-k", "claire-m")
    assert [m.account for m in renamed.members] == ["claire-m", "marc-d"]
    assert renamed.domains[0].referents == ["claire-m"]
    assert renamed.domains[0].validators == ["claire-m", "marc-d"]
    assert role_of(renamed, "claire-m") == "referent" and role_of(renamed, "anna-k") == "lecteur"
    assert governance.members[0].account == "anna-k"  # l'original n'est pas modifié


def test_rename_account_never_merges_two_members():
    governance = initial_governance("anna-k", "Anna")
    governance.members.append(Member(account="claire-m", name="Claire",
                                     roles=[MemberRole(role="lecteur")]))
    assert rename_account(governance, "anna-k", "claire-m") is governance
    assert rename_account(governance, "inconnue", "autre") is governance


# --- la suite du parcours : autoriser une plateforme -------------------------------------

def test_a_new_workspace_can_authorise_a_platform_once_attached(atlas_env, tmp_path):
    """Critère 5 : avant le rattachement l'enregistrement échoue en `no_remote` ; après, le
    créateur, seul référent, autorise Databricks et la proposition est fusionnée."""
    create_workspace(META)
    client = TestClient(create_app(token="secret"), headers=AUTH)
    state = client.get(f"/api/workspaces/{META.id}/admin").json()
    assert state["repository"]["url"] == "" and state["governance"]["allowed_platforms"] == []
    wanted = {**state["governance"], "allowed_platforms": ["databricks"]}
    refused = client.post(f"/api/workspaces/{META.id}/admin/governance",
                          json={"governance": wanted, "base_digest": state["base_digest"]})
    assert (refused.status_code, refused.json()["detail"]["code"]) == (422, "no_remote")

    bare = bare_repository(tmp_path)
    assert client.post(f"/api/workspaces/{META.id}/remote",
                       json={"remote_url": str(bare)}).status_code == 200
    state = client.get(f"/api/workspaces/{META.id}/admin").json()
    assert state["repository"]["url"] == str(bare)
    saved = client.post(f"/api/workspaces/{META.id}/admin/governance",
                        json={"governance": wanted, "base_digest": state["base_digest"]})
    assert saved.status_code == 201 and saved.json()["merged"] is True, saved.text
    published = yaml.safe_load(git(bare, "show", "main:governance.yaml"))
    assert published["allowed_platforms"] == ["databricks"]
    assert client.get(f"/api/workspaces/{META.id}/connections/platforms").json() == [
        {"id": "databricks", "label": "Databricks", "supported": True}]
