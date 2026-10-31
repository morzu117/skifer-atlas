"""Fiche d'un KPI ou d'un concept (plan 0012) : en-tête et onglets, disposition du
graphe, diff entre deux versions, implémentations et copie pour une nouvelle version.

La fiche part de l'aperçu du catalogue (plan 0011) et y ajoute ce que le YAML et le
dépôt seuls savent : sémantique, scopes, justification des déclinaisons, date des tags,
fichiers `implementations/<kpi>/<entité>/<plateforme>.sql`.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import duckdb

from . import extract
from .diff import DiffContext, diff
from .governance.rules import requirement
from .index.build import Analysis, analyze
from .index.search import dependencies
from .index.summary import summary
from .model.check import check_document
from .model.io import dump_data, read_yaml, validate_text
from .model.layout import layout
from .model.resolve import ResolvedGraph, resolve
from .repo import versions as repo_versions
from .repo.git import RepoError
from .repo.layout import read_governance

IMPLEMENTATIONS = "implementations"
SEMANTICS = ("calendar", "timezone", "currency")


def _mapping(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _raw(repo: Path, path: str) -> dict:
    try:
        raw, issues = read_yaml((repo / path).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        return {}
    return _mapping(raw) if not issues else {}


def _semantics(raw: dict) -> list[dict]:
    """Attributs déclarés, avec `variation` quand `semantics.<attribut>` est un point de
    variation. L'arrondi n'est pas un attribut : Atlas arrondit à la restitution."""
    declared = _mapping(raw.get("semantics"))
    points = raw.get("variation_points") if isinstance(raw.get("variation_points"), list) else []
    found = []
    for key in SEMANTICS:
        value = declared.get(key)
        if isinstance(value, dict):  # calendrier : {key, version}
            value = " ".join(str(v) for v in (value.get("key"), value.get("version")) if v)
        if value is not None:
            found.append({"key": key, "value": str(value), "variation": f"semantics.{key}" in points})
    return found


def implementations(repo: Path, kpi_id: str) -> list[dict]:
    """Fichiers SQL rangés sous `implementations/<kpi>/`, par entité puis plateforme."""
    root = repo / IMPLEMENTATIONS / kpi_id
    found = []
    for path in sorted(root.glob("*/*.sql")) if root.is_dir() else []:
        try:
            sql = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        found.append({"entity": path.parent.name, "platform": path.stem,
                      "path": path.relative_to(repo).as_posix(), "sql": sql,
                      "extractable": path.stem in extract.DIALECTS})
    return found


def sheet(connection: duckdb.DuckDBPyConnection, repo: Path, document_id: str) -> dict | None:
    base = summary(connection, repo, document_id)
    if base is None:
        return None
    [(path,)] = connection.execute(
        'SELECT path FROM "index".documents WHERE id = ?', [document_id]).fetchall()
    raw = _raw(repo, path)
    governance = read_governance(repo)
    domains = {d.id: d.label for d in governance.domains} if governance else {}
    tagged = repo_versions.versions(repo, document_id)
    current = next((v for v in tagged if v.version == base["version"]), None)
    kpi = base["kind"] == "kpi"

    variants = []
    for row in connection.execute("""
        SELECT v.id, v.entity, v.mode, v.override_count, v.undeclared_count, d.version, d.path
        FROM "index".variants v JOIN "index".documents d ON d.id = v.id
        WHERE v.kpi_id = ? ORDER BY v.entity
    """, [document_id]).fetchall() if kpi else []:
        variant_id, entity, mode, overrides, undeclared, version, variant_path = row
        justification = _raw(repo, variant_path).get("justification")
        variants.append({
            "id": variant_id, "entity": entity, "mode": mode, "version": version,
            "override_count": overrides, "undeclared_count": undeclared,
            "justification": justification if isinstance(justification, str) else None,
        })

    found = dependencies(connection, document_id)
    for side in ("references", "referenced_by"):
        for item in found[side]:
            item["domain_label"] = domains.get(item["domain"])
    found["referenced_by"] = [r for r in found["referenced_by"] if r["id"] != document_id]

    tolerance = raw.get("tolerance")
    return {
        **base,
        "validated_at": current.date if current else None,
        "validators_required": requirement(governance, "new_version", base["domain"]).required
        if governance and base["kind"] != "variant" else None,
        "version_count": len(tagged),
        "has_graph": isinstance(_mapping(raw.get("graph")).get("nodes"), list),
        "semantics": _semantics(raw) if kpi else [],
        "entity": _mapping(raw.get("entity")) or None,
        "variants": variants,
        "dependencies": found,
        "implementations": implementations(repo, document_id) if kpi else [],
        "scopes": [s for s in raw.get("scopes") or [] if isinstance(s, dict)] if kpi else [],
        "tolerance": _mapping(tolerance) or None,
        "workspace_tolerance": {"percent": governance.tolerance_percent} if governance else None,
    }


# --- graphes -----------------------------------------------------------------------------

def resolved_graph(document: Any, analysis: Analysis, label: str) -> ResolvedGraph:
    """Le document prêt à disposer ou à comparer : une variante est résolue sur son
    canonique ; un document sans graphe ou en erreur est refusé."""
    if document is None:
        raise RepoError("invalid_document", f"{label} n'est pas un document valide.")
    if document.kind == "variant":
        canonical = analysis.library.kpi(document.variant_of.id, document.variant_of.version)
        if canonical is None:
            raise RepoError("invalid_document", f"Le canonique de {label} est introuvable.")
        resolved = resolve(document, canonical, analysis.library)
    elif document.graph is None:
        raise RepoError("invalid_document", f"{label} n'a pas de graphe.")
    else:
        resolved = ResolvedGraph(document, issues=check_document(document, analysis.library))
    if not resolved.valid:
        raise RepoError("invalid_document", f"{label} est à corriger d'abord (atlas check).",
                        [i.to_dict() for i in resolved.issues if i.severity == "error"])
    return resolved


def _at(repo: Path, analysis: Analysis, document_id: str, version: int | None) -> ResolvedGraph:
    entry = analysis.entry(document_id)
    if entry is None:
        raise RepoError("not_found", f"Document « {document_id} » introuvable.")
    if version is None:
        return resolved_graph(entry.document, analysis, f"« {document_id} »")
    if version not in {v.version for v in repo_versions.versions(repo, document_id)}:
        raise RepoError("not_found", f"Version {version} de « {document_id} » introuvable.")
    text = repo_versions.document_at(repo, document_id, version, entry.file.path)
    label = f"La version {version} de « {document_id} »"
    return resolved_graph(validate_text(text).document, analysis, label)


def labelled_layout(resolved: ResolvedGraph, label: str) -> dict:
    """Disposition d'un graphe résolu, son titre de colonne et, pour une variante, les
    nœuds qu'elle surcharge."""
    overrides = [o.node for o in resolved.overrides] if resolved.variant is not None else []
    return {"label": label, **layout(resolved.document), "overrides": overrides}


