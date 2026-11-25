"""Diagnostics exacts des déclarations REST."""

import pytest
import yaml
from test_rest_datasets import dataset, rest_point

from skifer_atlas.connectors.rest_datasets import RestDatasets, parse_rest_datasets
from skifer_atlas.model.errors import Issue
from skifer_atlas.repo.git import RepoError


@pytest.mark.parametrize("changes,code,message", [
    ({"params": {"apikey": "x"}}, "key_param_in_dataset",
     "La clé d'API ne se déclare pas dans un jeu de données."),
    ({"params": {"start": "x"}, "window": {"from_param": "start", "to_param": "end"}},
     "param_clash", "Paramètres fixes, fenêtre et périmètre doivent être distincts."),
    ({"perimeter": {"param": "symbol", "column": "absent"}}, "perimeter_column_unknown",
     "Colonne de périmètre absente du jeu de données."),
])
def test_dataset_diagnostics(changes, code, message):
    found, issues = parse_rest_datasets(yaml.safe_dump({"datasets": [dataset(**changes)]}),
                                        [rest_point()])
    assert found is None
    assert issues == [Issue("/datasets/0", None, code, message)]


def test_duplicate_and_missing_points():
    raw = yaml.safe_dump({"datasets": [dataset(), dataset()]})
    found, issues = parse_rest_datasets(raw, [rest_point()])
    assert found is None
    assert issues == [Issue("/datasets/1", None, "duplicate_rest_dataset", "Jeu de données répété.")]
    for legacy, code in [((), "unknown_access_point"), (("api-exemple",), "access_point_not_rest")]:
        found, issues = parse_rest_datasets(yaml.safe_dump({"datasets": [dataset()]}), [],
                                            legacy_ids=legacy)
        assert found is None
        assert issues == [Issue("/datasets/0", None, code,
            "Le point du jeu de données n'est pas déclaré dans le registre REST.")]


def test_invalid_yaml_and_require_messages():
    assert parse_rest_datasets("[broken", []) == (None, [
        Issue("", None, "invalid_yaml", "rest_datasets.yaml n'est pas un YAML lisible.")])
    definitions = RestDatasets.model_validate({"datasets": [dataset()]})
    for table, point, message in [
        ("marche.prix.cours_jour", "other-point", "Jeu de données déclaré sur un autre point REST."),
        ("autre.table.nom", "api-exemple", "Table sans jeu de données sur ce point REST."),
    ]:
        with pytest.raises(RepoError) as caught:
            definitions.require(table, point)
        assert (caught.value.code, caught.value.message) == ("rest_dataset_missing", message)


def test_distinct_datasets_and_validation_after_unknown_point():
    first = dataset(access_point="missing-point")
    second = dataset(table="marche.prix.autre", params={"symbol": "fixed"},
                     perimeter={"param": "symbol", "column": "close"})
    found, issues = parse_rest_datasets(yaml.safe_dump({"datasets": [first, second]}), [rest_point()])
    assert found is None
    assert [(issue.path, issue.code) for issue in issues] == [
        ("/datasets/0", "unknown_access_point"), ("/datasets/1", "param_clash")]
    found, issues = parse_rest_datasets(yaml.safe_dump({"datasets": [dataset(),
        dataset(table="marche.prix.autre")]}), [rest_point()])
    assert found is not None and issues == []
