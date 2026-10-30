import pytest
from conftest import codes, read_fixture

from skifer_atlas.model import FromScratchVariant, OverrideVariant, validate_data


@pytest.fixture
def de() -> dict:
    return read_fixture("revenu-net--nordis-de.yaml")


@pytest.fixture
def es() -> dict:
    return read_fixture("revenu-net--nordis-es.yaml")


def test_override_variant_replaces_whole_nodes(de):
    document = validate_data(de).document
    assert isinstance(document, OverrideVariant)
    assert [o.node for o in document.overrides] == ["n02", "n03"]
    assert document.overrides[0].replace.condition == "statut:in:validée,expédiée"
    assert document.overrides[1].replace.type == "compute"


def test_from_scratch_variant(es):
    document = validate_data(es).document
    assert isinstance(document, FromScratchVariant)
    assert document.concepts == ["facture"]


def test_override_without_overrides_is_refused(de):
    del de["overrides"]
    assert codes(validate_data(de)) == [("/overrides", None, "missing_field")]


def test_override_with_empty_overrides_is_refused(de):
    de["overrides"] = []
    assert codes(validate_data(de)) == [("/overrides", None, "invalid_value")]


@pytest.mark.parametrize("field", ["justification", "concepts", "graph"])
def test_from_scratch_requirements(es, field):
    del es[field]
    assert codes(validate_data(es)) == [(f"/{field}", None, "missing_field")]


def test_empty_justification_is_refused(es):
    es["justification"] = "  "
    assert codes(validate_data(es)) == [("/justification", None, "invalid_value")]


def test_graph_is_not_allowed_in_override_mode(de, es):
    de["graph"] = es["graph"]
    assert codes(validate_data(de)) == [("/graph", None, "unknown_key")]


def test_overrides_are_not_allowed_from_scratch(de, es):
    es["overrides"] = de["overrides"]
    assert codes(validate_data(es)) == [("/overrides", None, "unknown_key")]


def test_unknown_mode(de):
    de["mode"] = "patch"
    assert codes(validate_data(de)) == [("/mode", None, "invalid_value")]


def test_replacement_keeps_the_node_id(de):
    de["overrides"][1]["replace"]["id"] = "n13"
    assert codes(validate_data(de)) == [("/overrides/1/replace/id", "n03", "invalid_value")]


def test_replacement_node_is_validated_with_its_id(de):
    del de["overrides"][0]["replace"]["nulls"]
    assert codes(validate_data(de)) == [("/overrides/0/replace/nulls", "n02", "missing_field")]


def test_override_needs_a_justification(de):
    del de["overrides"][1]["justification"]
    assert codes(validate_data(de)) == [("/overrides/1/justification", "n03", "missing_field")]


def test_same_node_overridden_twice(de):
    de["overrides"].append(dict(de["overrides"][1]))
    assert codes(validate_data(de)) == [("/overrides/2/node", "n03", "invalid_value")]


def test_semantic_override_uses_value(de):
    de["overrides"].append(
        {"node": "semantics.timezone", "justification": "Siège à Berlin.", "value": "Europe/Berlin"}
    )
    de["overrides"].append(
        {"node": "semantics.calendar", "justification": "Calendrier DE.",
         "value": {"key": "fiscal-nordis-de", "version": "2026.1"}}
    )
    assert validate_data(de).valid


@pytest.mark.parametrize(
    ("override", "path"),
    [
        ({"node": "semantics.timezone", "justification": "x", "value": "Mars/Olympus"}, "/overrides/2"),
        ({"node": "semantics.currency", "justification": "x", "value": "euro"}, "/overrides/2/value"),
        ({"node": "semantics.calendar", "justification": "x", "value": "fiscal"}, "/overrides/2/value"),
        ({"node": "semantics.timezone", "justification": "x"}, "/overrides/2/value"),
        ({"node": "n04", "justification": "x", "value": "month"}, "/overrides/2/value"),
    ],
)
def test_invalid_semantic_override(de, override, path):
    de["overrides"].append(override)
    issues = codes(validate_data(de))
    assert len(issues) == 1 and issues[0][0] == path
