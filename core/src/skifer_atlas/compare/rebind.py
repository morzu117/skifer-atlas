"""Le canonique rebranché sur les sources d'une déclinaison (plans 0009 et 0022, analyse Q11).

Le canonique s'évalue sur les mêmes données que la déclinaison comparée :

- **surcharge** : une source que la déclinaison remplace est remplacée de même dans le
  canonique ; les autres sources sont déjà communes ;
- **from scratch** (ADR 0026) : chaque source du canonique prend la source de la
  déclinaison rattachée au même concept.
  - Une colonne compte pour l'attribut auquel son `binding` la rattache, sinon pour son
    propre nom (convention du diff, plan 0003), des deux côtés. Elle se retrouve par cet
    attribut, sinon par son nom.
  - Le type doit être le même, ou un entier là où le canonique attend un décimal ou un
    flottant (élargissement sans perte).
  - Seules comptent les colonnes que le graphe du canonique lit, et celles qu'il
    rattache au concept (le scope filtre et regroupe sur elles). Une autre colonne
    introuvable est retirée de la source rebranchée.
  - Une source du canonique dont le concept n'a aucune source dans la déclinaison reste
    une **source commune** : même table, lue sur la plateforme de la déclinaison.
    Au moins une source doit être rebranchée.

La source rebranchée garde les noms de colonnes du canonique ; celles qui portent un autre
nom dans la table de la déclinaison se lisent sous ce nom (`renames`, plan 0007).
Sinon : `canonical_not_rebindable`, avec les colonnes introuvables.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..model.check import check_document, has_errors
from ..model.columns import propagate
from ..model.graph import Library
from ..model.resolve import ResolvedGraph
from ..repo.git import RepoError

# (type attendu par le canonique, type lu) admis en plus de l'égalité : sans perte.
WIDENING = frozenset({("decimal", "integer"), ("double", "integer")})


@dataclass
class Rebound:
    document: Any
    renames: dict[str, dict[str, str]] = field(default_factory=dict)
    sources: dict[str, str] = field(default_factory=dict)  # source du canonique → table
    common: list[str] = field(default_factory=list)  # sources communes (from scratch)


@dataclass
class _Attempt:
    candidate: Any
    mapping: dict[str, str]  # colonne du canonique → colonne de la candidate
    problems: list[str]  # colonnes nécessaires introuvables ou d'un autre type


def _refuse(entity: str, reason: str) -> RepoError:
    return RepoError("canonical_not_rebindable", f"Le canonique ne se rebranche pas sur les "
                     f"sources de « {entity} » : {reason}.")


def _replace_sources(canonical: Any, replaced: dict[str, Any]) -> Any:
    nodes = [replaced.get(node.id, node) for node in canonical.graph.nodes]
    return canonical.model_copy(update={
        "graph": canonical.graph.model_copy(update={"nodes": nodes})})


def compatible(expected: str, found: str) -> bool:
    return expected == found or (expected, found) in WIDENING


def _attribute(source: Any, column: str) -> str:
    return (source.binding or {}).get(column, column)


def _column_errors(document: Any, library: Library | None) -> set[tuple]:
    return {(i.code, i.node_id, i.path, i.message) for i in propagate(document, library)[1]
            if i.severity == "error"}


class _Needs:
    """Colonnes d'une source que le canonique ne peut pas perdre : celles qu'il rattache
    au concept, et celles dont le retrait fait échouer la propagation des colonnes."""

    def __init__(self, canonical: Any, library: Library | None):
        self.canonical = canonical
        self.library = library
        self.baseline = _column_errors(canonical, library)

    def __call__(self, source: Any, column: str) -> bool:
        if column in (source.binding or {}):
            return True
        trimmed = source.model_copy(update={
            "columns": [c for c in source.columns if c.name != column]})
        document = _replace_sources(self.canonical, {source.id: trimmed})
        return bool(_column_errors(document, self.library) - self.baseline)


def _attempt(source: Any, candidate: Any, needs: _Needs) -> _Attempt:
    types = {c.name: c.type for c in candidate.columns}
    by_attribute: dict[str, list[str]] = {}
    for name in types:
        by_attribute.setdefault(_attribute(candidate, name), []).append(name)
    mapping, problems = {}, []
    for column in source.columns:
        attribute = _attribute(source, column.name)
        found = next(iter(by_attribute.get(attribute, [])), None)
        if found is None and column.name in types:
            found = column.name
        if found is not None and compatible(column.type, types[found]):
            mapping[column.name] = found
        elif needs(source, column.name):
            problems.append(column.name if found is None else
                            f"{column.name} ({column.type} attendu, {types[found]} dans {found})")
    return _Attempt(candidate, mapping, problems)


def _from_scratch(canonical: Any, variant: Any, entity: str, library: Library | None) -> Rebound:
    candidates = [n for n in variant.graph.nodes if n.type == "source"]
    platform = candidates[0].platform if candidates else None
    needs = _Needs(canonical, library)
    replaced: dict[str, Any] = {}
    renames: dict[str, dict[str, str]] = {}
    common: list[str] = []
    for source in (n for n in canonical.graph.nodes if n.type == "source"):
        same = [c for c in candidates if source.concept and c.concept == source.concept]
        if not same:  # rien côté déclinaison pour ce concept : source commune
            common.append(source.id)
            replaced[source.id] = source.model_copy(update={"platform": platform})
            continue
        attempts = [_attempt(source, candidate, needs) for candidate in same]
        best = min(attempts, key=lambda a: len(a.problems))
        if best.problems:
            raise _refuse(entity, f"colonnes de {source.id} introuvables dans "
                          f"{best.candidate.table} ou d'un autre type : "
                          f"{', '.join(best.problems)} ; les rattacher au concept "
                          f"« {source.concept} » par un binding")
        kept = [c for c in source.columns if c.name in best.mapping]
        binding = {k: v for k, v in (source.binding or {}).items() if k in best.mapping}
        replaced[source.id] = source.model_copy(update={
            "platform": best.candidate.platform, "table": best.candidate.table,
            "columns": kept, "binding": binding or None})
        moved = {name: target for name, target in best.mapping.items() if name != target}
        if moved:
            renames[source.id] = moved
    if len(common) == len(replaced):
        raise _refuse(entity, "aucune de ses sources n'est rattachée à un concept des sources "
                      "du canonique")
    return Rebound(_replace_sources(canonical, replaced), renames, common=common)


def rebind(canonical: Any, resolved: ResolvedGraph, library: Library | None = None) -> Rebound:
    variant = resolved.variant
    if variant.mode == "override":
        replaced = {o.node: o.replace for o in variant.overrides
                    if o.replace is not None and o.replace.type == "source"}
        found = Rebound(_replace_sources(canonical, replaced))
    else:
        found = _from_scratch(canonical, variant, variant.entity, library)
    issues = check_document(found.document, library)
    if has_errors(issues):
        first = next(i for i in issues if i.severity == "error")
        raise _refuse(variant.entity, f"{first.node_id or first.path} : {first.message}")
    found.sources = {n.id: n.table for n in found.document.graph.nodes if n.type == "source"}
    return found
