"""Rattacher un espace neuf à un dépôt distant vide (plan 0033, ADR 0037).

Les dépôts « distants » sont des dépôts nus locaux. Pour GitHub, un faux serveur répond à
l'API (`/user`, `/repos/…`) et `url.<dépôts>.insteadOf` redirige les adresses
`https://github.com/…` vers des dépôts nus : git pousse et lit pour de vrai, sans réseau.
"""

import json
import os
import subprocess
import tempfile
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
    dump_governance,
    initial_governance,
    rename_account,
    role_of,
)
from skifer_atlas.proposals.common import open_context
from skifer_atlas.repo import RepoError
from skifer_atlas.repo import sync as repo_sync
from skifer_atlas.repo.git import mask_remote_url, normalize_remote_url
from skifer_atlas.repo.layout import WorkspaceMeta, read_governance
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

    def fill_then_pass(url, token, repo, branch, old_account, account):
        seed(bare, tmp_path / "graine")
        return None, "empty"

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


@pytest.mark.parametrize("hosted", [False, True])
def test_retry_after_registry_failure_finishes_attachment(atlas_env, request, tmp_path, monkeypatch, hosted):
    if hosted:
        url, bare = request.getfixturevalue("github")["repository"]("reprise")
    else:
        bare = bare_repository(tmp_path)
        url = str(bare)
    created = create_workspace(META)
    with monkeypatch.context() as patch:
        def fail_update(workspace):
            raise OSError("écriture simulée")
        patch.setattr(repo_sync, "update_workspace", fail_update)
        with pytest.raises(RepoError) as interrupted:
            set_remote(META.id, url)
    assert interrupted.value.code == "attach_incomplete"
    assert not get_workspace(META.id).git_remote
    repo = repo_dir(META.id)
    published = git(bare, "rev-parse", "main").strip()
    with monkeypatch.context() as patch:
        original = repo_sync.run_git

        def no_push(args, *a, **kw):
            assert args[0] != "push"
            return original(args, *a, **kw)
        patch.setattr(repo_sync, "run_git", no_push)
        attached = set_remote(META.id, url)
    assert (attached.git_remote, attached.role) == (url, "referent")
    assert attached.account == ("claire-m" if hosted else created.account)
    assert git(repo, "rev-parse", "main").strip() == published
    assert git(repo, "rev-parse", "--abbrev-ref", "main@{upstream}").strip() == "origin/main"
    assert get_workspace(META.id).git_remote == url


def test_ambiguous_push_is_confirmed(github, monkeypatch):
    create_workspace(META)
    url, bare = github["repository"]("ambigu")
    original = repo_sync.run_git
    with monkeypatch.context() as patch:
        def ambiguous(args, *a, **kw):
            result = original(args, *a, **kw)
            if args[0] == "push":
                raise RepoError("git_timeout", "délai dépassé")
            return result
        patch.setattr(repo_sync, "run_git", ambiguous)
        attached = set_remote(META.id, url)
    assert attached.git_remote == url and attached.role == "referent"
    assert git(repo_dir(META.id), "rev-parse", "main").strip() == git(bare, "rev-parse", "main").strip()
    assert "origin" in git(repo_dir(META.id), "remote").split()


def test_residual_origin_with_another_url_is_refused(atlas_env, tmp_path):
    create_workspace(META)
    first = bare_repository(tmp_path, "premier.git")
    second = bare_repository(tmp_path, "second.git")
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", str(first))
    before = workspace_state()
    client = TestClient(create_app(token="secret"), headers=AUTH)
    answer = client.post(f"/api/workspaces/{META.id}/remote", json={"remote_url": str(second)})
    assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "origin_conflict")
    assert workspace_state() == before
    assert git(second, "for-each-ref").strip() == ""


@pytest.mark.parametrize("variant", ["autre-branche", "tag", "contenu"])
def test_other_publications_are_refused_without_local_changes(github, variant):
    create_workspace(META)
    url, bare = github["repository"]("autre")
    repo = repo_dir(META.id)
    local = git(repo, "rev-parse", "main").strip()
    if variant == "contenu":
        path = repo / "governance.yaml"
        original = path.read_text(encoding="utf-8")
        path.write_text(original.replace("anna-k", "autre-compte") + "# étranger\n",
                        encoding="utf-8")
        commit_all(repo, "autre identité")
        git(repo, "push", "--quiet", str(bare), "main")
        git(repo, "reset", "--hard", local)
    else:
        git(repo, "push", "--quiet", str(bare), "main")
        if variant == "autre-branche":
            git(bare, "branch", "-m", "main", "autre")
        else:
            git(repo, "push", "--quiet", str(bare), "main:refs/tags/v1")
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, url)
    assert error.value.code == "remote_not_empty"
    assert workspace_state() == before


def test_retry_fetches_identity_after_merge_failure(github, monkeypatch):
    create_workspace(META)
    url, bare = github["repository"]("fusion")
    original = repo_sync.run_git
    with monkeypatch.context() as patch:
        def fail_merge(args, *a, **kw):
            if args[0] == "merge":
                raise RepoError("git_failed", "fusion simulée")
            return original(args, *a, **kw)
        patch.setattr(repo_sync, "run_git", fail_merge)
        with pytest.raises(RepoError):
            set_remote(META.id, url)
    repo = repo_dir(META.id)
    assert git(repo, "rev-parse", "main").strip() != git(bare, "rev-parse", "main").strip()
    with monkeypatch.context() as patch:
        def no_push(args, *a, **kw):
            assert args[0] != "push"
            return original(args, *a, **kw)
        patch.setattr(repo_sync, "run_git", no_push)
        attached = set_remote(META.id, url)
    assert (attached.account, attached.role) == ("claire-m", "referent")
    assert git(repo, "rev-parse", "main").strip() == git(bare, "rev-parse", "main").strip()


