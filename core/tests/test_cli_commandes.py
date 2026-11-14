"""Contrat du point d'entrée CLI, avec ses sorties et codes de retour."""

import json
from pathlib import Path

import pytest

from skifer_atlas.cli import main

FIXTURES = Path(__file__).parent / "fixtures"
DOCUMENTS = FIXTURES / "documents"
CANONIQUE = DOCUMENTS / "revenu-net.yaml"
VARIANTE = DOCUMENTS / "revenu-net--nordis-de.yaml"
SQL = FIXTURES / "sql" / "01_stg_orders.sql"
NULLS = FIXTURES / "compile" / "nulls"
EXEMPLE = Path(__file__).parents[2] / "examples" / "espace-nordis"
DONNEES = FIXTURES / "compare" / "revenu-net"


@pytest.fixture(autouse=True)
def environnement_isole(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path / "donnees"))
    monkeypatch.setenv("ATLAS_VAULT", "memory")
    monkeypatch.delenv("ATLAS_COMPARE_DATA", raising=False)


@pytest.mark.parametrize(("arguments", "fragment_sortie", "fragment_erreur"), [
    (["validate", str(CANONIQUE)], ": valide", ""),
    (["check", str(CANONIQUE)], "0 erreur(s)", ""),
    (["resolve", str(VARIANTE), str(CANONIQUE)], "kind: kpi", "n02 : undeclared"),
    (["normalize", str(CANONIQUE)], "normalization: atlas1", ""),
    (["fingerprint", str(CANONIQUE)], "sha256:atlas1:", ""),
    (["diff", str(CANONIQUE), str(CANONIQUE), "--format", "json"], '"identical": true', ""),
    (["extract", str(SQL), "--dialect", "databricks"], "schema_version:", "fidélité"),
    (["compile", str(NULLS / "kpi.yaml"), "--dialect", "duckdb"], "-- atlas:", ""),
    (["run", str(NULLS / "kpi.yaml"), "--data", str(NULLS)], "clients\n2\n", ""),
    (["schema"], '"title": "Document Skifer Atlas', ""),
])
def test_commandes_nominales_affichent_le_resultat_et_les_diagnostics(
    capsys, arguments, fragment_sortie, fragment_erreur
):
    assert main(arguments) == 0
    capture = capsys.readouterr()
    assert fragment_sortie in capture.out
    if fragment_erreur:
        assert fragment_erreur in capture.err
    else:
        assert capture.err == ""


@pytest.mark.parametrize("commande", ["validate", "check", "resolve", "normalize", "fingerprint",
                                      "diff", "extract", "compile", "run", "compare"])
def test_argument_obligatoire_manquant_explique_l_usage(capsys, commande):
    with pytest.raises(SystemExit) as erreur:
        main([commande])
    capture = capsys.readouterr()
    assert erreur.value.code == 2
    assert capture.out == ""
    assert "usage: atlas " + commande in capture.err
    assert "required" in capture.err


@pytest.mark.parametrize(("commande", "suffixe", "message"), [
    ("validate", [], "[unreadable_file]"),
    ("check", [], "[unreadable_file]"),
    ("resolve", [str(CANONIQUE)], "[unreadable_file]"),
    ("normalize", [], "[unreadable_file]"),
    ("fingerprint", [], "[unreadable_file]"),
    ("diff", [str(CANONIQUE)], "[unreadable_file]"),
    ("extract", ["--dialect", "databricks"], "fichier introuvable"),
    ("compile", [], "[unreadable_file]"),
    ("run", ["--data", str(NULLS)], "[unreadable_file]"),
])
def test_fichier_absent_est_signale_sans_traceback(tmp_path, capsys, commande, suffixe, message):
    absent = tmp_path / "absent.yaml"
    assert main([commande, str(absent), *suffixe]) == 1
    capture = capsys.readouterr()
    assert message in capture.out + capture.err
    assert "Traceback" not in capture.out + capture.err


def test_comparaison_locale_donne_un_resultat_json_et_un_code_d_ecart(capsys):
    code = main(["compare", str(EXEMPLE), "revenu-net", "--variants", "nordis-de",
                 "--scope", "fy2026-mois-entite", "--duckdb-data", str(DONNEES),
                 "--format", "json"])
    capture = capsys.readouterr()
    assert code == 2 and capture.err == ""
    resultat = json.loads(capture.out)
    assert resultat["status"] == "done"
    assert resultat["results"][0]["entity"] == "nordis-de"
    assert resultat["results"][0]["validation_pct"] < 100


def test_comparaison_espace_absent_explique_comment_comparer_un_dossier(capsys):
    code = main(["compare", "absent", "revenu-net", "--variants", "nordis-fr"])
    capture = capsys.readouterr()
    assert code == 1 and capture.out == ""
    assert "n'est pas un espace du registre local" in capture.err
    assert "--duckdb-data" in capture.err


@pytest.mark.parametrize("arguments", [
    ["schema", "--kind", "inconnu"],
    ["extract", str(SQL), "--dialect", "inconnu"],
    ["compile", str(NULLS / "kpi.yaml"), "--dialect", "inconnu"],
    ["diff", str(CANONIQUE), str(CANONIQUE), "--relation", "inconnue"],
])
def test_option_invalide_explique_les_choix_sans_executer(arguments, capsys):
    with pytest.raises(SystemExit) as erreur:
        main(arguments)
    capture = capsys.readouterr()
    assert erreur.value.code == 2
    assert capture.out == ""
    assert "invalid choice" in capture.err
    assert "usage: atlas" in capture.err
