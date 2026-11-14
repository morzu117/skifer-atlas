"""Droits documentés : brief §5/§10.3, ADR 0017, 0021 et 0009.

Les réponses 409/422 du tableau attestent que la requête autorisée atteint ensuite
le contrôle métier ; chaque cas utilise un dépôt et un coffre isolés.
"""

import pytest
from fastapi.testclient import TestClient
from repo.workspace_helpers import atlas_env, remote

from skifer_atlas.api.app import create_app
from skifer_atlas.workspaces import get_workspace, update_workspace

__all__ = ["atlas_env", "remote"]

WS = "/api/workspaces/groupe-nordis"
ROLES = [
    ("lecteur", "visiteur", "lecteur"),
    ("contributeur", "anna.k", "contributeur"),
    ("referent_domaine", "claire.m", "referent"),
    ("referent_espace", "julien.h", "referent"),
]

# Oracle : brief §10.3 (création), ADR 0017 (brouillons), brief §5.1
# (proposition par un contributeur), ADR 0021 et 0009 (administration d'espace).
ROUTES = [
    ("POST", "/editor/documents", {"kind": "kpi", "id": "revenu-net", "label": "Revenu",
                                    "domain": "finance", "owner": "anna.k"},
     (403, 409, 409, 409)),
    ("POST", "/editor/variants", {"kpi_id": "revenu-net", "entity": "nordis-fr",
                                   "mode": "override", "owner": "anna.k",
                                   "justification": "Essai"}, (403, 409, 409, 409)),
    ("PUT", "/editor/documents/revenu-net/draft", {"document": {}}, (403, 200, 200, 200)),
    ("DELETE", "/editor/documents/revenu-net/draft", None, (403, 204, 204, 204)),
    ("POST", "/proposals", {"document_yaml": "kind: [", "justification": "Essai"},
     (403, 422, 422, 422)),
    ("POST", "/connections", {"access_point": {}, "justification": "Essai"},
     (403, 422, 422, 422)),
    ("POST", "/proposals/1/merge", "proposition", (403, 409, 409, 409)),
    ("GET", "/admin", None, (403, 403, 403, 200)),
    ("POST", "/admin/governance", "governance", (403, 403, 403, 422)),
    ("POST", "/governance", "governance", (403, 403, 403, 422)),
]


@pytest.mark.parametrize(("role", "compte", "role_registre"), ROLES, ids=[r[0] for r in ROLES])
@pytest.mark.parametrize(("methode", "chemin", "corps", "attendus"), ROUTES,
                         ids=[f"{r[0]} {r[1]}" for r in ROUTES])
def test_matrice_des_droits(atlas_env, remote, monkeypatch, role, compte, role_registre,
                             methode, chemin, corps, attendus):
    monkeypatch.setenv("ATLAS_VAULT", "memory")
    monkeypatch.setenv("ATLAS_ACCOUNT", "julien.h")
    client = TestClient(create_app(token="secret"), headers={"Authorization": "Bearer secret"})
    joined = client.post("/api/workspaces/join", json={"remote_url": str(remote[0])})
    assert joined.status_code == 201, joined.text
    if corps == "proposition":
        monkeypatch.setenv("ATLAS_ACCOUNT", "claire.m")
        yaml = (remote[1] / "kpis/revenu-net.yaml").read_text(encoding="utf-8")
        yaml = yaml.replace("Chiffre d'affaires facturé, taxes déduites", "Texte précisé", 1)
        creation = client.post(f"{WS}/proposals", json={"document_yaml": yaml,
                               "justification": "Essai", "base_version": 4})
        assert creation.status_code == 201, creation.text
        corps = {}
    if corps == "governance":
        response = client.get(f"{WS}/admin")
        assert response.status_code == 200
        etat = response.json()
        corps = {"governance": etat["governance"]}
        if chemin == "/governance":
            corps["justification"] = "Essai"
        else:
            corps["base_digest"] = etat["base_digest"]
    monkeypatch.setenv("ATLAS_ACCOUNT", compte)
    workspace = get_workspace("groupe-nordis")
    update_workspace(workspace.model_copy(update={"account": compte, "role": role_registre}))
    reponse = client.request(methode, WS + chemin, json=corps)
    assert reponse.status_code == attendus[[r[0] for r in ROLES].index(role)], reponse.text
    if reponse.status_code == 403:
        assert reponse.json()["detail"]["code"] == "forbidden"
    elif reponse.status_code == 409:
        assert reponse.json()["detail"]["code"] in {"document_exists", "not_ready"}
    elif reponse.status_code == 422:
        assert reponse.json()["detail"]["code"] in {"invalid_document", "invalid_access_point", "no_change"}
