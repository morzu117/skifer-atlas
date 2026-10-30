"""Brouillons d'extraction (ADR 0006) : statut, littéral TODO, bloc extraction."""

import copy

import pytest
from conftest import MINIMAL_NODES, kpi_with

from skifer_atlas.model import validate_data

EXTRACTION = {
    "source_file": "revenu.sql", "line": 3, "dialect": "databricks",
    "sql_sha256": "0" * 64, "residues": [],
}


def draft(status="draft", residues=()):
    raw = kpi_with(copy.deepcopy(MINIMAL_NODES["source"]),
                   dict(MINIMAL_NODES["aggregate"], id="n02", inputs=["n01"]))
    raw["status"] = status
    raw["data_product"].update(owner="TODO", domain="TODO")
    raw["semantics"] = {"calendar": "TODO", "timezone": "TODO"}
    source = raw["graph"]["nodes"][0]
    source.update(owner="TODO", table="TODO.t")
    source["columns"][0]["type"] = "TODO"
    raw["extraction"] = dict(EXTRACTION, residues=list(residues))
    return raw


def found(result):
    return [(issue.path, issue.code, issue.severity) for issue in result.issues]


def test_todo_values_are_warnings_in_a_draft():
    result = validate_data(draft())
    assert result.valid and result.document is not None
    assert found(result) == [
        ("/data_product/owner", "todo", "warning"),
        ("/data_product/domain", "todo", "warning"),
        ("/semantics/calendar", "todo", "warning"),
        ("/semantics/timezone", "todo", "warning"),
        ("/graph/nodes/0/table", "todo", "warning"),
        ("/graph/nodes/0/owner", "todo", "warning"),
        ("/graph/nodes/0/columns/0/type", "todo", "warning"),
    ]
    assert {i.node_id for i in result.issues if i.path.startswith("/graph")} == {"n01"}


def test_todo_values_are_errors_once_the_status_is_removed():
    raw = draft()
    del raw["status"], raw["extraction"]
    result = validate_data(raw)
    assert not result.valid and result.document is None
    assert {severity for _, code, severity in found(result)} == {"error"}


def test_needs_curation_is_refused():
    result = validate_data(draft("needs_curation"))
    assert ("/status", "needs_curation", "error") in found(result)


def test_blocking_residue_in_a_draft_is_refused():
    residue = {"code": "window_function", "message": "Fenêtre.", "blocking": True}
    result = validate_data(draft(residues=[residue]))
    assert ("/extraction/residues/0", "blocking_residue", "error") in found(result)
    residue["blocking"] = False
    assert validate_data(draft(residues=[residue])).valid


def test_extraction_needs_a_status():
    raw = draft()
    del raw["status"]
    assert ("/extraction", "invalid_value", "error") in found(validate_data(raw))


@pytest.mark.parametrize(("path", "value"), [
    (("graph", "nodes", 1, "measures"), [["x", "n", "TODO"]]),
    (("graph", "nodes", 0, "platform"), "TODO"),
    (("data_product", "id"), "TODO"),
])
def test_todo_is_refused_where_extraction_can_know(path, value):
    raw = draft()
    target = raw
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    assert not validate_data(raw).valid