def test_retry_identity_from_local_repository(atlas_env, tmp_path, monkeypatch):
    from skifer_atlas.githost.local import LocalHost

    create_workspace(META, creator="ancien")
    bare = bare_repository(tmp_path)
    original = repo_sync.run_git
    with monkeypatch.context() as patch:
        patch.setattr(LocalHost, "current_account", lambda self: "nouveau")

        def fail_merge(args, *a, **kw):
            if args[0] == "merge":
                raise RepoError("git_failed", "fusion simulée")
            return original(args, *a, **kw)

        with monkeypatch.context() as failure:
            failure.setattr(repo_sync, "run_git", fail_merge)
            with pytest.raises(RepoError):
                set_remote(META.id, str(bare))
        attached = set_remote(META.id, str(bare))
    assert (attached.account, attached.role) == ("nouveau", "referent")
    assert git(repo_dir(META.id), "rev-parse", "main").strip() == git(bare, "rev-parse", "main").strip()


def test_ambiguous_local_push_is_confirmed(atlas_env, tmp_path, monkeypatch):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    original = repo_sync.run_git
    with monkeypatch.context() as patch:
        def ambiguous(args, *a, **kw):
            result = original(args, *a, **kw)
            if args[0] == "push":
                raise RepoError("git_timeout", "délai dépassé")
            return result

        patch.setattr(repo_sync, "run_git", ambiguous)
        attached = set_remote(META.id, str(bare))
    assert attached.git_remote == str(bare)
    assert git(repo_dir(META.id), "rev-parse", "main@{upstream}").strip() == git(
        bare, "rev-parse", "main").strip()


@pytest.fixture
def identity_host(atlas_env, monkeypatch):
    from skifer_atlas.githost.local import LocalHost

    monkeypatch.setattr(LocalHost, "current_account", lambda self: "nouveau")
    create_workspace(META, creator="ancien")
    return LocalHost


def interrupted_identity(bare, monkeypatch, step="merge"):
    original = repo_sync.run_git
    with monkeypatch.context() as patch:
        def fail(args, *a, **kw):
            if args[0] == step:
                raise RepoError("git_failed", "échec simulé")
            return original(args, *a, **kw)

        patch.setattr(repo_sync, "run_git", fail)
        with pytest.raises(RepoError):
            set_remote(META.id, str(bare))


def test_identity_diverged_after_publication_is_partial(identity_host, tmp_path, monkeypatch):
    bare = bare_repository(tmp_path)
    interrupted_identity(bare, monkeypatch)
    repo = repo_dir(META.id)
    (repo / "notes.md").write_text("suite locale\n", encoding="utf-8")
    commit_all(repo, "suite locale")
    before = workspace_state()
    with pytest.raises(RepoError, match="clone a évolué") as error:
        set_remote(META.id, str(bare))
    assert error.value.code == "remote_partial"
    assert workspace_state() == before


@pytest.mark.parametrize("step", ["merge", "branch"])
def test_other_account_after_identity_publication_is_partial(identity_host, tmp_path, monkeypatch, step):
    bare = bare_repository(tmp_path)
    interrupted_identity(bare, monkeypatch, step)
    with monkeypatch.context() as patch:
        patch.setattr(identity_host, "current_account", lambda self: "autre")
        with pytest.raises(RepoError, match="nouveau") as error:
            set_remote(META.id, str(bare))
        client = TestClient(create_app(token="secret"), headers=AUTH)
        answer = client.post(f"/api/workspaces/{META.id}/remote",
                             json={"remote_url": str(bare)})
        assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "remote_partial")
        assert "nouveau" in answer.json()["detail"]["message"]
    assert error.value.code == "remote_partial"
    assert not get_workspace(META.id).git_remote


def test_existing_local_head_is_published_with_identity(identity_host, tmp_path):
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    git(repo, "push", "--quiet", str(bare), "main")
    old = git(repo, "rev-parse", "main").strip()
    attached = set_remote(META.id, str(bare))
    assert (attached.account, attached.role) == ("nouveau", "referent")
    assert git(bare, "rev-parse", "main^").strip() == old
    assert git(repo, "rev-parse", "main").strip() == git(bare, "rev-parse", "main").strip()


def test_local_commits_after_bare_publication_are_pushed(atlas_env, tmp_path):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    git(repo, "push", "--quiet", str(bare), "main")
    (repo / "notes.md").write_text("suite\n", encoding="utf-8")
    commit_all(repo, "suite")
    attached = set_remote(META.id, str(bare))
    assert attached.role == "referent"
    assert git(repo, "rev-parse", "main").strip() == git(bare, "rev-parse", "main").strip()


def test_retry_after_upstream_failure_does_not_push(atlas_env, tmp_path, monkeypatch):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    interrupted_identity(bare, monkeypatch, "branch")
    original = repo_sync.run_git
    with monkeypatch.context() as patch:
        def no_push(args, *a, **kw):
            assert args[0] != "push"
            return original(args, *a, **kw)

        patch.setattr(repo_sync, "run_git", no_push)
        assert set_remote(META.id, str(bare)).role == "referent"


