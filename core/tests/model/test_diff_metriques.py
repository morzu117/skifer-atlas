"""Le renommage d'une entrée se propage aux métriques et mesures dépendantes."""

import pytest

from skifer_atlas.diff.compare import produced, rename_references


@pytest.fixture(autouse=True)
def environnement_isole(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ATLAS_VAULT", "memory")


def test_renommage_d_entree_metrique_conserve_les_noms_de_sortie():
    contenu = {"metrics": [{"name": "taux", "expr": "ancien / 2"}],
               "aggregate": {"group_by": ["ancien"],
                             "measures": [["ancien", "total", "sum"]]}}
    resultat = rename_references("metric_op", contenu, {"ancien": "nouveau"})
    assert resultat["metrics"] == [{"name": "taux", "expr": "nouveau / 2"}]
    assert resultat["aggregate"] == {"group_by": ["nouveau"],
                                     "measures": [["nouveau", "total", "sum"]]}
    assert produced("metric_op", resultat) == ["taux", "total"]
    assert contenu["metrics"][0]["expr"] == "ancien / 2"
