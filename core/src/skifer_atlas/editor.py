"""Éditeur de graphe (plan 0013) : validation à la frappe, brouillons locaux, aperçu de
la proposition.

Le YAML reste le pivot. L'éditeur envoie le document tel qu'il est, analysé en JSON ; le
serveur rend le texte YAML qu'il écrirait, les problèmes localisés sur un nœud, les
colonnes en sortie de chaque nœud et le SQL compilé. Un document encore invalide est
validé en partie : les nœuds valides dont les entrées le sont aussi donnent leurs
colonnes, pour que les listes de clés restent utilisables pendant la saisie.

Les brouillons et les positions du canevas vivent dans le dossier de l'espace, hors du
dépôt : `.atlas/drafts/<id>.json` et `.atlas/layout/<id>.json`. Rien n'y est jamais
poussé.
"""

from __future__ import annotations

import json
import re
import types
import typing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, TypeAdapter, ValidationError
from skifer.core.op_catalog import AGGREGATE_FUNCTIONS, FILTER_OPERATORS
from sqlglot import exp

from .compile import CompileError, NotCompilable, compile_document, load_calendars
from .diff import DiffContext, diff
from .governance.rules import requirement
from .index.build import Analysis
from .model.check import check_document
from .model.columns import propagate
from .model.document import (
    DOCUMENT_ADAPTER,
    ConceptDocument,
    KpiDocument,
    validate_data,
)
from .model.errors import NODE_ID_RE, Issue
from .model.graph import Library
from .model.io import dump_data, dump_document, read_yaml
from .model.layout import FAMILIES, OPERATOR_LABELS, TYPE_LABELS
from .model.nodes import FORBIDDEN_AGGREGATES, PLATFORMS, ColumnType, Node
from .model.resolve import ResolvedGraph, resolve
from .model.variants import FromScratchVariant, OverrideVariant
from .repo import versions as repo_versions
from .repo.git import RepoError
from .repo.layout import SLUG, document_path, read_governance

# Dialectes de l'état permanent (guide 10.3) : « Compilable Databricks, Snowflake ».
DIALECTS = ("databricks", "snowflake")
SEVERITIES = {"error": 0, "warning": 1, "info": 2}
NODE_ADAPTER: TypeAdapter[Any] = TypeAdapter(Node)