@pytest.mark.parametrize("rejected", [False, True])
def test_unconfirmed_push_removes_origin(atlas_env, tmp_path, monkeypatch, rejected):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    original = repo_sync.run_git
    checks = []
    with monkeypatch.context() as patch:
        def fail_push(args, *a, **kw):
            if args[0] == "push":
                output = "[remote rejected] main (hook declined)" if rejected else "connexion perdue"
                raise RepoError("push_failed", "échec simulé", output=output)
            if args[0] == "ls-remote":
                checks.append(args)
            return original(args, *a, **kw)

        patch.setattr(repo_sync, "run_git", fail_push)
        with pytest.raises(RepoError) as error:
            set_remote(META.id, str(bare))
    assert error.value.code == "push_failed"
    assert len(checks) == (1 if rejected else 2)
    assert not git(repo_dir(META.id), "remote").strip()
    assert not git(bare, "for-each-ref").strip()


@pytest.mark.parametrize("configuration", ["missing", "multiple", "pushurl"])
def test_bad_origin_configuration_is_a_conflict(atlas_env, tmp_path, configuration):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", str(bare))
    if configuration == "missing":
        git(repo, "config", "--unset-all", "remote.origin.url")
    elif configuration == "multiple":
        git(repo, "config", "--add", "remote.origin.url", str(bare) + "autre")
    else:
        git(repo, "config", "remote.origin.pushurl", str(bare) + "autre")
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, str(bare))
    assert error.value.code == "origin_conflict"
    assert workspace_state() == before


def test_inspection_fetch_failure_is_explained(identity_host, tmp_path, monkeypatch):
    bare = bare_repository(tmp_path)
    seed(bare, tmp_path / "graine")
    original = repo_sync.run_git
    with monkeypatch.context() as patch:
        def fail_fetch(args, *a, **kw):
            if args[0] == "fetch":
                raise RepoError("git_failed", "échec", output="Authentication failed")
            return original(args, *a, **kw)

        patch.setattr(repo_sync, "run_git", fail_fetch)
        with pytest.raises(RepoError) as error:
            set_remote(META.id, str(bare))
    assert error.value.code == "host_auth_failed"


@pytest.mark.parametrize("variant", ["contenu", "autre-fichier", "deux-parents"])
def test_unrelated_identity_shaped_commits_are_refused(identity_host, tmp_path, variant):
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    parent = git(repo, "rev-parse", "main").strip()
    path = repo / "governance.yaml"
    content = path.read_text(encoding="utf-8").replace("ancien", "nouveau")
    if variant == "contenu":
        content += "# contenu étranger\n"
    path.write_text(content, encoding="utf-8")
    if variant == "autre-fichier":
        (repo / "notes.md").write_text("étranger\n", encoding="utf-8")
    commit_all(repo, "identité étrangère")
    remote = git(repo, "rev-parse", "main").strip()
    if variant == "deux-parents":
        tree = git(repo, "rev-parse", "main^{tree}").strip()
        remote = git(repo, "commit-tree", tree, "-p", parent, "-p", remote,
                     "-m", "fusion étrangère").strip()
    git(repo, "push", "--quiet", str(bare), f"{remote}:refs/heads/main")
    git(repo, "reset", "--hard", parent)
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, str(bare))
    assert error.value.code == "remote_not_empty"
    assert workspace_state() == before


def test_account_change_after_registry_failure_is_partial(identity_host, tmp_path, monkeypatch):
    bare = bare_repository(tmp_path)
    with monkeypatch.context() as patch:
        def fail_update(workspace):
            raise OSError("écriture simulée")

        patch.setattr(repo_sync, "update_workspace", fail_update)
        with pytest.raises(RepoError) as interrupted:
            set_remote(META.id, str(bare))
    assert interrupted.value.code == "attach_incomplete"
    with monkeypatch.context() as patch:
        patch.setattr(identity_host, "current_account", lambda self: "autre")
        with pytest.raises(RepoError, match="nouveau") as error:
            set_remote(META.id, str(bare))
    assert error.value.code == "remote_partial"
    assert not get_workspace(META.id).git_remote


def test_foreign_history_is_inspected_shallowly(atlas_env, tmp_path, monkeypatch):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    work = tmp_path / "etranger"
    seed(bare, work)
    oldest = git(work, "rev-parse", "main").strip()
    for i in range(8):
        (work / "README.md").write_text(f"révision {i}\n", encoding="utf-8")
        commit_all(work, f"révision {i}")
    git(work, "push", "--quiet", str(bare), "main")
    original = repo_sync.run_git
    observed = []
    with monkeypatch.context() as patch:
        def observe(args, *a, **kw):
            result = original(args, *a, **kw)
            if args[0] == "fetch":
                staging = a[0]
                observed.append((args, git(staging, "rev-list", "--count", "FETCH_HEAD").strip()))
                # Pas de `cat-file -e` : sur un dépôt « promisor », il irait chercher le commit.
                assert oldest not in git(staging, "rev-list", "FETCH_HEAD").split()
            return result

        patch.setattr(repo_sync, "run_git", observe)
        before = workspace_state()
        with pytest.raises(RepoError) as error:
            set_remote(META.id, str(bare))
    assert error.value.code == "remote_not_empty"
    assert observed and observed[0][1] == "2" and "--depth=2" in observed[0][0]
    assert workspace_state() == before
    with pytest.raises(subprocess.CalledProcessError):
        git(repo_dir(META.id), "cat-file", "-e", f"{oldest}^{{commit}}")


