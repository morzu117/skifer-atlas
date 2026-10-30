"""Résolution d'une variante sur son canonique (plan 0002).

Une surcharge remplace un nœud entier (même identifiant, même type) ou un attribut de
`semantics`. Elle est classée `declared` si sa cible est un point de variation du
canonique, `undeclared` sinon : c'est ce classement qui fixe le niveau de validation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .check import check_document, has_errors
from .document import KpiDocument
from .errors import Issue, pointer
from .graph import Library
from .variants import OverrideVariant

Classification = Literal["declared", "undeclared"]


@dataclass(frozen=True)
class ResolvedOverride:
    node: str
    classification: Classification
    justification: str


@dataclass
class ResolvedGraph:
    document: KpiDocument | None
    overrides: list[ResolvedOverride] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)
    variant: Any = None  # la variante résolue, quand il y en a une

    @property
    def valid(self) -> bool:
        return self.document is not None and not has_errors(self.issues)


def resolve(variant: Any, canonical: KpiDocument, library: Library | None = None) -> ResolvedGraph:
    expected = (canonical.data_product.id, canonical.data_product.version)
    if (variant.variant_of.id, variant.variant_of.version) != expected:
        return ResolvedGraph(None, issues=[Issue(
            "/variant_of", None, "variant_of_mismatch",
            f"La variante porte sur {variant.variant_of.id} v{variant.variant_of.version}, "
            f"pas sur {expected[0]} v{expected[1]}.",
        )])
    if isinstance(variant, OverrideVariant):
        result = _apply_overrides(variant, canonical)
    else:
        result = _from_scratch(variant, canonical)
    result.variant = variant
    if result.document is not None:
        result.issues.extend(check_document(result.document, library))
    return result


def _apply_overrides(variant: OverrideVariant, canonical: KpiDocument) -> ResolvedGraph:
    declared = set(canonical.variation_points or [])
    nodes = list(canonical.graph.nodes)
    position = {node.id: index for index, node in enumerate(nodes)}
    semantics = canonical.semantics
    result = ResolvedGraph(None)
    for index, override in enumerate(variant.overrides):
        if override.replace is not None:
            if override.node not in position:
                result.issues.append(Issue(
                    pointer(["overrides", index, "node"]), override.node,
                    "unknown_override_target",
                    f"Le canonique n'a pas de nœud {override.node}.",
                ))
                continue
            original = nodes[position[override.node]]
            if original.type != override.replace.type:
                result.issues.append(Issue(
                    pointer(["overrides", index, "replace", "type"]), override.node,
                    "override_type_change",
                    f"{override.node} est un nœud {original.type} : une surcharge le remplace "
                    f"par un nœud du même type, pas {override.replace.type}.",
                ))
                continue
            nodes[position[override.node]] = override.replace
        else:
            attribute = override.node.removeprefix("semantics.")
            semantics = semantics.model_copy(update={attribute: override.value})
        classification: Classification = "declared" if override.node in declared else "undeclared"
        result.overrides.append(
            ResolvedOverride(override.node, classification, override.justification)
        )
        if classification == "undeclared":
            result.issues.append(Issue(
                pointer(["overrides", index, "node"]),
                override.node if override.replace is not None else None,
                "undeclared_override",
                f"{override.node} n'est pas un point de variation déclaré : la validation "
                "de niveau canonique s'applique.",
                "warning",
            ))
    if has_errors(result.issues):
        return result
    graph = canonical.graph.model_copy(update={"nodes": nodes})
    result.document = canonical.model_copy(update={"graph": graph, "semantics": semantics})
    return result


def _from_scratch(variant: Any, canonical: KpiDocument) -> ResolvedGraph:
    result = ResolvedGraph(canonical.model_copy(update={"graph": variant.graph}))
    bound = {n.concept for n in variant.graph.nodes if n.type == "source" and n.concept}
    for index, concept in enumerate(variant.concepts):
        if concept not in bound:
            result.issues.append(Issue(
                pointer(["concepts", index]), None, "unbound_concept",
                f"Aucune source n'est rattachée au concept « {concept} ».",
            ))
    return result