def _mapping(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list:
    return value if isinstance(value, list) else []


# --- ordre des clés ----------------------------------------------------------------------

def _models(annotation: Any) -> list[type[BaseModel]]:
    """Modèles pydantic cités par une annotation (unions, listes, Annotated)."""
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return [annotation]
    found: list[type[BaseModel]] = []
    for arg in typing.get_args(annotation):
        found.extend(m for m in _models(arg) if m not in found)
    return found


def _literal(model: type[BaseModel], key: str) -> tuple:
    field = model.model_fields.get(key)
    if field is None:
        return ()
    return tuple(v for arg in _flatten(field.annotation) for v in typing.get_args(arg)
                 if typing.get_origin(arg) is typing.Literal) or ()


def _flatten(annotation: Any) -> list:
    origin = typing.get_origin(annotation)
    if origin is typing.Literal:
        return [annotation]
    if origin in (typing.Union, types.UnionType, typing.Annotated):
        return [a for arg in typing.get_args(annotation) for a in _flatten(arg)]
    return [annotation]


def _pick(candidates: list[type[BaseModel]], value: dict) -> type[BaseModel] | None:
    """Le modèle d'une union que désignent les discriminants du mapping."""
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    for key in ("kind", "mode", "type", "operation"):
        if key in value:
            matching = [m for m in candidates if value[key] in _literal(m, key)]
            if matching:
                candidates = matching
                if len(candidates) == 1:
                    return candidates[0]
    return None


def _ordered(value: Any, model: type[BaseModel] | None) -> Any:
    """Les clés dans l'ordre du modèle, comme les écrit `dump_document` ; les clés
    inconnues suivent, dans leur ordre."""
    if not isinstance(value, dict) or model is None:
        return value
    out: dict = {}
    for name, field in model.model_fields.items():
        key = field.alias or name
        if key not in value:
            continue
        candidates = _models(field.annotation)
        item = value[key]
        if isinstance(item, list):
            out[key] = [_ordered(e, _pick(candidates, e)) if isinstance(e, dict) else e
                        for e in item]
        elif isinstance(item, dict):
            out[key] = _ordered(item, _pick(candidates, item))
        else:
            out[key] = item
    out.update({k: v for k, v in value.items() if k not in out})
    return out


def _document_model(raw: dict) -> type[BaseModel] | None:
    return _pick([ConceptDocument, KpiDocument, OverrideVariant, FromScratchVariant], raw)


def canonical_text(raw: Any, document: Any | None) -> str:
    if document is not None:
        return dump_document(document)
    if isinstance(raw, dict):
        return dump_data(_ordered(raw, _document_model(raw)))
    return dump_data(raw)


# --- validation partielle -----------------------------------------------------------------

def _inputs(node: dict) -> list[str]:
    inputs = node.get("inputs")
    if isinstance(inputs, dict):
        return [v for v in (inputs.get("left"), inputs.get("right")) if isinstance(v, str)]
    return [v for v in _list(inputs) if isinstance(v, str)]


def _pass_through(node: dict) -> dict | None:
    """Un filtre ou un dédoublonnage incomplet garde ses colonnes d'entrée : un filtre neutre
    le remplace, pour que la suite de la chaîne reste éditable (plan 0013, critère 4)."""
    inputs = node.get("inputs")
    if node.get("type") not in ("filter", "deduplicate") or not isinstance(node.get("id"), str):
        return None
    if not (isinstance(inputs, list) and len(inputs) == 1 and isinstance(inputs[0], str)):
        return None
    stand_in = {"id": node["id"], "type": "filter", "inputs": inputs,
                "condition": {"expr": "TRUE"}, "nulls": "keep"}
    try:
        NODE_ADAPTER.validate_python(stand_in)
    except ValidationError:
        return None
    return stand_in


def _valid_nodes(nodes: list) -> list[dict]:
    """Nœuds valides un à un, dont toutes les entrées sont elles-mêmes gardées."""
    kept: dict[str, dict] = {}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        try:
            NODE_ADAPTER.validate_python(node)
        except ValidationError:
            node = _pass_through(node)
            if node is None:
                continue
        if node.get("id") not in kept:
            kept[node["id"]] = node
    changed = True
    while changed:
        changed = False
        for node_id, node in list(kept.items()):
            if any(source not in kept for source in _inputs(node)):
                del kept[node_id]
                changed = True
    return list(kept.values())


def _partial(raw: dict, nodes: list) -> Any | None:
    """Un document qui ne garde que les nœuds valides : de quoi propager les colonnes."""
    kept = _valid_nodes(nodes)
    if not kept:
        return None
    graph = {"nodes": kept, "output": kept[-1]["id"]}
    stub = {"schema_version": 1, "kind": "concept", "label": "brouillon", "entity": "TODO",
            "data_product": {"id": "brouillon", "version": 1, "owner": "atlas",
                             "domain": "TODO"}}
    for candidate in ({**raw, "graph": graph}, {**stub, "graph": graph}):
        if candidate.get("kind") == "variant":
            continue
        try:
            return DOCUMENT_ADAPTER.validate_python(candidate)
        except ValidationError:
            continue
    return None


def _view_nodes(raw: dict, library: Library) -> tuple[list, Any]:
    """Les nœuds du graphe affiché, et le canonique d'une variante par surcharge."""
    if raw.get("kind") == "variant" and raw.get("mode") == "override":
        of = _mapping(raw.get("variant_of"))
        canonical = library.kpi(of.get("id"), of.get("version")) \
            if isinstance(of.get("version"), int) else None
        if canonical is None:
            return [], None
        nodes = [n.model_dump(mode="json", by_alias=True, exclude_none=True)
                 for n in canonical.graph.nodes]
        position = {n["id"]: i for i, n in enumerate(nodes)}
        for override in _list(raw.get("overrides")):
            replace = _mapping(override).get("replace") if isinstance(override, dict) else None
            if isinstance(replace, dict) and replace.get("id") in position:
                nodes[position[replace["id"]]] = replace
        return nodes, canonical
    return _list(_mapping(raw.get("graph")).get("nodes")), None


def _cycle(nodes: list) -> list[str] | None:
    inputs = {n["id"]: _inputs(n) for n in nodes if isinstance(n, dict) and isinstance(n.get("id"), str)}
    state: dict[str, int] = {}

    def visit(node_id: str, stack: list[str]) -> list[str] | None:
        state[node_id] = 1
        for source in inputs.get(node_id, []):
            if source not in inputs:
                continue
            if state.get(source) == 1:
                return [*stack[stack.index(source):], node_id] if source in stack else [source]
            if source not in state:
                found = visit(source, [*stack, node_id])
                if found:
                    return found
        state[node_id] = 2
        return None

    for node_id in inputs:
        if node_id not in state:
            found = visit(node_id, [])
            if found:
                return found
    return None


def _cte_sql(sql: str, dialect: str, node_id: str) -> str | None:
    """La CTE d'un nœud dans le SQL compilé du document."""
    import sqlglot

    try:
        tree = sqlglot.parse_one(sql, read=dialect)
    except sqlglot.errors.SqlglotError:
        return None
    for cte in tree.find_all(exp.CTE):
        if cte.alias == node_id:
            return cte.this.sql(dialect=dialect, pretty=True) + "\n"
    return None


def _fragments(text: str) -> dict[str, str]:
    """YAML de chaque nœud, tel qu'il figure dans le document (élément de liste)."""
    raw, issues = read_yaml(text)
    if issues or not isinstance(raw, dict):
        return {}
    found: dict[str, str] = {}
    for node in _list(_mapping(raw.get("graph")).get("nodes")):
        if isinstance(node, dict) and isinstance(node.get("id"), str):
            found.setdefault(node["id"], dump_data([node]))
    for override in _list(raw.get("overrides")):
        if isinstance(override, dict) and isinstance(override.get("node"), str):
            found.setdefault(override["node"], dump_data([override]))
    return found


def check(raw: Any, library: Library, calendars: dict, node_id: str | None = None) -> dict:
    """Problèmes, état permanent, colonnes et SQL d'un document en cours d'édition."""
    result = validate_data(raw)
    issues = list(result.issues)
    schema_valid = result.valid
    document = result.document
    raw = raw if isinstance(raw, dict) else {}
    nodes, canonical = _view_nodes(raw, library)

    graph_document = None
    if document is not None and document.kind == "variant":
        canonical = library.kpi(document.variant_of.id, document.variant_of.version)
        if canonical is None:
            issues.append(Issue("/variant_of", None, "unknown_kpi_ref",
                                f"Canonique {document.variant_of.id} v"
                                f"{document.variant_of.version} introuvable."))
        else:
            resolved = resolve(document, canonical, library)
            issues.extend(resolved.issues)
            graph_document = resolved.document
    elif document is not None and getattr(document, "graph", None) is not None:
        issues.extend(check_document(document, library))
        graph_document = document

    partial = graph_document is None
    if partial:
        base = canonical.model_dump(mode="json", by_alias=True, exclude_none=True) \
            if canonical is not None else raw
        graph_document = _partial(base, nodes)
    schemas: dict = {}
    if graph_document is not None:
        schemas, found = propagate(graph_document, library)
        if partial:
            seen = {(i.node_id, i.code, i.message) for i in issues}
            issues.extend(i for i in found if (i.node_id, i.code, i.message) not in seen)
    columns = {key: [[c.name, c.type] for c in schema.values()]
               for key, schema in schemas.items() if schema is not None}

    cycle = _cycle(nodes)
    errors = any(i.severity == "error" for i in issues)
    compiled: dict[str, dict] = {}
    for dialect in DIALECTS:
        if errors or partial or graph_document is None:
            compiled[dialect] = {"status": "blocked"}
            continue
        try:
            sql = compile_document(graph_document, dialect, None, library, calendars).sql
        except NotCompilable as error:
            compiled[dialect] = error.to_dict()
        except CompileError as error:
            first = error.issues[0]
            compiled[dialect] = {"status": "error", "node_id": first.node_id,
                                 "reason": first.message}
        else:
            compiled[dialect] = {"status": "ok", "sql": sql,
                                 "node_sql": _cte_sql(sql, dialect, node_id) if node_id else None}

    points = [p for p in _list(raw.get("variation_points")) if isinstance(p, str)
              and NODE_ID_RE.match(p)]
    if raw.get("kind") == "kpi" and points:
        issues.append(Issue(
            "/variation_points", None, "variation_points",
            f"{len(points)} point(s) de variation déclaré(s) ({', '.join(points)}) : "
            "surchargeables par les entités avec une validation légère.", "info"))

    text = canonical_text(raw, document)
    issues.sort(key=lambda i: SEVERITIES.get(i.severity, 3))
    return {
        "yaml": text,
        "fragments": _fragments(text),
        "issues": [i.to_dict() for i in issues],
        "status": {
            "schema": schema_valid,
            "acyclic": cycle is None,
            "cycle": cycle,
            "compilable": compiled,
        },
        "columns": columns,
        "submittable": not any(i.severity == "error" for i in issues),
    }


def parse(text: str) -> dict:
    """Le YAML plein écran : le document analysé, ou l'erreur qui empêche le retour."""
    raw, issues = read_yaml(text)
    if issues:
        return {"document": None, "issues": [i.to_dict() for i in issues]}
    if not isinstance(raw, dict):
        return {"document": None, "issues": [Issue(
            "", None, "invalid_value", "Le document doit être un mapping YAML.").to_dict()]}
    return {"document": raw, "issues": []}


# --- ouverture -----------------------------------------------------------------------------

def _folder(workspace_folder: Path, kind: str, document_id: str) -> Path:
    if not all(re.match(SLUG, part) for part in document_id.split("--", 1)):
        raise RepoError("not_found", f"Document « {document_id} » introuvable.")
    return workspace_folder / ".atlas" / kind / f"{document_id}.json"


def _read_json(path: Path) -> dict | None:
    try:
        found = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return found if isinstance(found, dict) else None


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _node_number(node_id: Any) -> int:
    match = re.fullmatch(r"n([0-9]{2,4})", node_id) if isinstance(node_id, str) else None
    return int(match.group(1)) if match else 0


def _highest(raw: Any) -> int:
    nodes = _list(_mapping(_mapping(raw).get("graph")).get("nodes"))
    return max((_node_number(_mapping(n).get("id")) for n in nodes), default=0)


def highest_node(repo: Path, document_id: str, raw: dict, path: str) -> int:
    """Le plus grand identifiant de nœud jamais attribué au document : version courante et
    versions taguées. Un nouveau nœud prend le suivant ; un identifiant supprimé n'est
    jamais réattribué (ADR 0017)."""
    highest = _highest(raw)
    for version in repo_versions.versions(repo, document_id):
        try:
            text = repo_versions.document_at(repo, document_id, version.version, path)
        except RepoError:
            continue
        highest = max(highest, _highest(read_yaml(text)[0]))
    return highest


def _calendars(repo: Path) -> list[dict]:
    return [{"key": c.key, "version": c.version}
            for c in load_calendars(repo / "calendars").values()]


def vocabulary() -> dict:
    """Le vocabulaire fermé que proposent les formulaires : rien d'autre n'est offert."""
    return {
        "types": [{"type": t, "label": label, "family": FAMILIES[t]}
                  for t, label in TYPE_LABELS.items()],
        "operators": [{"name": name, "arity": spec.arity, "label": OPERATOR_LABELS[name]}
                      for name, spec in FILTER_OPERATORS.items() if name != "sql"],
        "aggregates": sorted(set(AGGREGATE_FUNCTIONS) - FORBIDDEN_AGGREGATES),
        "platforms": list(PLATFORMS),
        "column_types": list(typing.get_args(ColumnType)),
    }


def _mode(raw: dict) -> str:
    if raw.get("kind") == "variant":
        return "override" if raw.get("mode") == "override" else "from_scratch"
    return "canonical"


def open_document(repo: Path, analysis: Analysis, folder: Path, document_id: str) -> dict:
    """Ce qu'il faut à l'éditeur : la copie de la version courante (version incrémentée),
    le brouillon local s'il existe, les positions, le canonique d'une surcharge."""
    draft = _read_json(_folder(folder, "drafts", document_id))
    entry = analysis.entry(document_id)
    if entry is None and draft is None:
        raise RepoError("not_found", f"Document « {document_id} » introuvable.")
    if entry is not None and isinstance(entry.raw, dict):
        raw = json.loads(json.dumps(entry.raw, default=str))
        product = _mapping(raw.get("data_product"))
        base = product.get("version") if isinstance(product.get("version"), int) else None
        if base is not None:
            raw["data_product"]["version"] = base + 1
        highest = highest_node(repo, document_id, entry.raw, entry.file.path)
    else:
        raw, base, highest = draft["document"], None, int(draft.get("highest") or 0)
    canonical = None
    if raw.get("kind") == "variant":
        of = _mapping(raw.get("variant_of"))
        found = analysis.library.kpi(of.get("id"), of.get("version")) \
            if isinstance(of.get("version"), int) else None
        if found is not None:
            canonical = found.model_dump(mode="json", by_alias=True, exclude_none=True)
    governance = read_governance(repo)
    return {
        "id": document_id,
        "mode": _mode(raw),
        "kind": raw.get("kind"),
        "base_version": base,
        "document": raw,
        "canonical": canonical,
        "highest": highest,
        "positions": _read_json(_folder(folder, "layout", document_id)),
        "draft": draft,
        "calendars": _calendars(repo),
        "vocabulary": vocabulary(),
        "domains": [{"id": d.id, "label": d.label} for d in governance.domains] if governance else [],
    }


def new_document(repo: Path, analysis: Analysis, folder: Path, kind: str, document_id: str,
                 label: str, domain: str, owner: str) -> dict:
    """Un concept ou un KPI vierge, enregistré aussitôt en brouillon local."""
    if not re.match(SLUG, document_id):
        raise RepoError("invalid_document", "Identifiant attendu : minuscules, chiffres et "
                        "tirets (ex. revenu-net).")
    if analysis.entry(document_id) is not None or (repo / document_path(kind, document_id)).exists():
        raise RepoError("document_exists", f"« {document_id} » existe déjà dans l'espace : "
                        "proposer une modification depuis sa fiche.")
    if _folder(folder, "drafts", document_id).exists():
        raise RepoError("document_exists", f"Un brouillon local de « {document_id} » existe "
                        "déjà : le reprendre.")
    raw: dict = {"schema_version": 1, "kind": kind,
                 "data_product": {"id": document_id, "version": 1, "owner": owner,
                                  "domain": domain},
                 "label": label}
    if kind == "kpi":
        raw["semantics"] = {"calendar": "TODO", "timezone": "TODO"}
    else:
        raw["entity"] = "TODO"
    save_draft(folder, document_id, {"document": raw, "positions": {}, "highest": 0,
                                     "base_version": None})
    return open_document(repo, analysis, folder, document_id)


def save_draft(folder: Path, document_id: str, draft: dict) -> dict:
    saved = {**draft, "saved_at": datetime.now(UTC).isoformat(timespec="seconds")}
    _write_json(_folder(folder, "drafts", document_id), saved)
    if isinstance(draft.get("positions"), dict):
        _write_json(_folder(folder, "layout", document_id), draft["positions"])
    return {"saved_at": saved["saved_at"]}


def delete_draft(folder: Path, document_id: str) -> None:
    _folder(folder, "drafts", document_id).unlink(missing_ok=True)


# --- aperçu de la proposition ----------------------------------------------------------------

def preview(repo: Path, analysis: Analysis, raw: Any) -> dict:
    """Ce que récapitule la fenêtre de soumission : nature, validations requises (plan
    0006) et écarts classés (plan 0003) avec la version courante ou le canonique."""
    result = validate_data(raw)
    document = result.document
    if document is None:
        raise RepoError("invalid_document", "Le document est à corriger avant de proposer.",
                        [i.to_dict() for i in result.issues if i.severity == "error"])
    library = analysis.library
    governance = read_governance(repo)
    report = None
    if document.kind == "variant":
        canonical = library.kpi(document.variant_of.id, document.variant_of.version)
        if canonical is None:
            raise RepoError("invalid_document", "Le canonique de la déclinaison est introuvable.")
        resolved = resolve(document, canonical, library)
        if resolved.document is not None:
            report = diff(ResolvedGraph(canonical), resolved, DiffContext(document.mode, library))
        if document.mode == "from_scratch":
            nature = "from_scratch"
        else:
            nature = "undeclared" if any(o.classification == "undeclared"
                                         for o in resolved.overrides) else "declared_point"
        domain = canonical.data_product.domain
    else:
        nature = "new_version"
        domain = document.data_product.domain
        entry = analysis.entry(document.data_product.id)
        previous = entry.document if entry is not None else None
        if previous is not None and previous.graph is not None and document.graph is not None:
            report = diff(ResolvedGraph(previous), ResolvedGraph(document),
                          DiffContext("version", library))
    need = requirement(governance, nature, domain if isinstance(domain, str) else None) \
        if governance else None
    return {
        "nature": nature,
        "domain": domain,
        "required": need.required if need else 0,
        "mention": need.mention if need else None,
        "diff": report.model_dump(mode="json") if report else None,
    }


def calendars_of(repo: Path) -> dict:
    return load_calendars(repo / "calendars")
