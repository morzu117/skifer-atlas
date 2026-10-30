import copy

import pytest
from conftest import read_fixture
from graphs import CONDITIONS, build, nodes, revenu_net, with_filters, with_join

from skifer_atlas.diff import DiffContext, diff, report_text
from skifer_atlas.diff.align import Side, align
from skifer_atlas.model.resolve import ResolvedGraph, resolve


def versions(base_raw: dict, other_raw: dict, relation: str = "version"):
    return diff(ResolvedGraph(build(base_raw)), ResolvedGraph(build(other_raw)),
                DiffContext(relation))


def changed(report) -> list[tuple]:
    return [
        (d.kind, d.node_ref.base if d.node_ref else None, d.classification, d.severity)
        for d in report.differences
    ]


def variant(name: str):
    canonical = build(revenu_net())
    return ResolvedGraph(canonical), resolve(build(read_fixture(name)), canonical)


# --- critères d'acceptation --------------------------------------------------------------

def test_identical_up_to_filter_order():
    report = versions(with_filters(CONDITIONS), with_filters(CONDITIONS[::-1]))
    assert report.identical
    assert report.differences == [] and report.pairs == []


def test_de_against_canonical_matches_the_mockup():
    base, other = variant("revenu-net--nordis-de.yaml")
    report = diff(base, other, DiffContext("override"))
    assert changed(report) == [
        ("modified", "n02", "override_undeclared", "critical"),
        ("modified", "n03", "override_declared", "warn"),
    ]
    n02 = report.differences[0]
    assert n02.node_type == "filter"
    assert (n02.changes[0].field, n02.changes[0].before, n02.changes[0].after) == (
        "condition", "statut:equals:validée", "statut:in:validée,expédiée",
    )
    assert "hors des points de variation déclarés" in n02.message
    assert report.other.id == "revenu-net--nordis-de"
    assert report.summary.by_classification["override_declared"] == 1


def test_sum_to_avg_is_critical():
    other = revenu_net()
    nodes(other)["n05"]["measures"][0][2] = "avg"
    report = versions(revenu_net(), other)
    assert changed(report) == [("modified", "n05", "critical", "critical")]
    assert report.differences[0].changes[0].field == "measures"


def test_join_bypass_is_critical_and_says_so():
    other = with_join(revenu_net(), check="bypass", bypass_reason="Doublons connus en amont.")
    report = versions(with_join(revenu_net()), other)
    assert changed(report) == [("modified", "n07", "critical", "critical")]
    assert "Contrôle de cardinalité contourné : Doublons connus en amont." in (
        report.differences[0].message
    )


def test_label_only_is_cosmetic():
    other = revenu_net()
    nodes(other)["n03"]["label"] = "Montant hors taxes"
    report = versions(revenu_net(), other)
    assert changed(report) == [("modified", "n03", "cosmetic", "info")]


DEDUP = {"id": "n08", "type": "deduplicate", "keys": ["facture_id"],
         "keep": {"order_by": [["date_facture", "desc"]]}}


def _join_then_dedup(dedup_first: bool) -> dict:
    raw = with_join(revenu_net())
    dedup = copy.deepcopy(DEDUP)
    raw["graph"]["nodes"].insert(4, dedup)
    if dedup_first:
        dedup["inputs"] = ["n02"]
        nodes(raw)["n07"]["inputs"]["left"] = "n08"
        nodes(raw)["n03"]["inputs"] = ["n07"]
    else:
        dedup["inputs"] = ["n07"]
        nodes(raw)["n03"]["inputs"] = ["n08"]
    return raw


def test_swapping_join_and_deduplicate_is_reordered():
    report = versions(_join_then_dedup(False), _join_then_dedup(True))
    assert changed(report) == [("reordered", "n07", "critical", "critical")]
    order = report.differences[0].changes[0]
    assert (order.field, order.before, order.after) == ("order", ["n07", "n08"], ["n08", "n07"])
    assert "Ordre inversé" in report.differences[0].message


