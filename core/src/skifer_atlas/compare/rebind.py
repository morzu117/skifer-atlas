"""Le canonique rebranché sur les sources d'une déclinaison (plan 0009, analyse Q11).

Le canonique s'évalue sur les mêmes données que la déclinaison comparée :

- **surcharge** : une source que la déclinaison remplace est remplacée de même dans le
  canonique ; les autres sources sont déjà communes ;
- **from scratch** : chaque source du canonique prend la source de la déclinaison
  rattachée au même concept. Chaque colonne du canonique s'y retrouve par son attribut
  de concept (`binding` des deux côtés), sinon par son nom, avec le même type.

La source rebranchée garde les colonnes du canonique ; celles qui portent un autre nom
dans la table de la déclinaison se lisent sous ce nom (`renames`, plan 0007).
Sinon : `canonical_not_rebindable`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..model.check import check_document, has_errors
from ..model.graph import Library
from ..model.resolve import ResolvedGraph
from ..repo.git import RepoError


@dataclass
class Rebound:
    document: Any
    renames: dict[str, dict[str, str]] = field(default_factory=dict)
    sources: dict[str, str] = field(default_factory=dict)  # source du canonique → table


def _refuse(entity: str, reason: str) -> RepoError:
    return RepoError("canonical_not_rebindable", f"Le canonique ne se rebranche pas sur les "
                     f"sources de « {entity} » : {reason}.")


def _replace_sources(canonical: Any, replaced: dict[str, Any]) -> Any:
    nodes = [replaced.get(node.id, node) for node in canonical.graph.nodes]
    return canonical.model_copy(update={
        "graph": canonical.graph.model_copy(update={"nodes": nodes})})


def _mapping(source: Any, candidate: Any) -> tuple[dict[str, str], list[str]]:
    """Colonne du canonique → colonne de la candidate, et colonnes introuvables."""
    attributes = {attribute: column for column, attribute in (candidate.binding or {}).items()}
    types = {c.name: c.type for c in candidate.columns}
    mapping, missing = {}, []
    for column in source.columns:
        attribute = (source.binding or {}).get(column.name)
        target = attributes.get(attribute) if attribute else None
        if target is None and column.name in types:
            target = column.name
        if target is None or types.get(target) != column.type:
            missing.append(column.name)
        else:
            mapping[column.name] = target
    return mapping, missing


def _from_scratch(canonical: Any, variant: Any, entity: str) -> Rebound:
    candidates = [n for n in variant.graph.nodes if n.type == "source"]
    replaced: dict[str, Any] = {}
    renames: dict[str, dict[str, str]] = {}
    for source in (n for n in canonical.graph.nodes if n.type == "source"):
        if source.concept is None:
            raise _refuse(entity, f"la source {source.id} du canonique n'est rattachée à "
                          "aucun concept")
        same = [c for c in candidates if c.concept == source.concept]
        if not same:
            raise _refuse(entity, f"aucune source n'y est rattachée au concept "
                          f"« {source.concept} » ({source.id})")
        attempts = [(candidate, *_mapping(source, candidate)) for candidate in same]
        found = next(((c, m) for c, m, missing in attempts if not missing), None)
        if found is None:
            _, _, missing = min(attempts, key=lambda a: len(a[2]))
            raise _refuse(entity, f"colonnes de {source.id} introuvables ou d'un autre type : "
                          f"{', '.join(missing)}")
        candidate, mapping = found
        replaced[source.id] = source.model_copy(update={
            "platform": candidate.platform, "table": candidate.table})
        moved = {name: target for name, target in mapping.items() if name != target}
        if moved:
            renames[source.id] = moved
    return Rebound(_replace_sources(canonical, replaced), renames)


def rebind(canonical: Any, resolved: ResolvedGraph, library: Library | None = None) -> Rebound:
    variant = resolved.variant
    if variant.mode == "override":
        replaced = {o.node: o.replace for o in variant.overrides
                    if o.replace is not None and o.replace.type == "source"}
        found = Rebound(_replace_sources(canonical, replaced))
    else:
        found = _from_scratch(canonical, variant, variant.entity)
    issues = check_document(found.document, library)
    if has_errors(issues):
        first = next(i for i in issues if i.severity == "error")
        raise _refuse(variant.entity, f"{first.node_id or first.path} : {first.message}")
    found.sources = {n.id: n.table for n in found.document.graph.nodes if n.type == "source"}
    return found
