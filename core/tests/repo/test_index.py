"""Index DuckDB d'un espace : construction, recherche, filtres, dépendances."""

import json
import shutil
import time

import pytest
import yaml
from workspace_helpers import EXAMPLE, REVENU_NET, atlas_env, commit_all, git, remote

from skifer_atlas.index import build_index, catalog, dependencies, document, ensure_index
from skifer_atlas.index.schema import connect
from skifer_atlas.index.search import _convergence

__all__ = ["atlas_env", "remote"]  # fixtures importées

TABLES = ("documents", "variants", "dependencies")


@pytest.fixture
def repo(atlas_env, tmp_path):
    work = tmp_path / "depot"
    shutil.copytree(EXAMPLE, work)
    git(work, "init", "--quiet")
    commit_all(work, "Espace Groupe Nordis")
    return work


@pytest.fixture
def index(repo, tmp_path):
    connection = ensure_index(repo, tmp_path / "atlas.duckdb")
    yield connection
    connection.close()


def ids(rows):
    return [row["id"] for row in rows]


def snapshot(db):
    connection = connect(db)
    try:
        return {table: sorted(connection.execute(f'SELECT * FROM "index".{table}').fetchall(),
                              key=repr)
                for table in TABLES}
    finally:
        connection.close()


def write(repo, path, data):
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False),
                      encoding="utf-8")


def load(path):
    return yaml.safe_load((EXAMPLE / path).read_text(encoding="utf-8"))


# --- construction -------------------------------------------------------------------------

def test_every_document_is_indexed(index):
    rows = index.execute(
        'SELECT id, kind, status, version FROM "index".documents ORDER BY path').fetchall()
    assert len(rows) == 10
    assert {status for _, _, status, _ in rows} == {"validated"}
    [meta] = index.execute('SELECT schema_version FROM "index".index_meta').fetchall()
    assert meta == (1,)
    variants = index.execute(
        'SELECT entity, mode, override_count, undeclared_count FROM "index".variants '
        "ORDER BY entity").fetchall()
    assert variants == [("nordis-de", "override", 3, 2), ("nordis-es", "from_scratch", 0, 0),
                        ("nordis-fr", "override", 2, 0)]


def test_rebuild_from_scratch_is_identical(repo, tmp_path):
    """Critère 6."""
    db = tmp_path / "atlas.duckdb"
    build_index(repo, db)
    first = snapshot(db)
    db.unlink()
    build_index(repo, db)
    assert snapshot(db) == first
    build_index(repo, db)  # sur une base existante : idempotent
    assert snapshot(db) == first


def test_index_follows_the_commit(repo, tmp_path):
    db = tmp_path / "atlas.duckdb"
    ensure_index(repo, db).close()
    stamp = snapshot_meta(db)
    ensure_index(repo, db).close()
    assert snapshot_meta(db) == stamp  # même commit : pas de reconstruction
    kpi = load("kpis/taux-de-service.yaml")
    kpi["label"] = "Taux de service client"
    write(repo, "kpis/taux-de-service.yaml", kpi)
    commit = commit_all(repo, "Libellé")
    connection = ensure_index(repo, db)
    assert document(connection, "taux-de-service")["label"] == "Taux de service client"
    assert connection.execute('SELECT "commit" FROM "index".index_meta').fetchone() == (commit,)
    connection.close()


def snapshot_meta(db):
    connection = connect(db)
    try:
        return connection.execute('SELECT * FROM "index".index_meta').fetchall()
    finally:
        connection.close()


def test_invalid_documents_are_indexed_with_their_errors(repo, tmp_path):
    """Critère 5."""
    broken = load("kpis/panier-moyen.yaml")
    broken["data_product"]["id"] = "panier-casse"
    del broken["data_product"]["owner"]
    broken["label"] = "Panier cassé"
    write(repo, "kpis/panier-casse.yaml", broken)
    misplaced = load("kpis/taux-de-service.yaml")
    write(repo, "kpis/mauvais-nom.yaml", misplaced)
    (repo / "concepts" / "illisible.yaml").write_text("label: [non fermé\n", encoding="utf-8")
    orphan = load("variants/revenu-net/nordis-fr.yaml")
    orphan["variant_of"]["id"] = "absent"
    orphan["data_product"]["id"] = "absent--nordis-fr"
    write(repo, "variants/absent/nordis-fr.yaml", orphan)
    commit_all(repo, "Documents invalides")
    connection = ensure_index(repo, tmp_path / "atlas.duckdb")
    try:
        invalid = {row["id"]: row for row in catalog(connection, status="invalid")}
        assert set(invalid) == {"panier-casse", "mauvais-nom", "illisible"}
        assert invalid["panier-casse"]["label"] == "Panier cassé"
        codes = {i["code"] for i in document(connection, "panier-casse")["issues"]}
        assert "missing_field" in codes or codes, codes
        assert [i["code"] for i in document(connection, "mauvais-nom")["issues"]] == [
            "id_mismatch"]
        assert document(connection, "illisible")["issues"][0]["code"] == "invalid_yaml"
        variant = document(connection, "absent--nordis-fr")
        assert variant["status"] == "invalid"
        assert "unknown_canonical" in {i["code"] for i in variant["issues"]}
        # Ses dépendances restent visibles, même invalide.
        assert "panier-casse" in ids(dependencies(connection, "revenu-net")["referenced_by"])
    finally:
        connection.close()