def test_es_from_scratch_is_paired_by_score():
    base, other = variant("revenu-net--nordis-es.yaml")
    report = diff(base, other, DiffContext("from_scratch"))
    assert [(p.base, p.other) for p in report.pairs] == [
        ("n01", "n01"), ("n02", "n02"), ("n04", "n04"), ("n05", "n05"),
    ]
    assert all(p.score is not None and p.score >= 3 for p in report.pairs)
    assert {d.classification for d in report.differences} == {"from_scratch"}
    assert [(d.kind, d.node_ref.base, d.node_ref.other, d.severity)
            for d in report.differences] == [
        ("modified", "n01", "n01", "warn"),
        ("modified", "n02", "n02", "critical"),
        ("removed", "n03", None, "warn"),
        ("modified", "n04", "n04", "warn"),
        ("modified", "n05", "n05", "critical"),
        ("added", None, "n03", "critical"),
    ]
    # sociedad est liée à entite : le group_by ne diffère pas.
    assert [c.field for c in report.differences[4].changes] == ["measures"]


def test_different_expressions_are_to_verify():
    other = revenu_net()
    nodes(other)["n03"]["expr"] = "montant_ttc * 0.8 - avoirs"
    report = versions(revenu_net(), other)
    assert changed(report) == [("modified", "n03", "to_verify", "warn")]
    assert "non démontrée" in report.differences[0].message


def test_equivalent_expressions_are_cosmetic():
    other = revenu_net()
    nodes(other)["n03"]["expr"] = "(montant_ttc - montant_taxes) - avoirs"
    report = versions(revenu_net(), other)
    assert not report.identical
    assert changed(report) == [("modified", "n03", "cosmetic", "info")]


def test_json_output_is_stable():
    base, other = variant("revenu-net--nordis-es.yaml")
    first = diff(base, other, DiffContext("from_scratch")).to_json()
    base, other = variant("revenu-net--nordis-es.yaml")
    assert diff(base, other, DiffContext("from_scratch")).to_json() == first


# --- tableau de classification -----------------------------------------------------------

def test_from_scratch_wins_over_critical():
    other = revenu_net()
    nodes(other)["n05"]["measures"][0][2] = "avg"
    report = versions(revenu_net(), other, "from_scratch")
    assert changed(report) == [("modified", "n05", "from_scratch", "critical")]


@pytest.mark.parametrize("node_id, field, value", [
    ("n02", "condition", "statut:equals:payée"),
    ("n02", "nulls", "keep"),
    ("n05", "group_by", ["mois_fiscal"]),
    ("n04", "grain", "quarter"),
])
def test_critical_fields(node_id, field, value):
    other = revenu_net()
    nodes(other)[node_id][field] = value
    assert changed(versions(revenu_net(), other)) == [
        ("modified", node_id, "critical", "critical"),
    ]


@pytest.mark.parametrize("field, value", [
    ("how", "inner"), ("keys", [["entite", "pays"]]), ("cardinality", "1:1"),
])
def test_critical_join_fields(field, value):
    other = with_join(revenu_net(), **{field: value})
    assert changed(versions(with_join(revenu_net()), other)) == [
        ("modified", "n07", "critical", "critical"),
    ]


def test_calendar_change_is_reported_once_at_semantics_level():
    other = revenu_net()
    other["semantics"]["calendar"]["version"] = "2027.1"
    report = versions(revenu_net(), other)
    assert [(d.node_type, d.node_ref, d.classification) for d in report.differences] == [
        ("semantics", None, "critical"),
    ]
    assert report.differences[0].changes[0].field == "calendar"


def test_declared_semantics_override():
    canonical_raw = revenu_net()
    canonical_raw["variation_points"].append("semantics.currency")
    raw = read_fixture("revenu-net--nordis-de.yaml")
    raw["overrides"] = [{"node": "semantics.currency", "justification": "Franc suisse.",
                         "value": "CHF"}]
    canonical = build(canonical_raw)
    report = diff(ResolvedGraph(canonical), resolve(build(raw), canonical),
                  DiffContext("override"))
    assert [(d.node_type, d.classification, d.severity) for d in report.differences] == [
        ("semantics", "override_declared", "warn"),
    ]


def test_consistent_column_rename_is_one_cosmetic_change():
    other = revenu_net()
    nodes(other)["n03"]["column"] = "montant_net"
    nodes(other)["n05"]["measures"][0][0] = "montant_net"
    report = versions(revenu_net(), other)
    assert changed(report) == [("modified", "n03", "cosmetic", "info")]
    assert report.differences[0].changes[0].field == "column"


def test_inconsistent_column_use_is_not_cosmetic():
    other = revenu_net()
    nodes(other)["n05"]["measures"][0][0] = "montant_ttc"
    assert changed(versions(revenu_net(), other)) == [("modified", "n05", "critical", "critical")]


