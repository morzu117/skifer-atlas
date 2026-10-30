import copy
from pathlib import Path

import pytest
import yaml

FIXTURES = Path(__file__).parents[1] / "fixtures"
DOCUMENTS = sorted((FIXTURES / "documents").glob("*.yaml"))

# Un nœud minimal valide par type : uniquement les champs requis.
MINIMAL_NODES = {
    "source": {
        "id": "n01", "type": "source", "platform": "databricks", "table": "gold.finance.t",
        "owner": "claire.m", "columns": [{"name": "x", "type": "string"}],
    },
    "filter": {
        "id": "n01", "type": "filter", "inputs": ["n00"], "condition": "x:is_not_null",
        "nulls": "drop",
    },
    "join": {
        "id": "n01", "type": "join", "inputs": {"left": "n10", "right": "n11"}, "how": "left",
        "keys": [["a", "b"]], "cardinality": "N:1", "check": "required",
    },
    "union": {
        "id": "n01", "type": "union", "inputs": ["n10", "n11"], "mode": "all",
        "columns": [{"name": "x", "from": {"n10": "a", "n11": "b"}}],
    },
    "compute": {"id": "n01", "type": "compute", "inputs": ["n00"], "column": "y", "expr": "a + b"},
    "deduplicate": {
        "id": "n01", "type": "deduplicate", "inputs": ["n00"], "keys": ["a"],
        "keep": {"order_by": [["d", "desc"]]},
    },
    "aggregate": {
        "id": "n01", "type": "aggregate", "inputs": ["n00"], "group_by": [],
        "measures": [["*", "n", "count"]],
    },
    "temporal": {
        "id": "n01", "type": "temporal", "inputs": ["n00"], "operation": "period",
        "column": "d", "target": "m", "grain": "month",
    },
    "kpi_ref": {"id": "n01", "type": "kpi_ref", "kpi": "revenu-net", "version": 4},
    "metric_op": {
        "id": "n01", "type": "metric_op", "inputs": ["n00"],
        "metrics": [{"name": "marge", "expr": "revenu - cout"}], "order": "aggregate_first",
    },
}


def kpi_with(*nodes: dict) -> dict:
    """Document KPI minimal qui porte les nœuds donnés ; la sortie est le dernier."""
    return {
        "schema_version": 1,
        "kind": "kpi",
        "data_product": {"id": "test", "version": 1, "owner": "claire.m", "domain": "finance"},
        "label": "Test",
        "semantics": {"calendar": {"key": "civil"}, "timezone": "Europe/Paris"},
        "graph": {"nodes": [copy.deepcopy(n) for n in nodes], "output": nodes[-1].get("id", "n99")},
    }


def read_fixture(name: str) -> dict:
    return yaml.safe_load((FIXTURES / "documents" / name).read_text(encoding="utf-8"))


def codes(result) -> list[tuple[str, str | None, str]]:
    return [(issue.path, issue.node_id, issue.code) for issue in result.issues]


@pytest.fixture
def revenu_net() -> dict:
    return read_fixture("revenu-net.yaml")
