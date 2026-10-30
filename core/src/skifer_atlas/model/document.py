"""Documents Atlas : concept, KPI ou déclinaison, dans le YAML Skifer (ADR 0002).

`validate_data` combine la validation pydantic et les contrôles qui portent sur tout le
document (identifiants uniques, sortie et points de variation qui désignent un nœud).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Annotated, Any, Literal

from pydantic import Field, TypeAdapter, ValidationError, model_validator

from .errors import Issue, issues_from_validation_error, pointer
from .nodes import (
    TODO,
    CalendarOrTodo,
    ColumnName,
    ColumnType,
    ConditionText,
    Graph,
    NonEmptyStr,
    PositiveInt,
    Slug,
    TimezoneOrTodo,
    _Model,
    invalid,
    or_todo,
)
from .variants import CURRENCY_PATTERN, VariantDocument, VariationPoint

SCHEMA_VERSION = 1


class DataProduct(_Model):
    id: Slug
    version: PositiveInt
    owner: NonEmptyStr
    domain: or_todo(Slug)
    description: str | None = None


class Semantics(_Model):
    calendar: CalendarOrTodo
    timezone: TimezoneOrTodo
    currency: Annotated[str, Field(pattern=CURRENCY_PATTERN)] | None = None


class EntityAttribute(_Model):
    name: ColumnName
    type: ColumnType


class Entity(_Model):
    key: Annotated[list[ColumnName], Field(min_length=1)]
    attributes: Annotated[list[EntityAttribute], Field(min_length=1)]


class Residue(_Model):
    """Ce que l'extraction n'a pas su traduire. Le message ne cite jamais de valeur de
    données ni de nom de table ; l'extrait SQL n'est désigné que par son empreinte."""

    code: Annotated[str, Field(pattern=r"^[a-z][a-z_]*$")]
    message: NonEmptyStr
    blocking: bool
    sql_excerpt_hash: Annotated[str, Field(pattern=r"^[0-9a-f]{16}$")] | None = None


class Extraction(_Model):
    source_file: NonEmptyStr
    line: PositiveInt | None = None
    dialect: Literal["databricks", "snowflake"]
    sql_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    residues: list[Residue]


Status = Literal["draft", "needs_curation"]


EntityOrTodo = or_todo(Entity)


class ConceptDocument(_Model):
    schema_version: Literal[1]
    kind: Literal["concept"]
    status: Status | None = None
    data_product: DataProduct
    label: NonEmptyStr
    synonyms: list[NonEmptyStr] | None = None
    entity: EntityOrTodo
    variation_points: list[VariationPoint] | None = None
    graph: Graph | None = None
    extraction: Extraction | None = None


class ScopePeriod(_Model):
    """Nom d'une période du calendrier du KPI, ou bornes ISO incluses."""

    calendar_period: NonEmptyStr | None = None
    from_: Annotated[date | None, Field(alias="from", strict=False)] = None
    to: Annotated[date | None, Field(strict=False)] = None

    @model_validator(mode="after")
    def _one_form(self) -> ScopePeriod:
        bounds = (self.from_, self.to)
        if self.calendar_period is not None:
            if bounds != (None, None):
                raise invalid("calendar_period", "Une période se donne par son nom ou par "
                              "ses bornes, pas les deux.")
        elif None in bounds:
            raise invalid("from", "Une période se donne par son nom (calendar_period) ou par "
                          "ses deux bornes (from, to).")
        elif self.to < self.from_:
            raise invalid("to", "La fin de la période précède son début.")
        return self

    def text(self) -> str:
        """Forme attendue par la compilation (plan 0007)."""
        if self.calendar_period is not None:
            return self.calendar_period
        return f"{self.from_.isoformat()}..{self.to.isoformat()}"


class KpiScope(_Model):
    """Scope de comparaison déclaré avec le KPI (plan 0009, analyse Q5)."""

    id: Slug
    period: ScopePeriod | None = None
    perimeter: list[ConditionText] | None = None
    granularity: Annotated[list[ColumnName], Field(min_length=1)] | None = None


