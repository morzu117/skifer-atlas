import json
import os
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
            assert set(error) == {"path", "node_id", "code", "message", "severity"}


def test_missing_file_is_reported():
    result = run("validate", "--format", "json", "absent.yaml")
    assert result.returncode == 1
    assert json.loads(result.stdout)[0]["errors"][0]["code"] == "unreadable_file"


def test_schema_command_prints_the_schema():
    result = run("schema")
    assert result.returncode == 0
    assert json.loads(result.stdout)["title"].startswith("Document Skifer Atlas")


DOCS = FIXTURES / "documents"
CANONICAL = DOCS / "revenu-net.yaml"
DE = DOCS / "revenu-net--nordis-de.yaml"
ES = DOCS / "revenu-net--nordis-es.yaml"


def test_check_corpus_with_the_canonical():
    result = run("check", "--with", CANONICAL, *DOCUMENTS)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "nordis-de.yaml : 0 erreur(s), 1 avertissement(s), 0 info(s)" in result.stdout
    assert "surcharge     n02 (hors points)" in result.stdout
    assert "surcharge     n03 (point déclaré)" in result.stdout
    assert "[undeclared_override]" in result.stdout


def test_check_variant_without_its_canonical():
    result = run("check", "--format", "json", DE)
    assert result.returncode == 1
    [report] = json.loads(result.stdout)
    assert [issue["code"] for issue in report["issues"]] == ["missing_canonical"]


def test_check_json_lists_overrides():
    [report] = json.loads(run("check", "--format", "json", "--with", CANONICAL, DE).stdout)
    assert report["valid"] is True
    assert [(o["node"], o["classification"]) for o in report["overrides"]] == [
        ("n02", "undeclared"), ("n03", "declared"),
    ]


def test_check_reports_graph_errors(tmp_path):
    broken = tmp_path / "revenu-net.yaml"
    broken.write_text(CANONICAL.read_text(encoding="utf-8").replace(
        "montant_ttc - montant_taxes - avoirs", "montant_ttc - montant_taxe - avoirs"
    ), encoding="utf-8")
    result = run("check", broken)
    assert result.returncode == 1
    assert "(n03) [unknown_column]" in result.stdout
    assert "Voulez-vous dire : montant_taxes, montant_ttc ?" in result.stdout


def test_resolve_writes_the_resolved_kpi(tmp_path):
    out = tmp_path / "de.yaml"
    result = run("resolve", DE, CANONICAL, "--out", out)
    assert result.returncode == 0, result.stderr
    assert "n02 : undeclared" in result.stderr and "n03 : declared" in result.stderr
    text = out.read_text(encoding="utf-8")
    assert "expr: montant_ttc / 1.19 - avoirs" in text
    assert run("check", out).returncode == 0


def test_normalize_prints_the_normalized_form():
    result = run("normalize", CANONICAL)
    assert result.returncode == 0
    assert result.stdout.startswith("normalization: atlas1\n")
    assert "type: filter_set" in result.stdout
    assert "label:" not in result.stdout and "owner:" not in result.stdout


def test_fingerprint_refuses_a_document_without_graph():
    result = run("fingerprint", DOCS / "commande.yaml")
    assert result.returncode == 1
    assert "[missing_field]" in result.stderr


def test_fingerprint_is_stable_under_different_hash_seeds():
    outputs = set()
    for seed in ("0", "7", "123456"):
        env = {**os.environ, "PYTHONHASHSEED": seed}
        result = subprocess.run(
            [str(ATLAS), "fingerprint", "--with", str(CANONICAL), str(CANONICAL), str(DE),
             str(ES)],
            capture_output=True, text=True, check=False, env=env,
        )
        assert result.returncode == 0, result.stderr
        outputs.add(result.stdout)
    [output] = outputs
    prints = [line.split()[0] for line in output.splitlines()]
    assert len(set(prints)) == 3
    assert all(p.startswith("sha256:atlas1:") for p in prints)