def test_unknown_identity_is_fetched_without_shallowing_clone(identity_host, tmp_path, monkeypatch):
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    work = tmp_path / "autre-clone"
    git(tmp_path, "clone", "--quiet", str(repo), str(work))
    path = work / "governance.yaml"
    path.write_text(path.read_text(encoding="utf-8").replace("account: ancien", "account: nouveau"),
                    encoding="utf-8")
    commit_all(work, "identité publiée")
    git(work, "push", "--quiet", str(bare), "main")
    published = git(bare, "rev-parse", "main").strip()
    with pytest.raises(subprocess.CalledProcessError):
        git(repo, "cat-file", "-e", f"{published}^{{commit}}")
    shallow = repo / ".git" / "shallow"
    assert not shallow.exists()
    original = repo_sync.run_git
    calls = []
    with monkeypatch.context() as patch:
        def observe(args, *a, **kw):
            if args[0] == "fetch":
                calls.append(args)
            return original(args, *a, **kw)

        patch.setattr(repo_sync, "run_git", observe)
        attached = set_remote(META.id, str(bare))
    assert (attached.account, attached.role) == ("nouveau", "referent")
    assert git(repo, "rev-parse", "main").strip() == published
    assert len(calls) == 2 and "--depth=2" in calls[0] and "--depth=2" not in calls[1]
    assert not shallow.exists()
    assert git(repo, "rev-parse", "--is-shallow-repository").strip() == "false"


@pytest.mark.parametrize("dirty", [False, True])
def test_resume_guards_precede_writes(identity_host, tmp_path, monkeypatch, dirty):
    bare = bare_repository(tmp_path)
    interrupted_identity(bare, monkeypatch)
    repo = repo_dir(META.id)
    if dirty:
        path = repo / "governance.yaml"
        path.write_text(path.read_text(encoding="utf-8") + "# brouillon\n", encoding="utf-8")
    else:
        git(repo, "checkout", "--quiet", "-b", "autre")
    before = workspace_state()
    remote_before = git(bare, "for-each-ref")
    config_before = git(repo, "config", "--local", "--list")
    with pytest.raises(RepoError) as error:
        set_remote(META.id, str(bare))
    assert error.value.code == ("workspace_dirty" if dirty else "wrong_branch")
    assert workspace_state() == before
    assert git(bare, "for-each-ref") == remote_before
    assert git(repo, "config", "--local", "--list") == config_before


def test_local_ahead_is_pushed_with_identity(identity_host, tmp_path):
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    git(repo, "push", "--quiet", str(bare), "main")
    (repo / "notes.md").write_text("suite locale\n", encoding="utf-8")
    commit_all(repo, "suite locale")
    before_identity = git(repo, "rev-parse", "main").strip()
    attached = set_remote(META.id, str(bare))
    assert (attached.account, attached.role) == ("nouveau", "referent")
    assert git(bare, "rev-parse", "main^").strip() == before_identity
    assert git(repo, "rev-parse", "main").strip() == git(bare, "rev-parse", "main").strip()


def test_inspection_rejects_branch_changed_after_ls_remote(atlas_env, tmp_path, monkeypatch):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    seed(bare, tmp_path / "graine")
    original = repo_sync.run_git
    before = workspace_state()
    with monkeypatch.context() as patch:
        def changed(args, *a, **kw):
            result = original(args, *a, **kw)
            if args == ["rev-parse", "FETCH_HEAD"]:
                return "0" * 40 + "\n"
            return result

        patch.setattr(repo_sync, "run_git", changed)
        with pytest.raises(RepoError) as error:
            set_remote(META.id, str(bare))
    assert error.value.code == "remote_partial"
    assert workspace_state() == before


def test_differently_cased_remote_does_not_conflict(atlas_env, tmp_path):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", str(bare))
    git(repo, "remote", "add", "Origin", str(bare) + "autre")
    git(repo, "config", "remote.Origin.pushurl", str(bare) + "autre")
    assert set_remote(META.id, str(bare)).git_remote == str(bare)


@pytest.mark.parametrize("had_origin", [False, True])
def test_ahead_push_rejected_when_remote_advances_removes_origin(atlas_env, tmp_path, monkeypatch,
                                                                 had_origin):
    """Push non rapide : jamais forcé. La branche du dépôt nu reste le commit concurrent ;
    `origin` n'est retiré que s'il a été ajouté par ce rattachement."""
    create_workspace(META)
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    git(repo, "push", "--quiet", str(bare), "main")
    work = tmp_path / "autre"
    git(tmp_path, "clone", "--quiet", str(bare), str(work))
    (repo / "notes.md").write_text("local\n", encoding="utf-8")
    commit_all(repo, "suite locale")
    if had_origin:
        git(repo, "remote", "add", "origin", str(bare))
    original = repo_sync._require_empty
    concurrent = []
    with monkeypatch.context() as patch:
        def advance(*args):
            result = original(*args)
            (work / "notes.md").write_text("distant\n", encoding="utf-8")
            commit_all(work, "suite distante")
            git(work, "push", "--quiet", str(bare), "main")
            concurrent.append(git(work, "rev-parse", "HEAD").strip())
            return result

        patch.setattr(repo_sync, "_require_empty", advance)
        with pytest.raises(RepoError) as error:
            set_remote(META.id, str(bare))
    assert error.value.code == "remote_not_empty"
    assert git(bare, "rev-parse", "main").strip() == concurrent[0]  # pas de push forcé
    assert git(bare, "log", "--format=%s", "main").splitlines()[0] == "suite distante"
    assert git(repo, "remote").split() == (["origin"] if had_origin else [])
    assert not get_workspace(META.id).git_remote


