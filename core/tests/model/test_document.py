import copy

import pytest
from conftest import DOCUMENTS, MINIMAL_NODES, codes, kpi_with, read_fixture

from skifer_atlas.model import ConceptDocument, KpiDocument, validate_data, validate_file


@pytest.mark.parametrize("path", DOCUMENTS, ids=lambda p: p.name)
def test_reference_fixtures_are_valid(path):
    result = validate_file(path)
    assert result.valid, result.issues


def test_revenu_net_declares_tax_deduction_and_fiscal_month_as_variation_points(revenu_net):
    document = validate_data(revenu_net).document
    assert isinstance(document, KpiDocument)
    assert document.variation_points == ["n03", "n04"]
    by_id = {node.id: node for node in document.graph.nodes}
    assert by_id["n03"].type == "compute" and by_id["n03"].label == "déduction des taxes"
    assert by_id["n04"].type == "temporal" and by_id["n04"].grain == "month"
    assert document.graph.output == "n05"


def test_concept_without_graph_is_valid():
    assert isinstance(validate_data(read_fixture("commande.yaml")).document, ConceptDocument)


# Chemins où l'on glisse une clé inconnue, du document jusqu'au nœud de remplacement.
UNKNOWN_KEY_LOCATIONS = [
    ("revenu-net.yaml", []),
    ("revenu-net.yaml", ["data_product"]),
    ("revenu-net.yaml", ["semantics"]),
    ("revenu-net.yaml", ["semantics", "calendar"]),
    ("revenu-net.yaml", ["graph"]),
    ("revenu-net.yaml", ["graph", "nodes", 1]),
    ("revenu-net.yaml", ["graph", "nodes", 0, "columns", 3]),
    ("commande.yaml", ["entity"]),
    ("commande.yaml", ["entity", "attributes", 0]),
    ("revenu-net--nordis-de.yaml", ["variant_of"]),
    ("revenu-net--nordis-de.yaml", ["overrides", 0]),
    ("revenu-net--nordis-de.yaml", ["overrides", 1, "replace"]),
]


@pytest.mark.parametrize(("fixture", "location"), UNKNOWN_KEY_LOCATIONS)
def test_unknown_key_anywhere(fixture, location):
    document = read_fixture(fixture)
    target = document
    for part in location:
        target = target[part]
    target["couleur"] = "bleu"
    pointer = "".join(f"/{part}" for part in location) + "/couleur"
    assert [(path, code) for path, _, code in codes(validate_data(document))] == [
        (pointer, "unknown_key")
    ]


def test_unknown_key_in_join_inputs_union_columns_and_dedup():
    join = copy.deepcopy(MINIMAL_NODES["join"])
    join["inputs"]["middle"] = "n12"
    union = copy.deepcopy(MINIMAL_NODES["union"])
    union["id"] = "n02"
    union["columns"][0]["alias"] = "x"
    dedup = copy.deepcopy(MINIMAL_NODES["deduplicate"])
    dedup["id"] = "n03"
    dedup["keep"]["first"] = True
    assert codes(validate_data(kpi_with(join, union, dedup))) == [
        ("/graph/nodes/0/inputs/middle", "n01", "unknown_key"),
        ("/graph/nodes/1/columns/0/alias", "n02", "unknown_key"),
        ("/graph/nodes/2/keep/first", "n03", "unknown_key"),
    ]


def test_unknown_schema_version(revenu_net):
    revenu_net["schema_version"] = 2
    assert codes(validate_data(revenu_net)) == [("/schema_version", None, "unknown_schema_version")]


def test_missing_schema_version(revenu_net):
    del revenu_net["schema_version"]
    assert codes(validate_data(revenu_net)) == [("/schema_version", None, "missing_field")]


def test_unknown_kind(revenu_net):
    revenu_net["kind"] = "dashboard"
    assert codes(validate_data(revenu_net)) == [("/kind", None, "invalid_value")]


def test_duplicate_node_id(revenu_net):
    revenu_net["graph"]["nodes"][2]["id"] = "n02"
    assert ("/graph/nodes/2/id", "n02", "duplicate_node_id") in codes(validate_data(revenu_net))


def test_output_must_name_a_node(revenu_net):
    revenu_net["graph"]["output"] = "n42"
    assert codes(validate_data(revenu_net)) == [("/graph/output", None, "invalid_value")]


def test_variation_point_must_name_a_node(revenu_net):
    revenu_net["variation_points"] = ["n03", "n42"]
    assert codes(validate_data(revenu_net)) == [("/variation_points/1", None, "invalid_value")]


def test_semantic_variation_point_must_be_declared(revenu_net):
    del revenu_net["semantics"]["currency"]
    revenu_net["variation_points"] = ["semantics.currency"]
    assert codes(validate_data(revenu_net)) == [("/variation_points/0", None, "invalid_value")]


def test_kpi_needs_semantics_and_graph(revenu_net):
    del revenu_net["semantics"]
    del revenu_net["graph"]
    assert codes(validate_data(revenu_net)) == [
        ("/semantics", None, "missing_field"),
        ("/graph", None, "missing_field"),
    ]


def test_calendar_version_must_be_a_string(revenu_net):
    revenu_net["semantics"]["calendar"]["version"] = 2026.1
    result = validate_data(revenu_net)
    assert codes(result) == [("/semantics/calendar/version", None, "invalid_value")]
    assert "guillemets" in result.issues[0].message


def test_data_product_id_format(revenu_net):
    revenu_net["data_product"]["id"] = "Revenu Net"
    assert codes(validate_data(revenu_net)) == [("/data_product/id", None, "invalid_value")]


def test_document_must_be_a_mapping():
    assert codes(validate_data(["a"])) == [("", None, "invalid_value")]


def test_messages_are_in_french(revenu_net):
    del revenu_net["graph"]["nodes"][1]["nulls"]
    issue = validate_data(revenu_net).issues[0]
    assert issue.message == "Champ requis manquant : « nulls »."
