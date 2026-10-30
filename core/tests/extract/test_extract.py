"""Extraction de bout en bout (plan 0004) : corpus du moteur, critères d'acceptation, CLI."""

import json
import os
import re
import time

import pytest
from helpers import EXAMPLES, GOLDEN, SQL, complete, load_yaml, run

from skifer_atlas.diff import DiffContext, diff
from skifer_atlas.extract import CODES, extract_file
from skifer_atlas.model import validate_data
from skifer_atlas.model.fingerprint import fingerprint
from skifer_atlas.model.resolve import ResolvedGraph

CORPUS = sorted(path.name for path in SQL.glob("0*.sql"))
VERIFIED_BY_ENGINE = ["01_stg_orders.sql", "02_stg_customers.sql", "03_stg_refunds.sql",
                      "04_silver_orders_enriched.sql", "06_gold_margin_v1.sql"]


def extract_corpus(out, report_format="json"):
    return run("extract", *CORPUS, "--dialect", "databricks", "--out", out, "--format",
               report_format, cwd=SQL)


def document(data: dict):
    return validate_data(data).document


# --- corpus du moteur (critère 1) ---------------------------------------------------------

def test_corpus_matches_golden_drafts_and_report(tmp_path):
    result = extract_corpus(tmp_path)
    assert result.returncode == 3, result.stderr
    drafts = sorted(tmp_path.glob("*.yaml"))
    assert len(drafts) == len(CORPUS) == 8
    update = os.environ.get("ATLAS_UPDATE_GOLDEN")
    if update:
        for old in GOLDEN.glob("*"):
            old.unlink()
        (GOLDEN / "corpus.json").write_text(result.stdout, encoding="utf-8")
    assert result.stdout == (GOLDEN / "corpus.json").read_text(encoding="utf-8")
    for draft in drafts:
        if update:
            (GOLDEN / draft.name).write_text(draft.read_text(encoding="utf-8"), encoding="utf-8")
        assert draft.read_text(encoding="utf-8") == (GOLDEN / draft.name).read_text(
            encoding="utf-8"), draft.name


def test_corpus_statuses():
    report = json.loads((GOLDEN / "corpus.json").read_text(encoding="utf-8"))
    by_file = {entry["file"]: entry["statements"] for entry in report}
    for name in VERIFIED_BY_ENGINE:
        [statement] = by_file[name]
        assert statement["status"] == "draft", name
        assert not any(r["blocking"] for r in statement["residues"]), name
        assert statement["roundtrip"] == {"status": "verified"}, name
    [cte_union] = by_file["05_silver_customers_geo.sql"]
    assert cte_union["status"] == "draft" and cte_union["roundtrip"]["status"] == "verified"
    [kpi] = by_file["08_kpi_monthly.sql"]
    assert kpi["status"] == "needs_curation"
    window = [r for r in kpi["residues"] if r["code"] == "window_function"]
    assert window and window[0]["blocking"] and "(LAG)" in window[0]["message"]


def test_monthly_kpi_union_is_a_node():
    draft = load_yaml((GOLDEN / "08-kpi-monthly.yaml").read_text(encoding="utf-8"))
    nodes = draft["graph"]["nodes"]
    [union] = [n for n in nodes if n["type"] == "union"]
    assert draft["graph"]["output"] == union["id"]
    assert union["mode"] == "all"
    assert [n["type"] for n in nodes].count("deduplicate") == 1


def test_drafts_validate_with_warnings_until_curated():
    for path in sorted(GOLDEN.glob("*.yaml")):
        result = run("validate", path)
        draft = load_yaml(path.read_text(encoding="utf-8"))
        if draft["status"] == "draft":
            assert result.returncode == 0, result.stdout
            assert "avertissement(s)" in result.stdout
        else:
            assert result.returncode == 1 and "[needs_curation]" in result.stdout


# --- déterminisme (critère 7) -------------------------------------------------------------

def test_extraction_is_deterministic(tmp_path):
    first, second = tmp_path / "a", tmp_path / "b"
    assert extract_corpus(first).stdout == extract_corpus(second).stdout
    for draft in sorted(first.glob("*.yaml")):
        assert draft.read_bytes() == (second / draft.name).read_bytes()


# --- critère 4 : SUM(a)/SUM(b) contre AVG(a/b) --------------------------------------------

def test_ratio_of_sums_against_average_of_ratios_is_critical(tmp_path):
    ratio = tmp_path / "ratio.sql"
    ratio.write_text("SELECT g, SUM(a) / SUM(b) AS taux FROM s.t GROUP BY g;\n")
    average = tmp_path / "moyenne.sql"
    average.write_text("SELECT g, AVG(a / b) AS taux FROM s.t GROUP BY g;\n")
    [left] = extract_file(ratio, "databricks").drafts
    [right] = extract_file(average, "databricks").drafts
    assert [n["type"] for n in left.data["graph"]["nodes"]] == ["source", "aggregate", "metric_op"]
    assert [n["type"] for n in right.data["graph"]["nodes"]] == ["source", "compute", "aggregate"]
    report = diff(ResolvedGraph(document(complete(left.data))),
                  ResolvedGraph(document(complete(right.data))), DiffContext("free"))
    assert report.has_critical


# --- critère 5 : même KPI en Databricks et en Snowflake -----------------------------------

def revenu_net_pair():
    [databricks] = extract_file(SQL / "revenu_net.databricks.sql", "databricks").extractions
    [snowflake] = extract_file(SQL / "revenu_net.snowflake.sql", "snowflake").extractions
    for extraction in (databricks, snowflake):
        assert extraction.draft.status == "draft" and extraction.roundtrip.status == "verified"
    types = {"date_facture": "timestamp", "entite": "string", "statut": "string"}
    return complete(databricks.draft.data, types), complete(snowflake.draft.data, types)