@pytest.mark.parametrize("ahead", [False, True])
def test_known_commit_is_inspected_without_fetch(atlas_env, tmp_path, monkeypatch, ahead):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    git(repo, "push", "--quiet", str(bare), "main")
    if ahead:
        (repo / "notes.md").write_text("local\n", encoding="utf-8")
        commit_all(repo, "suite locale")
    original = repo_sync.run_git
    with monkeypatch.context() as patch:
        def no_fetch(args, *a, **kw):
            assert args[0] != "fetch"
            return original(args, *a, **kw)

        patch.setattr(repo_sync, "run_git", no_fetch)
        attached = set_remote(META.id, str(bare))
    assert attached.git_remote == str(bare)


# --- suivi de #143 : clone divergé, fetch filtré, origin, erreurs après publication --------

def publish_identity_elsewhere(tmp_path, bare, *, large=False, allow_filter=False):
    """Le commit d'identité (« ancien » devient « nouveau ») est publié par un autre clone :
    celui de l'espace ne l'a pas. Avec `large`, `governance.yaml` dépasse 1 Ko, le seuil du
    filtre `blob:limit=1k`. Rend le commit publié."""
    repo = repo_dir(META.id)
    if allow_filter:
        git(bare, "config", "uploadpack.allowFilter", "true")
    if large:
        governance = read_governance(repo)
        members = [Member(account=f"membre-{i:02d}", name=f"Membre numéro {i:02d}",
                          roles=[MemberRole(role="lecteur")]) for i in range(20)]
        governance = governance.model_copy(update={"members": [*governance.members, *members]})
        (repo / "governance.yaml").write_text(dump_governance(governance), encoding="utf-8")
        commit_all(repo, "gouvernance élargie")
        assert len((repo / "governance.yaml").read_bytes()) > 1024
    work = tmp_path / "autre-clone"
    git(tmp_path, "clone", "--quiet", str(repo), str(work))
    renamed = rename_account(read_governance(work), "ancien", "nouveau")
    (work / "governance.yaml").write_text(dump_governance(renamed), encoding="utf-8")
    commit_all(work, "identité publiée ailleurs")
    git(work, "push", "--quiet", str(bare), "main")
    return git(bare, "rev-parse", "main").strip()


def observe_fetches(patch):
    """Les `fetch` de l'inspection : arguments, objets absents du dépôt temporaire, et
    existence du dossier temporaire pendant le fetch."""
    original = repo_sync.run_git
    seen = []

    def observe(args, *a, **kw):
        result = original(args, *a, **kw)
        if args[0] == "fetch" and a and "atlas-attach-" in str(a[0]):
            missing = [line[1:] for line in git(a[0], "rev-list", "--objects", "--missing=print",
                                                 "FETCH_HEAD").splitlines()
                       if line.startswith("?")]
            seen.append({"args": args, "missing": missing, "folder": a[0].exists()})
        return result

    patch.setattr(repo_sync, "run_git", observe)
    return seen


# Clone divergé (issue #143, case 1)

@pytest.mark.parametrize("divergence", ["amend", "reset"])
def test_identity_published_then_clone_rewritten_is_a_diverged_partial(
        identity_host, tmp_path, monkeypatch, divergence):
    """Un `commit --amend` ou un `reset` local, après une publication interrompue, retire le
    parent du commit d'identité de la branche : `remote_partial` « clone divergé », et non
    `remote_not_empty`, qui ferait croire à un dépôt étranger."""
    repo = repo_dir(META.id)
    if divergence == "reset":
        (repo / "notes.md").write_text("suite locale\n", encoding="utf-8")
        commit_all(repo, "suite locale")
    bare = bare_repository(tmp_path)
    interrupted_identity(bare, monkeypatch)
    if divergence == "amend":
        git(repo, "commit", "--quiet", "--amend", "-m", "message réécrit")
    else:
        git(repo, "reset", "--quiet", "--hard", "HEAD~1")
    before = workspace_state()
    remote_before = git(bare, "for-each-ref")
    with pytest.raises(RepoError) as error:
        set_remote(META.id, str(bare))
    assert error.value.code == "remote_partial"
    assert "Clone divergé" in error.value.message
    assert workspace_state() == before and git(bare, "for-each-ref") == remote_before
    client = TestClient(create_app(token="secret"), headers=AUTH)
    answer = client.post(f"/api/workspaces/{META.id}/remote", json={"remote_url": str(bare)})
    assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "remote_partial")


def test_a_clone_diverged_after_an_unknown_identity_publication_is_partial(
        identity_host, tmp_path):
    """Même cas quand le commit d'identité vient d'un autre clone (fetch d'inspection)."""
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    publish_identity_elsewhere(tmp_path, bare)
    git(repo, "commit", "--quiet", "--amend", "-m", "message réécrit")
    with pytest.raises(RepoError) as error:
        set_remote(META.id, str(bare))
    assert (error.value.code, "Clone divergé" in error.value.message) == ("remote_partial", True)


# Fetch d'inspection filtré (issue #143, case 2)

@pytest.mark.parametrize("allow_filter", [True, False])
def test_foreign_snapshot_is_fetched_without_big_blobs(atlas_env, tmp_path, monkeypatch,
                                                       allow_filter):
    """`--filter=blob:limit=1k` : le gros fichier n'est pas téléchargé quand le serveur
    accepte le filtre ; sinon Git l'ignore avec un avertissement et l'inspection aboutit."""
    create_workspace(META)
    bare = bare_repository(tmp_path)
    if allow_filter:
        git(bare, "config", "uploadpack.allowFilter", "true")
    work = tmp_path / "etranger"
    seed(bare, work)
    (work / "gros.bin").write_text("x" * 5000, encoding="utf-8")
    commit_all(work, "gros fichier")
    git(work, "push", "--quiet", str(bare), "main")
    big = git(work, "rev-parse", "HEAD:gros.bin").strip()
    before = workspace_state()
    with monkeypatch.context() as patch:
        seen = observe_fetches(patch)
        with pytest.raises(RepoError) as error:
            set_remote(META.id, str(bare))
    assert error.value.code == "remote_not_empty"
    assert len(seen) == 1 and "--filter=blob:limit=1k" in seen[0]["args"]
    assert seen[0]["missing"] == ([big] if allow_filter else [])
    assert workspace_state() == before


