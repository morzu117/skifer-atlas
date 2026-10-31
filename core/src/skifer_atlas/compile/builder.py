"""Graphe → AST SQLGlot → SQL d'un dialecte (plan 0007, ADR 0004 et 0010).

Une CTE par nœud utile, nommée d'après son identifiant, dans l'ordre topologique ; les
colonnes sont toujours explicites, dans l'ordre que leur donne la propagation (plan
0002). Une référence à un KPI est compilée une fois, préfixée `r_<kpi>_v<n>_`.
Les contrôles (cardinalité, couverture du calendrier) sont des CTE regroupées par une
garde que la requête finale consulte (`cardinality.py`). Division, semaine et garde sont
écrites pour donner le même résultat dans les trois moteurs (plan 0021, ADR 0025).

La compilation est pure : même document, mêmes calendriers, même scope et même dialecte
donnent le même SQL, à l'octet près.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import sqlglot
from sqlglot import exp
from sqlglot.dialects.spark import Spark
from sqlglot.time import format_time

from ..model.check import check_document, has_errors
from ..model.columns import Schema, propagate
from ..model.functions import parse_sql, referenced_columns
from ..model.graph import GraphView, Library, node_inputs
from ..model.nodes import TODO
from . import cardinality
from .calendar import CIVIL, Calendar, aligned
from .dialects import (
    DIALECTS,
    aggregate,
    check_expression,
    check_window,
    mark_strings,
    ordered,
    safe_division,
    week_start,
)
from .errors import CompileError, NotCompilable, compile_error
from .scope import Scope, apply_granularity, perimeter_filters, period_bounds, reference_period

_NUMBER = re.compile(r"^-?[0-9]+(\.[0-9]+)?$")
_INTEGER = re.compile(r"^-?[0-9]+$")
_DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
_COMPARISONS = {"equals": exp.EQ, "not_equals": exp.NEQ, "greater_than": exp.GT,
                "less_than": exp.LT, "greater_than_equal": exp.GTE, "less_than_equal": exp.LTE}
_JOINS = {"inner": "inner", "left": "left", "right": "right", "full": "full", "cross": "cross"}


@dataclass(frozen=True)
class SourceTable:
    table: str
    columns: tuple[tuple[str, str | None], ...]  # (nom, type ; None si à compléter)


@dataclass
class Compiled:
    dialect: str
    sql: str
    checked: list[str] = field(default_factory=list)  # jointures contrôlées
    bypassed: list[str] = field(default_factory=list)
    sources: list[SourceTable] = field(default_factory=list)


@dataclass
class _Output:
    cte: str
    schema: Schema
    zones: dict[str, str]


def _todo(node_id: str, what: str) -> CompileError:
    return compile_error("todo", f"{what} est à compléter avant de compiler.", node_id)


class _Builder:
    def __init__(self, dialect: str, library: Library, calendars: dict[str, Calendar],
                 renames: dict[str, dict[str, str]] | None = None):
        self.dialect = dialect
        self.library = library
        self.calendars = calendars
        self.renames = renames or {}
        self.ctes: list[tuple[str, exp.Expression]] = []
        self.checks: list[cardinality.Check] = []
        self.checked: list[str] = []
        self.bypassed: list[str] = []
        self.sources: dict[str, SourceTable] = {}
        self.references: dict[tuple[str, int], _Output] = {}
        self.calendar_ctes: dict[tuple[str, str], str] = {}

    def add(self, name: str, query: exp.Expression) -> None:
        self.ctes.append((name, query))

    def calendar_cte(self, calendar: Calendar) -> str:
        key = (calendar.key, calendar.version)
        if key not in self.calendar_ctes:
            name = "cal_" + re.sub(r"[^a-z0-9]", "_", calendar.key.lower())
            if name in self.calendar_ctes.values():
                name += f"_{len(self.calendar_ctes)}"
            rows = [exp.tuple_(exp.Literal.string(p.name),
                               exp.cast(exp.Literal.string(p.start.isoformat()), "date"),
                               exp.cast(exp.Literal.string(p.end.isoformat()), "date"))
                    for p in calendar.periods]
            values = exp.Values(expressions=rows, alias=exp.TableAlias(
                this=exp.to_identifier("c"),
                columns=[exp.to_identifier(c) for c in ("period_name", "start_date",
                                                         "end_date")]))
            self.add(name, exp.select("period_name", "start_date", "end_date").from_(values))
            self.calendar_ctes[key] = name
        return self.calendar_ctes[key]


class _Unit:
    """Compilation d'un document : le KPI demandé, ou un KPI qu'il référence."""

    def __init__(self, builder: _Builder, document: Any, prefix: str = "",
                 scope: Scope | None = None):
        self.builder = builder
        self.dialect = builder.dialect
        self.document = document
        self.prefix = prefix
        self.scope = scope or Scope()
        self.view = GraphView(document.graph)
        self.schemas: dict[str, Schema | None] = propagate(document, builder.library)[0]
        self.zones: dict[str, dict[str, str]] = {}
        self.filters: dict[str, list[exp.Expression]] = {}

    # --- outils ---------------------------------------------------------------------------

    def name(self, node_id: str) -> str:
        return f"{self.prefix}{node_id}"

    def columns(self, node_id: str) -> list[str]:
        return list(self.schemas[node_id] or {})

    def types(self, node_id: str) -> dict[str, str | None]:
        return {name: column.type for name, column in (self.schemas[node_id] or {}).items()}

    def expression(self, text: str, node_id: str, types: dict[str, str | None],
                   substitutions: dict[str, exp.Expression] | None = None) -> exp.Expression:
        tree = parse_sql(text)
        check_expression(tree, types, node_id, self.dialect)
        tree = safe_division(mark_strings(tree, types), types)
        if substitutions:
            def replace(node: exp.Expression) -> exp.Expression:
                if isinstance(node, exp.Column) and not node.table and node.name in substitutions:
                    return exp.paren(substitutions[node.name].copy())
                return node
            tree = tree.transform(replace)
        return tree

    def literal(self, value: str, kind: str | None, node_id: str) -> exp.Expression:
        if kind in ("integer", "decimal", "double"):
            if not (_INTEGER if kind == "integer" else _NUMBER).match(value):
                raise compile_error("invalid_value", f"« {value} » n'est pas un nombre "
                                    f"({kind}).", node_id)
            return exp.Literal.number(value)
        if kind == "boolean":
            if value.lower() not in ("true", "false"):
                raise compile_error("invalid_value", f"« {value} » n'est pas un booléen.",
                                    node_id)
            return exp.Boolean(this=value.lower() == "true")
        if kind == "date":
            if not _DATE.match(value):
                raise compile_error("invalid_value", f"« {value} » n'est pas une date "
                                    "AAAA-MM-JJ.", node_id)
            return exp.cast(exp.Literal.string(value), "date")
        if kind == "timestamp":
            return exp.cast(exp.Literal.string(value), "timestamp")
        if kind is None and _NUMBER.match(value):  # type à compléter : comme le moteur
            return exp.Literal.number(value)
        return exp.Literal.string(value)

    def condition(self, condition: Any, types: dict[str, str | None], node_id: str,
                  nulls: str = "drop") -> exp.Expression:
        if not isinstance(condition, str):
            tree = self.expression(condition.expr, node_id, types)
            nullable = referenced_columns(tree)
        else:
            column_name, operator, *rest = condition.split(":", 2)
            value = rest[0] if rest else ""
            tree = self._predicate(exp.column(column_name), operator, value,
                                   types.get(column_name), node_id)
            nullable = [column_name]
        if nulls == "keep":
            tree = exp.or_(exp.paren(tree), *[exp.column(c).is_(exp.null()) for c in nullable])
        return tree

    def _predicate(self, column: exp.Column, operator: str, value: str, kind: str | None,
                   node_id: str) -> exp.Expression:
        if operator == "is_null":
            return column.is_(exp.null())
        if operator == "is_not_null":
            return column.is_(exp.null()).not_()
        if operator in _COMPARISONS:
            return _COMPARISONS[operator](this=column, expression=self.literal(value, kind, node_id))
        if operator in ("in", "not_in"):
            values = [self.literal(v, kind, node_id) for v in value.split(",")]
            found = column.isin(*values)
            return found.not_() if operator == "not_in" else found
        if operator in ("between", "not_between"):
            low, high = (self.literal(v, kind, node_id) for v in value.split(","))
            if operator == "between":
                return exp.and_(column >= low, column <= high)
            return exp.paren(exp.or_(column.copy() < low, column.copy() > high))
        if operator in ("like", "not_like"):
            found = column.like(exp.Literal.string(value))
            return exp.Not(this=exp.paren(found)) if operator == "not_like" else found
        escaped = re.sub(r"([\\%_])", r"\\\1", value)
        pattern = {"contains": f"%{escaped}%", "not_contains": f"%{escaped}%",
                   "starts_with": f"{escaped}%", "ends_with": f"%{escaped}"}[operator]
        found = exp.Escape(this=column.like(exp.Literal.string(pattern)),
                           expression=exp.Literal.string("\\"))
        return exp.Not(this=exp.paren(found)) if operator == "not_contains" else found

    # --- parcours -------------------------------------------------------------------------

    def build(self) -> _Output:
        view = self.view
        if not view.is_dag():
            raise compile_error("invalid_graph", "Le graphe n'est pas un DAG.")
        useful = view.ancestors_of_output()
        if self.scope.period is not None:
            self._period_scope()
        for source, conditions in perimeter_filters(view, self.scope).items():
            types = self.types(source)
            self.filters.setdefault(source, []).extend(
                self.condition(c, types, source) for c in conditions)
        for node_id in view.topological_order():
            if node_id not in useful:
                continue
            node = view.by_id[node_id]
            inputs = node_inputs(node)
            self.zones[node_id] = self._zones(node, [self.zones[i] for i in inputs])
            query = getattr(self, f"_{node.type}")(node)
            if self.filters.get(node_id):  # périmètre : seules les sources sont filtrées
                query = query.where(exp.and_(*self.filters[node_id]))
            self.builder.add(self.name(node_id), query)
        output = view.output
        return _Output(self.name(output), self.schemas[output] or {}, self.zones[output])

    def _period_scope(self) -> None:
        node_id = reference_period(self.view)
        self.period_scope = node_id
        calendar = self._calendar(node_id)
        key = self.document.semantics.calendar.key
        self.bounds = period_bounds(self.scope, calendar, key)

    def _calendar(self, node_id: str) -> Calendar | None:
        semantics = getattr(self.document, "semantics", None)
        reference = semantics.calendar if semantics is not None else None
        if reference is None or reference == TODO:
            raise _todo(node_id, "Le calendrier du KPI (semantics.calendar)")
        if reference.key == CIVIL:
            return None
        calendar = self.builder.calendars.get(reference.key)
        if calendar is None:
            raise compile_error("unknown_calendar", f"Calendrier « {reference.key} » "
                                "introuvable (calendars/<key>.yaml).", node_id)
        if reference.version is not None and reference.version != calendar.version:
            raise compile_error("calendar_version_mismatch", f"Le KPI attend le calendrier "
                                f"« {reference.key} » en version {reference.version} ; le "
                                f"dépôt a la version {calendar.version}.", node_id)
        return calendar

    # --- fuseaux --------------------------------------------------------------------------

    def _zones(self, node: Any, inputs: list[dict[str, str]]) -> dict[str, str]:
        if node.type == "source":
            return {c.name: c.timezone for c in node.columns if c.timezone}
        if node.type == "kpi_ref":
            return dict(self.builder.references[(node.kpi, node.version)].zones) \
                if (node.kpi, node.version) in self.builder.references else {}
        merged: dict[str, str] = {}
        for zones in inputs:
            for name, zone in zones.items():
                merged.setdefault(name, zone)
        columns = set(self.columns(node.id))
        zones = {name: zone for name, zone in merged.items() if name in columns}
        if node.type == "compute":
            zones.pop(node.column, None)
        if node.type == "union":
            zones = {}
            for column in node.columns:
                found = {inputs[node.inputs.index(i)].get(c) for i, c in column.source.items()
                         if i in node.inputs}
                if len(found) == 1 and None not in found:
                    zones[column.name] = found.pop()
        if node.type == "temporal":
            zones.pop(node.target, None)
            if node.operation == "convert_timezone":
                zones[node.target] = node.to
            elif node.operation == "to_date":
                zones[node.target] = node.timezone
            elif node.operation == "period" and node.column in merged:
                zones[node.target] = merged[node.column]
        return zones

    # --- nœuds ----------------------------------------------------------------------------

    def _source(self, node: Any) -> exp.Select:
        # Source rebranchée (plan 0009) : colonne du graphe → colonne de la table.
        physical = self.builder.renames.get(node.id, {}) if not self.prefix else {}
        self.builder.sources.setdefault(node.table, SourceTable(node.table, tuple(
            (physical.get(c.name, c.name), None if c.type == TODO else c.type)
            for c in node.columns)))
        items = [exp.column(physical[c.name]).as_(c.name) if c.name in physical
                 else exp.column(c.name) for c in node.columns]
        return exp.select(*items).from_(exp.to_table(node.table))

    def _filter(self, node: Any) -> exp.Select:
        source = node.inputs[0]
        predicate = self.condition(node.condition, self.types(source), node.id, node.nulls)
        return exp.select(*self.columns(node.id)).from_(self.name(source)).where(predicate)

    def _join(self, node: Any) -> exp.Select:
        left, right = node.inputs.left, node.inputs.right
        left_columns = set(self.columns(left))
        merged = {a for a, b in node.keys if a == b}
        on = exp.and_(*[exp.column(a, table="l").eq(exp.column(b, table="r"))
                        for a, b in node.keys]) if node.keys else None
        items: list[exp.Expression] = []
        for name in self.columns(node.id):
            if name in merged and node.how in ("right", "full"):
                items.append(exp.Coalesce(this=exp.column(name, table="l"),
                                          expressions=[exp.column(name, table="r")]).as_(name))
            else:
                items.append(exp.column(name, table="l" if name in left_columns else "r"))
        query = exp.select(*items).from_(exp.to_table(self.name(left)).as_("l"))
        if node.how in ("left_semi", "left_anti"):
            exists = exp.Exists(this=exp.select(exp.Literal.number(1)).from_(
                exp.to_table(self.name(right)).as_("r")).where(on))
            query = query.where(exists if node.how == "left_semi" else exists.not_())
        else:
            query = query.join(exp.to_table(self.name(right)).as_("r"), on=on,
                               join_type=_JOINS[node.how])
        if node.check == "bypass":
            self.builder.bypassed.append(self.name(node.id))
        elif node.cardinality == TODO:
            raise _todo(node.id, "La cardinalité de la jointure")
        else:
            self.builder.checked.append(self.name(node.id))
            for check in cardinality.join_checks(self.name(node.id), node.cardinality,
                                                 self.name(left), self.name(right), node.keys):
                self.builder.checks.append(check)
        return query

    def _union(self, node: Any) -> exp.Expression:
        types = self.types(node.id)
        parts = []
        for source in node.inputs:
            items = []
            for column in node.columns:
                origin = column.source.get(source)
                if origin is None:
                    kind = types.get(column.name)
                    null: exp.Expression = exp.null()
                    if kind is not None:
                        null = exp.cast(null, _SQL_TYPES[kind])
                    items.append(null.as_(column.name))
                elif origin == column.name:
                    items.append(exp.column(origin))
                else:
                    items.append(exp.column(origin).as_(column.name))
            parts.append(exp.select(*items).from_(self.name(source)))
        return exp.union(*parts, distinct=node.mode == "distinct")

    def _compute(self, node: Any) -> exp.Select:
        source = node.inputs[0]
        value = self.expression(node.expr, node.id, self.types(source))
        items = [value.as_(name) if name == node.column else exp.column(name)
                 for name in self.columns(node.id)]
        return exp.select(*items).from_(self.name(source))

    def _deduplicate(self, node: Any) -> exp.Select:
        columns = self.columns(node.id)
        order = [ordered(c, d) for c, d in node.keep.order_by]
        named = {c for c, _ in node.keep.order_by}
        # Départage déterministe : les autres colonnes, quand l'ordre déclaré a des ex aequo.
        order += [ordered(c, "asc") for c in columns if c not in named and c not in node.keys]
        rank = exp.Window(this=exp.RowNumber(),
                          partition_by=[exp.column(k) for k in node.keys],
                          order=exp.Order(expressions=order))
        return exp.select(*columns).from_(self.name(node.inputs[0])).qualify(
            rank.eq(exp.Literal.number(1)))

    def _measures(self, measures: list) -> list[exp.Expression]:
        return [aggregate(function, source).as_(target) for source, target, function in measures]

    def _aggregate(self, node: Any) -> exp.Select:
        query = exp.select(*node.group_by, *self._measures(node.measures)).from_(
            self.name(node.inputs[0]))
        if node.group_by:
            query = query.group_by(*node.group_by)
        if node.having:
            types = self.types(node.id)
            query = exp.select(*self.columns(node.id)).from_(query.subquery("a")).where(
                exp.and_(*[self.condition(c, types, node.id) for c in node.having]))
        return query

    def _temporal(self, node: Any) -> exp.Select:
        source = node.inputs[0]
        types, zones = self.types(source), self.zones[source]
        column = exp.column(node.column)
        if node.operation == "window":
            return self._window(node)
        if node.operation == "period":
            return self._period(node, types.get(node.column))
        if node.operation == "convert_timezone":
            if node.to == TODO:
                raise _todo(node.id, "Le fuseau cible")
            origin = zones.get(node.column)
            if origin is None:
                raise compile_error("unknown_timezone", f"« {node.column} » n'a pas de fuseau "
                                    "connu : le déclarer sur la source.", node.id)
            if types.get(node.column) == "date":
                raise compile_error("invalid_value", "Une date n'a pas d'heure : convertir son "
                                    "fuseau n'a pas de sens.", node.id)
            value = _convert(column, origin, node.to)
        else:  # to_date
            if node.timezone == TODO:
                raise _todo(node.id, "Le fuseau de la date")
            value = self._to_date(node, column, types.get(node.column), zones.get(node.column))
        return self._with(node, value)

    def _with(self, node: Any, value: exp.Expression) -> exp.Select:
        items = [value.as_(name) if name == node.target else exp.column(name)
                 for name in self.columns(node.id)]
        return exp.select(*items).from_(self.name(node.inputs[0]))

    def _to_date(self, node: Any, column: exp.Expression, kind: str | None,
                 origin: str | None) -> exp.Expression:
        if kind == "timestamp":
            if origin is None:
                raise compile_error("unknown_timezone", f"« {node.column} » n'a pas de fuseau "
                                    "connu : le déclarer sur la source.", node.id)
            return exp.cast(_convert(column, origin, node.timezone), "date")
        if kind == "date":
            if origin is not None and origin != node.timezone:
                raise compile_error("invalid_value", f"« {node.column} » est une date de "
                                    f"{origin} : elle ne se ramène pas à {node.timezone}.",
                                    node.id)
            return exp.cast(column, "date")
        if node.format:
            pattern = node.format if "%" in node.format else format_time(
                node.format, Spark.TIME_MAPPING, Spark.TIME_TRIE)
            return exp.StrToDate(this=column, format=exp.Literal.string(pattern))
        return exp.cast(column, "date")

    def _period(self, node: Any, kind: str | None) -> exp.Select:
        day = exp.column(node.column, table="i")
        if kind != "date":
            day = exp.cast(day, "date")
        calendar = self._calendar(node.id)
        source = exp.to_table(self.name(node.inputs[0])).as_("i")
        if calendar is not None and calendar.grain == node.grain:
            name = self.builder.calendar_cte(calendar)
            value: exp.Expression = exp.column("start_date", table="c")
            query = exp.select().from_(source).join(
                exp.to_table(name).as_("c"),
                on=exp.Between(this=day.copy(), low=exp.column("start_date", table="c"),
                               high=exp.column("end_date", table="c")),
                join_type="left")
        else:
            if calendar is not None and (calendar.grain is None or GRAIN_RANK[node.grain]
                                         > GRAIN_RANK[calendar.grain] or not aligned(
                                             calendar, node.grain)):
                raise compile_error("calendar_grain_unsupported", f"Le calendrier "
                                    f"« {calendar.key} » ne se découpe pas en {node.grain} : "
                                    "grain plus large que ses périodes, ou périodes non "
                                    "alignées sur ce grain.", node.id)
            if node.grain == "day":
                value = day.copy()
            elif node.grain == "week":
                value = week_start(day.copy(), self.dialect)
            else:
                value = exp.cast(exp.TimestampTrunc(this=day.copy(),
                                                    unit=exp.var(node.grain.upper())), "date")
            query = exp.select().from_(source)
        if calendar is not None:
            self._coverage(node, calendar, day)
        items = [value.as_(name) if name == node.target else exp.column(name, table="i")
                 for name in self.columns(node.id)]
        query = query.select(*items)
        if getattr(self, "period_scope", None) == node.id:
            start, end = self.bounds
            query = query.where(exp.and_(
                day.copy() >= exp.cast(exp.Literal.string(start.isoformat()), "date"),
                day.copy() <= exp.cast(exp.Literal.string(end.isoformat()), "date")))
        return query

    def _coverage(self, node: Any, calendar: Calendar, day: exp.Expression) -> None:
        name = self.builder.calendar_cte(calendar)
        inside = exp.Exists(this=exp.select(exp.Literal.number(1)).from_(
            exp.to_table(name).as_("c")).where(exp.Between(
                this=day.copy(), low=exp.column("start_date", table="c"),
                high=exp.column("end_date", table="c"))))
        query = exp.select(exp.Count(this=exp.Star()).as_("problems")).from_(
            exp.to_table(self.name(node.inputs[0])).as_("i")).where(
            exp.and_(day.copy().is_(exp.null()).not_(), inside.not_()))
        self.builder.checks.append(cardinality.Check(
            f"chk_{self.name(node.id)}_calendar", self.name(node.id),
            f"atlas: dates hors du calendrier {calendar.key} {calendar.version} en "
            f"{self.name(node.id)} : ", query))

    def _window(self, node: Any) -> exp.Select:
        check_window(node.function, node.id, self.dialect)
        template = parse_sql(f"SUM(x) OVER (ORDER BY y {node.frame})")
        spec = template.args.get("spec")
        if spec is None:
            raise compile_error("invalid_value", f"Cadre de fenêtre « {node.frame} » "
                                "illisible.", node.id)
        window = exp.Window(this=aggregate(node.function, node.column),
                            partition_by=[exp.column(c) for c in node.partition_by or []],
                            order=exp.Order(expressions=[ordered(c, d) for c, d in node.order_by]),
                            spec=spec)
        return self._with(node, window)

    def _kpi_ref(self, node: Any) -> exp.Select:
        key = (node.kpi, node.version)
        if key not in self.builder.references:
            document = self.builder.library.kpi(*key)
            prefix = f"r_{node.kpi.replace('-', '_')}_v{node.version}_"
            self.builder.references[key] = _Unit(self.builder, document, prefix).build()
            self.zones[node.id] = dict(self.builder.references[key].zones)
        output = self.builder.references[key]
        return exp.select(*self.columns(node.id)).from_(output.cte)

    def _metric_op(self, node: Any) -> exp.Select:
        source = node.inputs[0]
        types = self.types(source)
        values: dict[str, exp.Expression] = {}
        for metric in node.metrics:
            values[metric.name] = self.expression(metric.expr, node.id, types, dict(values))
            types[metric.name] = None
        rows = list(self.schemas[source] or {})
        rows += [m.name for m in node.metrics if m.name not in rows]
        items = [values[name].as_(name) if name in values else exp.column(name) for name in rows]
        query = exp.select(*items).from_(self.name(source))
        if node.order == "aggregate_first":
            return query
        block = node.aggregate
        query = exp.select(*block.group_by, *self._measures(block.measures)).from_(
            query.subquery("m"))
        return query.group_by(*block.group_by) if block.group_by else query


GRAIN_RANK = {"day": 0, "week": 1, "month": 2, "quarter": 3, "year": 4}
_SQL_TYPES = {"string": "text", "integer": "bigint", "decimal": "decimal(38, 10)",
              "double": "double", "boolean": "boolean", "date": "date",
              "timestamp": "timestamp"}


def _convert(column: exp.Expression, origin: str, target: str) -> exp.Expression:
    if origin == target:
        return exp.cast(column, "timestamp")
    return exp.ConvertTimezone(source_tz=exp.Literal.string(origin),
                               target_tz=exp.Literal.string(target), timestamp=column)


def _header(document: Any, dialect: str, builder: _Builder) -> str:
    product = document.data_product
    lines = [f"-- atlas: {product.id} v{product.version}, {dialect}"]
    lines += [f"-- atlas: cardinality bypass {node_id}" for node_id in builder.bypassed]
    return "\n".join(lines) + "\n"


def compile_document(document: Any, dialect: str, scope: Scope | None = None,
                     library: Library | None = None,
                     calendars: dict[str, Calendar] | None = None,
                     renames: dict[str, dict[str, str]] | None = None) -> Compiled:
    """SQL du document (concept ou KPI ; une variante se compile une fois résolue).

    `renames` lit certaines colonnes d'une source sous un autre nom dans sa table : c'est
    le canonique rebranché sur les sources d'une déclinaison (plan 0009)."""
    if dialect not in DIALECTS:
        raise ValueError(f"Dialecte inconnu : {dialect}.")
    if getattr(document, "graph", None) is None:
        raise compile_error("missing_field", "Ce document n'a pas de graphe.")
    library = library or Library()
    issues = check_document(document, library)
    if has_errors(issues):
        raise CompileError([i for i in issues if i.severity == "error"])
    scope = scope or Scope()
    document = apply_granularity(document, scope, library)
    builder = _Builder(dialect, library, calendars or {}, renames)
    output = _Unit(builder, document, scope=scope).build()
    query: exp.Query = exp.select(*output.schema).from_(output.cte)
    for check in builder.checks:
        builder.add(check.name, check.query)
    if builder.checks:
        builder.add("atlas_guard", cardinality.guard(builder.checks, dialect))
        query = cardinality.guarded(query, list(output.schema))
    # Sans copie : chaque CTE appartient au constructeur, et recopier la requête à chaque
    # ajout rendait la compilation quadratique (plan 0013, validation sous 150 ms).
    for name, cte in builder.ctes:
        query = query.with_(name, as_=cte, copy=False)
    sql = query.sql(dialect=dialect, pretty=True)
    return Compiled(dialect, _header(document, dialect, builder) + sql + "\n",
                    builder.checked, builder.bypassed, list(builder.sources.values()))


def compilability(document: Any, library: Library | None = None,
                  calendars: dict[str, Calendar] | None = None,
                  scope: Scope | None = None) -> dict[str, dict]:
    """Par dialecte : `{"status": "ok"}` ou `{"status": "not_compilable", node_id, reason}`.
    Une `CompileError` (document non compilable du tout) est levée telle quelle."""
    found: dict[str, dict] = {}
    for dialect in DIALECTS:
        try:
            compile_document(document, dialect, scope, library, calendars)
        except NotCompilable as error:
            found[dialect] = error.to_dict()
        else:
            found[dialect] = {"status": "ok"}
    return found


def reparse(sql: str, dialect: str) -> exp.Expression:
    """Relit le SQL produit dans son dialecte (critère 8)."""
    return sqlglot.parse_one(sql, read=dialect)
