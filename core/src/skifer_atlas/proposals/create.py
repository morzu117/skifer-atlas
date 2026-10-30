"""Créer une proposition : branche, commit, pull request (plan 0006).

Le commit est construit à côté du clone, puis contrôlé sur une extraction de l'arbre
proposé, avec tout l'espace autour (`kpi_ref`, canoniques, tags). Rien n'est poussé si
le document est refusé. La version du document est celle qui sera fusionnée (base + 1) :
les validateurs approuvent exactement ce qui entrera dans la branche principale.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

from ..diff import DiffContext, diff
from ..governance.codeowners import PATH as CODEOWNERS_PATH
from ..governance.codeowners import OwnedDocument, generate
from ..governance.model import dump_governance, space_referents, validate_governance
from ..governance.rules import requirement
from ..index.build import Analysis, Entry, analyze
from ..model.document import validate_data
from ..model.io import dump_data, read_yaml
from ..model.resolve import ResolvedGraph, resolve
from ..repo.git import RepoError
from ..repo.layout import GOVERNANCE_FILE, SLUG, document_path, variant_path
from .common import (
    Context,
    checkout,
    commit_files,
    open_context,
    push,
    remote_branches,
    render_body,
)

MAX_DIFFERENCES = 200  # au-delà, seul le résumé figure dans le corps de la PR


def _issues(issues: list) -> list[dict]:
    return [i.to_dict() for i in issues]


def _mapping(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _target(raw: dict) -> dict:
    """Ce que désigne le document : identifiant, chemin, entité, KPI d'une variante."""
    kind = raw.get("kind")
    product = _mapping(raw.get("data_product"))
    if kind in ("concept", "kpi"):
        document_id = product.get("id")
        if not isinstance(document_id, str) or not _slug(document_id):
            raise RepoError("invalid_document", "Identifiant de document invalide.")
        return {"kind": kind, "id": document_id, "path": document_path(kind, document_id),
                "entity": None, "kpi_id": document_id if kind == "kpi" else None}
    if kind == "variant":
        kpi_id, entity = _mapping(raw.get("variant_of")).get("id"), raw.get("entity")
        if not (isinstance(kpi_id, str) and isinstance(entity, str) and _slug(kpi_id)
                and _slug(entity)):
            raise RepoError("invalid_document", "Une variante doit désigner son KPI "
                            "(`variant_of.id`) et son entité (`entity`).")
        return {"kind": "variant", "id": f"{kpi_id}--{entity}",
                "path": variant_path(kpi_id, entity), "entity": entity, "kpi_id": kpi_id}
    raise RepoError("invalid_document", "Type de document inconnu : concept, kpi ou variant.")


def _slug(value: str) -> bool:
    return re.match(SLUG, value) is not None


def _current_version(context: Context, path: str) -> int | None:
    text = context.show(path)
    if text is None:
        return None
    raw, _ = read_yaml(text)
    version = _mapping(_mapping(raw).get("data_product")).get("version")
    return version if isinstance(version, int) else None


def _check_base(current: int | None, base_version: int | None, document_id: str) -> None:
    if current != base_version:
        if current is None:
            message = f"« {document_id} » n'existe plus sur la branche principale."
        elif base_version is None:
            message = f"« {document_id} » existe déjà (v{current}) : partir de cette version."
        else:
            message = (f"La base v{base_version} de « {document_id} » n'est plus la version "
                       f"courante (v{current}) : repartir de la version courante.")
        raise RepoError("stale_base", message)


def _branch(context: Context, stem: str) -> str:
    taken = remote_branches(context, f"prop/{stem}-")
    n = 1
    while f"prop/{stem}-{n}" in taken:
        n += 1
    return f"prop/{stem}-{n}"


def _nature(target: dict, entry: Entry) -> str:
    if target["kind"] != "variant":
        return "new_version"
    if entry.raw.get("mode") == "from_scratch":
        return "from_scratch"
    return "undeclared" if entry.undeclared_count else "declared_point"


def _domain(target: dict, analysis: Analysis, entry: Entry) -> str | None:
    source = entry if target["kind"] != "variant" else analysis.entry(target["kpi_id"])
    domain = _mapping(source.raw.get("data_product")).get("domain") if source else None
    return domain if isinstance(domain, str) else None


def _diff(context: Context, target: dict, analysis: Analysis, entry: Entry) -> dict | None:
    """Écarts classés : contre la version courante pour un canonique, contre le canonique
    désigné pour une variante. None pour une création ou un concept sans graphe."""
    document = entry.document
    if target["kind"] == "variant":
        canonical = analysis.library.kpi(document.variant_of.id, document.variant_of.version)
        if canonical is None:
            return None
        base, other = ResolvedGraph(canonical), resolve(document, canonical, analysis.library)
        relation = document.mode
    else:
        text = context.show(target["path"])
        previous = validate_data(read_yaml(text)[0]).document if text else None
        if previous is None or previous.graph is None or document.graph is None:
            return None
        base, other, relation = ResolvedGraph(previous), ResolvedGraph(document), "version"
    report = diff(base, other, DiffContext(relation, analysis.library))
    differences = [{
        "node": d.node_ref.base if d.node_ref else None, "node_type": d.node_type,
        "kind": d.kind, "classification": d.classification, "severity": d.severity,
        "message": d.message,
    } for d in report.differences]
    return {"relation": relation, "identical": report.identical,
            "summary": report.summary.model_dump(),
            "differences": differences[:MAX_DIFFERENCES],
            "truncated": len(differences) > MAX_DIFFERENCES}