def canonical_diff(repo: Path, variant_id: str) -> dict:
    """Une déclinaison face à son canonique (0015, « Nœud divergent ») : les deux graphes
    disposés et le rapport de diff (plan 0003), dans la relation de la déclinaison."""
    analysis = analyze(repo)
    entry = analysis.entry(variant_id)
    if entry is None:
        raise RepoError("not_found", f"Document « {variant_id} » introuvable.")
    document = entry.document
    if document is None or document.kind != "variant":
        raise RepoError("not_a_variant", f"« {variant_id} » n'est pas une déclinaison.")
    resolved = resolved_graph(document, analysis, f"« {variant_id} »")
    canonical = ResolvedGraph(analysis.library.kpi(document.variant_of.id,
                                                   document.variant_of.version))
    report = diff(canonical, resolved, DiffContext(document.mode, analysis.library))
    return {
        "base": labelled_layout(canonical, f"Canonique v{document.variant_of.version}"),
        "other": labelled_layout(resolved, f"Déclinaison {document.entity} "
                                           f"v{document.data_product.version}"),
        "report": report.model_dump(mode="json"),
    }


def graph_layout(repo: Path, document_id: str, version: int | None = None) -> dict:
    """Disposition du graphe courant, ou de celui d'une version taguée ; pour une
    variante, du graphe résolu."""
    resolved = _at(repo, analyze(repo), document_id, version)
    document = resolved.document
    if resolved.variant is not None:  # les points de variation sont ceux du canonique
        return {**layout(document), "overrides": [o.node for o in resolved.overrides]}
    return {**layout(document), "overrides": []}


