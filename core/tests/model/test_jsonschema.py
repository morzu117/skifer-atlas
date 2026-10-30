import copy
import json
from pathlib import Path

import pytest
from conftest import DOCUMENTS, MINIMAL_NODES, kpi_with, read_fixture
from jsonschema import Draft202012Validator

from skifer_atlas.model import NODE_TYPES, validate_data
from skifer_atlas.model.jsonschema import SCHEMA_FILENAME, document_json_schema, schema_text

SCHEMA_PATH = Path(__file__).parents[2] / "schemas" / SCHEMA_FILENAME


@pytest.fixture(scope="module")
def validator():
    schema = document_json_schema()
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def test_committed_schema_is_up_to_date():
    assert SCHEMA_PATH.read_text(encoding="utf-8") == schema_text(), (
        "Régénérer : uv run atlas schema --out schemas/" + SCHEMA_FILENAME
    )


def _valid_corpus():
    yield from (read_fixture(path.name) for path in DOCUMENTS)
    yield from (kpi_with(MINIMAL_NODES[node_type]) for node_type in NODE_TYPES)


def _mutate(fixture, change):
    document = copy.deepcopy(read_fixture(fixture))
    change(document)
    return document


def _node(document, index):
    return document["graph"]["nodes"][index]


# Erreurs de forme : le JSON Schema doit les refuser comme pydantic.
SHAPE_ERRORS = {
    "clé inconnue": lambda d: d.update(couleur="bleu"),
    "version inconnue": lambda d: d.update(schema_version=2),
    "sorte inconnue": lambda d: d.update(kind="dashboard"),
    "type de nœud inconnu": lambda d: _node(d, 1).update(type="pivot"),
    "filtre sans nulls": lambda d: _node(d, 1).pop("nulls"),
    "nulls hors liste": lambda d: _node(d, 1).update(nulls="maybe"),
    "opérateur inconnu": lambda d: _node(d, 1).update(condition="statut:pivot:x"),
    "fonction first": lambda d: _node(d, 4).update(measures=[["a", "b", "first"]]),
    "grain inconnu": lambda d: _node(d, 3).update(grain="fortnight"),
    "plateforme inconnue": lambda d: _node(d, 0).update(platform="oracle"),
    "identifiant de nœud": lambda d: _node(d, 2).update(id="calcul"),
    "version texte": lambda d: d["data_product"].update(version="4"),
    "clé dans une colonne": lambda d: _node(d, 0)["columns"][0].update(nullable=True),
    "graphe vide": lambda d: d["graph"].update(nodes=[]),
}


def test_valid_corpus_is_accepted_by_both(validator):
    for document in _valid_corpus():
        assert validate_data(document).valid
        assert not list(validator.iter_errors(document))


@pytest.mark.parametrize("change", SHAPE_ERRORS.values(), ids=SHAPE_ERRORS.keys())
def test_shape_errors_are_refused_by_both(validator, change):
    document = _mutate("revenu-net.yaml", change)
    assert not validate_data(document).valid
    assert list(validator.iter_errors(json.loads(json.dumps(document))))
