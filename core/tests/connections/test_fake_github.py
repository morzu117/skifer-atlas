"""Le faux GitHub des parcours de bout en bout : pull requests et fusion pilotée (plan 0006)."""

import json
import threading
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen

import fake_github
import pytest

from skifer_atlas.githost import GitHubHost
from skifer_atlas.repo.git import RepoError


@pytest.fixture
def host():
    fake_github.PULLS.clear()
    server = ThreadingHTTPServer(("127.0.0.1", 0), fake_github.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}"
    yield GitHubHost("e2e-atlas", "depot", fake_github.TOKEN, api_url=url), url
    fake_github.SETTINGS["merge_error"] = None
    server.shutdown()
    server.server_close()


def configure(url, **body):
    request = Request(f"{url}/__test__/configure", json.dumps(body).encode(),
                      {"Content-Type": "application/json"})
    assert json.load(urlopen(request))["configured"] is True


def test_pull_requests_are_created_listed_and_merged(host):
    github, _ = host
    pull = github.create_pull_request("prop/x-1", "Titre", "Corps")
    assert (pull.number, pull.branch, pull.author, pull.state) == (1, "prop/x-1", "julien.h", "open")
    assert [p.number for p in github.list_pull_requests("open")] == [1]
    assert github.get_reviews(1) == [] and github.list_comments(1) == []
    github.merge(1, pull.head, "Fusion", "")
    assert github.get_pull_request(1).state == "merged"


def test_the_merge_answers_what_the_test_route_asks(host):
    github, url = host
    pull = github.create_pull_request("prop/x-1", "Titre", "Corps")
    configure(url, merge_error={"status": 405, "message": "Repository rule violations found"})
    with pytest.raises(RepoError) as error:
        github.merge(1, pull.head, "Fusion", "")
    assert error.value.code == "branch_protected"
    assert github.get_pull_request(1).state == "open"
    configure(url)
    github.merge(1, pull.head, "Fusion", "")