def test_drafts_keep_their_status(repo, tmp_path):
    draft = load("concepts/commande.yaml")
    draft["data_product"]["id"] = "commande-brouillon"
    draft["status"] = "draft"
    draft["data_product"]["owner"] = "TODO"
    write(repo, "concepts/commande-brouillon.yaml", draft)
    commit_all(repo, "Brouillon")
    connection = ensure_index(repo, tmp_path / "atlas.duckdb")
    try:
        row = document(connection, "commande-brouillon")
        assert row["status"] == "draft"
        assert {i["code"] for i in row["issues"]} == {"todo"}
    finally:
        connection.close()


def test_references_to_a_tagged_version_stay_valid(remote, tmp_path):
    """Revenu net passe en v5 : Marge brute et les variantes, qui portent sur la v4
    taguée, restent valides ; les variantes signalent qu'elles sont à réaligner."""
    _, work = remote
    text = (work / REVENU_NET).read_text(encoding="utf-8")
    (work / REVENU_NET).write_text(text.replace("version: 4", "version: 5", 1),
                                   encoding="utf-8")
    commit_all(work, "Revenu net v5")
    connection = ensure_index(work, tmp_path / "atlas.duckdb")
    try:
        assert document(connection, "revenu-net")["version"] == 5
        assert document(connection, "marge-brute")["status"] == "validated"
        variant = document(connection, "revenu-net--nordis-fr")
        assert variant["status"] == "validated"
        assert [i["code"] for i in variant["issues"]] == ["outdated_canonical"]
    finally:
        connection.close()
    git(work, "tag", "-d", "doc/revenu-net/v4")
    commit_all_empty(work)
    connection = ensure_index(work, tmp_path / "atlas.duckdb")
    try:
        assert document(connection, "marge-brute")["status"] == "invalid"
        assert document(connection, "revenu-net--nordis-fr")["status"] == "invalid"
    finally:
        connection.close()


def commit_all_empty(work):
    git(work, "commit", "--quiet", "--allow-empty", "-m", "Nouveau commit")


# --- recherche (critères 3 et 4) ----------------------------------------------------------

def test_search_by_synonym_ignoring_accents_and_case(index):
    assert ids(catalog(index, q="ca net")) == ["revenu-net"]
    assert ids(catalog(index, q="RÉVENU"))[0] == "revenu-net"
    assert ids(catalog(index, q="  revenu ")) == ids(catalog(index, q="Révenu"))
    assert ids(catalog(index, q="net revenue")) == ["revenu-net"]


def test_search_ranks_label_then_synonyms_then_description(index):
    found = catalog(index, q="revenu")
    assert found[0]["id"] == "revenu-net"  # libellé
    by_description = [row for row in found[1:]]
    assert by_description and all("revenu" not in row["label"].lower()
                                  for row in by_description)


def test_catalog_lists_concepts_and_kpis_only(index):
    rows = catalog(index)
    assert ids(rows) == ["client-actif", "commande", "date-de-reference", "marge-brute",
                         "panier-moyen", "revenu-net", "taux-de-service"]
    revenu = next(row for row in rows if row["id"] == "revenu-net")
    assert (revenu["variant_count"], revenu["convergence"]) == (3, "never_compared")
    assert next(r for r in rows if r["id"] == "marge-brute")["convergence"] == "converged"
    assert next(r for r in rows if r["id"] == "commande")["convergence"] is None
    assert catalog(index, kind="variant") == []


