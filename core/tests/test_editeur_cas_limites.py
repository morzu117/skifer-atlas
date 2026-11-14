"""Diagnostics de l'éditeur pour un document YAML de forme inattendue."""

from pathlib import Path

import pytest
import yaml

from skifer_atlas import editor
from skifer_atlas.model.graph import Library


@pytest.fixture(autouse=True)
def environnement_isole(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ATLAS_VAULT", "memory")


def test_editeur_refuse_un_yaml_qui_est_une_liste():
    resultat = editor.parse("- un\n- deux\n")
    assert resultat["document"] is None
    [probleme] = resultat["issues"]
    assert probleme["code"] == "invalid_value"
    assert probleme["message"] == "Le document doit être un mapping YAML."
    assert probleme["severity"] == "error"


def test_variante_sans_canonique_ne_peut_pas_etre_soumise():
    chemin = Path(__file__).parent / "fixtures/documents/revenu-net--nordis-de.yaml"
    variante = yaml.safe_load(chemin.read_text(encoding="utf-8"))
    resultat = editor.check(variante, Library(), {})
    assert resultat["submittable"] is False
    assert any(p["code"] == "unknown_kpi_ref" and "Canonique revenu-net" in p["message"]
               for p in resultat["issues"])
    assert all(v["status"] == "blocked" for v in resultat["status"]["compilable"].values())
