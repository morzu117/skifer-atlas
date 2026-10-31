"""Comparaison chiffrée (plan 0009) : réconciliation, préparation, exécution DuckDB locale."""

import json
import shutil
import threading
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import duckdb
import pytest
import yaml

from skifer_atlas.cli import main
from skifer_atlas.compare import (
    CompareRequest,
    LocalRunner,
    divergent_node,
    gap,
    orchestrate,
    reconcile,
    store,
)
from skifer_atlas.compare.reconcile import dimension_value, keyed, summarize
from skifer_atlas.compare.service import prepare_in
from skifer_atlas.connectors.base import QueryResult
from skifer_atlas.repo.git import RepoError

EXAMPLE = Path(__file__).parents[3] / "examples" / "espace-nordis"
DATA = Path(__file__).parents[1] / "fixtures" / "compare" / "revenu-net"
SCOPE = "fy2026-mois-entite"


def request(*variants, **extra):
    return CompareRequest(kpi_id="revenu-net", variants=list(variants or ["nordis-de"]),
                          **({"scope_id": SCOPE} | extra))


def compare(root, db, *variants, runner=None, **extra):
    prepared = prepare_in(root, request(*variants, **extra), None, True)
    started = orchestrate.start(db, "julien.h", prepared, runner or LocalRunner(DATA),
                                wait=True)
    return prepared, store.get(db, started.number)


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    """Registre des espaces vide : la CLI ne lit jamais celui du poste."""
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path / "atlas"))
    monkeypatch.delenv("ATLAS_COMPARE_DATA", raising=False)


@pytest.fixture
def space(tmp_path):
    """Copie modifiable de l'espace de démonstration."""
    root = tmp_path / "espace"
    shutil.copytree(EXAMPLE, root)
    return root


@pytest.fixture
def db(tmp_path):
    return tmp_path / "atlas.duckdb"


def edit_yaml(path, change):
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    change(data)
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")


# --- réconciliation (unitaires) -------------------------------------------------------------

@pytest.mark.parametrize(("canonical", "variant", "expected"), [
    (100.0, 101.0, 1.0),
    (100.0, 99.0, -1.0),
    (-100.0, -90.0, 10.0),  # en pourcentage de |canonique|
    (0.0, 0.0, 0.0),
    (0.0, 5.0, None),  # critère 4
    (None, None, 0.0),
    (None, 3.0, None),
])
def test_gap(canonical, variant, expected):
    assert gap(canonical, variant) == expected


def test_cells_missing_on_one_side_are_out_of_tolerance():
    """Critères 3 et 4."""
    canonical = {'["2026-01"]': 100.0, '["2026-02"]': 0.0, '["2026-03"]': 50.0}
    variant = {'["2026-01"]': 101.0, '["2026-02"]': 4.0, '["2026-04"]': 7.0}
    cells = reconcile(["mois"], canonical, variant, 1.5)
    assert [(c.dims["mois"], c.within, c.missing, c.gap_pct) for c in cells] == [
        ("2026-01", True, None, 1.0), ("2026-02", False, None, None),
        ("2026-03", False, "variant", None), ("2026-04", False, "canonical", None)]
    summary = summarize(cells)
    assert (summary.cell_count, summary.validation_pct, summary.max_gap_pct) == (4, 25.0, 1.0)
    assert summarize([]).validation_pct is None


def test_dimension_values_compare_across_platforms():
    assert dimension_value(date(2026, 9, 1)) == "2026-09-01"
    assert dimension_value(datetime(2026, 9, 1, 6, 30)) == "2026-09-01 06:30:00"
    assert dimension_value(Decimal("12.00")) == 12 == dimension_value(12.0)
    assert dimension_value(Decimal("1.5")) == 1.5
    with pytest.raises(RepoError) as error:
        keyed([("FR", 1), ("FR", 2)], [0], 1, "du canonique")
    assert error.value.code == "duplicate_dimensions"


