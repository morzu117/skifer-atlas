"""Compilation de valeurs et filtres atypiques dans les trois dialectes."""

import pytest
from test_compile import counted, kpi

from skifer_atlas.compile import DIALECTS, CompileError, compile_document


@pytest.fixture(autouse=True)
def environnement_isole(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ATLAS_VAULT", "memory")


@pytest.mark.parametrize(("condition", "fragment"), [
    ("actif:equals:peut-etre", "n'est pas un booléen"),
    ("ouvert_le:equals:hier", "n'est pas une date"),
])
def test_valeur_incompatible_avec_le_type_de_la_colonne(condition, fragment):
    with pytest.raises(CompileError) as erreur:
        compile_document(counted(condition), "duckdb")
    assert any(issue.code == "invalid_value" and fragment in issue.message
               for issue in erreur.value.issues)


@pytest.mark.parametrize("dialecte", DIALECTS)
def test_une_periode_civile_au_jour_garde_la_date(dialecte):
    document = kpi([
        {"id": "n02", "type": "temporal", "inputs": ["n01"], "operation": "period",
         "column": "ouvert_le", "target": "jour", "grain": "day"},
        {"id": "n03", "type": "aggregate", "inputs": ["n02"], "group_by": ["jour"],
         "measures": [["*", "lignes", "count"]]},
    ], "n03")
    sql = compile_document(document, dialecte).sql
    assert "ouvert_le AS jour" in sql
    assert "TRUNC" not in sql


@pytest.mark.parametrize(("jointure", "factures"), [
    ("left_semi", {"F1", "F2"}),
    ("left_anti", {"F3"}),
])
def test_jointure_semi_ou_anti_filtre_sans_multiplier_les_lignes(jointure, factures):
    from compile_support import FIXTURES, load

    from skifer_atlas.run import open_database

    dossier = FIXTURES / "cardinalite"
    document = load(dossier / "kpi.yaml")
    noeuds = [noeud.model_copy(update={"how": jointure, "check": "bypass",
                                       "bypass_reason": "Test des doublons"})
              if noeud.id == "n03" else noeud for noeud in document.graph.nodes]
    noeuds[3] = noeuds[3].model_copy(update={"group_by": ["facture_id"],
                                             "measures": [("*", "lignes", "count")]})
    document = document.model_copy(update={"graph": document.graph.model_copy(
        update={"nodes": noeuds})})
    resultat = compile_document(document, "duckdb")
    assert "EXISTS" in resultat.sql
    connection = open_database(resultat.sources, dossier)
    try:
        connection.execute("DELETE FROM ventes.clients WHERE id_client = 'K3'")
        lignes = connection.execute(resultat.sql).fetchall()
    finally:
        connection.close()
    assert {ligne[0] for ligne in lignes} == factures
    assert len(lignes) == len(factures)
