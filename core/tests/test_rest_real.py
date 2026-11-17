"""Sonde manuelle REST, jamais configurée en CI (plan 0036, critère 33)."""

import os

import pytest

from skifer_atlas.connectors.http import ApiKey, get


@pytest.mark.rest
def test_real_provider():
    origin = os.environ.get("ATLAS_REST_TEST_ORIGIN")
    key = os.environ.get("ATLAS_REST_TEST_KEY")
    path = os.environ.get("ATLAS_REST_TEST_PATH")
    if not all((origin, key, path)):
        pytest.skip("Fournisseur REST non configuré.")
    response = get(origin + path, origin=origin, key=ApiKey(key, "query",
        os.environ.get("ATLAS_REST_TEST_KEY_NAME", "apikey")))
    assert response.status == 200
