"""Le renommage en amont ne doit pas inventer d'écarts en aval."""

import copy

import pytest

from skifer_atlas.diff.compare import rename_references


@pytest.mark.parametrize(("type_noeud", "contenu", "attendu"), [
    ("aggregate", {"group_by": ["ancien"], "measures": [["ancien", "total", "sum"]],
                   "having": ["ancien:gt:0"]},
     {"group_by": ["nouveau"], "measures": [["nouveau", "total", "sum"]],
      "having": ["nouveau:gt:0"]}),
    ("join", {"keys": [["ancien", "autre"]]}, {"keys": [["nouveau", "autre"]]}),
    ("deduplicate", {"keys": ["ancien"], "keep": {"order_by": [["ancien", "desc"]]}},
     {"keys": ["nouveau"], "keep": {"order_by": [["nouveau", "desc"]]}}),
    ("temporal", {"column": "ancien", "order_by": [["ancien", "asc"]],
                  "partition_by": ["ancien"]},
     {"column": "nouveau", "order_by": [["nouveau", "asc"]],
      "partition_by": ["nouveau"]}),
    ("union", {"columns": [{"name": "resultat", "from": {"n01": "ancien", "n02": "autre"}}]},
     {"columns": [{"name": "resultat", "from": {"n01": "nouveau", "n02": "autre"}}]}),
    ("kpi_ref", {"columns": ["ancien", "autre"]}, {"columns": ["nouveau", "autre"]}),
])
def test_renommer_une_colonne_change_ses_references_pas_ses_sorties(type_noeud, contenu, attendu):
    avant = copy.deepcopy(contenu)
    assert rename_references(type_noeud, contenu, {"ancien": "nouveau"}) == attendu
    assert contenu == avant
