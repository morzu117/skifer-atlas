"""Contrats de sécurité et cas limites visibles par les utilisateurs."""

import json
import re

import pytest
from fastapi.testclient import TestClient

from skifer_atlas import cli, server
from skifer_atlas.api.app import create_app
from skifer_atlas.compile import CompileError, parse_calendar
from skifer_atlas.compile.calendar import aligned, load_calendars
from skifer_atlas.extract import extract_file, report_json, report_text


@pytest.fixture(autouse=True)
def donnees_isolees(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path / "donnees"))
    monkeypatch.setenv("ATLAS_VAULT", "memory")
    monkeypatch.delenv("ATLAS_TOKEN", raising=False)
    monkeypatch.delenv("ATLAS_DEV_NO_TOKEN", raising=False)
    monkeypatch.delenv("ATLAS_PARENT_PID", raising=False)


ROUTES = [
    (method.upper(), re.sub(r"\{[^}]+\}", "exemple", path))
    for path, operations in create_app(token="secret").openapi()["paths"].items()
    if path != "/alive"
    for method in operations
]


@pytest.mark.parametrize(("methode", "chemin"), ROUTES)
@pytest.mark.parametrize("autorisation", [None, "Bearer incorrect"])
def test_toutes_les_routes_protegees_refusent_un_token_absent_ou_invalide(
    methode, chemin, autorisation
):
    client = TestClient(create_app(token="secret"))
    headers = {} if autorisation is None else {"Authorization": autorisation}
    reponse = client.request(methode, chemin, headers=headers)
    assert reponse.status_code == 401
    assert reponse.json() == {"detail": "Token de session invalide."}


def test_serveur_ecoute_uniquement_sur_loopback_et_respecte_le_port(monkeypatch):
    configs = []
    monkeypatch.setenv("ATLAS_TOKEN", "secret")
    monkeypatch.setenv("ATLAS_PORT", "9876")
    monkeypatch.setenv("ATLAS_LOG_LEVEL", "warning")
    monkeypatch.setattr(server.lifeline, "parent_pid", lambda: None)

    class Serveur:
        def __init__(self, config):
            configs.append(config)

        def run(self):
            pass

    monkeypatch.setattr(server.uvicorn, "Server", Serveur)
    server.main()
    [config] = configs
    assert (config.host, config.port, config.log_level) == ("127.0.0.1", 9876, "warning")
    assert config.app.state.token == "secret"


@pytest.mark.parametrize("valeur", ["0", "true", "yes", "", " 1"])
def test_serveur_refuse_les_valeurs_non_explicites_du_mode_dev(valeur, monkeypatch, capsys):
    monkeypatch.setenv("ATLAS_DEV_NO_TOKEN", valeur)
    with pytest.raises(SystemExit) as erreur:
        server.main()
    assert erreur.value.code == 2
    assert "refuse de démarrer" in capsys.readouterr().err


def test_disparition_du_parent_demande_arret_et_programme_arret_force(monkeypatch, capsys):
    monkeypatch.setenv("ATLAS_TOKEN", "secret")
    monkeypatch.setattr(server.lifeline, "parent_pid", lambda: 123)
    surveillance, minuteurs, serveurs = [], [], []
    monkeypatch.setattr(server.lifeline, "watch", lambda pid, stop: surveillance.append((pid, stop)))

    class Minuteur:
        def __init__(self, delai, fonction, args):
            self.delai, self.fonction, self.args = delai, fonction, args
            self.daemon = False
            self.demarre = False
            minuteurs.append(self)

        def start(self):
            self.demarre = True

    class Serveur:
        def __init__(self, config):
            self.should_exit = False
            serveurs.append(self)

        def run(self):
            pass

    monkeypatch.setattr(server.threading, "Timer", Minuteur)
    monkeypatch.setattr(server.uvicorn, "Server", Serveur)
    server.main()
    [(pid, arreter)] = surveillance
    assert pid == 123 and not serveurs[0].should_exit
    arreter()
    assert serveurs[0].should_exit
    [minuteur] = minuteurs
    assert (minuteur.delai, minuteur.fonction, minuteur.args) == (
        server.SHUTDOWN_GRACE_SECONDS, server.os._exit, (0,)
    )
    assert minuteur.daemon and minuteur.demarre
    assert "Processus parent 123 disparu" in capsys.readouterr().err


@pytest.mark.parametrize(("texte", "message"), [
    ("periods: [", "YAML illisible"),
    ("periods: []", "sont requis"),
    ("periods:\n  - start: 2024-01-01\n    end: 2024-01-31", "période sans nom"),
    ("periods:\n  - name: janvier\n    start: impossible\n    end: 2024-01-31", "date « impossible » invalide"),
    ("periods:\n  - name: janvier\n    start: 2024-02-01\n    end: 2024-01-31", "finit avant"),
    ("periods:\n  - name: a\n    start: 2024-01-01\n    end: 2024-01-31\n  - name: b\n    start: 2024-01-31\n    end: 2024-02-29", "se chevauchent"),
])
def test_calendrier_invalide_explique_la_cause(texte, message):
    with pytest.raises(CompileError) as erreur:
        parse_calendar(texte, "fiscal.yaml")
    [issue] = erreur.value.issues
    assert issue.code == "invalid_calendar"
    assert "fiscal.yaml" in issue.message and message in issue.message


