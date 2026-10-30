"""Construction de l'index d'un espace depuis son clone (plan 0005).

Deux passes : chaque fichier est d'abord lu et validé seul ; les KPI valides forment la
`Library` qui résout les `kpi_ref` et les canoniques des variantes ; la seconde passe
contrôle les graphes, résout les variantes et calcule les empreintes.

Un document invalide est indexé avec `status: invalid` et ses diagnostics, jamais
ignoré. Les dépendances se lisent dans le YAML brut : celles d'un document invalide
restent visibles dans le graphe de dépendances.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb

from ..model.check import check_document
from ..model.document import KpiDocument, validate_data
from ..model.errors import Issue
from ..model.fingerprint import fingerprint
from ..model.graph import Library
from ..model.io import read_yaml, validate_text
from ..model.resolve import resolve
from ..repo.git import RepoError, head
from ..repo.layout import DocumentFile, document_files, document_path
from ..repo.versions import document_at
from .schema import DDL, SCHEMA_VERSION, connect, index_state

# Erreurs propres aux brouillons (ADR 0006) : le document garde son statut de brouillon.
DRAFT_CODES = frozenset({"needs_curation", "blocking_residue"})

_locks: dict[Path, threading.Lock] = {}
_locks_guard = threading.Lock()


@dataclass
class Entry:
    file: DocumentFile
    raw: Any
    document: Any
    issues: list[Issue] = field(default_factory=list)
    fingerprint: str | None = None
    override_count: int = 0
    undeclared_count: int = 0


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _mapping(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _read(root: Path, file: DocumentFile) -> Entry:
    try:
        text = (root / file.path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        return Entry(file, {}, None, [Issue("", None, "unreadable_file",
                                             f"Lecture impossible : {error}")])
    raw, issues = read_yaml(text)
    if issues:
        return Entry(file, {}, None, issues)
    result = validate_data(raw)
    issues = list(result.issues)
    raw = _mapping(raw)
    kind = raw.get("kind")
    if kind is not None and kind != file.kind:
        issues.append(Issue("/kind", None, "wrong_folder",
                            f"Un document « {kind} » n'a pas sa place dans ce dossier."))
    declared = _mapping(raw.get("data_product")).get("id")
    if declared is not None and declared != file.expected_id:
        issues.append(Issue("/data_product/id", None, "id_mismatch",
                            f"L'identifiant « {declared} » ne correspond pas au fichier : "
                            f"« {file.expected_id} » attendu."))
    if file.kind == "variant":
        kpi_id, entity = file.expected_id.split("--", 1)
        target = _mapping(raw.get("variant_of")).get("id")
        if target not in (None, kpi_id) or raw.get("entity") not in (None, entity):
            issues.append(Issue("/variant_of", None, "wrong_folder",
                                f"Une variante rangée ici porte sur « {kpi_id} », entité "
                                f"« {entity} »."))
    document = result.document if not _has_errors(issues) else None
    return Entry(file, raw, document, issues)


def _has_errors(issues: list[Issue]) -> bool:
    return any(issue.severity == "error" for issue in issues)


def _tagged_kpi(repo: Path, kpi_id: str, version: int) -> KpiDocument | None:
    """Le KPI tel qu'il était au tag de cette version, s'il existe et reste valide."""
    try:
        text = document_at(repo, kpi_id, version, document_path("kpi", kpi_id))
    except RepoError:
        return None
    document = validate_text(text).document
    return document if isinstance(document, KpiDocument) else None


def _library(repo: Path, entries: list[Entry]) -> Library:
    """KPI valides au commit courant, plus les versions taguées qu'un `kpi_ref` ou une
    variante désigne : un KPI qui passe en v5 n'invalide pas ce qui référence sa v4."""
    library = Library(e.document for e in entries if isinstance(e.document, KpiDocument))
    wanted = {(d[1], d[2]) for e in entries for d in _dependencies(e) if d[3] == "kpi_ref"}
    wanted |= {(e.document.variant_of.id, e.document.variant_of.version) for e in entries
               if e.file.kind == "variant" and e.document is not None}
    for kpi_id, version in sorted(wanted, key=lambda key: (key[0], key[1] or 0)):
        if version is not None and library.kpi(kpi_id, version) is None:
            tagged = _tagged_kpi(repo, kpi_id, version)
            if tagged is not None:
                library.add(tagged)
    return library


def _check(repo: Path, entries: list[Entry]) -> Library:
    library = _library(repo, entries)
    canonicals = {e.file.expected_id: e.document for e in entries if e.file.kind == "kpi"}
    for entry in entries:
        if entry.document is None:
            continue
        if entry.file.kind != "variant":
            entry.issues.extend(check_document(entry.document, library))
            if entry.document.graph is not None and not _has_errors(entry.issues):
                entry.fingerprint = fingerprint(entry.document)
            continue
        variant = entry.document
        entry.override_count = len(getattr(variant, "overrides", None) or [])
        target = (variant.variant_of.id, variant.variant_of.version)
        current = canonicals.get(target[0])
        canonical = library.kpi(*target) or current
        if canonical is None:
            entry.issues.append(Issue("/variant_of", None, "unknown_canonical",
                                      f"Le KPI « {target[0]} » est absent ou invalide : "
                                      "la variante ne peut pas être résolue."))
            continue
        if current is not None and current.data_product.version != target[1]:
            entry.issues.append(Issue(
                "/variant_of/version", None, "outdated_canonical",
                f"La variante porte sur {target[0]} v{target[1]} ; le canonique est en "
                f"v{current.data_product.version}.", "warning"))
        resolved = resolve(variant, canonical, library)
        entry.issues.extend(resolved.issues)
        entry.undeclared_count = sum(o.classification == "undeclared"
                                     for o in resolved.overrides)
        if resolved.valid:
            entry.fingerprint = fingerprint(resolved.document)
    return library


