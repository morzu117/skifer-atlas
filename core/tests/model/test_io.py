import pytest
import yaml
from conftest import DOCUMENTS

from skifer_atlas.model import DocumentError, dump_document, load_document, validate_text
from skifer_atlas.model.io import dump_data


@pytest.mark.parametrize("path", DOCUMENTS, ids=lambda p: p.name)
def test_canonical_fixtures_round_trip(path):
    text = path.read_text(encoding="utf-8")
    assert dump_document(load_document(path)) == text
    assert dump_document(load_document(text)) == text


def _reverse_keys(value):
    if isinstance(value, dict):
        return {key: _reverse_keys(value[key]) for key in reversed(list(value))}
    if isinstance(value, list):
        return [_reverse_keys(item) for item in value]
    return value


@pytest.mark.parametrize("path", DOCUMENTS, ids=lambda p: p.name)
def test_non_canonical_file_is_rewritten_then_stable(path):
    canonical = path.read_text(encoding="utf-8")
    shuffled = dump_data(_reverse_keys(yaml.safe_load(canonical)))
    assert shuffled != canonical
    first = dump_document(load_document(shuffled))
    assert first == canonical
    assert dump_document(load_document(first)) == first


def test_dump_is_lf_utf8_and_two_space_indented():
    text = DOCUMENTS[-1].read_text(encoding="utf-8")
    assert "\r" not in text and "déduction des taxes" in text
    assert "\n  nodes:\n    - id: n01\n" in text


def test_aliases_are_rewritten_on_dump():
    text = (DOCUMENTS[-1].read_text(encoding="utf-8")
            .replace("statut:equals:validée", "statut:eq:validée")
            .replace("revenu_net, sum", "revenu_net, sum"))
    assert "statut:equals:validée" in dump_document(load_document(text))


@pytest.mark.parametrize(
    ("text", "fragment"),
    [
        ("base: &b {a: 1}\nother: *b\n", "ancres"),
        ("a: !!python/object:os.system x\n", "balises"),
        ("a: !!str 1\n", "balises"),
        ("a: 1\na: 2\n", "répétée"),
        ("graph:\n  nodes:\n    - id: n01\n      id: n02\n", "répétée"),
        ("a: [1, 2\n", "illisible"),
        ("a: 1\n---\nb: 2\n", "illisible"),
    ],
)
def test_unsafe_or_broken_yaml_is_refused(text, fragment):
    result = validate_text(text)
    assert [issue.code for issue in result.issues] == ["invalid_yaml"]
    assert fragment in result.issues[0].message


def test_load_document_raises_with_all_issues():
    with pytest.raises(DocumentError) as error:
        load_document("schema_version: 1\nkind: kpi\n")
    assert len(error.value.issues) == 4