def test_filter_moved_across_a_join_is_critical():
    report = versions(with_filters(CONDITIONS, join_after=2),
                      with_filters(CONDITIONS, join_after=1))
    # La suite n11-n13 perd n13, qui passe après la jointure.
    assert changed(report) == [
        ("modified", "n13", "critical", "critical"),
        ("added", None, "critical", "critical"),
    ]
    assert [d.node_ref.other for d in report.differences] == ["n12", "n13"]


def test_added_filter_and_removed_compute():
    other = revenu_net()
    graph_nodes = other["graph"]["nodes"]
    graph_nodes.insert(2, {"id": "n06", "type": "compute", "inputs": ["n02"], "column": "x",
                           "expr": "avoirs * 2"})
    nodes(other)["n03"]["inputs"] = ["n06"]
    graph_nodes.append({"id": "n07", "type": "filter", "inputs": ["n04"],
                        "condition": "entite:not_equals:test", "nulls": "keep"})
    nodes(other)["n05"]["inputs"] = ["n07"]
    report = versions(revenu_net(), other)
    assert changed(report) == [
        ("added", None, "to_verify", "warn"),
        ("added", None, "critical", "critical"),
    ]
    assert [d.node_ref.other for d in report.differences] == ["n06", "n07"]

    report = versions(other, revenu_net())
    assert [(d.kind, d.node_ref.base, d.severity) for d in report.differences] == [
        ("removed", "n06", "warn"), ("removed", "n07", "critical"),
    ]


def test_overrides_are_ignored_outside_the_override_relation():
    base, other = variant("revenu-net--nordis-de.yaml")
    report = diff(base, other, DiffContext("free"))
    assert "override_declared" not in {d.classification for d in report.differences}


# --- alignement ----------------------------------------------------------------------------

def _two_branches(ids: tuple[str, str]) -> dict:
    raw = revenu_net()
    first, second = ids
    branch = {"type": "filter", "inputs": ["n01"], "condition": "statut:equals:validée",
              "nulls": "drop"}
    graph_nodes = [n for n in raw["graph"]["nodes"] if n["id"] != "n02"]
    graph_nodes[1:1] = [{"id": first, **branch}, {"id": second, **branch}, {
        "id": "n09", "type": "union", "inputs": [first, second], "mode": "all",
        "columns": [{"name": c, "from": {first: c, second: c}}
                    for c in ("entite", "date_facture", "montant_ttc", "montant_taxes", "avoirs")],
    }]
    raw["graph"]["nodes"] = graph_nodes
    nodes(raw)["n03"]["inputs"] = ["n09"]
    return raw


def test_score_ties_follow_topological_order():
    base = Side(build(_two_branches(("n02", "n06"))))
    other = Side(build(_two_branches(("n17", "n12"))))
    pairs = {p.base: p.other for p in align(base, other, by_id=False)}
    assert pairs["n02"] == "n17" and pairs["n06"] == "n12"


def test_renamed_graph_is_paired_by_score():
    other = revenu_net()
    text = repr(other)
    for old in ("n01", "n02", "n03", "n04", "n05"):
        text = text.replace(f"'{old}'", f"'{old.replace('n0', 'n3')}'")
    renamed = eval(text)
    pairs = align(Side(build(revenu_net())), Side(build(renamed)), by_id=True)
    assert [(p.base, p.other) for p in pairs] == [
        ("n01", "n31"), ("n02", "n32"), ("n03", "n33"), ("n04", "n34"), ("n05", "n35"),
    ]
    assert all(p.score >= 5 for p in pairs)


def test_low_score_pair_is_to_verify():
    base, other = variant("revenu-net--nordis-es.yaml")
    report = diff(base, other, DiffContext("free"))
    period = next(d for d in report.differences if d.node_ref.base == "n04")
    assert next(p.score for p in report.pairs if p.base == "n04") < 5
    assert (period.classification, period.severity) == ("to_verify", "warn")
    assert "Appariement incertain" in period.message


def test_text_report_reads_without_json():
    base, other = variant("revenu-net--nordis-de.yaml")
    text = report_text(diff(base, other, DiffContext("override")))
    assert text.splitlines()[:3] == [
        "revenu-net v4 → revenu-net--nordis-de v3 (surcharge)",
        "2 écart(s) : 1 critique(s), 1 à surveiller, 0 sans effet",
        "  n02       filter       modifié  surcharge hors points · critique",
    ]
    assert "      condition : statut:equals:validée → statut:in:validée,expédiée" in text