def test_divergent_node_prefers_critical_then_undeclared_nodes():
    def difference(classification, node=None, field="timezone"):
        return {"classification": classification, "node_type": "filter" if node else "semantics",
                "node_ref": {"base": node, "other": node} if node else None,
                "changes": [{"field": field}], "message": classification}
    semantic = difference("override_undeclared")
    assert divergent_node([semantic])["node_id"] == "semantics.timezone"
    assert divergent_node([semantic, difference("override_undeclared", "n02")])["node_id"] == "n02"
    assert divergent_node([difference("override_undeclared", "n02"),
                           difference("critical", "n05")])["node_id"] == "n05"
    assert divergent_node([difference("override_declared", "n03")]) is None
    # Une source déplacée sur une autre plateforme n'explique pas un écart (plan 0018).
    moved = difference("override_undeclared", "n01", field="platform")
    assert divergent_node([moved, difference("override_undeclared", "n02")])["node_id"] == "n02"
    assert divergent_node([moved]) is None


# --- critères 1, 2, 7, 9 : la démonstration en DuckDB local ---------------------------------

def test_mockup_values(db):
    """Critère 1 : 94 % de validation, écart maximal 6,1 %, nœud divergent n02."""
    prepared, found = compare(EXAMPLE, db, "nordis-de", "nordis-fr")
    assert found["status"] == "done" and found["error"] is None
    de, fr = found["results"]
    assert (de["entity"], de["cell_count"], round(de["validation_pct"]),
            round(de["max_gap_pct"], 1)) == ("nordis-de", 16, 94, 6.1)
    assert de["divergent"]["node_id"] == "n02" and de["divergent_node"] == "n02"
    [out] = [c for c in de["cells"] if not c["within_tolerance"]]
    assert out["dims"] == {"mois_fiscal": "2026-09-01", "entite": "DE"}
    assert (out["canonical_value"], out["variant_value"]) == (4410720, 4679780)
    assert (fr["validation_pct"], fr["max_gap_pct"], fr["divergent"]) == (100, 0, None)
    assert {d["node_ref"]["other"] for d in de["differences"] if d["node_ref"]} >= {"n02", "n03"}
    assert [a["code"] for a in prepared.alerts()] == ["undeclared_override"]
    assert prepared.alerts()[0]["nodes"] == ["semantics.timezone", "n02"]


def test_kpi_tolerance_overrides_the_global_one(space, db):
    """Critère 2 : 1,5 % au KPI contre 1 % dans l'espace. Août (+1,43 %) passe."""
    _, found = compare(space, db)
    assert (found["tolerance_pct"], found["results"][0]["validation_pct"]) == (1.5, 93.75)
    edit_yaml(space / "kpis" / "revenu-net.yaml", lambda d: d.pop("tolerance"))
    _, found = compare(space, db)
    assert (found["tolerance_pct"], found["results"][0]["validation_pct"]) == (1.0, 87.5)
    _, found = compare(space, db, tolerance=7)  # le curseur de l'écran l'emporte
    assert found["results"][0]["validation_pct"] == 100


def test_sql_is_kept_and_nothing_extracted_remains(db):
    """Critères 7 et 9 : SQL exécutés relisibles ; aucune table d'extraction ; jamais
    plus de lignes rapatriées que de cellules."""
    prepared, found = compare(EXAMPLE, db, "nordis-de", "nordis-fr")
    plans = {p.variant_id: p for p in prepared.plans}
    assert len(found["runs"]) == 4
    for run in found["runs"]:
        compiled = getattr(plans[run["variant_id"]], run["side"]).compiled
        assert run["sql_text"] == compiled.sql and run["status"] == "done"
        assert run["access_point"] is None and run["platform"] == "databricks"
    cells = {r["variant_id"]: r["cell_count"] for r in found["results"]}
    assert all(run["row_count"] <= cells[run["variant_id"]] for run in found["runs"])
    with duckdb.connect(str(db)) as connection:
        tables = [t for (t,) in connection.execute(
            "SELECT table_name FROM duckdb_tables()").fetchall()]
        stored = connection.execute("SELECT count(*) FROM results.cells").fetchone()[0]
    assert sorted(tables) == ["cells", "comparison_runs", "comparisons", "summaries"]
    assert stored == 24
    assert "staging" not in " ".join(tables)


