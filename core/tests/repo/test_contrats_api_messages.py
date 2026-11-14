"""Messages des routes avec session valide, sur un vrai dépôt temporaire."""

import pytest
from test_catalog_api import WS, atlas_env, client, joined, remote

__all__ = ["atlas_env", "client", "joined", "remote"]


@pytest.fixture(autouse=True)
def coffre_en_memoire(monkeypatch):
    monkeypatch.setenv("ATLAS_VAULT", "memory")
    monkeypatch.delenv("ATLAS_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("ATLAS_GITHUB_CLIENT_ID", raising=False)


@pytest.mark.parametrize("suffixe", [
    "/documents/absent",
    "/documents/absent/summary",
    "/documents/absent/versions",
    "/documents/absent/versions/1",
    "/documents/absent/dependencies",
    "/documents/absent/sheet",
    "/documents/absent/draft",
])
def test_catalogue_et_fiche_nomment_le_document_absent(client, joined, suffixe):
    response = client.get(WS + suffixe)
    assert response.status_code == 404
    assert response.json() == {"detail": {"code": "not_found", "message": "Document « absent » introuvable."}}


def test_catalogue_nommes_la_version_absente(client, joined):
    response = client.get(f"{WS}/documents/revenu-net/versions/99")
    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "not_found", "message": "Version 99 de « revenu-net » introuvable."
    }


@pytest.mark.parametrize("suffixe", ["/catalog", "/catalog/facets", "/index", "/governance", "/github"])
def test_lecture_d_un_espace_inconnu_explique_son_absence(client, suffixe):
    response = client.get("/api/workspaces/absent" + suffixe)
    assert response.status_code == 404
    assert response.json()["detail"] == {"code": "not_found", "message": "Espace « absent » inconnu."}


def test_github_sans_connexion_ne_renvoie_pas_de_secret(client, joined):
    response = client.get(f"{WS}/github")
    assert response.status_code == 200
    assert response.json() == {"configured": False, "applies": False, "state": "absent",
                               "source": None, "account": None}
    response = client.delete(f"{WS}/github")
    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "not_found", "message": "Aucune connexion GitHub pour cet espace."
    }


def test_device_github_sans_configuration_signale_comment_la_corriger(client):
    response = client.post("/api/github/device", json={})
    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "github_not_configured",
        "message": "Aucun client OAuth GitHub configuré pour Atlas (ATLAS_GITHUB_CLIENT_ID).",
    }


def test_device_github_expire_demande_de_recommencer(client):
    response = client.post("/api/github/device/flux-inconnu", json={})
    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "not_found", "message": "Connexion GitHub inconnue ou expirée : recommencer."
    }


def test_gouvernance_expose_la_situation_du_membre(client, joined):
    response = client.get(f"{WS}/governance")
    assert response.status_code == 200
    data = response.json()
    assert set(data) == {"governance", "issues", "account", "role", "single_referent", "git_remote"}
    assert data["account"] == "julien.h"
    assert data["role"] == "referent"
    assert data["single_referent"] is True
    assert [(issue["code"], issue["message"]) for issue in data["issues"]] == [
        ("domain_without_referent", "Le domaine « Marketing » n'a pas de référent.")
    ]
    assert {"members", "domains", "validators_required", "allowed_platforms"} <= data["governance"].keys()


@pytest.mark.parametrize(("method", "path", "body", "message"), [
    ("POST", "/documents", {"kind": "kpi", "id": "nouveau", "label": "Nouveau",
                             "domain": "finance", "owner": "anna.k"},
     "Un lecteur ne crée pas de document."),
    ("POST", "/variants", {"kpi_id": "revenu-net", "entity": "nordis-fr", "mode": "override",
                            "owner": "anna.k", "justification": "Essai"},
     "Un lecteur ne crée pas de déclinaison."),
    ("PUT", "/documents/revenu-net/draft", {"document": {}},
     "Un lecteur ne modifie pas de brouillon."),
    ("DELETE", "/documents/revenu-net/draft", None,
     "Un lecteur ne supprime pas de brouillon."),
])
def test_editeur_explique_les_droits_du_lecteur(client, joined, method, path, body, message):
    from skifer_atlas.paths import workspace_dir
    from skifer_atlas.workspaces import get_workspace, update_workspace

    workspace = get_workspace("groupe-nordis")
    update_workspace(workspace.model_copy(update={"role": "lecteur"}))
    response = client.request(method, f"{WS}/editor{path}", json=body)
    assert response.status_code == 403
    assert response.json()["detail"] == {"code": "forbidden", "message": message}
    assert not (workspace_dir("groupe-nordis") / ".atlas/drafts/revenu-net.json").exists()