def test_same_kpi_in_both_dialects_differs_only_by_its_source():
    databricks, snowflake = revenu_net_pair()
    report = diff(ResolvedGraph(document(databricks)), ResolvedGraph(document(snowflake)),
                  DiffContext("free"))
    assert [(d.kind, d.node_ref.base, sorted(c.field for c in d.changes))
            for d in report.differences] == [("modified", "n01", ["platform", "table"])]


def test_same_kpi_in_both_dialects_has_the_same_fingerprint_once_sources_agree():
    databricks, snowflake = revenu_net_pair()
    # L'empreinte inclut la plateforme et la table lues : on aligne la source, comme le
    # ferait un curateur qui rattache les deux implémentations à la même table.
    source = snowflake["graph"]["nodes"][0]
    source.update(platform="databricks", table="gold.finance.fact_facturation")
    assert fingerprint(document(databricks)) == fingerprint(document(snowflake))


# --- critère 6 : messages sans valeur issue du SQL ----------------------------------------

def test_residue_messages_never_quote_the_sql():
    result = extract_file(SQL / "sentinelles.sql", "databricks")
    residues = [r for _, r in result.residues] + [
        r for extraction in result.extractions for r in extraction.draft.residues
    ]
    found = {r.code for r in residues}
    assert found >= set(CODES) - {"notebook_cell_unreadable"}, set(CODES) - found
    for residue in residues:
        assert not re.search(r"zqx|987654321", residue.message, re.IGNORECASE), residue
    report = json.dumps([e.to_dict() for e in result.extractions])
    assert not re.search(r"zqx|987654321", report, re.IGNORECASE)


# --- notebooks ----------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["notebook.py", "notebook_jupyter.ipynb"])
def test_notebooks(name):
    result = extract_file(SQL / name, "databricks")
    assert [(e.draft.data["kind"], e.draft.status) for e in result.extractions] == [
        ("concept", "draft"), ("kpi", "draft"),
    ]
    unreadable = [r.code for _, r in result.residues]
    assert unreadable == (["notebook_cell_unreadable"] if name.endswith(".py") else [])


# --- CLI ----------------------------------------------------------------------------------

def test_exit_codes(tmp_path):
    clean = tmp_path / "propre.sql"
    clean.write_text("SELECT id FROM s.t;\n")
    review = tmp_path / "a_revoir.sql"
    review.write_text("SELECT id FROM t;\n")
    blocking = tmp_path / "bloquant.sql"
    blocking.write_text("SELECT ROUND(v) AS v FROM s.t;\n")
    assert run("extract", clean, "--dialect", "snowflake").returncode == 0
    assert run("extract", clean, review, "--dialect", "snowflake").returncode == 2
    assert run("extract", clean, review, blocking, "--dialect", "snowflake").returncode == 3
    assert run("extract", tmp_path / "absent.sql", "--dialect", "snowflake").returncode == 1
    assert run("extract", clean, "--dialect", "bigquery").returncode == 2  # argparse


def test_drafts_on_stdout_report_on_stderr(tmp_path):
    script = tmp_path / "deux.sql"
    script.write_text("SELECT id FROM s.t;\nSELECT id, v FROM s.u WHERE v > 0;\n")
    result = run("extract", script, "--dialect", "databricks")
    drafts = result.stdout.split("---\n")
    assert [load_yaml(d)["data_product"]["id"] for d in drafts] == ["deux-1", "deux-2"]
    assert "deux.sql:1 → deux-1 (concept, draft), fidélité verified" in result.stderr
    assert "[nulls_inferred]" in result.stderr


# --- démonstration (critère 8) ------------------------------------------------------------

def test_demo_shows_the_announced_differences(tmp_path):
    out = tmp_path / "brouillons"
    first = run("extract", "marge_v1.sql", "marge_v2.sql", "revenu_net_databricks.sql",
                "--dialect", "databricks", "--out", out, cwd=EXAMPLES)
    second = run("extract", "revenu_net_snowflake.sql", "--dialect", "snowflake", "--out", out,
                 cwd=EXAMPLES)
    assert (first.returncode, second.returncode) == (2, 0), first.stdout + second.stdout

    margins = run("diff", out / "marge-v1.yaml", out / "marge-v2.yaml", "--relation", "free",
                  "--format", "json")
    assert margins.returncode == 2, margins.stderr
    formula = [d for d in json.loads(margins.stdout)["differences"]
               if d["node_type"] == "compute"]
    assert [d["classification"] for d in formula] == ["to_verify"]

    revenue = run("diff", out / "revenu-net-databricks.yaml", out / "revenu-net-snowflake.yaml",
                  "--relation", "free", "--format", "json")
    assert revenue.returncode == 3, revenue.stderr
    critical = [d for d in json.loads(revenue.stdout)["differences"]
                if d["classification"] == "critical"]
    assert [d["node_type"] for d in critical] == ["filter"]


# --- banc d'essai -------------------------------------------------------------------------

def test_two_thousand_lines_extract_quickly(tmp_path):
    block = (SQL / "08_kpi_monthly.sql").read_text(encoding="utf-8")
    lines = block.count("\n")
    script = tmp_path / "gros.sql"
    script.write_text(block * (2000 // lines + 1), encoding="utf-8")
    assert script.read_text(encoding="utf-8").count("\n") >= 2000
    start = time.perf_counter()
    result = extract_file(script, "databricks")
    elapsed = time.perf_counter() - start
    assert len(result.extractions) == 2000 // lines + 1
    assert elapsed < 2, f"{elapsed:.2f} s"
