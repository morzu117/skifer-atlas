"""Frontière HTTP REST sans redirection ni restitution de secrets (plan 0036)."""

import secrets
import sys
import threading
from pathlib import Path
from urllib.parse import quote, urlencode, urlunsplit

import pytest
from fake_rest import FakeRest

from skifer_atlas.connectors import http
from skifer_atlas.masking import mask_url
from skifer_atlas.repo.git import RepoError

sys.path.insert(0, str(Path(__file__).parents[1] / "compare"))
from test_rest_runner import save_dataset, setup_rest, space

__all__ = ["setup_rest", "space"]


def test_mask_unit():
    key = secrets.token_urlsafe(24) + "/+"
    credential = http.ApiKey(key, "query", "apikey", "")
    assert key not in repr(credential)
    url = urlunsplit(("https", "api.exemple.test", "/v1", urlencode({"apikey": key, "x": 1}), ""))
    assert key not in mask_url(url, "apikey") and quote(key, safe="") not in mask_url(url, "apikey")
    assert "x=1" in mask_url(url, "apikey")
    assert key not in http.message_of({"message": "x" * 295 + key}, key)


def test_next_url_other_host_refused():
    with FakeRest() as first, FakeRest() as other:
        key = http.ApiKey(first.key, "query", "apikey", "")
        with pytest.raises(RepoError) as caught:
            http.get(other.url + "/v1/data", key=key, origin=first.url)
        assert caught.value.code == "rest_next_url_refused" and other.requests == []


def test_redirect_not_followed():
    with FakeRest() as first, FakeRest() as other:
        first.replies = [(302, {}, {"Location": other.url + "/v1/data"})]
        reply = http.get(first.url + "/v1/data", key=http.ApiKey(first.key, "query", "apikey", ""),
                         origin=first.url)
        assert reply.status == 302 and len(first.requests) == 1 and not other.requests


def test_get_is_bounded_and_replaces_query_key():
    with FakeRest() as server:
        key = http.ApiKey(server.key, "query", "apikey", "")
        reply = http.get(server.url + "/v1/data?apikey=old", key=key, origin=server.url)
        assert reply.body == server.rows and reply.size > 0
        assert server.requests[0][1]["apikey"] == [server.key]
        with pytest.raises(RepoError) as caught:
            http.get(server.url + "/v1/data", key=key, origin=server.url, max_bytes=1)
        assert caught.value.code == "rest_response_too_large"


@pytest.mark.parametrize("status,code", [(401, "access_expired"), (402, "rest_payment_required"),
    (403, "rest_forbidden"), (500, "rest_server_error"), (400, "rest_http_error"),
    (200, "rest_error_body")])
def test_errors_map_to_codes(space, setup_rest, status, code):
    from skifer_atlas import connections
    from skifer_atlas.compare.rest_runner import RestRunner

    server, ds, compiled, plan = setup_rest
    ds["error_keys"] = ["error"]
    save_dataset(space, ds)
    server.replies = [(status, {"error": server.key}, {})]
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert caught.value.code == code and server.key not in str(caught.value)
    assert len(server.requests) == 1
    assert connections.status("exemple", "api-exemple")["my_access"] == (
        "expired" if status == 401 else "connected")


@pytest.mark.parametrize("headers,requests", [({}, 1), ({"Retry-After": "0"}, 2),
    ({"retry-after": "0"}, 2),
    ({"Retry-After": "61"}, 1), ({"Retry-After": "bad"}, 1)])
def test_429_retries_once(setup_rest, headers, requests):
    from skifer_atlas.compare.rest_runner import RestRunner

    server, _ds, compiled, plan = setup_rest
    server.replies = [(429, {}, headers)] * 3
    with pytest.raises(RepoError) as caught:
        RestRunner("exemple")(plan, compiled, threading.Event())
    assert caught.value.code == "rate_limited" and len(server.requests) == requests


def test_network_failure_never_includes_url_or_key():
    server = FakeRest()
    target = server.url + "/v1/data"
    key = http.ApiKey(server.key, "query", "apikey", "")
    server.close()
    with pytest.raises(RepoError) as caught:
        http.get(target, key=key, origin=server.url, timeout=0.5)
    assert caught.value.code == "host_unreachable"
    assert target not in str(caught.value) and key.value not in str(caught.value)
