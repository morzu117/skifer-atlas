import copy
import os
import subprocess
import sys

import pytest
from conftest import read_fixture
from graphs import CONDITIONS, ENTITES, build, nodes, revenu_net, with_filters
from hypothesis import given, settings
from hypothesis import strategies as st

from skifer_atlas.model.fingerprint import fingerprint
from skifer_atlas.model.normalize import normalized_form


def print_of(raw: dict) -> str:
    return fingerprint(build(raw))


def test_format():
    value = print_of(revenu_net())
    assert value.startswith("sha256:atlas1:")
    assert len(value.removeprefix("sha256:atlas1:")) == 64


def test_permuting_three_consecutive_filters_keeps_the_fingerprint():
    reference = print_of(with_filters(CONDITIONS))
    for permutation in ([2, 0, 1], [1, 2, 0], [2, 1, 0]):
        assert print_of(with_filters([CONDITIONS[i] for i in permutation])) == reference


def test_consecutive_filters_become_one_filter_set():
    graph = normalized_form(build(with_filters(CONDITIONS)))["graph"]
    filter_sets = [n for n in graph["nodes"] if n["type"] == "filter_set"]
    assert filter_sets == [{
        "id": "n02", "type": "filter_set", "inputs": ["n01"],
        "conditions": sorted(f"{c}|drop" for c in CONDITIONS),
    }]


def test_moving_a_filter_across_a_join_changes_the_fingerprint():
    before = print_of(with_filters(CONDITIONS, join_after=2))
    after = print_of(with_filters(CONDITIONS, join_after=1))
    assert before != after


def _renamed(raw: dict) -> dict:
    mapping = {node["id"]: f"n{40 + index}" for index, node in enumerate(raw["graph"]["nodes"])}
    text = repr(raw)
    for old, new in mapping.items():
        text = text.replace(f"'{old}'", f"'{new}'")
    renamed = eval(text)
    for node in renamed["graph"]["nodes"]:
        node["label"] = f"Étape {node['id']}"
        node["note"] = "Libellé de test."
    renamed["graph"]["nodes"].reverse()
    return renamed


def test_renaming_ids_and_labels_and_reordering_nodes_keeps_the_fingerprint():
    raw = revenu_net()
    renamed = _renamed(raw)
    assert nodes(renamed).keys().isdisjoint(nodes(raw))
    assert print_of(renamed) == print_of(raw)


def test_owner_and_bypass_reason_are_metadata():
    raw = revenu_net()
    reference = print_of(raw)
    nodes(raw)["n01"]["owner"] = "marc.d"
    assert print_of(raw) == reference


def test_orphan_nodes_are_ignored():
    raw = revenu_net()
    reference = print_of(raw)
    raw["graph"]["nodes"].append(copy.deepcopy(ENTITES))
    assert print_of(raw) == reference


def test_sql_is_normalized():
    raw = revenu_net()
    reference = print_of(raw)
    nodes(raw)["n03"]["expr"] = "(montant_ttc  -  montant_taxes) - avoirs"
    assert print_of(raw) != reference  # parenthèses explicites : arbre différent
    nodes(raw)["n03"]["expr"] = "MONTANT_TTC - montant_taxes   -   AVOIRS"
    assert print_of(raw) == reference


def test_calendar_is_part_of_the_period():
    raw = revenu_net()
    reference = print_of(raw)
    raw["semantics"]["calendar"]["version"] = "2027.1"
    assert print_of(raw) != reference


def test_de_and_es_variants_differ_from_the_canonical():
    from skifer_atlas.model.resolve import resolve

    canonical = build(revenu_net())
    prints = {fingerprint(canonical)}
    for name in ("revenu-net--nordis-de.yaml", "revenu-net--nordis-es.yaml"):
        prints.add(fingerprint(resolve(build(read_fixture(name)), canonical).document))
    assert len(prints) == 3