@pytest.mark.parametrize("allow_filter", [True, False])
@pytest.mark.parametrize("large", [False, True])
def test_identity_is_recognised_whatever_the_size_of_the_governance(
        identity_host, tmp_path, monkeypatch, allow_filter, large):
    """Le contenu se compare par identifiant d'objet : un `governance.yaml` de plus de 1 Ko,
    omis par le filtre, n'empêche pas de reconnaître le commit d'identité."""
    bare = bare_repository(tmp_path)
    published = publish_identity_elsewhere(tmp_path, bare, large=large, allow_filter=allow_filter)
    repo = repo_dir(META.id)
    blob = git(bare, "rev-parse", "main:governance.yaml").strip()
    with monkeypatch.context() as patch:
        seen = observe_fetches(patch)
        attached = set_remote(META.id, str(bare))
    assert (attached.account, attached.role) == ("nouveau", "referent")
    assert git(repo, "rev-parse", "main").strip() == published
    assert "--filter=blob:limit=1k" in seen[0]["args"]
    assert (blob in seen[0]["missing"]) == (large and allow_filter)  # omis, jamais lu
    assert git(repo, "rev-parse", "--is-shallow-repository").strip() == "false"


@pytest.mark.parametrize("allow_filter", [True, False])
def test_another_published_account_with_a_large_governance_is_still_explained(
        identity_host, tmp_path, monkeypatch, allow_filter):
    """Le compte publié n'est pas le compte courant : il faut lire le fichier. Omis par le
    filtre, il est récupéré seul ; l'erreur dit le compte publié."""
    bare = bare_repository(tmp_path)
    publish_identity_elsewhere(tmp_path, bare, large=True, allow_filter=allow_filter)
    with monkeypatch.context() as patch:
        patch.setattr(identity_host, "current_account", lambda self: "autre")
        with pytest.raises(RepoError, match="nouveau") as error:
            set_remote(META.id, str(bare))
    assert error.value.code == "remote_partial"


def test_a_server_that_fails_on_the_filter_gets_a_second_unfiltered_fetch(
        atlas_env, tmp_path, monkeypatch):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    seed(bare, tmp_path / "etranger")
    original = repo_sync.run_git
    fetches = []
    with monkeypatch.context() as patch:
        def refuse_filter(args, *a, **kw):
            if args[0] == "fetch":
                fetches.append(args)
                if any(arg.startswith("--filter") for arg in args):
                    raise RepoError("git_failed", "échec", output="fatal: filter not supported")
            return original(args, *a, **kw)

        patch.setattr(repo_sync, "run_git", refuse_filter)
        with pytest.raises(RepoError) as error:
            set_remote(META.id, str(bare))
    assert error.value.code == "remote_not_empty"
    assert [any(arg.startswith("--filter") for arg in args) for args in fetches] == [True, False]


def test_a_timeout_on_the_filtered_fetch_is_not_retried(atlas_env, tmp_path, monkeypatch):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    seed(bare, tmp_path / "etranger")
    original = repo_sync.run_git
    fetches = []
    with monkeypatch.context() as patch:
        def slow(args, *a, **kw):
            if args[0] == "fetch":
                fetches.append(args)
                raise RepoError("git_timeout", "délai dépassé")
            return original(args, *a, **kw)

        patch.setattr(repo_sync, "run_git", slow)
        with pytest.raises(RepoError) as error:
            set_remote(META.id, str(bare))
    assert error.value.code == "host_unreachable" and len(fetches) == 1


# Dépôt temporaire (issue #143, case 3)

@pytest.mark.parametrize("outcome", ["refus", "fetch en échec", "branche changée", "succès"])
def test_the_inspection_folder_is_always_removed(identity_host, tmp_path, monkeypatch, outcome):
    scratch = tmp_path / "temporaire"
    scratch.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(scratch))
    bare = bare_repository(tmp_path)
    if outcome == "succès":
        publish_identity_elsewhere(tmp_path, bare)
    else:
        seed(bare, tmp_path / "etranger")
    original = repo_sync.run_git
    folders = []
    with monkeypatch.context() as patch:
        def intercept(args, *a, **kw):
            if args[0] == "fetch" and a and "atlas-attach-" in str(a[0]):
                folders.append(a[0].exists())
                if outcome == "fetch en échec":
                    raise RepoError("git_failed", "échec", output="Authentication failed")
            result = original(args, *a, **kw)
            if outcome == "branche changée" and args == ["rev-parse", "FETCH_HEAD"]:
                return "0" * 40 + "\n"
            return result

        patch.setattr(repo_sync, "run_git", intercept)
        if outcome == "succès":
            assert set_remote(META.id, str(bare)).role == "referent"
        else:
            with pytest.raises(RepoError) as error:
                set_remote(META.id, str(bare))
            assert error.value.code == {"refus": "remote_not_empty",
                                        "fetch en échec": "host_auth_failed",
                                        "branche changée": "remote_partial"}[outcome]
    assert folders == [True]  # le dossier existait pendant le fetch
    assert list(scratch.iterdir()) == []  # et il a disparu, y compris sur erreur


