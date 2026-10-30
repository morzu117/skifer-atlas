"""Disposition d'un graphe en lecture (plan 0012)."""

from pathlib import Path

from skifer_atlas.model.io import load_document
from skifer_atlas.model.layout import condition_text, layout

EXAMPLE = Path(__file__).parents[3] / "examples" / "espace-nordis"


def test_layout_ignores_document_order():
    """Critère 6 : la disposition ne dépend que du graphe, pas de l'ordre du YAML."""
    document = load_document(EXAMPLE / "kpis" / "revenu-net.yaml")
    shuffled = document.model_copy(deep=True)
    shuffled.graph.nodes.reverse()
    def placed(found):
        return {n["id"]: (n["layer"], n["rank"]) for n in found["nodes"]}
    assert placed(layout(document)) == placed(layout(shuffled))


def test_cards_by_family():
    found = {n["id"]: n for n in layout(load_document(EXAMPLE / "kpis" / "marge-brute.yaml"))["nodes"]}
    assert {n["family"] for n in found.values()} >= {"ref", "result"}
    ref = next(n for n in found.values() if n["type"] == "kpi_ref")
    assert ref["detail"] == "revenu-net v4"


def test_condition_text():
    assert condition_text("statut:in:validée,expédiée") == "statut dans validée, expédiée"
    assert condition_text("date:is_null") == "date est nul"