def version_diff(repo: Path, document_id: str, base: int, other: int) -> dict:
    """Rapport de diff (plan 0003) entre deux versions taguées d'un même document."""
    analysis = analyze(repo)
    before = _at(repo, analysis, document_id, base)
    after = _at(repo, analysis, document_id, other)
    report = diff(before, after, DiffContext("version", analysis.library))
    return report.model_dump(mode="json")


def extract_implementation(repo: Path, kpi_id: str, entity: str, platform: str) -> dict:
    """Plan 0004 puis 0003 : brouillon de chaque requête du fichier, et son diff au
    graphe canonique courant (relation libre : rien ne relie encore le brouillon au KPI)."""
    path = repo / IMPLEMENTATIONS / kpi_id / entity / f"{platform}.sql"
    if platform not in extract.DIALECTS or not path.is_file():
        raise RepoError("not_found", f"Implémentation {entity}/{platform} de « {kpi_id} » "
                                     "introuvable.")
    analysis = analyze(repo)
    canonical = _at(repo, analysis, kpi_id, None)
    result = extract.extract_file(path, platform, path.relative_to(repo).as_posix())
    statements = []
    for extraction in result.extractions:
        draft = extraction.draft
        document = validate_text(draft.text()).document
        try:
            other = resolved_graph(document, analysis, "Le brouillon")
        except RepoError:
            report = None
        else:
            report = diff(canonical, other, DiffContext("free", analysis.library))
        statements.append({**extraction.to_dict(), "draft": draft.text(),
                           "diff": report.model_dump(mode="json") if report else None})
    found = result.to_dict()
    return {"file": found["file"], "residues": found["residues"], "statements": statements}


# --- nouvelle version --------------------------------------------------------------------

_BLOCK = re.compile(r"^data_product:[ \t]*\n((?:[ \t]+.*\n|[ \t]*\n)*)", re.MULTILINE)
_VERSION = re.compile(r"^([ \t]+version:[ \t]*)([0-9]+)([ \t]*(?:#.*)?)$", re.MULTILINE)


def next_version(text: str) -> tuple[str, int, int]:
    """Copie du YAML avec `data_product.version` incrémentée : (texte, avant, après).

    La ligne est réécrite en place, pour que le diff de la future proposition ne porte
    que sur ce qui change ; un `data_product` en style compact est réécrit en entier."""
    raw, issues = read_yaml(text)
    product = _mapping(_mapping(raw).get("data_product")) if not issues else {}
    version = product.get("version")
    if not isinstance(version, int) or isinstance(version, bool):
        raise RepoError("invalid_document", "Le document n'a pas de `data_product.version`.")
    block = _BLOCK.search(text)
    line = _VERSION.search(block.group(1)) if block else None
    if block and line and int(line.group(2)) == version:
        start = block.start(1) + line.start(2)
        return text[:start] + str(version + 1) + text[block.start(1) + line.end(2):], \
            version, version + 1
    raw["data_product"]["version"] = version + 1
    return dump_data(raw), version, version + 1