def test_normalizing_a_cycle_is_refused():
    raw = revenu_net()
    nodes(raw)["n02"]["inputs"] = ["n04"]
    with pytest.raises(ValueError):
        normalized_form(build(raw))


SCRIPT = """
import sys
from pathlib import Path
from skifer_atlas.model import load_document
from skifer_atlas.model.fingerprint import fingerprint
print(fingerprint(load_document(Path(sys.argv[1]))))
"""


def test_fingerprint_is_stable_across_processes_and_hash_seeds(tmp_path):
    from skifer_atlas.model.io import dump_data

    path = tmp_path / "filtres.yaml"
    path.write_text(dump_data(with_filters(CONDITIONS, join_after=1)), encoding="utf-8")
    prints = set()
    for seed in ("0", "1", "4242"):
        env = {**os.environ, "PYTHONHASHSEED": seed}
        result = subprocess.run([sys.executable, "-c", SCRIPT, str(path)], env=env,
                                capture_output=True, text=True, check=True)
        prints.add(result.stdout.strip())
    assert prints == {print_of(with_filters(CONDITIONS, join_after=1))}


# --- propriétés ---

WORD = st.text(alphabet="abcdefghijklmnopqrstuvwxyz", min_size=1, max_size=8)
CONDITION = st.one_of(
    st.builds(lambda w: f"statut:equals:{w}", WORD),
    st.builds(lambda w: f"entite:not_equals:{w}", WORD),
    st.builds(lambda n: f"montant_ttc:greater_than:{n}", st.integers(0, 10_000)),
    st.just("avoirs:is_not_null"),
)


@settings(max_examples=60, deadline=None)
@given(st.lists(CONDITION, min_size=2, max_size=5, unique=True).flatmap(
    lambda conditions: st.tuples(st.just(conditions), st.permutations(conditions))
))
def test_property_permuting_consecutive_filters_keeps_the_fingerprint(case):
    conditions, permuted = case
    assert print_of(with_filters(conditions)) == print_of(with_filters(list(permuted)))


def _mutations():
    def condition(raw, word):
        nodes(raw)["n02"]["condition"] = f"statut:equals:{word}x"

    def nulls(raw, _):
        nodes(raw)["n02"]["nulls"] = "keep"

    def expr(raw, word):
        nodes(raw)["n03"]["expr"] = f"montant_ttc - montant_taxes - avoirs * {len(word) + 1}"

    def column_type(raw, _):
        nodes(raw)["n03"]["column_type"] = "double"

    def table(raw, word):
        nodes(raw)["n01"]["table"] = f"gold.finance.{word}"

    def source_column(raw, word):
        nodes(raw)["n01"]["columns"].append({"name": f"extra_{word}", "type": "string"})

    def grain(raw, _):
        nodes(raw)["n04"]["grain"] = "quarter"

    def target(raw, word):
        nodes(raw)["n04"]["target"] = f"mois_{word}"
        nodes(raw)["n05"]["group_by"][0] = f"mois_{word}"

    def function(raw, _):
        nodes(raw)["n05"]["measures"][0][2] = "max"

    def measure_name(raw, word):
        nodes(raw)["n05"]["measures"][0][1] = f"revenu_{word}"

    def calendar(raw, word):
        raw["semantics"]["calendar"]["key"] = f"fiscal-{word}"

    return [condition, nulls, expr, column_type, table, source_column, grain, target,
            function, measure_name, calendar]


@settings(max_examples=80, deadline=None)
@given(st.sampled_from(_mutations()), WORD)
def test_property_any_non_label_change_changes_the_fingerprint(mutate, word):
    raw = revenu_net()
    reference = print_of(raw)
    mutate(raw, word)
    assert print_of(raw) != reference


@settings(max_examples=40, deadline=None)
@given(WORD)
def test_property_label_changes_keep_the_fingerprint(word):
    raw = revenu_net()
    reference = print_of(raw)
    for node in raw["graph"]["nodes"]:
        node["label"] = word
    raw["label"] = word
    assert print_of(raw) == reference
