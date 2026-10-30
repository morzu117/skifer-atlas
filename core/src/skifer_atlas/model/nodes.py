"""Les dix types de nœuds du graphe (plan 0001).

Identifiants de type en anglais ; le libellé français vient de l'UI. Les contrôles faits
ici ne regardent qu'un nœud à la fois : les règles de graphe (cycles, ports, colonnes
disponibles) relèvent du plan 0002.
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import sqlglot
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Discriminator,
    Field,
    Strict,
    Tag,
    WithJsonSchema,
    model_validator,
)
from pydantic_core import PydanticCustomError
from skifer.core.op_catalog import (
    AGGREGATE_FUNCTIONS,
    FILTER_OPERATORS,
    resolve_aggregate_function,
    resolve_filter_operator,
)
from sqlglot import exp

NODE_ID_PATTERN = r"^n[0-9]{2,4}$"
SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{1,63}$"
COLUMN_PATTERN = r"^[A-Za-z_][A-Za-z0-9_]*$"
TABLE_PATTERN = r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){1,2}$"

NODE_TYPES = (
    "source", "filter", "join", "union", "compute",
    "deduplicate", "aggregate", "temporal", "kpi_ref", "metric_op",
)
PLATFORMS = ("databricks", "snowflake", "bigquery", "fabric", "redshift", "duckdb")
FORBIDDEN_AGGREGATES = frozenset({"first", "last"})
FORBIDDEN_SQL_FUNCTIONS = frozenset({"round", "bround"})


def invalid(field: str, message: str) -> PydanticCustomError:
    return PydanticCustomError("invalid_value", message, {"field": field})


def missing(field: str, message: str | None = None) -> PydanticCustomError:
    return PydanticCustomError(
        "missing_field", message or f"Champ requis manquant : « {field} ».", {"field": field}
    )


# --- Types scalaires -------------------------------------------------------------------

NodeId = Annotated[str, Field(pattern=NODE_ID_PATTERN)]
Slug = Annotated[str, Field(pattern=SLUG_PATTERN)]
ColumnName = Annotated[str, Field(pattern=COLUMN_PATTERN)]
NonEmptyStr = Annotated[str, Field(pattern=r"\S")]
ColumnType = Literal["string", "integer", "decimal", "double", "boolean", "date", "timestamp"]
PositiveInt = Annotated[int, Field(ge=1)]


def _check_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise PydanticCustomError(
            "invalid_value",
            "Fuseau « {value} » inconnu : un nom IANA est attendu (ex. Europe/Paris).",
            {"value": value},
        ) from None
    return value


Timezone = Annotated[str, AfterValidator(_check_timezone)]


def _parse_sql(text: str) -> exp.Expression:
    try:
        tree = sqlglot.parse_one(text, read="databricks")
    except sqlglot.errors.SqlglotError as error:
        detail = str(error).splitlines()[0] if str(error) else type(error).__name__
        raise PydanticCustomError(
            "invalid_value", "Expression SQL illisible : {detail}", {"detail": detail}
        ) from None
    if tree is None:
        raise PydanticCustomError("invalid_value", "Expression SQL vide.")
    return tree


def _check_sql(text: str) -> str:
    _parse_sql(text)
    return text


def _check_computation(text: str) -> str:
    for func in _parse_sql(text).find_all(exp.Func):
        name = func.name if isinstance(func, exp.Anonymous) else func.sql_name()
        if name.lower() in FORBIDDEN_SQL_FUNCTIONS:
            raise PydanticCustomError(
                "forbidden_function",
                "« {name} » est interdit dans un calcul : l'arrondi se fait à la restitution.",
                {"name": name.lower()},
            )
    return text


SqlText = Annotated[str, Field(pattern=r"\S"), AfterValidator(_check_sql)]
Computation = Annotated[str, Field(pattern=r"\S"), AfterValidator(_check_computation)]


# --- Conditions (grammaire Skifer `colonne:opérateur[:valeur]` ou `{expr: SQL}`) -------

_FILTER_NAMES = sorted(
    {name for spec in FILTER_OPERATORS.values() for name in (spec.canonical, *spec.aliases)}
    - {"sql"},
    key=lambda name: (-len(name), name),
)
_CONDITION_SCHEMA_PATTERN = (
    COLUMN_PATTERN[:-1] + ":(" + "|".join(re.escape(n) for n in _FILTER_NAMES) + ")(:.*)?$"
)


def _check_condition_text(text: str) -> str:
    parts = text.split(":", 2)
    column = parts[0].strip()
    if len(parts) < 2 or not re.match(COLUMN_PATTERN, column):
        raise PydanticCustomError(
            "invalid_value",
            "Condition « {text} » : forme attendue colonne:opérateur[:valeur], "
            "ou {{expr: <SQL>}}.",
            {"text": text},
        )
    operator = parts[1].strip()
    canonical = resolve_filter_operator(operator) if operator == operator.lower() else None
    if canonical is None or canonical == "sql":
        raise PydanticCustomError(
            "invalid_value",
            "Opérateur « {operator} » non admis. Pour du SQL, écrire {{expr: <SQL>}}. "
            "Opérateurs admis : {allowed}.",
            {"operator": operator, "allowed": ", ".join(sorted(set(FILTER_OPERATORS) - {"sql"}))},
        )
    spec = FILTER_OPERATORS[canonical]
    value = parts[2].strip() if len(parts) == 3 else ""
    if spec.arity == "none":
        if value:
            raise PydanticCustomError(
                "invalid_value", "L'opérateur « {op} » n'attend pas de valeur.", {"op": canonical}
            )
        return f"{column}:{canonical}"
    if not value:
        raise PydanticCustomError(
            "invalid_value", "L'opérateur « {op} » attend une valeur.", {"op": canonical}
        )
    if spec.arity == "list":
        values = [item.strip() for item in value.replace(";", ",").split(",")]
        if not all(values) or (canonical in ("between", "not_between") and len(values) != 2):
            raise PydanticCustomError(
                "invalid_value",
                "Liste de valeurs invalide pour « {op} » : {value}.",
                {"op": canonical, "value": value},
            )
        value = ",".join(values)
    return f"{column}:{canonical}:{value}"


ConditionText = Annotated[
    str,
    AfterValidator(_check_condition_text),
    WithJsonSchema({"type": "string", "pattern": _CONDITION_SCHEMA_PATTERN}),
]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ExprCondition(_Model):
    expr: SqlText


def _condition_branch(value: Any) -> str:
    return "condition-expr" if isinstance(value, (dict, ExprCondition)) else "condition-text"


Condition = Annotated[
    Annotated[ConditionText, Tag("condition-text")] | Annotated[ExprCondition, Tag("condition-expr")],
    Discriminator(_condition_branch),
]


# --- Fonctions d'agrégation -------------------------------------------------------------

_AGGREGATE_NAMES = sorted(
    {name for spec in AGGREGATE_FUNCTIONS.values() for name in (spec.canonical, *spec.aliases)}
    - FORBIDDEN_AGGREGATES
)


def _check_aggregate(name: str) -> str:
    canonical = resolve_aggregate_function(name) if name == name.lower() else None
    if canonical in FORBIDDEN_AGGREGATES:
        raise PydanticCustomError(
            "forbidden_function",
            "« {name} » n'est pas déterministe : interdit dans un KPI.",
            {"name": canonical},
        )
    if canonical is None:
        raise PydanticCustomError(
            "invalid_value",
            "Fonction d'agrégation « {name} » inconnue. Fonctions admises : {allowed}.",
            {"name": name, "allowed": ", ".join(sorted(set(AGGREGATE_FUNCTIONS) - FORBIDDEN_AGGREGATES))},
        )
    return canonical


AggregateFunction = Annotated[
    str,
    AfterValidator(_check_aggregate),
    WithJsonSchema({"type": "string", "enum": _AGGREGATE_NAMES}),
]
MeasureSource = Annotated[str, Field(pattern=r"^(\*|[A-Za-z_][A-Za-z0-9_]*)$")]
# [source, cible, fonction] ; les listes YAML sont acceptées comme tuples.
Measure = Annotated[tuple[MeasureSource, ColumnName, AggregateFunction], Strict(False)]
KeyPair = Annotated[tuple[ColumnName, ColumnName], Strict(False)]
OrderItem = Annotated[tuple[ColumnName, Literal["asc", "desc"]], Strict(False)]
SingleInput = Annotated[list[NodeId], Field(min_length=1, max_length=1)]


def _check_measures(measures: list[tuple[str, str, str]], field: str) -> None:
    for index, (source, _target, function) in enumerate(measures):
        if source == "*" and function != "count":
            raise invalid(
                f"{field}/{index}", "La source « * » n'est admise qu'avec la fonction count."
            )


# --- Nœuds ------------------------------------------------------------------------------


class _Node(_Model):
    id: NodeId
    type: str
    label: str | None = None
    note: str | None = None


class SourceColumn(_Model):
    name: ColumnName
    type: ColumnType
    timezone: Timezone | None = None
    format: NonEmptyStr | None = None

    @model_validator(mode="after")
    def _temporal_columns(self) -> SourceColumn:
        if self.type in ("date", "timestamp"):
            for field in ("timezone", "format"):
                if getattr(self, field) is None:
                    raise missing(
                        field,
                        f"La colonne « {self.name} » ({self.type}) doit déclarer « {field} ».",
                    )
        elif self.timezone is not None or self.format is not None:
            raise invalid(
                "timezone" if self.timezone is not None else "format",
                f"La colonne « {self.name} » ({self.type}) n'a ni fuseau ni format.",
            )
        return self


class Source(_Node):
    type: Literal["source"]
    platform: Literal[PLATFORMS]
    table: Annotated[str, Field(pattern=TABLE_PATTERN)]
    owner: NonEmptyStr
    columns: Annotated[list[SourceColumn], Field(min_length=1)]
    concept: Slug | None = None
    binding: dict[ColumnName, ColumnName] | None = None

    @model_validator(mode="after")
    def _binding_needs_concept(self) -> Source:
        if self.binding is not None and self.concept is None:
            raise missing("concept", "Un « binding » suppose un « concept » de rattachement.")
        return self


class Filter(_Node):
    type: Literal["filter"]
    inputs: SingleInput
    condition: Condition
    nulls: Literal["keep", "drop"]


class JoinInputs(_Model):
    left: NodeId
    right: NodeId


class Join(_Node):
    type: Literal["join"]
    inputs: JoinInputs
    how: Literal["inner", "left", "right", "full", "cross", "left_anti", "left_semi"]
    keys: list[KeyPair]
    cardinality: Literal["1:1", "N:1", "1:N"]
    check: Literal["required", "bypass"]
    bypass_reason: NonEmptyStr | None = None

    @model_validator(mode="after")
    def _keys_and_bypass(self) -> Join:
        if self.how == "cross" and self.keys:
            raise invalid("keys", "Une jointure croisée (cross) n'a pas de clés.")
        if self.how != "cross" and not self.keys:
            raise invalid("keys", "Au moins une paire de clés [gauche, droite] est requise.")
        if self.check == "bypass" and self.bypass_reason is None:
            raise missing(
                "bypass_reason", "Le contournement du contrôle de cardinalité doit être justifié."
            )
        if self.check == "required" and self.bypass_reason is not None:
            raise invalid("bypass_reason", "« bypass_reason » n'a de sens qu'avec check: bypass.")
        return self


class UnionColumn(_Model):
    name: ColumnName
    source: Annotated[dict[NodeId, ColumnName], Field(alias="from", min_length=1)]


class UnionNode(_Node):
    type: Literal["union"]
    inputs: Annotated[list[NodeId], Field(min_length=2)]
    mode: Literal["all", "distinct"]
    columns: Annotated[list[UnionColumn], Field(min_length=1)]


class Compute(_Node):
    type: Literal["compute"]
    inputs: SingleInput
    column: ColumnName
    expr: Computation
    # `type` est le discriminant du nœud : le type de la colonne produite a son propre nom.
    column_type: ColumnType | None = None


class DeduplicateKeep(_Model):
    order_by: Annotated[list[OrderItem], Field(min_length=1)]


class Deduplicate(_Node):
    type: Literal["deduplicate"]
    inputs: SingleInput
    keys: Annotated[list[ColumnName], Field(min_length=1)]
    keep: DeduplicateKeep


class Aggregate(_Node):
    type: Literal["aggregate"]
    inputs: SingleInput
    group_by: list[ColumnName]
    measures: Annotated[list[Measure], Field(min_length=1)]
    having: list[Condition] | None = None

    @model_validator(mode="after")
    def _star_only_with_count(self) -> Aggregate:
        _check_measures(self.measures, "measures")
        return self


class _Temporal(_Node):
    type: Literal["temporal"]
    inputs: SingleInput
    operation: str
    column: ColumnName
    target: ColumnName


class ConvertTimezone(_Temporal):
    operation: Literal["convert_timezone"]
    to: Timezone


class ToDate(_Temporal):
    operation: Literal["to_date"]
    timezone: Timezone
    format: NonEmptyStr | None = None


class Period(_Temporal):
    operation: Literal["period"]
    grain: Literal["day", "week", "month", "quarter", "year"]


class Window(_Temporal):
    operation: Literal["window"]
    function: AggregateFunction
    frame: NonEmptyStr
    order_by: Annotated[list[OrderItem], Field(min_length=1)]
    partition_by: list[ColumnName] | None = None


Temporal = Annotated[
    ConvertTimezone | ToDate | Period | Window, Field(discriminator="operation")
]


class KpiRef(_Node):
    type: Literal["kpi_ref"]
    kpi: Slug
    version: PositiveInt
    columns: list[ColumnName] | None = None


class Metric(_Model):
    name: ColumnName
    expr: Computation


class MetricAggregate(_Model):
    group_by: list[ColumnName]
    measures: Annotated[list[Measure], Field(min_length=1)]

    @model_validator(mode="after")
    def _star_only_with_count(self) -> MetricAggregate:
        _check_measures(self.measures, "measures")
        return self


class MetricOp(_Node):
    type: Literal["metric_op"]
    inputs: SingleInput
    metrics: Annotated[list[Metric], Field(min_length=1)]
    order: Literal["aggregate_first", "rows_first"]
    aggregate: MetricAggregate | None = None

    @model_validator(mode="after")
    def _rows_first_needs_aggregate(self) -> MetricOp:
        if self.order == "rows_first" and self.aggregate is None:
            raise missing("aggregate", "order: rows_first exige un bloc « aggregate ».")
        return self


Node = Annotated[
    Source | Filter | Join | UnionNode | Compute | Deduplicate | Aggregate | Temporal | KpiRef | MetricOp,
    Field(discriminator="type"),
]


class CalendarRef(_Model):
    key: Slug
    version: NonEmptyStr | None = None


class Graph(_Model):
    nodes: Annotated[list[Node], Field(min_length=1)]
    output: NodeId
