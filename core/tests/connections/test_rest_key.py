"""Clé REST : coffre d'abord, environnement seulement sans trousseau (ADR 0053)."""

import os
import secrets

import pytest
from test_rest_access_points import point, space, write_points

from skifer_atlas import connections
from skifer_atlas.repo.git import RepoError
from skifer_atlas.vault import Credential, Vault
from skifer_atlas.vault.keyring_vault import MemoryKeyring

__all__ = ["space"]


def test_rest_key_source_order(space, monkeypatch):
    from skifer_atlas.vault import keyring_vault

    write_points(space, [point()])
    p = connections.access_point("exemple", "api-exemple")
    key = secrets.token_urlsafe(24)
    monkeypatch.setenv("ATLAS_REST_KEY_API_EXEMPLE", key)
    vault = Vault(MemoryKeyring())
    env_get = os.environ.get

    def refuse_env_read(name, default=None):
        assert name != "ATLAS_REST_KEY_API_EXEMPLE", "Le coffre disponible interdit ce repli."
        return env_get(name, default)

    with monkeypatch.context() as guard:
        guard.setattr(os.environ, "get", refuse_env_read)
        with pytest.raises(RepoError) as caught:
            connections.rest_key("exemple", p, vault)
        assert caught.value.code == "not_connected"
        vault.put("exemple", p.id, Credential("apikey", key, host=p.host))
        assert connections.rest_key("exemple", p, vault) == (key, "vault")

    def unavailable():
        raise RepoError("vault_unavailable", "Sans trousseau.")

    monkeypatch.setattr(keyring_vault, "system_keyring", unavailable)
    assert connections.rest_key("exemple", p) == (key, "env")
    monkeypatch.delenv("ATLAS_REST_KEY_API_EXEMPLE")
    with pytest.raises(RepoError) as caught:
        connections.rest_key("exemple", p)
    assert caught.value.code == "vault_unavailable"


def test_apikey_credential_states():
    key = secrets.token_urlsafe(24)
    credential = Credential("apikey", key)
    assert credential.state() == "connected" and not credential.needs_refresh()
    assert credential.describe() == {"kind": "apikey", "my_access": "connected",
                                     "expires_in_days": None}
    assert key not in repr(credential)
    credential.rejected = True
    assert credential.state() == "expired"


def test_env_variable_names_never_collide():
    import itertools
    import string

    names = set()
    for length in (2, 3):
        for first in string.ascii_lowercase + string.digits:
            for rest in itertools.product(string.ascii_lowercase + string.digits + "-",
                                          repeat=length - 1):
                name = connections.rest_key_variable(first + "".join(rest))
                assert name not in names
                names.add(name)
    assert connections.rest_key_variable("ma-source") == "ATLAS_REST_KEY_MA_SOURCE"


def test_env_key_is_never_written(space, monkeypatch):
    from keyring.errors import KeyringError

    from skifer_atlas.vault import keyring_vault

    write_points(space, [point()])
    key = secrets.token_urlsafe(24)
    monkeypatch.setenv("ATLAS_REST_KEY_API_EXEMPLE", key)
    before = dict(os.environ)

    backend = MemoryKeyring()
    vault = Vault(backend)
    vault.put("exemple", "api-exemple", Credential("apikey", key, host="api.exemple.test"))
    assert vault.get("exemple", "api-exemple").access_token == key
    vault.delete("exemple", "api-exemple")
    monkeypatch.setattr(keyring_vault, "system_keyring", lambda: backend)

    def unavailable(*args):
        raise KeyringError("Lecture indisponible, écritures possibles.")

    with monkeypatch.context() as reading:
        reading.setattr(backend, "get_password", unavailable)
        connections.ensure_usable("exemple", "api-exemple")
        found = connections.status("exemple", "api-exemple")
        assert found["key_source"] == "env" and found["my_access"] == "connected"
        assert connections.list_connections("exemple")[0]["key_source"] == "env"
    assert vault.get("exemple", "api-exemple") is None
    for path in space.parents[2].rglob("*"):
        if path.is_file():
            assert key.encode() not in path.read_bytes()
    assert dict(os.environ) == before


def test_key_bound_to_host(space):
    write_points(space, [point()])
    p = connections.access_point("exemple", "api-exemple")
    vault = Vault(MemoryKeyring())
    vault.put("exemple", p.id, Credential("apikey", secrets.token_urlsafe(24), host="other.test"))
    with pytest.raises(RepoError) as caught:
        connections.rest_key("exemple", p, vault)
    assert caught.value.code == "access_host_mismatch"


def test_check_access_rest_states(space, monkeypatch):
    from types import SimpleNamespace

    from skifer_atlas.compare.service import check_access
    from skifer_atlas.vault import keyring_vault

    write_points(space, [point()])
    keyring_vault._memory._items.clear()
    prepared = SimpleNamespace(plans=[SimpleNamespace(access_point="api-exemple")])
    with pytest.raises(RepoError) as caught:
        check_access("exemple", prepared)
    assert caught.value.code == "needs_auth"

    def unavailable():
        raise RepoError("vault_unavailable", "Sans trousseau.")

    monkeypatch.setattr(keyring_vault, "system_keyring", unavailable)
    with pytest.raises(RepoError) as caught:
        check_access("exemple", prepared)
    assert caught.value.code == "vault_unavailable"
    monkeypatch.setenv("ATLAS_REST_KEY_API_EXEMPLE", secrets.token_urlsafe(24))
    check_access("exemple", prepared)
