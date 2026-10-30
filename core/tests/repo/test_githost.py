"""Client GitHub contre un faux serveur HTTP ; hygiène du jeton Git (plan 0006).

Le test réel (critère 8) ne tourne que si `ATLAS_GITHUB_TEST_REPO` (`owner/repo`) et
`ATLAS_GITHUB_TOKEN` sont fournis : `uv run pytest -m github`.
"""

import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from workspace_helpers import atlas_env, git

from skifer_atlas.githost import GitHubHost, LocalHost, host_for, remote_token
from skifer_atlas.githost.github import github_repository
from skifer_atlas.repo.git import RepoError, run_git

__all__ = ["atlas_env"]  # fixture importée

TOKEN = "ghp_jeton-de-test"
REPO = "/repos/nordis/annuaire"


class FakeGitHub(BaseHTTPRequestHandler):
    """Juste ce qu'Atlas appelle, avec la pagination et les erreurs de GitHub."""

    state: dict

    def log_message(self, *args):
        pass

    def _send(self, status, payload=None):
        body = json.dumps(payload).encode() if payload is not None else b""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def _page(self, items):
        query = dict(p.split("=") for p in self.path.split("?", 1)[1].split("&"))
        size, page = int(query["per_page"]), int(query["page"])
        return items[(page - 1) * size: page * size]

    def _route(self, method):
        state = self.state
        state["calls"].append((method, self.path, self.headers["Authorization"]))
        if self.headers["Authorization"] != f"Bearer {TOKEN}":
            return self._send(401, {"message": "Bad credentials"})
        path = self.path.split("?", 1)[0]
        if path == "/user":
            return self._send(200, {"login": state["login"]})
        if path == f"{REPO}/pulls" and method == "POST":
            body = self._body()
            pull = {"number": len(state["pulls"]) + 1, "title": body["title"],
                    "body": body["body"], "state": "open", "merged_at": None,
                    "head": {"ref": body["head"], "sha": "a" * 40},
                    "user": {"login": state["login"]}, "created_at": "2026-10-30T10:00:00Z"}
            state["pulls"].append(pull)
            return self._send(201, pull)
        if path == f"{REPO}/pulls":
            return self._send(200, self._page(state["pulls"]))
        match = re.fullmatch(rf"{REPO}/(pulls|issues)/(\d+)(/\w+)?", path)
        if not match:
            return self._send(404, {"message": "Not Found"})
        pull = state["pulls"][int(match[2]) - 1]
        action = match[3]
        if action is None:
            return self._send(200, pull)
        if action == "/reviews" and method == "POST":
            state["submitted"].append(self._body())
            return self._send(200, {})
        if action == "/reviews":
            return self._send(200, self._page(state["reviews"]))
        if action == "/comments" and method == "POST":
            comment = {"user": {"login": state["login"]}, "body": self._body()["body"],
                       "created_at": "2026-10-30T11:00:00Z"}
            state["comments"].append(comment)
            return self._send(201, comment)
        if action == "/comments":
            return self._send(200, self._page(state["comments"]))
        if action == "/merge":
            body = self._body()
            if state.get("merge_error"):
                return self._send(*state["merge_error"])
            if body["sha"] != pull["head"]["sha"]:
                return self._send(409, {"message": "Head branch was modified."})
            state["merged"] = body
            pull.update(state="closed", merged_at="2026-10-30T12:00:00Z",
                        merge_commit_sha="m" * 40)
            return self._send(200, {"sha": "m" * 40, "merged": True})
        return self._send(404, {"message": "Not Found"})

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PUT(self):
        self._route("PUT")


@pytest.fixture
def github():
    state = {"login": "claire-m", "pulls": [], "reviews": [], "comments": [], "submitted": [],
             "calls": []}
    handler = type("Handler", (FakeGitHub,), {"state": state})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host = GitHubHost("nordis", "annuaire", TOKEN,
                      api_url=f"http://127.0.0.1:{server.server_port}")
    yield host, state
    server.shutdown()
    server.server_close()


def test_github_cycle(github):
    """Critère 8, contre le faux serveur : créer, commenter, revues, fusionner."""
    host, state = github
    assert host.current_account() == "claire-m"
    pull = host.create_pull_request("prop/revenu-net-canonical-1", "Revenu net v5", "Corps")
    assert (pull.number, pull.branch, pull.author, pull.state) == (
        1, "prop/revenu-net-canonical-1", "claire-m", "open")
    host.add_comment(1, "Et les avoirs ?")
    host.submit_review(1, "approve", "")
    assert state["submitted"] == [{"event": "APPROVE", "body": ""}]
    state["reviews"] = [
        {"user": {"login": f"v{i}"}, "state": "APPROVED", "commit_id": "a" * 40,
         "submitted_at": "2026-10-30T10:30:00Z", "body": ""} for i in range(120)
    ] + [{"user": {"login": "brouillon"}, "state": "PENDING"},
         {"user": {"login": "marc-d"}, "state": "CHANGES_REQUESTED", "commit_id": "a" * 40}]
    reviews = host.get_reviews(1)
    assert len(reviews) == 121  # deux pages, la revue en attente écartée
    assert (reviews[-1].account, reviews[-1].state) == ("marc-d", "changes_requested")
    assert [c.body for c in host.list_comments(1)] == ["Et les avoirs ?"]
    assert [p.number for p in host.list_pull_requests("open")] == [1]
    with pytest.raises(RepoError) as error:
        host.merge(1, "b" * 40, "Fusion", "Atlas-Proposal: #1")
    assert error.value.code == "head_changed"
    assert host.merge(1, "a" * 40, "Fusion", "Atlas-Proposal: #1") == "m" * 40
    assert state["merged"]["merge_method"] == "merge"
    merged = host.get_pull_request(1)
    assert (merged.state, merged.merged_commit) == ("merged", "m" * 40)
    assert host.list_pull_requests("open") == []
    assert {call[2] for call in state["calls"]} == {f"Bearer {TOKEN}"}