def test_device_github_en_attente_retourne_le_code_public_sans_le_code_secret(client, monkeypatch):
    from skifer_atlas.githost import device

    monkeypatch.setenv("ATLAS_GITHUB_CLIENT_ID", "client")
    monkeypatch.setattr(device, "_flows", {})
    appels = []

    def repondre(path, fields):
        appels.append((path, fields))
        if path.endswith("/device/code"):
            return {"device_code": "code-secret", "user_code": "ABCD-1234",
                    "verification_uri": "https://github.com/login/device", "expires_in": 600,
                    "interval": 5}
        return {"error": "authorization_pending"}

    monkeypatch.setattr(device, "_post", repondre)
    response = client.post("/api/github/device", json={})
    assert response.status_code == 200
    data = response.json()
    assert {key: data[key] for key in ("user_code", "verification_uri", "expires_in", "interval")} == {
        "user_code": "ABCD-1234", "verification_uri": "https://github.com/login/device",
        "expires_in": 600, "interval": 5}
    assert "code-secret" not in response.text
    suivi = client.post(f"/api/github/device/{data['flow']}", json={})
    assert suivi.status_code == 200
    assert suivi.json() == {"status": "pending", "interval": 5}
    assert "code-secret" not in suivi.text
    assert appels[-1][1]["device_code"] == "code-secret"


def test_comparaison_absente_et_annulation_expliquent_leur_etat(client, joined):
    response = client.get(f"{WS}/comparisons/42")
    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "not_found", "message": "Comparaison 42 introuvable."
    }
    response = client.post(f"{WS}/comparisons/42/cancel")
    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "not_found", "message": "Comparaison 42 introuvable."
    }


def test_comparaisons_sans_resultat_renvoie_une_liste_vide(client, joined):
    response = client.get(f"{WS}/comparisons", params={"kpi": "revenu-net"})
    assert response.status_code == 200
    assert response.json() == []


def test_proposition_inexistante_donne_un_message_lisible(client, joined):
    response = client.get(f"{WS}/proposals/42")
    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "not_found", "message": "Proposition #42 introuvable."
    }


def test_editeur_refuse_un_yaml_malforme_sans_perdre_le_diagnostic(client, joined):
    response = client.post(f"{WS}/editor/parse", json={"text": "graph: ["})
    assert response.status_code == 200
    data = response.json()
    assert data["document"] is None
    [issue] = data["issues"]
    assert issue["code"] == "invalid_yaml"
    assert "YAML illisible" in issue["message"]
    assert issue["severity"] == "error"


@pytest.mark.parametrize(("method", "suffixe", "body"), [
    ("GET", "/status", None),
    ("POST", "/authorize", {}),
    ("PUT", "/key-pair", {"user": "alice", "private_key_file": "/absent"}),
    ("PUT", "/token", {"token": "jeton-test"}),
    ("POST", "/test", {}),
    ("DELETE", "/token", None),
])
def test_connexions_indiquent_le_point_d_acces_absent(client, joined, method, suffixe, body):
    response = client.request(method, f"{WS}/connections/absent{suffixe}", json=body)
    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "not_found", "message": "Point d'accès « absent » inconnu."
    }
    assert "jeton-test" not in response.text


def test_connexion_brouillon_oubliee_deja_absente(client, joined):
    liste = client.get(f"{WS}/access-point-draft/credentials")
    assert liste.status_code == 200 and liste.json() == []
    response = client.delete(f"{WS}/access-point-draft/credentials/absent")
    assert response.status_code == 404
    assert response.json()["detail"] == {"code": "not_found", "message": "Brouillon inconnu."}


@pytest.mark.parametrize("compte", ["anna.k", "claire.m", "visiteur"])
def test_gouvernance_refuse_les_non_referents_d_espace_avec_un_message(client, joined, monkeypatch, compte):
    monkeypatch.setenv("ATLAS_ACCOUNT", compte)
    response = client.post(f"{WS}/governance", json={"governance": {}, "justification": "Essai"})
    assert response.status_code == 403
    assert response.json()["detail"] == {
        "code": "forbidden",
        "message": "Seul un référent de l'espace propose une modification de la gouvernance.",
    }


def test_comparaison_precise_les_points_d_acces_ambigus(client, joined, monkeypatch):
    import yaml

    from skifer_atlas.workspaces import repo_dir

    monkeypatch.delenv("ATLAS_COMPARE_DATA", raising=False)
    points = [{"id": nom, "platform": "databricks", "host": "https://adb.example.com",
               "warehouse_id": "abc", "entity": "nordis-de", "owner": "claire.m"}
              for nom in ("dbx-un", "dbx-deux")]
    chemin = repo_dir("groupe-nordis") / "access_points.yaml"
    chemin.write_text(yaml.safe_dump({"schema_version": 1, "access_points": points}),
                      encoding="utf-8")
    demande = {"kpi_id": "revenu-net", "variants": ["nordis-de"],
               "scope_id": "fy2026-mois-entite"}
    response = client.post(f"{WS}/comparisons/preview", json=demande)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "ambiguous_access_point"
    assert "Plusieurs points d'accès databricks" in detail["message"]
    assert "nordis-de" in detail["message"]
    assert "dbx-un" in detail["message"] and "dbx-deux" in detail["message"]
    assert client.get(f"{WS}/comparisons").json() == []
