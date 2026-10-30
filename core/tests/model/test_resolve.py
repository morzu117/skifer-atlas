from conftest import read_fixture
from graphs import build, nodes, revenu_net

from skifer_atlas.model.resolve import resolve


def resolved(variant_raw: dict, canonical_raw: dict | None = None):
    return resolve(build(variant_raw), build(canonical_raw or revenu_net()))


def de() -> dict:
    return read_fixture("revenu-net--nordis-de.yaml")


def test_de_override_replaces_n03_and_classifies_overrides():
    result = resolved(de())
    assert result.valid
    by_id = {node.id: node for node in result.document.graph.nodes}
    assert [node.id for node in result.document.graph.nodes] == ["n01", "n02", "n03", "n04", "n05"]
    assert by_id["n03"].expr == "montant_ttc / 1.19 - avoirs"
    assert by_id["n03"].label == "déduction des taxes"
    assert by_id["n02"].condition == "statut:in:validée,expédiée"
    assert [(o.node, o.classification) for o in result.overrides] == [
        ("n02", "undeclared"), ("n03", "declared"),
    ]
    assert [(i.code, i.node_id, i.severity) for i in result.issues] == [
        ("undeclared_override", "n02", "warning"),
    ]


def test_resolution_keeps_the_canonical_untouched():
    canonical = build(revenu_net())
    before = canonical.model_dump()
    resolve(build(de()), canonical)
    assert canonical.model_dump() == before


def test_override_type_change_is_refused():
    raw = de()
    raw["overrides"][1]["replace"] = {
        "id": "n03", "type": "filter", "inputs": ["n02"], "condition": "avoirs:is_null",
        "nulls": "keep",
    }
    result = resolved(raw)
    assert not result.valid
    assert result.document is None
    issue = next(i for i in result.issues if i.code == "override_type_change")
    assert (issue.node_id, issue.path) == ("n03", "/overrides/1/replace/type")


def test_unknown_override_target():
    raw = de()
    raw["overrides"][1]["node"] = "n09"
    raw["overrides"][1]["replace"]["id"] = "n09"
    result = resolved(raw)
    assert [(i.code, i.node_id) for i in result.issues if i.severity == "error"] == [
        ("unknown_override_target", "n09"),
    ]


def test_override_breaking_a_column_is_reported_on_the_resolved_graph():
    raw = de()
    raw["overrides"][1]["replace"]["expr"] = "montant_ttc / 1.19 - avoir"
    result = resolved(raw)
    assert not result.valid
    assert [(i.code, i.node_id) for i in result.issues if i.severity == "error"] == [
        ("unknown_column", "n03"),
    ]


def test_semantics_override():
    raw = de()
    raw["overrides"] = [{"node": "semantics.currency", "justification": "Franc suisse.",
                         "value": "CHF"}]
    canonical = revenu_net()
    canonical["variation_points"].append("semantics.currency")
    result = resolved(raw, canonical)
    assert result.valid
    assert result.document.semantics.currency == "CHF"
    assert [(o.node, o.classification) for o in result.overrides] == [
        ("semantics.currency", "declared"),
    ]


def test_variant_of_mismatch():
    canonical = revenu_net()
    canonical["data_product"]["version"] = 5
    result = resolved(de(), canonical)
    assert [i.code for i in result.issues] == ["variant_of_mismatch"]
    assert result.document is None


def test_from_scratch_es_variant_is_clean():
    result = resolved(read_fixture("revenu-net--nordis-es.yaml"))
    assert result.valid
    assert result.issues == []
    assert result.document.graph.nodes[0].platform == "snowflake"
    assert result.document.data_product.id == "revenu-net"


def test_unbound_concept():
    raw = read_fixture("revenu-net--nordis-es.yaml")
    raw["concepts"].append("client")
    result = resolved(raw)
    assert [(i.code, i.path) for i in result.issues] == [("unbound_concept", "/concepts/1")]


def test_from_scratch_graph_is_checked():
    raw = read_fixture("revenu-net--nordis-es.yaml")
    del raw["graph"]["nodes"][2]
    nodes(raw)["n04"].update(inputs=["n02"], column="fecha")
    result = resolved(raw)
    assert [(i.code, i.node_id) for i in result.issues] == [
        ("implicit_timezone_conversion", "n04"),
    ]