@pytest.mark.parametrize(("status", "message", "expected"), [
    (405, "At least 1 approving review is required by reviewers with write access.",
     "branch_protected"),
    (405, "Repository rule violations found", "branch_protected"),
    (405, "Pull Request is not mergeable", "merge_conflict"),
    (403, "Resource not accessible by integration", "host_forbidden"),
])
def test_merge_errors(github, status, message, expected):
    """Critère 13 : une protection de branche remonte telle quelle, sans contournement."""
    host, state = github
    host.create_pull_request("prop/x-canonical-1", "x", "")
    state["merge_error"] = (status, {"message": message})
    with pytest.raises(RepoError) as error:
        host.merge(1, "a" * 40, "Fusion", "")
    assert error.value.code == expected
    assert [c[0] for c in state["calls"]].count("PUT") == 1  # aucune autre tentative
    assert TOKEN not in str(error.value)


def test_bad_token(github):
    host, _ = github
    host._token = "faux"
    with pytest.raises(RepoError) as error:
        host.current_account()
    assert error.value.code == "host_auth_failed" and "faux" not in str(error.value)
    host._token = None
    with pytest.raises(RepoError) as error:
        host.current_account()
    assert error.value.code == "host_auth_failed"


@pytest.mark.parametrize(("url", "expected"), [
    ("https://github.com/nordis/annuaire.git", ("nordis", "annuaire")),
    ("https://github.com/nordis/annuaire", ("nordis", "annuaire")),
    ("git@github.com:nordis/annuaire.git", ("nordis", "annuaire")),
    ("ssh://git@github.com/nordis/annuaire.git", ("nordis", "annuaire")),
    ("https://gitlab.com/nordis/annuaire.git", None),
    ("https://github.com/nordis", None),
])
def test_github_repository(url, expected):
    assert github_repository(url) == expected


def test_host_for(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_GITHUB_TOKEN", TOKEN)
    assert isinstance(host_for("https://github.com/nordis/annuaire.git"), GitHubHost)
    assert isinstance(host_for(str(tmp_path)), LocalHost)
    assert isinstance(host_for(tmp_path.as_uri()), LocalHost)
    for url, error_code in (("", "no_remote"), ("https://gitlab.com/n/a.git",
                                                "unsupported_host")):
        with pytest.raises(RepoError) as error:
            host_for(url)
        assert error.value.code == error_code
    assert remote_token("https://github.com/nordis/annuaire.git") == TOKEN
    assert remote_token("git@github.com:nordis/annuaire.git") is None  # SSH : clé de l'agent
    assert remote_token(str(tmp_path)) is None


def test_the_token_stays_out_of_urls_config_and_errors(atlas_env, tmp_path):
    """Critère 9 : git reçoit le jeton par un assistant d'identification en ligne de
    commande qui le lit dans l'environnement du seul sous-processus."""
    repo = tmp_path / "clone"
    git(tmp_path, "init", "--quiet", str(repo))
    url = "https://github.com/nordis/annuaire.git"
    git(repo, "remote", "add", "origin", url)
    filled = run_git(["credential", "fill"], repo, input="protocol=https\nhost=github.com\n\n",
                     token=TOKEN)
    assert f"password={TOKEN}" in filled.splitlines()
    assert "ATLAS_GIT_TOKEN" not in os.environ
    with pytest.raises(RepoError) as error:
        run_git(["ls-remote", f"http://127.0.0.1:9/{TOKEN}.git"], repo, timeout=20,
                token=TOKEN)
    assert TOKEN not in str(error.value) and "***" in str(error.value)
    config = (repo / ".git" / "config").read_text(encoding="utf-8")
    assert TOKEN not in config and git(repo, "remote", "get-url", "origin").strip() == url
    without = run_git(["credential", "fill"], repo,
                      input="protocol=https\nhost=example.org\nusername=u\npassword=p\n\n")
    assert TOKEN not in without


@pytest.mark.github
@pytest.mark.skipif(not (os.environ.get("ATLAS_GITHUB_TEST_REPO")
                         and os.environ.get("ATLAS_GITHUB_TOKEN")),
                    reason="ATLAS_GITHUB_TEST_REPO et ATLAS_GITHUB_TOKEN requis")
def test_real_github_reads():
    """Critère 8, lecture seule : compte et propositions d'un dépôt de test réel. Le
    cycle complet se joue à la main (README), avec deux comptes."""
    owner, repo = os.environ["ATLAS_GITHUB_TEST_REPO"].split("/", 1)
    host = GitHubHost(owner, repo, os.environ["ATLAS_GITHUB_TOKEN"])
    assert host.current_account()
    assert isinstance(host.list_pull_requests("all"), list)