def test_history_keeps_every_comparison(db):
    compare(EXAMPLE, db)
    compare(EXAMPLE, db, scope_id=None, scope={"period": {"calendar_period": "FY2026_Q4"},
                                                 "perimeter": ["entite:in:DE"]})
    history = store.history(db, "revenu-net")
    assert [c["id"] for c in history] == [2, 1]
    assert history[0]["scope"]["perimeter"] == ["entite:in:DE"]
    assert history[0]["results"][0]["validation_pct"] == pytest.approx(200 / 3)


# --- critère 5 : bypass ---------------------------------------------------------------------

def test_bypassed_join_is_reported(space, db):
    path = space / "variants" / "revenu-net" / "nordis-de.yaml"

    def bypass(data):
        data["overrides"].append({
            "node": "n07", "justification": "Calendrier comptable allemand en doublons.",
            "replace": {"id": "n07", "type": "join", "label": "Date comptable",
                        "inputs": {"left": "n03", "right": "n06"}, "how": "inner",
                        "keys": [["date_facture", "date_jour"]], "cardinality": "N:1",
                        "check": "bypass", "bypass_reason": "Doublons connus côté DE."}})
    edit_yaml(path, bypass)
    prepared, found = compare(space, db)
    assert found["results"][0]["bypass_nodes"] == ["n07"]
    assert {a["code"] for a in prepared.alerts()} == {"cardinality_bypass",
                                                      "undeclared_override"}
    assert next(a for a in prepared.alerts() if a["code"] == "cardinality_bypass")[
        "nodes"] == ["n07"]


# --- rebranchement du canonique -------------------------------------------------------------

ES_FILE = Path("variants") / "revenu-net" / "nordis-es.yaml"


def edit_es_source(space, change):
    """Modifie la source n01 de nordis-es dans la copie de l'espace."""
    def apply(data):
        source = data["graph"]["nodes"][0]
        change(source)
    edit_yaml(space / ES_FILE, apply)


def drop_column(source, name):
    source["columns"] = [c for c in source["columns"] if c["name"] != name]
    source["binding"].pop(name, None)


def test_from_scratch_es_compares_with_fr_and_de(db):
    """Plan 0022, critère 1 : FR, DE et ES comparées ensemble ; ES a un vrai pourcentage."""
    prepared, found = compare(EXAMPLE, db, "nordis-de", "nordis-fr", "nordis-es")
    assert found["status"] == "done" and found["error"] is None
    results = {r["entity"]: r for r in found["results"]}
    assert (round(results["nordis-de"]["validation_pct"]),
            results["nordis-fr"]["validation_pct"]) == (94, 100)
    es = results["nordis-es"]
    assert (es["platform"], es["cell_count"], es["validation_pct"],
            round(es["max_gap_pct"], 2)) == ("snowflake", 8, 75, 2.93)
    out = [(c["dims"]["mois_fiscal"], c["canonical_value"], c["variant_value"])
           for c in es["cells"] if not c["within_tolerance"]]
    # La facture du 30 juin, clôturée après minuit à Madrid : juillet côté ES.
    assert out == [("2026-06-01", 2100000, 2040000), ("2026-07-01", 2050000, 2110000)]
    assert es["divergent"] is None  # from scratch : écarts justifiés, pas de piste
    plan = next(p for p in prepared.plans if p.entity == "nordis-es")
    sql = plan.canonical.compiled.sql
    assert "FROM FINANZAS.PUBLIC.FACTURAS" in sql and "importe_bruto AS montant_ttc" in sql
    assert "estado_grupo AS statut" in sql and "sociedad AS entite" in sql
    tables = {s.table: [c for c, _ in s.columns] for s in plan.canonical.compiled.sources}
    # facture_id n'est lue par aucun nœud du canonique : retirée de la source rebranchée.
    assert tables["FINANZAS.PUBLIC.FACTURAS"] == [
        "factura_id", "sociedad", "estado_grupo", "fecha_factura", "importe_bruto", "iva",
        "abonos"]
    assert tables["gold.finance.dim_date"] == ["date_jour", "date_comptable"]  # commune


