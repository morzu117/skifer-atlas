"""Erreurs et renouvellement OAuth sans ouvrir de port ni utiliser le trousseau."""

import pytest

from skifer_atlas.connectors import oauth
from skifer_atlas.connectors.http import Response
from skifer_atlas.repo.git import RepoError
from skifer_atlas.vault.model import Credential

ENDPOINTS = oauth.Endpoints("https://example.test/authorize", "https://example.test/token",
                            "https://example.test/revoke")


def test_renouvellement_conserve_l_ancien_jeton_et_l_origine(monkeypatch):
    appels = []

    def repondre(method, url, *, form):
        appels.append((method, url, form))
        return Response(200, {"access_token": "nouveau", "expires_in": 3600})

    monkeypatch.setattr(oauth, "request", repondre)
    monkeypatch.setattr(oauth.time, "time", lambda: 1000)
    avant = Credential("oauth", "ancien", "rafraichissement", client_id="client", host="hote")
    apres = oauth.refresh(ENDPOINTS, avant)
    assert (apres.access_token, apres.refresh_token, apres.expires_at, apres.host) == (
        "nouveau", "rafraichissement", 4600, "hote")
    assert appels == [("POST", ENDPOINTS.token, {
        "grant_type": "refresh_token", "client_id": "client",
        "refresh_token": "rafraichissement"})]


@pytest.mark.parametrize("statut", [400, 401])
def test_renouvellement_refuse_impose_une_reconnexion(monkeypatch, statut):
    monkeypatch.setattr(oauth, "request", lambda *args, **kw: Response(statut, {}))
    with pytest.raises(oauth.RefreshRefused):
        oauth.refresh(ENDPOINTS, Credential("oauth", "ancien", "rafraichissement"))


def test_renouvellement_sans_jeton_ne_contacte_pas_le_serveur(monkeypatch):
    appels = []
    monkeypatch.setattr(oauth, "request", lambda *args, **kw: appels.append(args))
    with pytest.raises(oauth.RefreshRefused):
        oauth.refresh(ENDPOINTS, Credential("oauth", "ancien"))
    assert appels == []


def test_renouvellement_en_erreur_indique_le_statut_sans_secret(monkeypatch):
    monkeypatch.setattr(oauth, "request", lambda *args, **kw: Response(503, {"secret": "jeton"}))
    with pytest.raises(RepoError) as erreur:
        oauth.refresh(ENDPOINTS, Credential("oauth", "ancien", "rafraichissement"))
    assert erreur.value.code == "oauth_failed"
    assert erreur.value.message == "Rafraîchissement impossible (HTTP 503)."


def test_revocation_tente_les_deux_jetons_meme_si_le_premier_echoue(monkeypatch):
    appels = []

    def repondre(method, url, *, form):
        appels.append((method, url, form))
        return Response(500 if len(appels) == 1 else 200, {})

    monkeypatch.setattr(oauth, "request", repondre)
    credential = Credential("oauth", "acces", "rafraichissement", client_id="client")
    assert oauth.revoke(ENDPOINTS, credential) is False
    assert [appel[2]["token_type_hint"] for appel in appels] == ["refresh_token", "access_token"]
    assert [appel[2]["token"] for appel in appels] == ["rafraichissement", "acces"]


def test_sans_endpoint_de_revocation_aucun_jeton_n_est_transmis(monkeypatch):
    appels = []
    monkeypatch.setattr(oauth, "request", lambda *args, **kw: appels.append(args))
    assert oauth.revoke(oauth.Endpoints("a", "b"), Credential("oauth", "acces")) is False
    assert appels == []


def test_echange_sans_jeton_d_acces_est_refuse(monkeypatch):
    monkeypatch.setattr(oauth, "request", lambda *args, **kw: Response(200, {"expires_in": 60}))
    with pytest.raises(RepoError) as erreur:
        oauth.exchange(ENDPOINTS, "client", "code", "verificateur", "http://localhost:8020")
    assert erreur.value.code == "oauth_failed"
    assert erreur.value.message == "Réponse OAuth sans jeton d'accès."


def test_decouverte_oauth_refuse_les_metadonnees_incompletes(monkeypatch):
    from skifer_atlas.connectors.access_points import AccessPoint

    point = AccessPoint.model_validate({"id": "dbx", "platform": "databricks",
                                        "host": "https://adb.example.com",
                                        "warehouse_id": "abc", "owner": "claire.m"})
    monkeypatch.setattr(oauth, "request", lambda *args, **kw: Response(200, {
        "authorization_endpoint": "https://adb.example.com/authorize"}))
    with pytest.raises(RepoError) as erreur:
        oauth.discover(point)
    assert erreur.value.code == "oauth_unavailable"
    assert "OAuth indisponible" in erreur.value.message
    assert "utiliser un token personnel" in erreur.value.message
