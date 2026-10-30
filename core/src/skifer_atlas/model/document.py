"""Documents Atlas : concept, KPI ou déclinaison, dans le YAML Skifer (ADR 0002).

`validate_data` combine la validation pydantic et les contrôles qui portent sur tout le
document (identifiants uniques, sortie et points de variation qui désignent un nœud).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated, Any, Literal

from pydantic import Field, TypeAdapter, ValidationError

from .errors import Issue, issues_from_validation_error, pointer
from .nodes import (
    CalendarRef,
    ColumnName,
    ColumnType,
    Graph,
    NonEmptyStr,
    PositiveInt,
    Slug,
    Timezone,
    _Model,
)
from .variants import CURRENCY_PATTERN, VariantDocument, VariationPoint

SCHEMA_VERSION = 1


class DataProduct(_Model):
    id: Slug
    version: PositiveInt
    owner: NonEmptyStr
    domain: Slug
    description: str | None = None


class Semantics(_Model):
    calendar: CalendarRef
    timezone: Timezone
    currency: Annotated[str, Field(pattern=CURRENCY_PATTERN)] | None = None


class EntityAttribute(_Model):
    name: ColumnName
    type: ColumnType


class Entity(_Model):
    key: Annotated[list[ColumnName], Field(min_length=1)]
    attributes: Annotated[list[EntityAttribute], Field(min_length=1)]


class ConceptDocument(_Model):
    schema_version: Literal[1]
    kind: Literal["concept"]
    data_product: DataProduct
    label: NonEmptyStr
    synonyms: list[NonEmptyStr] | None = None
    entity: Entity
    variation_points: list[VariationPoint] | None = None
    graph: Graph | None = None


class KpiDocument(_Model):
    schema_version: Literal[1]
    kind: Literal["kpi"]
    data_product: DataProduct
    label: NonEmptyStr
    synonyms: list[NonEmptyStr] | None = None
    semantics: Semantics
    variation_points: list[VariationPoint] | None = None
    graph: Graph


Document = Annotated[
    ConceptDocument | KpiDocument | VariantDocument, Field(discriminator="kind")
]
DOCUMENT_ADAPTER: TypeAdapter[Any] = TypeAdapter(Document)


@dataclass
class ValidationResult:
    document: Any | None
    issues: list[Issue] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.issues


def validate_data(raw: Any) -> ValidationResult:
    """Valide un document déjà chargé depuis le YAML."""
    if not isinstance(raw, dict):
        return ValidationResult(
            None, [Issue("", None, "invalid_value", "Le document doit être un mapping YAML.")]
        )
    version = raw.get("schema_version")
    if "schema_version" in raw and (version != SCHEMA_VERSION or isinstance(version, bool)):
        return ValidationResult(None, [Issue(
            "/schema_version", None, "unknown_schema_version",
            f"Version de schéma « {version} » inconnue : seule la version "
            f"{SCHEMA_VERSION} est prise en charge.",
        )])
    issues: list[Issue] = []
    document = None
    try:
        document = DOCUMENT_ADAPTER.validate_python(raw)
    except ValidationError as error:
        issues.extend(issues_from_validation_error(error, raw))
    issues.extend(document_checks(raw))
    return ValidationResult(None if issues else document, issues)


def document_checks(raw: dict) -> list[Issue]:
    """Contrôles qui demandent de voir tout le document. Robuste aux formes invalides."""
    issues: list[Issue] = []
    graph = raw.get("graph")
    nodes = graph.get("nodes") if isinstance(graph, dict) else None
    ids: dict[str, int] = {}
    for index, node in enumerate(nodes if isinstance(nodes, list) else []):
        node_id = node.get("id") if isinstance(node, dict) else None
        if not isinstance(node_id, str):
            continue
        if node_id in ids:
            issues.append(Issue(
                pointer(["graph", "nodes", index, "id"]), node_id, "duplicate_node_id",
                f"L'identifiant {node_id} est déjà celui du nœud en position {ids[node_id]}.",
            ))
        else:
            ids[node_id] = index

    output = graph.get("output") if isinstance(graph, dict) else None
    if ids and isinstance(output, str) and output not in ids:
        issues.append(Issue(
            "/graph/output", None, "invalid_value",
            f"La sortie « {output} » ne désigne aucun nœud du graphe.",
        ))

    points = raw.get("variation_points")
    semantics = raw.get("semantics")
    seen: set[str] = set()
    for index, point in enumerate(points if isinstance(points, list) else []):
        if not isinstance(point, str):
            continue
        path = pointer(["variation_points", index])
        if point in seen:
            issues.append(Issue(path, None, "invalid_value", f"« {point} » est déclaré deux fois."))
        seen.add(point)
        if point.startswith("n") and isinstance(nodes, list) and point not in ids:
            issues.append(Issue(
                path, None, "invalid_value", f"Le point de variation {point} n'est pas un nœud du graphe.",
            ))
        attribute = point.removeprefix("semantics.")
        if point.startswith("semantics.") and isinstance(semantics, dict) and attribute not in semantics:
            issues.append(Issue(
                path, None, "invalid_value",
                f"« {point} » est déclaré point de variation mais n'est pas renseigné.",
            ))

    overrides = raw.get("overrides")
    targets: set[str] = set()
    for index, override in enumerate(overrides if isinstance(overrides, list) else []):
        target = override.get("node") if isinstance(override, dict) else None
        if isinstance(target, str):
            if target in targets:
                issues.append(Issue(
                    pointer(["overrides", index, "node"]), target if target.startswith("n") else None,
                    "invalid_value", f"« {target} » est surchargé deux fois.",
                ))
            targets.add(target)
    return issues
