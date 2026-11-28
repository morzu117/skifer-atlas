"""Contrat du chargeur contre le faux service BigQuery."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from skifer_atlas.compile import SourceTable
from skifer_atlas.repo.git import RepoError

sys.path.insert(0, str(Path(__file__).parent))
import bigquery_recette as recette
from connections.fake_bigquery import FakeBigQuery


@pytest.fixture
def service():
    fake = FakeBigQuery()
    yield fake
    fake.close()


def loader(service, path):
    token = service.state.token
    return recette.Recette(recette.connector("projet-test", token, host=service.url),
                            "recette", path, token)


def source(folder):
    (folder / "ventes.clients.csv").write_text("id,pays\n1,FR\n", encoding="utf-8")
    return [SourceTable("ventes.clients", (("id", "integer"), ("pays", "string")))]


def test_jeu_existant_conserve(service, tmp_path):
    service.state.datasets["recette"] = {"labels": {}, "tables": {}}
    r = loader(service, tmp_path / "etat.json")
    r.setup()
    r.load(source(tmp_path), tmp_path)
    assert len(service.state.datasets["recette"]["tables"]) == 1
    r.drop()
    assert service.state.datasets["recette"]["tables"] == {}
    assert not r.path.exists()


def test_jeu_cree_puis_supprime(service, tmp_path):
    r = loader(service, tmp_path / "etat.json")
    r.setup()
    assert service.state.datasets["recette"]["labels"]["atlas_recette"] == r.state["marker"]
    r.load(source(tmp_path), tmp_path)
    r.drop()
    assert "recette" not in service.state.datasets
    assert not r.path.exists()


def test_collision_table_etrangere(service, tmp_path, monkeypatch):
    foreign = {"description": "étrangère"}
    service.state.datasets["recette"] = {"labels": {}, "tables": {"r_collision": foreign}}
    r = loader(service, tmp_path / "etat.json")
    r.setup()
    monkeypatch.setattr(recette.uuid, "uuid4", lambda: SimpleNamespace(hex="collision"))
    with pytest.raises(RepoError):
        r.load(source(tmp_path), tmp_path)
    r.drop()
    assert service.state.datasets["recette"]["tables"] == {"r_collision": foreign}


def test_marqueurs_differents(service, tmp_path):
    r = loader(service, tmp_path / "etat.json")
    r.setup()
    r.load(source(tmp_path), tmp_path)
    dataset = service.state.datasets["recette"]
    table = next(iter(dataset["tables"].values()))
    table["description"] = "autre"
    dataset["labels"]["atlas_recette"] = "autre"
    r.drop()
    assert dataset["tables"] and service.state.datasets["recette"] is dataset


def test_echec_chargement_reprise_et_404(service, tmp_path):
    r = loader(service, tmp_path / "etat.json")
    r.setup()
    r.load(source(tmp_path), tmp_path)
    service.state.fail_create = True
    with pytest.raises(RepoError, match="échec") as error:
        r.load(source(tmp_path), tmp_path)
    assert service.state.token not in str(error.value)
    assert len(json.loads(r.path.read_text())["tables"]) == 2
    loader(service, r.path).drop()
    assert "recette" not in service.state.datasets
    assert not r.path.exists()


def test_jeu_non_vide_conserve_et_reprise(service, tmp_path):
    r = loader(service, tmp_path / "etat.json")
    r.setup()
    service.state.datasets["recette"]["tables"]["etrangere"] = {"description": "autre"}
    with pytest.raises(RepoError, match="non vide"):
        r.drop()
    assert r.path.exists() and "recette" in service.state.datasets
    del service.state.datasets["recette"]["tables"]["etrangere"]
    r.drop()
    assert "recette" not in service.state.datasets


def test_etat_existant_refuse(service, tmp_path):
    path = tmp_path / "etat.json"
    path.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="État existant"):
        loader(service, path).setup()
    assert path.read_text() == "{}" and not service.state.calls


@pytest.mark.parametrize(("kind", "expected"), [
    ("VARCHAR", "STRING"), ("VARCHAR(10)", "STRING"), ("BIGINT", "INT64"),
    ("DOUBLE", "FLOAT64"), ("BOOLEAN", "BOOL"), ("DATE", "DATE"),
    ("TIMESTAMP", "DATETIME"), ("DECIMAL(18,3)", "NUMERIC"),
    ("DECIMAL(38,10)", "BIGNUMERIC"), ("DECIMAL(30,0)", "BIGNUMERIC"),
])
def test_types_sans_parametres(kind, expected):
    assert recette.cast_type(kind) == expected


def test_erreur_http_masquee(service, tmp_path):
    r = loader(service, tmp_path / "etat.json")
    service.state.status = 403
    with pytest.raises(RepoError) as error:
        r.setup()
    assert service.state.token not in str(error.value)
    assert "***" in str(error.value)


def test_commande_drop_apres_interruption(service, tmp_path, monkeypatch):
    r = loader(service, tmp_path / "etat.json")
    r.setup()
    r.load(source(tmp_path), tmp_path)
    monkeypatch.setenv("ATLAS_BIGQUERY_PROJECT", "projet-test")
    monkeypatch.setenv("ATLAS_BIGQUERY_TOKEN", service.state.token)
    original = recette.connector
    monkeypatch.setattr(recette, "connector", lambda project, token, location=None:
                        original(project, token, location, host=service.url))
    recette.main(["drop", str(r.path)])
    assert "recette" not in service.state.datasets and not r.path.exists()


def test_chargement_types_des_fixtures(service, tmp_path):
    r = loader(service, tmp_path / "etat.json")
    r.setup()
    (tmp_path / "types.csv").write_text(
        "texte,nombre,flottant,date,temps\nbonjour,12.3,1.5,2026-01-02,2026-01-02 03:04:05\n",
        encoding="utf-8")
    columns = (("texte", "string"), ("nombre", "decimal"), ("flottant", "double"),
               ("date", "date"), ("temps", "timestamp"))
    r.load([SourceTable("types", columns)], tmp_path)
    query = next(body["query"] for method, _, _, body in service.state.calls
                 if method == "POST" and body.get("query", "").startswith("CREATE TABLE"))
    for kind in ("STRING", "BIGNUMERIC", "FLOAT64", "DATE", "DATETIME"):
        assert f" AS {kind})" in query
    assert "BIGNUMERIC(" not in query and "STRING(" not in query
    r.drop()


def test_attente_et_erreur_de_job(service, tmp_path, monkeypatch):
    r = loader(service, tmp_path / "etat.json")
    service.state.polls_before_complete = 1
    monkeypatch.setattr(recette.time, "sleep", lambda _: pytest.fail("Attente superflue"))
    r.sql("SELECT 1")
    assert sum(method == "GET" for method, _, _, _ in service.state.calls) == 1
    service.state.polls_before_complete = 1
    service.state.poll_errors = [{"message": "erreur secret-bq"}]
    with pytest.raises(RepoError, match="échec") as error:
        r.sql("SELECT 1")
    assert "secret-bq" not in str(error.value)


def test_jeu_note_avant_insertion(service, tmp_path):
    r = loader(service, tmp_path / "etat.json")
    service.state.fail_dataset_insert = True
    with pytest.raises(RepoError, match="interrompue"):
        r.setup()
    assert json.loads(r.path.read_text())["dataset"] is True
    r.drop()
    assert not r.path.exists()
