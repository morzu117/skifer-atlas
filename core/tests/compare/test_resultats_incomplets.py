"""Correspondance des colonnes rendues par les plateformes SQL."""

import pytest

from skifer_atlas.compare.orchestrate import Side, _keyed
from skifer_atlas.connectors.base import QueryResult
from skifer_atlas.repo.git import RepoError


def test_colonnes_snowflake_en_majuscules_sont_identifiees_sans_sensibilite_a_la_casse():
    resultat = QueryResult(["MOIS", "MONTANT"], ["date", "decimal"], [("2026-01", 12)])
    side = Side(compiled=None, dims=["mois"], value="montant")
    assert _keyed(resultat, side, "du canonique") == {'["2026-01"]': 12}


@pytest.mark.parametrize(("colonnes", "colonne_absente"), [
    (["montant"], "mois"),
    (["mois"], "montant"),
])
def test_resultat_sans_dimension_ou_mesure_est_refuse(colonnes, colonne_absente):
    resultat = QueryResult(colonnes, ["string"], [])
    side = Side(compiled=None, dims=["mois"], value="montant")
    with pytest.raises(RepoError) as erreur:
        _keyed(resultat, side, "du canonique")
    assert erreur.value.code == "query_failed"
    assert erreur.value.message == f"Colonne « {colonne_absente} » absente du résultat."
