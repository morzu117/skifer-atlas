"""Fabriques de documents pour les tests du plan 0002 (à partir des fixtures)."""

import copy

from conftest import read_fixture

from skifer_atlas.model import validate_data


def build(raw: dict):
    result = validate_data(raw)
    assert result.valid, result.issues
    return result.document


def revenu_net() -> dict:
    return read_fixture("revenu-net.yaml")


def nodes(raw: dict) -> dict:
    return {node["id"]: node for node in raw["graph"]["nodes"]}


def kpi(kpi_id: str, version: int, graph_nodes: list, output: str) -> dict:
    return {
        "schema_version": 1, "kind": "kpi",
        "data_product": {"id": kpi_id, "version": version, "owner": "claire.m",
                         "domain": "finance"},
        "label": kpi_id,
        "semantics": {"calendar": {"key": "civil"}, "timezone": "Europe/Paris"},
        "graph": {"nodes": copy.deepcopy(graph_nodes), "output": output},
    }


def kpi_ref(node_id: str, kpi_id: str, version: int) -> dict:
    return {"id": node_id, "type": "kpi_ref", "kpi": kpi_id, "version": version}


def total(node_id: str, source: str, group_by: list, measure: list) -> dict:
    return {"id": node_id, "type": "aggregate", "inputs": [source], "group_by": group_by,
            "measures": [measure]}


CONDITIONS = ["statut:equals:validée", "montant_ttc:greater_than:0", "entite:is_not_null"]

ENTITES = {
    "id": "n06", "type": "source", "platform": "databricks", "table": "gold.ref.entites",
    "owner": "claire.m",
    "columns": [{"name": "entite_id", "type": "string"}, {"name": "pays", "type": "string"}],
}


def with_join(raw: dict, **join_fields) -> dict:
    """Revenu net avec une jointure n07 (n02 × entités n06) entre le filtre et le calcul."""
    raw["graph"]["nodes"].insert(1, copy.deepcopy(ENTITES))
    join = {
        "id": "n07", "type": "join", "inputs": {"left": "n02", "right": "n06"}, "how": "left",
        "keys": [["entite", "entite_id"]], "cardinality": "N:1", "check": "required",
    }
    join.update(join_fields)
    raw["graph"]["nodes"].insert(3, join)
    nodes(raw)["n03"]["inputs"] = ["n07"]
    return raw


def with_filters(conditions: list[str], join_after: int | None = None) -> dict:
    """Revenu net dont n02 est remplacé par une suite de filtres (n11, n12…), avec, si
    demandé, une jointure aux entités après le filtre de rang `join_after`."""
    raw = revenu_net()
    graph_nodes = [n for n in raw["graph"]["nodes"] if n["id"] != "n02"]
    chain, previous = [], "n01"
    for index, condition in enumerate(conditions):
        chain.append({"id": f"n{index + 11}", "type": "filter", "inputs": [previous],
                      "condition": condition, "nulls": "drop"})
        previous = chain[-1]["id"]
        if join_after == index:
            chain.append(copy.deepcopy(ENTITES))
            chain.append({
                "id": "n10", "type": "join", "inputs": {"left": previous, "right": "n06"},
                "how": "left", "keys": [["entite", "entite_id"]], "cardinality": "N:1",
                "check": "required",
            })
            previous = "n10"
    nodes_by_id = {n["id"]: n for n in graph_nodes}
    nodes_by_id["n03"]["inputs"] = [previous]
    raw["graph"]["nodes"] = [graph_nodes[0], *chain, *graph_nodes[1:]]
    return raw
