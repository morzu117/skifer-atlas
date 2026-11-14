"""Cas limites SQL sans perte silencieuse pendant l'extraction."""

import pytest
from helpers import by_type, codes, single


@pytest.fixture(autouse=True)
def environnement_isole(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ATLAS_VAULT", "memory")


@pytest.mark.parametrize("dialecte", ["databricks", "snowflake"])
def test_group_by_alias_d_expression_est_calcule_avant_agregation(tmp_path, dialecte):
    extrait = single(tmp_path,
                     "SELECT prix * 2 AS double_prix, COUNT(*) AS n FROM s.t GROUP BY double_prix",
                     dialecte)
    [calcul] = by_type(extrait, "compute")
    [agregat] = by_type(extrait, "aggregate")
    assert calcul["column"] == "double_prix" and "prix" in calcul["expr"]
    assert agregat["group_by"] == ["double_prix"]
    assert agregat["measures"] == [["*", "n", "count"]]
    assert not extrait.blocking


@pytest.mark.parametrize("dialecte", ["databricks", "snowflake"])
def test_union_avec_nombres_de_colonnes_differents_est_bloquante(tmp_path, dialecte):
    extrait = single(tmp_path, "SELECT a FROM s.t UNION ALL SELECT a, b FROM s.u", dialecte)
    assert extrait.blocking
    assert "unsupported_construct" in codes(extrait)
    assert any("UNION" in r.message for r in extrait.draft.residues)


@pytest.mark.parametrize("dialecte", ["databricks", "snowflake"])
def test_agregat_distinct_non_pris_en_charge_est_signale(tmp_path, dialecte):
    extrait = single(tmp_path, "SELECT AVG(DISTINCT prix) AS moyenne FROM s.t", dialecte)
    assert extrait.blocking
    assert "unsupported_construct" in codes(extrait)
    assert any("AVG" in r.message for r in extrait.draft.residues)


@pytest.mark.parametrize("dialecte", ["databricks", "snowflake"])
def test_union_de_trois_requetes_garde_les_trois_branches(tmp_path, dialecte):
    extrait = single(tmp_path, "SELECT a FROM s.t UNION ALL SELECT b FROM s.u "
                     "UNION ALL SELECT c FROM s.v", dialecte)
    [union] = by_type(extrait, "union")
    assert union["mode"] == "all"
    assert len(union["inputs"]) == 3
    assert union["columns"][0]["name"] == "a"
    assert set(union["columns"][0]["from"].values()) == {"a", "b", "c"}
    assert not extrait.blocking


@pytest.mark.parametrize("dialecte", ["databricks", "snowflake"])
def test_colonne_hors_regroupement_est_signalee(tmp_path, dialecte):
    extrait = single(tmp_path, "SELECT a, b, SUM(c) AS total FROM s.t GROUP BY a", dialecte)
    assert extrait.blocking
    assert "unsupported_construct" in codes(extrait)
    assert any("GROUP BY" in r.message for r in extrait.draft.residues)