class Tolerance(_Model):
    percent: Annotated[float, Field(ge=0, le=100, strict=False)]


class KpiDocument(_Model):
    schema_version: Literal[1]
    kind: Literal["kpi"]
    status: Status | None = None
    data_product: DataProduct
    label: NonEmptyStr
    synonyms: list[NonEmptyStr] | None = None
    semantics: Semantics
    variation_points: list[VariationPoint] | None = None
    graph: Graph
    scopes: list[KpiScope] | None = None
    tolerance: Tolerance | None = None
    extraction: Extraction | None = None

    def scope(self, scope_id: str) -> KpiScope | None:
        return next((s for s in self.scopes or [] if s.id == scope_id), None)


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
        return not any(issue.severity == "error" for issue in self.issues)


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
    errors = any(issue.severity == "error" for issue in issues)
    return ValidationResult(None if errors else document, issues)


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

    scopes = raw.get("scopes")
    scope_ids: set[str] = set()
    for index, scope in enumerate(scopes if isinstance(scopes, list) else []):
        scope_id = scope.get("id") if isinstance(scope, dict) else None
        if isinstance(scope_id, str):
            if scope_id in scope_ids:
                issues.append(Issue(pointer(["scopes", index, "id"]), None, "invalid_value",
                                    f"Le scope « {scope_id} » est déclaré deux fois."))
            scope_ids.add(scope_id)

    issues.extend(draft_checks(raw))

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


def _todo_paths(value: Any, path: list[str | int]) -> list[list[str | int]]:
    if value == TODO or (isinstance(value, str) and value.startswith(f"{TODO}.")):
        return [path]
    if isinstance(value, dict):
        return [p for key, item in value.items() for p in _todo_paths(item, [*path, key])]
    if isinstance(value, list):
        return [p for index, item in enumerate(value) for p in _todo_paths(item, [*path, index])]
    return []


def draft_checks(raw: dict) -> list[Issue]:
    """Brouillons d'extraction (plan 0004) : statut, résidus, valeurs à compléter.

    Un `TODO` est un avertissement dans un brouillon et une erreur ailleurs ; un document
    `needs_curation`, ou un brouillon qui garde un résidu bloquant, est refusé.
    """
    issues: list[Issue] = []
    status = raw.get("status")
    extraction = raw.get("extraction")
    if extraction is not None and status is None:
        issues.append(Issue(
            "/extraction", None, "invalid_value",
            "Le bloc « extraction » n'est admis que dans un brouillon (status: draft).",
        ))
    if status == "needs_curation":
        issues.append(Issue(
            "/status", None, "needs_curation",
            "Brouillon à reprendre : lever les résidus bloquants de « extraction.residues », "
            "puis passer status à draft.",
        ))
    residues = extraction.get("residues") if isinstance(extraction, dict) else None
    if status == "draft":
        for index, residue in enumerate(residues if isinstance(residues, list) else []):
            if isinstance(residue, dict) and residue.get("blocking") is True:
                issues.append(Issue(
                    pointer(["extraction", "residues", index]), None, "blocking_residue",
                    f"Résidu bloquant « {residue.get('code')} » non levé : le traiter, puis "
                    "le retirer de la liste.",
                ))
    graph = raw.get("graph")
    nodes = graph.get("nodes") if isinstance(graph, dict) else None
    for path in _todo_paths({k: v for k, v in raw.items() if k != "extraction"}, []):
        node_id = None
        if path[:2] == ["graph", "nodes"] and isinstance(nodes, list) and len(path) > 2:
            node = nodes[path[2]]
            node_id = node.get("id") if isinstance(node, dict) else None
        issues.append(Issue(
            pointer(path), node_id, "todo", "Valeur à compléter.",
            "warning" if status is not None else "error",
        ))
    return issues