def test_rebound_canonical_keeps_a_common_source(space):
    """Date de référence : aucune source ES rattachée à ce concept, la table du canonique
    reste, lue sur la plateforme de la déclinaison."""
    from skifer_atlas.compare.rebind import rebind
    from skifer_atlas.index.build import analyze
    from skifer_atlas.model.resolve import resolve

    analysis = analyze(space)
    kpi = analysis.entry("revenu-net").document
    variant = analysis.entry("revenu-net--nordis-es").document
    found = rebind(kpi, resolve(variant, kpi, analysis.library), analysis.library)
    nodes = {n.id: n for n in found.document.graph.nodes if n.type == "source"}
    assert found.common == ["n06"]
    assert (nodes["n06"].table, nodes["n06"].platform) == ("gold.finance.dim_date", "snowflake")
    assert (nodes["n01"].table, nodes["n01"].platform) == ("FINANZAS.PUBLIC.FACTURAS",
                                                           "snowflake")
    assert found.renames["n01"]["avoirs"] == "abonos"
    assert "facture_id" not in [c.name for c in nodes["n01"].columns]


def test_canonical_not_rebindable_lists_missing_columns(space, db):
    """Plan 0022, critère 2 : une colonne lue par le canonique manque vraiment."""
    edit_es_source(space, lambda s: drop_column(s, "abonos"))
    with pytest.raises(RepoError) as error:
        compare(space, db, "nordis-es")
    assert error.value.code == "canonical_not_rebindable"
    assert "colonnes de n01 introuvables dans FINANZAS.PUBLIC.FACTURAS" in error.value.message
    assert error.value.message.endswith(": avoirs ; les rattacher au concept « commande » "
                                        "par un binding.")
    assert not db.exists()  # rien n'a été enregistré ni exécuté


def test_unread_columns_may_be_missing_but_bound_ones_may_not(space, db):
    edit_es_source(space, lambda s: drop_column(s, "factura_id"))
    with pytest.raises(RepoError) as error:  # commande_id : rattachée au concept
        compare(space, db, "nordis-es")
    assert error.value.message.endswith(": commande_id ; les rattacher au concept "
                                        "« commande » par un binding.")


def test_type_mismatch_is_named_and_integers_widen(space, db, tmp_path):
    def retype(kind):
        def change(source):
            for column in source["columns"]:
                if column["name"] == "iva":
                    column["type"] = kind
        return change
    edit_es_source(space, retype("string"))
    with pytest.raises(RepoError) as error:
        compare(space, db, "nordis-es")
    assert "montant_taxes (decimal attendu, string dans iva)" in error.value.message
    # Un entier se lit sans perte là où le canonique attend un décimal.
    edit_es_source(space, retype("integer"))
    data = tmp_path / "donnees"
    shutil.copytree(DATA / "nordis-es", data / "nordis-es")
    path = data / "nordis-es" / "FINANZAS.PUBLIC.FACTURAS.csv"
    lines = path.read_text(encoding="utf-8").splitlines()
    header = lines[0].split(",")
    column = header.index("iva")
    rows = [line.split(",") for line in lines[1:]]
    for row in rows:
        row[column] = row[column].removesuffix(".00")
    path.write_text("\n".join([lines[0], *(",".join(r) for r in rows)]) + "\n",
                    encoding="utf-8")
    _, found = compare(space, db, "nordis-es", runner=LocalRunner(data))
    assert found["results"][0]["validation_pct"] == 75


def test_a_variant_sharing_no_concept_is_refused(space, db):
    def detach(data):
        data["graph"]["nodes"][0]["concept"] = "client-actif"
        data["graph"]["nodes"][0]["binding"] = {"sociedad": "entite"}
        data["concepts"] = ["client-actif"]
    edit_yaml(space / ES_FILE, detach)
    with pytest.raises(RepoError) as error:
        compare(space, db, "nordis-es")
    assert error.value.code == "canonical_not_rebindable"
    assert "aucune de ses sources n'est rattachée à un concept" in error.value.message


