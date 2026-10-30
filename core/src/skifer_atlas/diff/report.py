"""Rapport de diff (plan 0003) : modèle de sortie, calcul et rendu texte.

L'ordre des écarts est déterministe : écarts de sémantique, puis ordre topologique de
`base`, puis nœuds ajoutés dans l'ordre topologique d'`other`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from ..model.fingerprint import fingerprint
from ..model.graph import Library
from ..model.resolve import ResolvedGraph
from .align import LOW_SCORE, STRUCTURING, Side, align
from .classify import CLASSIFICATIONS, SEVERITIES, classify, message, severity
from .compare import CRITICAL, METADATA_FIELDS, OTHER, Change, metadata, node_changes

Relation = Literal["version", "override", "from_scratch", "free"]
RELATIONS = ("version", "override", "from_scratch", "free")
DIFF_SCHEMA_VERSION = 1
DIFF_SCHEMA_FILENAME = f"diff-report.v{DIFF_SCHEMA_VERSION}.schema.json"


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DocumentRef(_Model):
    id: str
    version: int
    fingerprint: str


class NodeRef(_Model):
    base: str | None
    other: str | None


class PairOut(_Model):
    base: str
    other: str
    score: int | None


class ChangeOut(_Model):
    field: str
    before: Any
    after: Any


class Difference(_Model):
    kind: Literal["modified", "added", "removed", "reordered"]
    node_ref: NodeRef | None
    node_type: str
    changes: list[ChangeOut]
    classification: Literal[
        "override_declared", "override_undeclared", "from_scratch", "critical", "cosmetic",
        "to_verify",
    ]
    severity: Literal["info", "warn", "critical"]
    message: str


class Summary(_Model):
    by_classification: dict[str, int]
    by_severity: dict[str, int]


class DiffReport(_Model):
    identical: bool
    relation: Relation
    base: DocumentRef
    other: DocumentRef
    pairs: list[PairOut]
    differences: list[Difference]
    summary: Summary

    def to_json(self) -> str:
        return json.dumps(self.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n"

    @property
    def has_critical(self) -> bool:
        return any(d.severity == "critical" for d in self.differences)


@dataclass(frozen=True)
class DiffContext:
    relation: Relation
    library: Library | None = None


# --- calcul --------------------------------------------------------------------------------

def _ref(resolved: ResolvedGraph) -> DocumentRef:
    named = resolved.variant or resolved.document
    return DocumentRef(
        id=named.data_product.id, version=named.data_product.version,
        fingerprint=fingerprint(resolved.document),
    )


def _semantic_changes(base: Any, other: Any) -> list[Change]:
    before, after = getattr(base, "semantics", None), getattr(other, "semantics", None)
    if before is None or after is None:
        return []
    changes = []
    for name in ("calendar", "timezone", "currency"):
        b, a = getattr(before, name), getattr(after, name)
        b = b.model_dump(exclude_none=True) if hasattr(b, "model_dump") else b
        a = a.model_dump(exclude_none=True) if hasattr(a, "model_dump") else a
        if b != a:
            changes.append(Change(name, b, a, CRITICAL if name != "currency" else OTHER))
    return changes


def _binding_renames(base: Side, other: Side) -> dict[str, str]:
    """Colonnes de base → colonnes d'other liées au même attribut de concept : une colonne
    rattachée par `binding` se compare sous son nom local."""
    renames: dict[str, str] = {}
    for column, concept in sorted(other.binding.items()):
        local = [name for name, target in base.binding.items() if target == concept] or [concept]
        for name in local:
            if name != column:
                renames[name] = column
    return renames


def _metadata_by_id(document: Any) -> dict[str, dict]:
    return {
        node.id: {name: getattr(node, name, None) for name in METADATA_FIELDS}
        for node in document.graph.nodes
    }


def _anchors(side: Side, node_id: str, paired: set[str]) -> list[str]:
    """Entrées d'un nœud, en remontant à travers les nœuds non appariés."""
    found: list[str] = []
    for source in side.node(node_id).inputs:
        found.extend([source] if source in paired else _anchors(side, source, paired))
    return found


def _reorders(base: Side, other: Side, mapped: dict[str, str]) -> list[tuple[str, str]]:
    """Paires (a, b) d'opérations structurantes : a en amont de b dans base, b en amont
    de a dans other."""
    structural = [
        node_id for node_id in base.order
        if node_id in mapped and base.node(node_id).type in STRUCTURING - {"source"}
    ]
    return [
        (a, b)
        for b in structural for a in structural
        if a in base.ancestors[b] and mapped[b] in other.ancestors[mapped[a]]
    ]