# Origin préexistant (issue #143, cases 3 et 4)

def test_a_matching_origin_survives_a_refused_push(atlas_env, tmp_path):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    hook = bare / "hooks" / "pre-receive"
    hook.write_text("#!/bin/sh\necho 'refus de test' >&2\nexit 1\n")
    hook.chmod(0o755)
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", str(bare))
    before = workspace_state()
    with pytest.raises(RepoError) as error:
        set_remote(META.id, str(bare))
    assert error.value.code == "push_failed"
    assert git(repo, "remote").split() == ["origin"]
    assert git(repo, "config", "--get-all", "remote.origin.url").split() == [str(bare)]
    assert workspace_state() == before
    assert not git(bare, "for-each-ref").strip()


@pytest.mark.parametrize("variant", ["slash", "sans .git", "slash après .git"])
def test_equivalent_origin_spellings_do_not_conflict(github, variant):
    create_workspace(META)
    url, bare = github["repository"]("equivalent")
    origin = {"slash": url + "/", "sans .git": url.removesuffix(".git"),
              "slash après .git": url + "/"}[variant]
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", origin)
    attached = set_remote(META.id, url)
    assert (attached.git_remote, attached.role) == (url, "referent")
    assert git(repo, "config", "--get-all", "remote.origin.url").split() == [origin]
    assert git(bare, "rev-parse", "main").strip() == git(repo, "rev-parse", "main").strip()


def test_a_local_origin_with_a_trailing_slash_does_not_conflict(atlas_env, tmp_path):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    git(repo_dir(META.id), "remote", "add", "origin", f"{bare}/")
    assert set_remote(META.id, str(bare)).git_remote == str(bare)


@pytest.mark.parametrize(("left", "right"), [
    ("https://github.com/nordis/x.git", "https://GitHub.COM/nordis/x"),
    ("https://github.com/nordis/x.git/", "https://github.com/nordis/x"),
    ("HTTPS://github.com/nordis/x", "https://github.com/nordis/x.git"),
    ("git@github.com:nordis/x.git", "git@GitHub.com:nordis/x/"),
    ("ssh://git@github.com/nordis/x.git", "ssh://git@GITHUB.com/nordis/x"),
    ("/depots/x.git/", "/depots/x.git"),
])
def test_equivalent_remote_urls_normalize_alike(left, right):
    assert normalize_remote_url(left) == normalize_remote_url(right)


@pytest.mark.parametrize(("left", "right"), [
    ("https://github.com/nordis/x", "https://github.com/nordis/y"),
    ("https://github.com/nordis/x", "https://github.com/Nordis/x"),  # le chemin garde sa casse
    ("https://github.com/nordis/x", "https://jeton@github.com/nordis/x"),  # avec identifiant
    ("https://github.com/nordis/x", "ssh://git@github.com/nordis/x"),
    ("/depots/x", "/depots/x.git"),  # deux dossiers possibles
])
def test_different_remote_urls_stay_different(left, right):
    assert normalize_remote_url(left) != normalize_remote_url(right)


@pytest.mark.parametrize(("url", "shown"), [
    ("https://ghp_abc:xyz@github.com/o/r.git", "https://***@github.com/o/r.git"),
    ("https://ghp_abc@github.com/o/r", "https://***@github.com/o/r"),
    ("https://example.com/r.git?token=SECRET", "https://example.com/r.git?***"),
    ("https://example.com/r.git#SECRET", "https://example.com/r.git#***"),
    ("https://example.com/r.git?token=SECRET#SECRET2", "https://example.com/r.git?***#***"),
    ("https://u:p@example.com/r.git?a=b#c", "https://***@example.com/r.git?***#***"),
    ("ssh://git@github.com/o/r", "ssh://git@github.com/o/r"),
    ("ssh://git@github.com/o/r?k=SECRET", "ssh://git@github.com/o/r?***"),
    ("git@github.com:o/r", "git@github.com:o/r"),
    ("git@github.com:o/r.git?k=SECRET", "git@github.com:o/r.git?***"),
    ("jeton@github.com:o/r", "***@github.com:o/r"),
    ("/depots/x.git", "/depots/x.git"),
    ("/depots/x.git/", "/depots/x.git/"),
    ("/depots/x.git?k=SECRET", "/depots/x.git?***"),
])
def test_a_url_is_shown_without_userinfo_query_or_fragment(url, shown):
    assert mask_remote_url(url) == shown
    assert "SECRET" not in mask_remote_url(url)


def test_origin_conflict_happens_before_any_network_call(github, monkeypatch):
    """Ni API de l'hébergeur, ni `ls-remote`, `fetch` ou `push` avant le refus."""
    create_workspace(META)
    url, bare = github["repository"]("conflit")
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", "https://github.com/nordis/autre.git")
    before = workspace_state()
    original = repo_sync.run_git
    git_calls = []
    with monkeypatch.context() as patch:
        def spy(args, *a, **kw):
            git_calls.append(args[0])
            return original(args, *a, **kw)

        patch.setattr(repo_sync, "run_git", spy)
        with pytest.raises(RepoError) as error:
            set_remote(META.id, url)
    assert error.value.code == "origin_conflict"
    assert "https://github.com/nordis/autre.git" in error.value.message  # l'origin trouvé
    assert not {"ls-remote", "fetch", "push", "clone"} & set(git_calls)
    assert github["calls"] == []  # pas même l'API de l'hébergeur
    assert workspace_state() == before and not git(bare, "for-each-ref").strip()


