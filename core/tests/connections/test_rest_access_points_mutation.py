"""Validation et construction des adresses REST."""

import pytest
import yaml
from test_rest_access_points import point

from skifer_atlas.connectors.rest_access_points import RestAccessPoint, parse_rest_access_points
from skifer_atlas.model.errors import Issue


def test_warnings_and_yaml_message():
    found, issues = parse_rest_access_points(yaml.safe_dump({"access_points": [point()]}), None)
    assert found is not None
    assert issues == [Issue("/access_points/0", None, "rest_no_budget",
                            "Aucun budget REST déclaré.", "warning")]
    assert parse_rest_access_points("[broken", None) == (None, [
        Issue("", None, "invalid_yaml", "rest_access_points.yaml n'est pas un YAML lisible.")])


@pytest.mark.parametrize("path", ["relative", "//other", "/a/../b", "/a//b", "/a?x=1", "/a\\b"])
def test_call_path_rejected_exactly(path):
    with pytest.raises(ValueError) as caught:
        RestAccessPoint(**point()).call_url(path)
    assert str(caught.value) == "Chemin d'appel invalide."


def test_call_url_and_public():
    access = RestAccessPoint(**point(http_path="/v1/", calls_per_minute=2))
    assert access.call_url("/items") == "https://api.exemple.test/v1/items"
    assert access.base_url == "api.exemple.test"
    assert access.auth_mode == "apikey"
    assert access.public() == {"id": "api-exemple", "platform": "rest", "host": "api.exemple.test",
        "http_path": "/v1/", "owner": "exemple.owner", "key_in": "query", "key_name": "apikey",
        "calls_per_minute": 2}


def test_path_suffix_and_individual_budget_warnings():
    access = RestAccessPoint(**point(http_path="/v1X/", calls_per_minute=1))
    assert access.call_url("/items") == "https://api.exemple.test/v1X/items"
    for changes in ({"calls_per_minute": 1}, {"bytes_per_day": 100}):
        found, issues = parse_rest_access_points(yaml.safe_dump({"access_points": [point(**changes)]}), None)
        assert found is not None
        assert issues == []
