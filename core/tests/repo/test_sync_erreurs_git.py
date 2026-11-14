"""Les erreurs Git distantes deviennent des diagnostics compréhensibles sans fuite."""

import pytest

from skifer_atlas.repo import sync
from skifer_atlas.repo.git import RepoError


@pytest.mark.parametrize(("sortie", "code", "message"), [
    ("fatal: repository not found", "remote_not_found", "Dépôt introuvable"),
    ("fatal: Authentication failed", "host_auth_failed", "refuse l'authentification"),
    ("remote: Permission to depot denied to user", "remote_not_writable", "droit de pousser"),
    ("fatal: DNS resolution failed", "host_unreachable", "dépôt distant est injoignable"),
])
def test_lecture_des_refs_explique_l_erreur_sans_divulguer_la_sortie(
    monkeypatch, sortie, code, message
):
    def refuser(*args, **kwargs):
        raise RepoError("git_failed", "secret brut", output=sortie + " jeton-confidentiel")

    monkeypatch.setattr(sync, "run_git", refuser)
    with pytest.raises(RepoError) as erreur:
        sync._remote_refs("https://example.test/depot.git", "jeton-confidentiel")
    assert erreur.value.code == code
    assert message in erreur.value.message
    assert "jeton-confidentiel" not in erreur.value.message
    assert erreur.value.output == ""