def test_calendrier_trie_les_periodes_et_verifie_les_bornes(tmp_path):
    (tmp_path / "fiscal.yaml").write_text(
        "version: 1\nperiods:\n  - {name: février, start: 2024-02-01, end: 2024-02-29}\n"
        "  - {name: janvier, start: 2024-01-01, end: 2024-01-31}\n", encoding="utf-8"
    )
    calendrier = load_calendars(tmp_path)["fiscal"]
    assert [p.name for p in calendrier.periods] == ["janvier", "février"]
    assert calendrier.grain == "month"
    assert calendrier.period("absente") is None
    assert aligned(calendrier, "month") and not aligned(calendrier, "year")
    assert load_calendars(tmp_path / "absent") == {}


def test_extraction_signale_les_instructions_non_requetes(tmp_path):
    fichier = tmp_path / "script.sql"
    fichier.write_text("UPDATE ventes SET prix = 1;\nSELECT * FROM ventes;\n", encoding="utf-8")
    resultat = extract_file(fichier, "databricks")
    rapport = json.loads(report_json([resultat]))[0]
    assert rapport["file"] == "script.sql"
    assert rapport["residues"][0]["code"] == "unsupported_statement"
    assert rapport["residues"][0]["line"] == 1
    assert len(rapport["statements"]) == 1
    assert "[unsupported_statement]" in report_text([resultat])


def test_extraction_refuse_un_dialecte_inconnu(tmp_path):
    with pytest.raises(ValueError, match="Dialecte inconnu : inconnu"):
        extract_file(tmp_path / "test.sql", "inconnu")


def test_cli_signale_un_fichier_sql_absent(tmp_path, capsys):
    statut = cli.main(["extract", str(tmp_path / "absent.sql"), "--dialect", "databricks"])
    assert statut == 1
    assert "fichier introuvable" in capsys.readouterr().err


def test_cli_validation_json_signale_un_yaml_invalide(tmp_path, capsys):
    fichier = tmp_path / "invalide.yaml"
    fichier.write_text("graph: [", encoding="utf-8")
    assert cli.main(["validate", "--format", "json", str(fichier)]) == 1
    [rapport] = json.loads(capsys.readouterr().out)
    assert rapport["valid"] is False
    assert rapport["errors"][0]["code"] == "invalid_yaml"


def test_cli_schema_ecrit_un_fichier_lisible(tmp_path):
    sortie = tmp_path / "schema.json"
    assert cli.main(["schema", "--out", str(sortie)]) == 0
    assert json.loads(sortie.read_text(encoding="utf-8"))["title"].startswith("Document Skifer Atlas")


def test_extraction_sans_requete_indique_le_fichier_et_la_ligne(tmp_path):
    fichier = tmp_path / "modification.sql"
    fichier.write_text("DELETE FROM ventes WHERE id = 1;\n", encoding="utf-8")
    resultat = extract_file(fichier, "snowflake")
    rapport = report_text([resultat])
    assert resultat.drafts == []
    assert "modification.sql : aucune requête" in rapport
    assert "modification.sql:1 [unsupported_statement]" in rapport


def test_cli_extraction_multirequetes_produit_un_rapport_et_des_brouillons(tmp_path, capsys):
    source = tmp_path / "deux.sql"
    source.write_text("SELECT id FROM ventes;\nSELECT id FROM clients;\n", encoding="utf-8")
    sortie = tmp_path / "brouillons"
    statut = cli.main(["extract", str(source), "--dialect", "databricks", "--out", str(sortie),
                       "--format", "json"])
    [rapport] = json.loads(capsys.readouterr().out)
    assert statut == 2  # Des informations de schéma restent à compléter.
    assert len(rapport["statements"]) == 2
    assert all(entree["residues"] for entree in rapport["statements"])
    assert {f.stem for f in sortie.glob("*.yaml")} == {
        entree["id"] for entree in rapport["statements"]
    }


def test_hote_local_signale_une_proposition_absente(tmp_path):
    from skifer_atlas.githost.local import LocalHost
    from skifer_atlas.repo.git import RepoError

    hote = LocalHost(tmp_path / "depot.git")
    assert hote.list_pull_requests() == []
    with pytest.raises(RepoError) as erreur:
        hote.get_pull_request(42)
    assert erreur.value.code == "not_found"
    assert erreur.value.message == "Proposition #42 introuvable."


def test_flux_github_refuse_sans_client_configure(monkeypatch):
    from skifer_atlas.githost import device
    from skifer_atlas.repo.git import RepoError

    monkeypatch.delenv("ATLAS_GITHUB_CLIENT_ID", raising=False)
    with pytest.raises(RepoError) as erreur:
        device.start()
    assert erreur.value.code == "github_not_configured"
    assert "Aucun client OAuth GitHub configuré" in erreur.value.message
