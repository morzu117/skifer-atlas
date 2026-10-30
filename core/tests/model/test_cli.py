import json
import subprocess
import sys
from pathlib import Path

from conftest import DOCUMENTS, FIXTURES

ATLAS = Path(sys.executable).with_name("atlas")
INVALID = sorted((FIXTURES / "documents-invalid").glob("*.yaml"))


def run(*args):
    return subprocess.run([str(ATLAS), *map(str, args)], capture_output=True, text=True, check=False)


def test_valid_documents_exit_zero():
    result = run("validate", *DOCUMENTS)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.count(": valide") == len(DOCUMENTS)


def test_each_invalid_document_exits_one():
    assert len(INVALID) >= 3
    for path in INVALID:
        assert run("validate", path).returncode == 1, path.name


def test_json_output_lists_errors_in_the_documented_format():
    result = run("validate", "--format", "json", DOCUMENTS[0], *INVALID)
    assert result.returncode == 1
    reports = json.loads(result.stdout)
    assert [report["valid"] for report in reports] == [True] + [False] * len(INVALID)
    for report in reports[1:]:
        assert report["errors"]
        for error in report["errors"]:
            assert set(error) == {"path", "node_id", "code", "message"}


def test_missing_file_is_reported():
    result = run("validate", "--format", "json", "absent.yaml")
    assert result.returncode == 1
    assert json.loads(result.stdout)[0]["errors"][0]["code"] == "unreadable_file"


def test_schema_command_prints_the_schema():
    result = run("schema")
    assert result.returncode == 0
    assert json.loads(result.stdout)["title"].startswith("Document Skifer Atlas")