def test_from_scratch_variant_rebinds_by_concept_binding(space, db, tmp_path):
    """La source suisse nomme `societe` l'attribut `entite` : le canonique la lit par le
    rattachement au concept, et la granularité `entite` la retrouve."""
    kpi = yaml.safe_load((space / "kpis" / "revenu-net.yaml").read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in kpi["graph"]["nodes"]}
    invoices = dict(nodes["n01"], table="ch.finance.factures", owner="lena.s",
                    columns=[c if c["name"] != "entite" else dict(c, name="societe")
                             for c in nodes["n01"]["columns"]],
                    binding={"commande_id": "commande_id", "societe": "entite"})
    graph = {"nodes": [invoices, nodes["n02"], nodes["n03"], nodes["n06"], nodes["n07"],
                       nodes["n04"],
                       dict(nodes["n05"], group_by=["mois_fiscal", "societe"])],
             "output": "n05"}
    variant = {"schema_version": 1, "kind": "variant",
               "data_product": {"id": "revenu-net--nordis-ch", "version": 1,
                                "owner": "lena.s"},
               "variant_of": {"id": "revenu-net", "version": 4}, "entity": "nordis-ch",
               "mode": "from_scratch", "justification": "Facturation suisse propre.",
               "graph": graph, "concepts": ["commande"]}
    (space / "variants" / "revenu-net" / "nordis-ch.yaml").write_text(
        yaml.safe_dump(variant, allow_unicode=True, sort_keys=False), encoding="utf-8")
    data = tmp_path / "donnees"
    (data / "nordis-ch").mkdir(parents=True)
    shutil.copy(DATA / "nordis-de" / "gold.finance.dim_date.csv", data / "nordis-ch")
    facts = (DATA / "nordis-de" / "gold.finance.fact_facturation.csv").read_text(
        encoding="utf-8").replace(",entite,", ",societe,", 1)
    (data / "nordis-ch" / "ch.finance.factures.csv").write_text(facts, encoding="utf-8")
    prepared, found = compare(space, db, "nordis-ch", runner=LocalRunner(data))
    plan = prepared.plans[0]
    assert "societe AS entite" in plan.canonical.compiled.sql
    assert plan.canonical.compiled.sources[0].columns[2] == ("societe", "string")
    assert (plan.canonical.dims, plan.variant.dims) == (["mois_fiscal", "entite"],
                                                        ["mois_fiscal", "societe"])
    result = found["results"][0]
    assert (result["cell_count"], result["validation_pct"]) == (16, 100)
    assert result["cells"][0]["dims"] == {"mois_fiscal": "2026-02-01", "entite": "AT"}


# --- échecs, annulation ---------------------------------------------------------------------

@pytest.mark.parametrize(("extra", "code"), [
    ({"scope_id": "inconnu"}, "unknown_scope"),
    ({"scope_id": None}, "scope_required"),
    ({"scope_id": None, "scope": {"period": {"from": "2026-02-01"}}}, "invalid_scope"),
])
def test_invalid_requests(db, extra, code):
    with pytest.raises(RepoError) as error:
        compare(EXAMPLE, db, **extra)
    assert error.value.code == code


def test_unknown_variant(db):
    with pytest.raises(RepoError) as error:
        compare(EXAMPLE, db, "nordis-it")
    assert error.value.code == "not_found"


def test_too_many_rows_fail_the_variant_only(db):
    _, found = compare(EXAMPLE, db, "nordis-de", "nordis-fr", runner=LocalRunner(DATA, 10))
    assert found["status"] == "partial" and found["error"].startswith("result_too_large")
    assert [r["entity"] for r in found["results"]] == ["nordis-fr"]
    statuses = {(r["variant_id"], r["side"]): r["status"] for r in found["runs"]}
    assert statuses[("revenu-net--nordis-de", "canonical")] == "failed"
    assert statuses[("revenu-net--nordis-de", "variant")] == "skipped"


def test_cancel_leaves_cancelled_and_nothing_extracted(db):
    """Critère 10."""
    started = threading.Event()

    def blocking(plan, compiled, cancel):
        started.set()
        cancel.wait(5)
        raise RepoError("query_canceled", "Requête annulée.")

    prepared = prepare_in(EXAMPLE, request("nordis-de", "nordis-fr"), None, True)
    job = orchestrate.start(db, None, prepared, blocking)
    assert started.wait(5)
    assert orchestrate.job(db, job.number).snapshot()[0]["state"] == "running"
    job.cancel.set()
    deadline = threading.Event()
    for _ in range(250):
        if orchestrate.job(db, job.number) is None:
            break
        deadline.wait(0.02)
    found = store.get(db, job.number)
    assert found["status"] == "cancelled" and found["results"] == []
    assert {r["status"] for r in found["runs"]} == {"cancelled", "skipped"}
    with duckdb.connect(str(db)) as connection:
        assert connection.execute("SELECT count(*) FROM results.cells").fetchone()[0] == 0