def _title(target: dict, entry: Entry, analysis: Analysis, version: int) -> str:
    if target["kind"] == "variant":
        kpi = analysis.entry(target["kpi_id"])
        label = (kpi.raw.get("label") if kpi else None) or target["kpi_id"]
        return f"{label} — {target['entity']} v{version}"
    return f"{entry.raw.get('label') or target['id']} v{version}"


def _open_pull(context: Context, stem: str, commit: str, title: str, justification: str,
               block: dict) -> dict:
    branch = _branch(context, stem)
    push(context, f"{commit}:refs/heads/{branch}")
    pull = context.host.create_pull_request(branch, title, render_body(justification, block))
    from .status import describe  # évite un import circulaire

    return describe(context, pull)


def create_proposal(workspace_id: str, document_yaml: str, justification: str,
                    base_version: int | None) -> dict:
    context = open_context(workspace_id, sync=True)
    context.require("contributeur")
    raw, issues = read_yaml(document_yaml)
    if issues or not isinstance(raw, dict):
        raise RepoError("invalid_document", "Le document n'est pas un YAML lisible.",
                        _issues(issues))
    target = _target(raw)
    current = _current_version(context, target["path"])
    _check_base(current, base_version, target["id"])
    version = (current or 0) + 1
    raw.setdefault("data_product", {})["version"] = version
    content = dump_data(raw)
    commit = commit_files(context.repo, context.base, {target["path"]: content},
                          f"{target['id']} v{version}\n\n{justification.strip()}")
    with checkout(context.repo, commit) as root:
        analysis = analyze(root, context.repo)
    entry = analysis.entry(target["id"])
    errors = [i for i in entry.issues if i.severity == "error"]
    if entry.document is None or errors:
        raise RepoError("invalid_document", "Le document est refusé : corriger les erreurs "
                        "avant de proposer.", _issues(errors or entry.issues))
    nature = _nature(target, entry)
    domain = _domain(target, analysis, entry)
    need = requirement(context.governance, nature, domain)
    title = _title(target, entry, analysis, version)
    block = {
        "schema_version": 1, "target": target, "nature": nature, "domain": domain,
        "base_version": base_version, "version": version, "mention": need.mention,
        "diff": _diff(context, target, analysis, entry),
        "warnings": _issues([i for i in entry.issues if i.severity != "error"]),
    }
    stem = target["id"] if target["kind"] != "variant" else \
        f"{target['kpi_id']}-{target['entity']}"
    if target["kind"] != "variant":
        stem += "-canonical"
    return _open_pull(context, stem, commit, title, justification, block)


def owned_documents(analysis: Analysis) -> list[OwnedDocument]:
    return [OwnedDocument(e.file.path, e.file.kind,
                          _mapping(e.raw.get("data_product")).get("domain"))
            for e in analysis.entries if e.file.kind in ("concept", "kpi")]


def create_governance_proposal(workspace_id: str, governance_data: dict,
                               justification: str) -> dict:
    """Nouvelle gouvernance, avec `CODEOWNERS` régénéré dans le même commit."""
    context = open_context(workspace_id, sync=True)
    if context.account not in space_referents(context.governance):
        raise RepoError("forbidden", "Seul un référent de l'espace propose une modification "
                        "de la gouvernance.")
    governance, issues = validate_governance(governance_data)
    if governance is None:
        raise RepoError("invalid_governance", "La gouvernance proposée est refusée.",
                        _issues(issues))
    with checkout(context.repo, context.base) as root:
        documents = owned_documents(analyze(root, context.repo))
    files = {GOVERNANCE_FILE: dump_governance(governance),
             CODEOWNERS_PATH: generate(governance, documents)}
    title = "Gouvernance de l'espace"
    commit = commit_files(context.repo, context.base, files,
                          f"Gouvernance\n\n{justification.strip()}")
    current = context.show(GOVERNANCE_FILE) or ""
    block = {
        "schema_version": 1,
        "target": {"kind": "governance", "id": "governance", "path": GOVERNANCE_FILE,
                   "entity": None, "kpi_id": None},
        "nature": "governance", "domain": None, "base_version": None, "version": None,
        "base_governance": _digest(current), "mention": None, "diff": None,
        "warnings": _issues([i for i in issues if i.severity != "error"]),
    }
    return _open_pull(context, "governance", commit, title, justification, block)


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