@pytest.mark.parametrize("origin", [
    "https://ghp_SECRET123:motdepasse456@example.org/o/r.git",
    "https://ghp_SECRET123@example.org/o/r.git",
    "https://example.org/o/r.git?token=ghp_SECRET123",
    "https://example.org/o/r.git#ghp_SECRET123",
    "https://example.org/o/r.git?token=ghp_SECRET123#motdepasse456",
])
@pytest.mark.parametrize("place", ["url", "pushurl"])
def test_origin_conflict_never_shows_a_secret_of_the_configured_url(atlas_env, tmp_path, origin,
                                                                    place):
    """Identifiant, query string ou fragment d'un `origin` (ou d'un `pushurl`) mis à la main :
    la réponse montre l'adresse, rien de secret."""
    create_workspace(META)
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    git(repo, "remote", "add", "origin", str(bare))
    if place == "url":
        git(repo, "config", "remote.origin.url", origin)
    else:
        git(repo, "config", "remote.origin.pushurl", origin)
    client = TestClient(create_app(token="secret"), headers=AUTH)
    answer = client.post(f"/api/workspaces/{META.id}/remote", json={"remote_url": str(bare)})
    assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "origin_conflict")
    assert "SECRET123" not in answer.text and "motdepasse456" not in answer.text
    assert "example.org/o/r.git" in answer.json()["detail"]["message"]


# Étapes après la publication (issue #143, case 5)

SECRET = "gho_SECRET-de-git"


def failing_step(step):
    """Un `run_git` (ou une autre fonction) qui échoue à l'étape demandée, avec une sortie
    de git qui contient un secret, une seule fois."""
    original = repo_sync.run_git
    done = []

    def run(args, *a, **kw):
        if args[0] == step and not done:
            done.append(True)
            raise RepoError("fetch_failed" if step == "fetch" else "git_failed", "échec simulé",
                            output=f"fatal: https://x-access-token:{SECRET}@github.com/")
        return original(args, *a, **kw)

    return run


@pytest.mark.parametrize("step", ["merge", "fetch", "branch", "read_governance", "update_workspace"])
def test_a_failure_after_publication_is_attach_incomplete_then_a_retry_finishes(
        identity_host, tmp_path, monkeypatch, step):
    bare = bare_repository(tmp_path)
    repo = repo_dir(META.id)
    original = repo_sync.run_git
    if step == "fetch":
        interrupted_identity(bare, monkeypatch, "merge")  # le fetch ne sert qu'à la reprise
    with monkeypatch.context() as patch:
        if step in ("merge", "fetch", "branch"):
            patch.setattr(repo_sync, "run_git", failing_step(step))
        elif step == "read_governance":
            reads = []
            real = repo_sync.read_governance

            def fail_second_read(root):
                reads.append(root)
                if len(reads) == 2:  # la première lecture précède le push
                    raise ValueError(f"gouvernance illisible {SECRET}")
                return real(root)

            patch.setattr(repo_sync, "read_governance", fail_second_read)
        else:
            def fail_update(workspace):
                raise OSError(f"écriture simulée {SECRET}")

            patch.setattr(repo_sync, "update_workspace", fail_update)
        with pytest.raises(RepoError) as error:
            set_remote(META.id, str(bare))
    assert error.value.code == "attach_incomplete"
    assert "publié" in error.value.message and "nouvel essai" in error.value.message
    assert SECRET not in error.value.message and "fatal" not in error.value.message
    assert not get_workspace(META.id).git_remote
    assert git(repo, "remote").split() == ["origin"]
    published = git(bare, "rev-parse", "main").strip()
    with monkeypatch.context() as patch:
        def no_push(args, *a, **kw):
            assert args[0] != "push"
            return original(args, *a, **kw)

        patch.setattr(repo_sync, "run_git", no_push)
        attached = set_remote(META.id, str(bare))
    assert (attached.git_remote, attached.account, attached.role) == (str(bare), "nouveau", "referent")
    assert git(repo, "rev-parse", "main").strip() == published
    assert git(repo, "rev-parse", "--abbrev-ref", "main@{upstream}").strip() == "origin/main"


def test_a_failure_after_publication_is_reported_by_the_route_without_git_output(
        atlas_env, tmp_path, monkeypatch):
    create_workspace(META)
    bare = bare_repository(tmp_path)
    client = TestClient(create_app(token="secret"), headers=AUTH)
    with monkeypatch.context() as patch:
        patch.setattr(repo_sync, "run_git", failing_step("merge"))
        answer = client.post(f"/api/workspaces/{META.id}/remote", json={"remote_url": str(bare)})
    assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "attach_incomplete")
    assert SECRET not in answer.text and "fatal" not in answer.text
    assert "publié" in answer.json()["detail"]["message"]
    retried = client.post(f"/api/workspaces/{META.id}/remote", json={"remote_url": str(bare)})
    assert retried.status_code == 200 and retried.json()["git_remote"] == str(bare)


def test_a_branch_changed_during_the_attachment_stays_partial_not_incomplete(
        identity_host, tmp_path, monkeypatch):
    bare = bare_repository(tmp_path)
    interrupted_identity(bare, monkeypatch, "merge")
    original = repo_sync.run_git
    with monkeypatch.context() as patch:
        def moved(args, *a, **kw):
            result = original(args, *a, **kw)
            if args == ["rev-parse", "refs/remotes/origin/main"]:
                return "0" * 40 + "\n"
            return result

        patch.setattr(repo_sync, "run_git", moved)
        with pytest.raises(RepoError) as error:
            set_remote(META.id, str(bare))
    assert error.value.code == "remote_partial" and "rattachement" in error.value.message