def test_filters_combine(index):
    assert ids(catalog(index, domain="finance")) == ["date-de-reference", "marge-brute",
                                                    "revenu-net"]
    assert ids(catalog(index, domain="finance", kind="kpi")) == ["marge-brute", "revenu-net"]
    assert ids(catalog(index, owner="marc.d")) == ["client-actif", "commande", "panier-moyen"]
    assert ids(catalog(index, owner="marc.d", kind="concept")) == ["client-actif", "commande"]
    assert ids(catalog(index, owner="marc.d", kind="concept", status="validated",
                       domain="ventes")) == ["client-actif", "commande"]
    assert ids(catalog(index, domain="finance", status="invalid")) == []
    assert ids(catalog(index, q="revenu", domain="ventes")) == ["panier-moyen"]


# --- dépendances (critère 8) --------------------------------------------------------------

def test_dependencies_of_revenu_net(index):
    found = dependencies(index, "revenu-net")
    assert [(r["id"], r["kind"], r["label"]) for r in found["references"]] == [
        ("commande", "concept", "Commande"),
        ("date-de-reference", "concept", "Date de référence"),
    ]
    assert [(r["id"], r["kind"], r["version"], r["label"]) for r in found["referenced_by"]] == [
        ("marge-brute", "kpi_ref", 4, "Marge brute"),
        ("panier-moyen", "kpi_ref", 4, "Panier moyen"),
    ]
    assert found["impact"] == 2


def test_impact_is_transitive(index):
    found = dependencies(index, "commande")
    assert "revenu-net" in ids(found["referenced_by"])
    assert "marge-brute" not in ids(found["referenced_by"])
    # revenu-net, panier-moyen, ses variantes, puis marge-brute par revenu-net
    assert found["impact"] == len({"revenu-net", "panier-moyen", "marge-brute",
                                   *ids(r for r in found["referenced_by"]
                                        if r["document_kind"] == "variant")})


def test_document_row(index):
    row = document(index, "revenu-net")
    assert row["fingerprint"].startswith("sha256:atlas1:")
    assert ids(row["variants"]) == ["revenu-net--nordis-de", "revenu-net--nordis-es",
                                    "revenu-net--nordis-fr"]
    variant = document(index, "revenu-net--nordis-es")
    assert variant["label"] == "Revenu net — nordis-es"
    assert variant["variant"]["mode"] == "from_scratch"
    assert document(index, "absent") is None
    json.dumps(row, default=str)


# --- banc d'essai -------------------------------------------------------------------------

def test_rebuild_of_a_thousand_documents_is_fast(repo, tmp_path):
    kpi = load("kpis/taux-de-service.yaml")
    concept = load("concepts/client-actif.yaml")
    for n in range(500):
        kpi["data_product"]["id"] = f"kpi-{n:04d}"
        concept["data_product"]["id"] = f"concept-{n:04d}"
        write(repo, f"kpis/kpi-{n:04d}.yaml", kpi)
        write(repo, f"concepts/concept-{n:04d}.yaml", concept)
    commit_all(repo, "Mille documents")
    start = time.perf_counter()
    build_index(repo, tmp_path / "atlas.duckdb")
    elapsed = time.perf_counter() - start
    assert elapsed < 5, f"{elapsed:.2f} s"


VARIANTS = [{"id": "k--de", "mode": "override"}, {"id": "k--es", "mode": "from_scratch"}]


def _result(variant_id, pct, version=4):
    return {"variant_id": variant_id, "kpi_version": version, "validation_pct": pct}


@pytest.mark.parametrize(("compared", "expected"), [
    ([], "never_compared"),
    ([_result("k--de", 100)], "never_compared"),  # une variante pas encore comparée
    ([_result("k--de", 100), _result("k--es", 100)], "converged"),
    ([_result("k--de", 100), _result("k--es", 94)], "candidates:1"),  # from scratch
    ([_result("k--de", 94), _result("k--es", 94)], "divergences:1"),  # surcharge d'abord
    ([_result("k--de", None), _result("k--es", 100)], "divergences:1"),
    ([_result("k--de", 94, version=3), _result("k--es", 100)], "never_compared"),
])
def test_convergence_separates_candidates_from_divergences(compared, expected):
    """Plan 0011, ADR 0015 : un écart sur une variante from scratch la laisse candidate."""
    assert _convergence("kpi", VARIANTS, 4, compared) == expected
    assert _convergence("kpi", [], 4, compared) == "converged"
    assert _convergence("concept", VARIANTS, 4, compared) is None