def test_local_runner_interrupts_duckdb(db):
    prepared = prepare_in(EXAMPLE, request(), None, True)
    plan = prepared.plans[0]
    slow = plan.canonical.compiled
    slow = type(slow)(slow.dialect, "SELECT count(*) FROM range(10000000000)", [], [],
                      slow.sources)
    cancel = threading.Event()
    threading.Timer(0.2, cancel.set).start()
    with pytest.raises(RepoError) as error:
        LocalRunner(DATA)(plan, slow, cancel)
    assert error.value.code == "query_canceled"


def test_remote_runner_goes_through_the_access_point(monkeypatch):
    from skifer_atlas import connections
    from skifer_atlas.compare import service

    seen = []

    def fake(ws, ap, sql, cancel=None):
        seen.append((ws, ap))
        return QueryResult(["x"], ["int"], [(1,)])
    monkeypatch.setattr(connections, "run_aggregate", fake)
    plan = type("Plan", (), {"access_point": "dbx-de"})()
    compiled = type("Compiled", (), {"sql": "SELECT 1"})()
    assert service.remote_runner("nordis")(plan, compiled, threading.Event()).rows == [(1,)]
    assert seen == [("nordis", "dbx-de")]


# --- CLI ------------------------------------------------------------------------------------

def test_cli_compare(capsys, db):
    code = main(["compare", str(EXAMPLE), "revenu-net", "--variants", "nordis-de,nordis-fr",
                 "--scope", SCOPE, "--duckdb-data", str(DATA), "--db", str(db)])
    out = capsys.readouterr().out
    assert code == 2
    assert "nordis-de (databricks) : 93,8 % de validation sur 16 cellule(s)" in out
    assert "nœud divergent : n02" in out
    assert "mois_fiscal=2026-09-01, entite=DE" in out
    assert "nordis-fr (databricks) : 100,0 %" in out
    code = main(["compare", str(EXAMPLE), "revenu-net", "--variants", "nordis-fr",
                 "--period", "2026-02-01..2026-09-30", "--by", "mois_fiscal,entite",
                 "--duckdb-data", str(DATA), "--format", "json"])
    found = json.loads(capsys.readouterr().out)
    assert code == 0 and found["results"][0]["validation_pct"] == 100
    assert found["scope"]["period"] == {"from": "2026-02-01", "to": "2026-09-30"}


def test_cli_compare_errors(capsys, space):
    edit_es_source(space, lambda s: drop_column(s, "abonos"))
    assert main(["compare", str(space), "revenu-net", "--variants", "nordis-es",
                 "--scope", "fy2026-t4", "--duckdb-data", str(DATA)]) == 1
    assert "canonical_not_rebindable" in capsys.readouterr().err
    assert main(["compare", "espace-inconnu", "revenu-net", "--variants", "nordis-de",
                 "--scope", SCOPE]) == 1


def test_concurrent_reads_of_the_history(tmp_path):
    """L'index existe (catalogue) sans le schéma `results` : les premières lectures
    simultanées le créent chacune. Sans verrou, DuckDB répondait « Catalog write-write
    conflict » (500 à l'ouverture de l'écran Comparaison)."""
    errors: list[Exception] = []
    for attempt in range(10):
        db = tmp_path / f"index-{attempt}.duckdb"
        duckdb.connect(str(db)).close()  # l'index du catalogue, sans comparaison
        start = threading.Barrier(8)

        def read(db=db, start=start):
            try:
                start.wait()
                store.history(db)
            except Exception as error:  # noqa: BLE001 — remonté par l'assertion
                errors.append(error)

        threads = [threading.Thread(target=read) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    assert errors == []