def _status(entry: Entry) -> str:
    if any(i.severity == "error" and i.code not in DRAFT_CODES for i in entry.issues):
        return "invalid"
    return _text(entry.raw.get("status")) or "validated"


def _dependencies(entry: Entry) -> list[tuple]:
    found = []
    graph = _mapping(entry.raw.get("graph"))
    for node in _list(graph.get("nodes")):
        node = _mapping(node)
        if node.get("type") == "kpi_ref" and _text(node.get("kpi")):
            found.append((entry.file.expected_id, node["kpi"], _int(node.get("version")),
                          "kpi_ref"))
        if node.get("type") == "source" and _text(node.get("concept")):
            found.append((entry.file.expected_id, node["concept"], None, "concept"))
    for concept in _list(entry.raw.get("concepts")):  # variante from_scratch
        if _text(concept):
            found.append((entry.file.expected_id, concept, None, "concept"))
    return sorted(set(found), key=lambda d: (d[1], d[3], d[2] or 0))


def _rows(entries: list[Entry]) -> tuple[list, list, list]:
    kpis = {e.file.expected_id: e.raw for e in entries if e.file.kind == "kpi"}
    documents, variants, dependencies = [], [], []
    for entry in entries:
        raw, file = entry.raw, entry.file
        product = _mapping(raw.get("data_product"))
        label = _text(raw.get("label"))
        domain = _text(product.get("domain"))
        description = _text(product.get("description"))
        if file.kind == "variant":
            kpi_id, entity = file.expected_id.split("--", 1)
            kpi = _mapping(kpis.get(kpi_id))
            label = f"{_text(kpi.get('label')) or kpi_id} — {entity}"
            domain = _text(_mapping(kpi.get("data_product")).get("domain"))
            description = description or _text(raw.get("justification"))
            variants.append((
                file.expected_id, kpi_id, _int(_mapping(raw.get("variant_of")).get("version")),
                entity, _text(raw.get("mode")) or "unknown", entry.override_count,
                entry.undeclared_count,
            ))
        synonyms = [s for s in _list(raw.get("synonyms")) if _text(s)]
        documents.append((
            file.expected_id, file.kind, label or file.expected_id, domain,
            _text(product.get("owner")), _int(product.get("version")), _status(entry),
            description, synonyms, entry.fingerprint, file.path,
            json.dumps([i.to_dict() for i in entry.issues], ensure_ascii=False),
        ))
        dependencies.extend(_dependencies(entry))
    return documents, variants, dependencies


@dataclass
class Analysis:
    entries: list[Entry]
    library: Library

    def entry(self, document_id: str) -> Entry | None:
        return next((e for e in self.entries if e.file.expected_id == document_id), None)


def analyze(root: Path, repo: Path | None = None) -> Analysis:
    """Lit et contrôle tous les documents d'un arbre. `repo` fournit les tags des
    versions antérieures quand `root` n'est qu'une extraction (proposition)."""
    entries = [_read(root, file) for file in document_files(root)]
    library = _check(repo or root, entries)
    return Analysis(entries, library)


def entry_status(entry: Entry) -> str:
    return _status(entry)


def build_index(repo: Path, db: Path) -> str:
    """Reconstruit entièrement le schéma `index` ; renvoie le commit indexé."""
    commit = head(repo)
    documents, variants, dependencies = _rows(analyze(repo).entries)
    connection = connect(db)
    try:
        connection.execute("BEGIN TRANSACTION")
        connection.execute('DROP SCHEMA IF EXISTS "index" CASCADE')
        connection.execute(DDL)
        if documents:
            connection.executemany(
                'INSERT INTO "index".documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                documents)
        if variants:
            connection.executemany('INSERT INTO "index".variants VALUES (?, ?, ?, ?, ?, ?, ?)',
                                   variants)
        if dependencies:
            connection.executemany('INSERT INTO "index".dependencies VALUES (?, ?, ?, ?)',
                                   dependencies)
        connection.execute('INSERT INTO "index".index_meta VALUES (?, ?, ?)',
                           [commit, datetime.now(UTC).replace(tzinfo=None), SCHEMA_VERSION])
        connection.execute("COMMIT")
    except BaseException:
        connection.execute("ROLLBACK")
        raise
    finally:
        connection.close()
    return commit


def ensure_index(repo: Path, db: Path) -> duckdb.DuckDBPyConnection:
    """Connexion à un index à jour : reconstruit s'il manque, s'il porte sur un autre
    commit ou sur une autre version de schéma."""
    with _locks_guard:
        lock = _locks.setdefault(db.resolve(), threading.Lock())
    with lock:
        commit = head(repo)
        connection = connect(db)
        state = index_state(connection)
        if state == (commit, SCHEMA_VERSION):
            return connection
        connection.close()
        build_index(repo, db)
        return connect(db)


def index_fresh(repo: Path, db: Path) -> bool:
    """Vrai si l'index porte sur le commit courant : la prochaine lecture ne le
    reconstruira pas."""
    if not db.exists():
        return False
    connection = connect(db)
    try:
        return index_state(connection) == (head(repo), SCHEMA_VERSION)
    finally:
        connection.close()