def diff(base: ResolvedGraph, other: ResolvedGraph, context: DiffContext) -> DiffReport:
    base_ref, other_ref = _ref(base), _ref(other)
    semantic = _semantic_changes(base.document, other.document)
    identical = DiffReport(
        identical=True, relation=context.relation, base=base_ref, other=other_ref,
        pairs=[], differences=[], summary=_summary([]),
    )
    # Court-circuit : même empreinte, même sémantique et mêmes métadonnées nœud par nœud.
    # L'empreinte ignore libellés et notes ; sans ce dernier test, un changement de
    # libellé passerait inaperçu.
    if (
        base_ref.fingerprint == other_ref.fingerprint and not semantic
        and _metadata_by_id(base.document) == _metadata_by_id(other.document)
    ):
        return identical

    relation = context.relation
    # Le classement des surcharges ne vaut que contre leur propre canonique.
    overrides = (
        {o.node: o.classification for o in other.overrides} if relation == "override" else {}
    )
    b_side = Side(base.document, context.library)
    o_side = Side(other.document, context.library)
    pairs = align(b_side, o_side, by_id=relation in ("version", "override"))
    mapped = {pair.base: pair.other for pair in pairs}
    reverse = {pair.other: pair.base for pair in pairs}
    scores = {pair.base: pair.score for pair in pairs}
    reorders = _reorders(b_side, o_side, mapped)
    involved = {node_id for pair in reorders for node_id in pair}

    def override_of(side: Side, node_id: str) -> str | None:
        for member in side.node(node_id).members:
            if member.id in overrides:
                return overrides[member.id]
        return None

    def build(kind: str, base_id: str | None, other_id: str | None,
              changes: list[Change]) -> Difference:
        side, node_id = (o_side, other_id) if base_id is None else (b_side, base_id)
        node = side.node(node_id)
        score = scores.get(base_id) if base_id is not None else None
        low = score is not None and score < LOW_SCORE
        gravity = severity(kind, node.type, changes)
        override = override_of(o_side, other_id) if other_id is not None else None
        classification = classify(gravity, relation, override, low)
        other_meta = metadata(o_side.node(other_id)) if other_id is not None else {}
        return Difference(
            kind=kind, node_ref=NodeRef(base=base_id, other=other_id),
            node_type="filter" if node.type == "filter_set" else node.type,
            changes=[ChangeOut(field=c.field, before=c.before, after=c.after) for c in changes],
            classification=classification, severity=gravity,
            message=message(
                kind, node.type, metadata(node).get("label"), node_id, changes,
                classification, low, other_meta.get("bypass_reason"),
            ),
        )

    differences: list[Difference] = []
    for change in semantic:
        gravity = "critical" if change.nature == CRITICAL else "warn"
        classification = classify(gravity, relation, overrides.get(f"semantics.{change.field}"),
                                  False)
        differences.append(Difference(
            kind="modified", node_ref=None, node_type="semantics",
            changes=[ChangeOut(field=change.field, before=change.before, after=change.after)],
            classification=classification, severity=gravity,
            message=message("modified", "semantics", None, None, [change], classification,
                            False),
        ))

    renames = _binding_renames(b_side, o_side)
    for base_id in b_side.order:
        if base_id not in mapped:
            differences.append(build("removed", base_id, None, []))
            continue
        other_id = mapped[base_id]
        changes = node_changes(b_side.node(base_id), o_side.node(other_id), renames)
        before = _anchors(b_side, base_id, set(mapped))
        after = _anchors(o_side, other_id, set(reverse))
        explained = base_id in involved or (
            set(before) <= involved and {reverse[a] for a in after} <= involved
        )
        if [mapped[a] for a in before] != after and not explained:
            changes.insert(0, Change("inputs", before, after, CRITICAL))
        if changes:
            differences.append(build("modified", base_id, other_id, changes))
        for a, b in reorders:
            if b == base_id:
                order = Change("order", [a, b], [mapped[b], mapped[a]], CRITICAL)
                differences.append(build("reordered", a, mapped[a], [order]))
    for other_id in o_side.order:
        if other_id not in reverse:
            differences.append(build("added", None, other_id, []))

    if not differences:
        return identical  # mêmes graphes à l'identifiant près
    return DiffReport(
        identical=False, relation=relation, base=base_ref, other=other_ref,
        pairs=[PairOut(base=p.base, other=p.other, score=p.score) for p in pairs],
        differences=differences, summary=_summary(differences),
    )


def _summary(differences: list[Difference]) -> Summary:
    return Summary(
        by_classification={c: sum(d.classification == c for d in differences)
                           for c in CLASSIFICATIONS},
        by_severity={s: sum(d.severity == s for d in differences) for s in SEVERITIES},
    )


# --- schéma et texte -----------------------------------------------------------------------

def diff_json_schema() -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": f"Rapport de diff Skifer Atlas (v{DIFF_SCHEMA_VERSION})",
        **DiffReport.model_json_schema(mode="serialization"),
    }


def diff_schema_text() -> str:
    return json.dumps(diff_json_schema(), indent=2, ensure_ascii=False) + "\n"


_RELATION_LABELS = {
    "version": "versions", "override": "surcharge", "from_scratch": "from scratch",
    "free": "graphes libres",
}
_CLASS_LABELS = {
    "override_declared": "surcharge déclarée", "override_undeclared": "surcharge hors points",
    "from_scratch": "from scratch", "critical": "critique", "cosmetic": "cosmétique",
    "to_verify": "à vérifier",
}
_SEVERITY_LABELS = {"info": "info", "warn": "attention", "critical": "critique"}
_KIND_LABELS = {
    "modified": "modifié", "added": "ajouté", "removed": "retiré", "reordered": "ordre",
}


def _value(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def report_text(report: DiffReport) -> str:
    b, o = report.base, report.other
    lines = [f"{b.id} v{b.version} → {o.id} v{o.version} ({_RELATION_LABELS[report.relation]})"]
    if report.identical:
        lines.append("Identiques (même empreinte).")
        return "\n".join(lines) + "\n"
    counts = report.summary.by_severity
    lines.append(
        f"{len(report.differences)} écart(s) : {counts['critical']} critique(s), "
        f"{counts['warn']} à surveiller, {counts['info']} sans effet"
    )
    for d in report.differences:
        ref = d.node_ref
        where = "" if ref is None else (
            ref.base if ref.base == ref.other or ref.other is None
            else ref.other if ref.base is None else f"{ref.base}→{ref.other}"
        )
        lines.append(
            f"  {where:<9} {d.node_type:<12} {_KIND_LABELS[d.kind]:<8} "
            f"{_CLASS_LABELS[d.classification]} · {_SEVERITY_LABELS[d.severity]}"
        )
        for change in d.changes:
            lines.append(f"      {change.field} : {_value(change.before)} → {_value(change.after)}")
        lines.append(f"      {d.message}")
    return "\n".join(lines) + "\n"
