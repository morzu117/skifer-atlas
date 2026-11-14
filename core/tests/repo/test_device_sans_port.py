"""Diagnostics du device flow GitHub sans serveur HTTP ni coffre système."""

import io
import urllib.error

import pytest

from skifer_atlas.githost import device
from skifer_atlas.repo.git import RepoError


@pytest.fixture(autouse=True)
def environnement_isole(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ATLAS_VAULT", "memory")
    monkeypatch.setenv("ATLAS_GITHUB_CLIENT_ID", "client-test")
    monkeypatch.setattr(device, "_flows", {})


@pytest.mark.parametrize(("corps", "attendu"), [
    (b'{"error":"access_denied"}', {"error": "access_denied"}),
    (b"", {}),
])
def test_erreur_http_json_reste_lisible_par_le_flux(monkeypatch, corps, attendu):
    def refuser(requete, timeout):
        raise urllib.error.HTTPError(requete.full_url, 400, "refusé", {}, io.BytesIO(corps))

    monkeypatch.setattr(device.urllib.request, "urlopen", refuser)
    assert device._post("/login/device/code", {"client_id": "client"}) == attendu


def test_erreur_http_non_json_ne_revele_pas_le_corps(monkeypatch):
    def refuser(requete, timeout):
        raise urllib.error.HTTPError(requete.full_url, 502, "refusé", {},
                                     io.BytesIO(b"secret dans la page"))

    monkeypatch.setattr(device.urllib.request, "urlopen", refuser)
    with pytest.raises(RepoError) as erreur:
        device._post("/login/device/code", {"client_id": "client"})
    assert erreur.value.code == "device_flow_failed"
    assert erreur.value.message == "GitHub a répondu 502."


def test_demande_de_code_refusee_reste_explicite(monkeypatch):
    monkeypatch.setattr(device, "_post", lambda *args: {"error": "access_denied"})
    with pytest.raises(RepoError) as erreur:
        device.start()
    assert erreur.value.code == "device_flow_failed"
    assert "GitHub a refusé la demande de code : access_denied" in erreur.value.message


def test_jeton_d_un_flux_inacheve_ne_peut_servir_a_rejoindre(monkeypatch):
    flow = device.Flow("identifiant", None, "secret", 5, float("inf"))
    monkeypatch.setitem(device._flows, flow.id, flow)
    with pytest.raises(RepoError) as erreur:
        device.pending(flow.id)
    assert erreur.value.code == "not_found"
    assert "inachevée" in erreur.value.message
    assert "secret" not in erreur.value.message
