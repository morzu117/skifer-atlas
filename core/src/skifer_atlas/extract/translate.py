"""Traduction d'une instruction SQL en graphe Atlas (plan 0004).

Parcours de l'intérieur vers l'extérieur, dans l'ordre logique du SQL : FROM et JOIN,
WHERE, regroupement, SELECT, QUALIFY. Chaque nœud reçoit son identifiant à sa création ;
les entrées étant toujours créées avant leurs consommateurs, la numérotation suit l'ordre
topologique et ne dépend que du texte SQL.

Atlas ne projette pas : un flux garde toutes ses colonnes, et la liste projetée par un
SELECT (`Rel.outputs`) ne sert qu'aux unions. Les colonnes d'une source sont celles que le
SQL cite ; leur type reste `TODO`.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from sqlglot import exp

from ..model.functions import ALLOWED_FUNCTIONS, function_name, is_function
from ..model.nodes import TODO
from .residues import Residue, residue

_ROUNDING = {"ROUND", "BROUND", "FLOOR", "CEIL", "CEILING", "TRUNC", "TRUNCATE"}
_NON_DETERMINISTIC_NAMES = {"NOW", "RAND", "RANDOM", "UUID", "SYSDATE", "GETDATE"}
_NON_DETERMINISTIC = (exp.CurrentTimestamp, exp.CurrentDate, exp.CurrentTime, exp.Rand)
_GRAINS = {"DAY": "day", "WEEK": "week", "MONTH": "month", "QUARTER": "quarter", "YEAR": "year"}
_COMPARISONS = {
    exp.EQ: "equals", exp.NEQ: "not_equals", exp.GT: "greater_than",
    exp.GTE: "greater_than_equal", exp.LT: "less_than", exp.LTE: "less_than_equal",
}
_FLIPPED = {
    "equals": "equals", "not_equals": "not_equals", "greater_than": "less_than",
    "greater_than_equal": "less_than_equal", "less_than": "greater_than",
    "less_than_equal": "greater_than_equal",
}
_HOW = {
    ("", ""): "inner", ("", "INNER"): "inner", ("LEFT", ""): "left", ("LEFT", "OUTER"): "left",
    ("RIGHT", ""): "right", ("RIGHT", "OUTER"): "right", ("FULL", ""): "full",
    ("FULL", "OUTER"): "full", ("", "CROSS"): "cross", ("LEFT", "ANTI"): "left_anti",
    ("", "ANTI"): "left_anti", ("LEFT", "SEMI"): "left_semi", ("", "SEMI"): "left_semi",
}

NULLS_DROP_NOTE = (
    "nulls déduit du SQL : une condition indéterminée (valeur nulle) écarte la ligne."
)
NULLS_KEEP_NOTE = "nulls déduit du SQL : la condition retient explicitement les valeurs nulles."


@dataclass
class Rel:
    """Flux produit par un nœud : colonnes connues, colonnes projetées par le SELECT."""

    node: str
    columns: list[str]
    outputs: list[str] = field(default_factory=list)
    table: str | None = None  # flux brut d'une table : ses colonnes s'étendent aux citations


@dataclass
class _Cte:
    query: Any
    scope: dict[str, _Cte]
    rel: Rel | None = None


def column_name(column: exp.Column) -> str:
    identifier = column.this
    quoted = isinstance(identifier, exp.Identifier) and identifier.quoted
    return column.name if quoted else column.name.lower()


def conjuncts(condition: exp.Expression | None) -> Iterator[exp.Expression]:
    if condition is None:
        return
    while isinstance(condition, exp.Paren):
        condition = condition.this
    if isinstance(condition, exp.And):
        yield from conjuncts(condition.left)
        yield from conjuncts(condition.right)
    else:
        yield condition


def _aggregates(expression: exp.Expression) -> list[exp.AggFunc]:
    """Agrégats de l'expression elle-même, hors fenêtres et sous-requêtes."""
    def nested(node: exp.Expression) -> bool:
        return node is not expression and isinstance(node, (exp.Window, exp.Subquery, exp.Select))
    return [node for node in expression.walk(bfs=False, prune=nested)
            if isinstance(node, exp.AggFunc)]


def _is_row_number_filter(condition: exp.Expression) -> str | None:
    """Nom de la colonne si la condition est `x = 1`."""
    if isinstance(condition, exp.EQ):
        left, right = condition.left, condition.right
        if isinstance(right, exp.Column):
            left, right = right, left
        if isinstance(left, exp.Column) and isinstance(right, exp.Literal) and right.this == "1":
            return column_name(left)
    return None


def query_of(ast: exp.Expression) -> exp.Expression | None:
    """La requête d'une instruction `SELECT`, `CREATE … AS SELECT` ou `INSERT … SELECT`."""
    body = ast.expression if isinstance(ast, (exp.Create, exp.Insert)) else ast
    return body if isinstance(body, (exp.Select, exp.SetOperation, exp.Subquery)) else None


class Translator:
    def __init__(self, dialect: str):
        self.dialect = dialect
        self.nodes: list[dict[str, Any]] = []
        self.source_columns: dict[str, list[str]] = {}
        self.source_ids: dict[str, str] = {}
        self.residues: list[Residue] = []
        self.dedup_aliases: set[str] = set()

    # --- outils ----------------------------------------------------------------------

    def add(self, node: dict[str, Any]) -> str:
        node_id = f"n{len(self.nodes) + 1:02d}"
        self.nodes.append({"id": node_id, **node})
        return node_id

    def flag(self, code: str, excerpt: exp.Expression | str | None = None, detail: str = "") -> None:
        text = excerpt.sql(dialect=self.dialect) if isinstance(excerpt, exp.Expression) else excerpt
        found = residue(code, text, detail)
        if found not in self.residues:
            self.residues.append(found)

    def neutral(self, expression: exp.Expression) -> str:
        """SQL en dialecte neutre, sans préfixe de table, identifiants en minuscules."""
        def strip(node: exp.Expression) -> exp.Expression:
            if isinstance(node, exp.Column) and not node.is_star:
                return exp.Column(this=exp.to_identifier(column_name(node)))
            return node
        return expression.copy().transform(strip).sql()

    def problems(self, expression: exp.Expression) -> bool:
        """Signale ce qu'une expression de ligne ne peut pas contenir ; vrai si bloquant."""
        blocking = False
        for node in expression.walk():
            if isinstance(node, (exp.Subquery, exp.Select)):
                self.flag("unsupported_construct", expression, "sous-requête dans une expression")
                return True
            if isinstance(node, exp.Window):
                self.flag("window_function", expression, function_name(node.this)
                          if isinstance(node.this, exp.Func) else "OVER")
                return True
            if not is_function(node) or node.find_ancestor(exp.Window) is not None:
                continue
            name = function_name(node)
            if type(node) in ALLOWED_FUNCTIONS:
                continue
            if isinstance(node, exp.AggFunc):
                self.flag("unsupported_construct", expression, f"agrégat {name} hors regroupement")
            elif name in _ROUNDING or isinstance(node, (exp.Round, exp.Floor, exp.Ceil)):
                self.flag("rounding_in_definition", expression, name)
            elif name in _NON_DETERMINISTIC_NAMES or isinstance(node, _NON_DETERMINISTIC):
                self.flag("non_deterministic", expression, name)
            elif isinstance(node, exp.Anonymous):
                # Fonction inconnue de SQLGlot, souvent propre au client : pas de nom.
                self.flag("unsupported_construct", expression, "fonction inconnue")
            else:
                self.flag("unsupported_construct", expression, f"fonction {name}")
            blocking = True
        return blocking

    # --- instruction ---------------------------------------------------------------------

    def statement(self, ast: exp.Expression) -> tuple[Rel | None, str | None]:
        """Flux de sortie de l'instruction et nom de la table créée, s'il y en a une."""
        target = None
        if isinstance(ast, (exp.Create, exp.Insert)):
            table = ast.this.this if isinstance(ast.this, exp.Schema) else ast.this
            target = table.sql(dialect=self.dialect) if isinstance(table, exp.Table) else None
        body = query_of(ast)
        if body is None:
            self.flag("unsupported_statement", detail=ast.key.upper())
            return None, target
        filtered = {name for c in body.find_all(exp.EQ) if (name := _is_row_number_filter(c))}
        numbered = {
            alias.alias.lower() for alias in body.find_all(exp.Alias)
            if isinstance(alias.this, exp.Window) and isinstance(alias.this.this, exp.RowNumber)
        }
        self.dedup_aliases = filtered & numbered
        return self.query(body, {}), target

    def query(self, node: exp.Expression, ctes: dict[str, _Cte]) -> Rel | None:
        ctes = self.with_ctes(node, ctes)
        if isinstance(node, exp.Subquery):
            return self.query(node.this, ctes)
        if isinstance(node, exp.Union):
            return self.union(node, ctes)
        if isinstance(node, exp.Select):
            return self.select(node, ctes)
        self.flag("unsupported_construct", node, node.key.upper())
        return None

    def with_ctes(self, node: exp.Expression, ctes: dict[str, _Cte]) -> dict[str, _Cte]:
        with_ = node.args.get("with_")
        if not with_:
            return ctes
        scope = dict(ctes)
        for cte in with_.expressions:
            scope[cte.alias.lower()] = _Cte(cte.this, dict(scope))
        return scope

    def relation(self, expression: exp.Expression, ctes: dict[str, _Cte]) -> Rel | None:
        if expression.args.get("pivots"):
            pivot = expression.args["pivots"][0]
            self.flag("unsupported_construct", expression,
                      "UNPIVOT" if pivot.args.get("unpivot") else "PIVOT")
            return None
        if isinstance(expression, exp.Table) and not expression.db:
            cte = ctes.get(expression.name.lower())
            if cte is not None:
                if cte.rel is None:
                    cte.rel = self.query(cte.query, cte.scope)
                return cte.rel
        if isinstance(expression, exp.Table) and isinstance(expression.this, exp.Identifier):
            return self.source(expression)
        if isinstance(expression, exp.Subquery):
            return self.query(expression.this, ctes)
        self.flag("unsupported_construct", expression, expression.key.upper())
        return None

    def source(self, table: exp.Table) -> Rel:
        parts = [part.name for part in table.parts]
        if len(parts) == 1:
            self.flag("unqualified_table", table)
            parts = [TODO, *parts]
        fqn = ".".join(parts)
        if fqn not in self.source_ids:
            self.source_columns[fqn] = []
            self.source_ids[fqn] = self.add({
                "type": "source", "platform": self.dialect, "table": fqn, "owner": TODO,
                "columns": self.source_columns[fqn],
            })
        return Rel(self.source_ids[fqn], self.source_columns[fqn], table=fqn)

    # --- SELECT --------------------------------------------------------------------------

    def select(self, select: exp.Select, ctes: dict[str, _Cte]) -> Rel | None:
        from_ = select.args.get("from_")
        if from_ is None:
            self.flag("unsupported_construct", select, "SELECT sans FROM")
            return None
        if select.args.get("laterals"):
            self.flag("unsupported_construct", select.args["laterals"][0], "LATERAL")
            return None
        joins = select.args.get("joins") or []
        rels: list[tuple[str, Rel]] = []
        for expression in [from_.this, *(join.this for join in joins)]:
            rel = self.relation(expression, ctes)
            if rel is None:
                return None
            rels.append((expression.alias_or_name.lower(), rel))
        items = select.expressions
        if any(isinstance(item, exp.Star) or (isinstance(item, exp.Column) and item.is_star)
               for item in items):
            self.flag("unsupported_construct", select, "SELECT *")
            return None
        aliases = {item.alias.lower() for item in items if item.alias}
        self.cite(select, rels, aliases)

        alias, rel = rels[0]
        left = {alias}
        for (alias, right), join in zip(rels[1:], joins, strict=True):
            rel = self.join(rel, left, alias, right, join, rels)
            if rel is None:
                return None
            left.add(alias)

        for condition in conjuncts(select.args["where"].this if select.args.get("where") else None):
            if _is_row_number_filter(condition) in self.dedup_aliases:
                continue  # dédoublonnage déjà placé là où ROW_NUMBER est calculé
            rel = self.filter(rel, condition)

        if select.args.get("qualify"):
            rel = self.qualify(rel, select.args["qualify"].this)
        if select.args.get("group") or any(_aggregates(item) for item in items):
            rel = self.aggregate(rel, select)
        else:
            rel = self.projection(rel, items)
        if rel is not None:
            if select.args.get("limit"):
                self.flag("unsupported_construct", select.args["limit"], "LIMIT")
            if select.args.get("distinct"):
                self.flag("unsupported_construct", select, "SELECT DISTINCT")
            if select.args.get("order"):
                self.flag("ignored_clause", select.args["order"], "ORDER BY")
        return rel

    def cite(self, select: exp.Select, rels: list[tuple[str, Rel]], aliases: set[str]) -> None:
        """Colonnes citées dans la portée du SELECT, ajoutées aux sources concernées dans
        l'ordre du texte SQL (l'ordre de l'AST varie d'un dialecte à l'autre)."""
        for column in sorted(select.find_all(exp.Column), key=_position):
            if column.is_star or column.find_ancestor(exp.Select) is not select:
                continue
            name = column_name(column)
            if name in self.dedup_aliases:
                continue
            if not column.table and name in aliases and not _within(column, select.expressions):
                continue  # alias du SELECT cité dans GROUP BY, HAVING, QUALIFY ou ORDER BY
            rel = self.owner(column, rels)
            if rel is not None and rel.table is not None and name not in rel.columns:
                rel.columns.append(name)

    def owner(self, column: exp.Column, rels: list[tuple[str, Rel]]) -> Rel | None:
        if column.table:
            qualifier = column.table.lower()
            return next((rel for alias, rel in rels if alias == qualifier), None)
        name = column_name(column)
        known = [rel for _, rel in rels if name in rel.columns]
        tables = [rel for _, rel in rels if rel.table is not None]
        candidates = known or tables
        if len(candidates) > 1 or (not known and not tables):
            self.flag("ambiguous_column_origin", column)
        return candidates[0] if candidates else None

    def join(self, rel: Rel, left: set[str], alias: str, right: Rel, join: exp.Join,
             rels: list[tuple[str, Rel]]) -> Rel | None:
        side = (join.args.get("side") or "").upper()
        kind = (join.args.get("kind") or "").upper()
        how = _HOW.get((side, kind))
        if how is None:
            self.flag("unsupported_construct", join, f"jointure {side} {kind}".strip())
            return None
        keys: list[list[str]] = []
        extra: list[exp.Expression] = []
        for identifier in join.args.get("using") or []:
            name = identifier.name.lower()
            for side_rel in (rel, right):
                if side_rel.table is not None and name not in side_rel.columns:
                    side_rel.columns.append(name)
            keys.append([name, name])
        aliases = dict(rels)
        for condition in conjuncts(join.args.get("on")):
            if isinstance(condition, exp.EQ) and all(
                isinstance(side_expr, exp.Column) for side_expr in (condition.left, condition.right)
            ):
                first, second = condition.left, condition.right
                owners = [_alias_of(self.owner(c, rels), aliases) for c in (first, second)]
                if owners[0] in left and owners[1] == alias:
                    keys.append([column_name(first), column_name(second)])
                    continue
                if owners[1] in left and owners[0] == alias:
                    keys.append([column_name(second), column_name(first)])
                    continue
            extra.append(condition)
        if extra and how != "inner":
            self.flag("unsupported_construct", join, "condition de jointure non équi")
            return None
        if not keys and how != "cross":
            self.flag("unsupported_construct", join, "jointure sans clé")
            return None
        node = self.add({
            "type": "join", "inputs": {"left": rel.node, "right": right.node}, "how": how,
            "keys": keys, "cardinality": TODO, "check": "required",
        })
        self.flag("cardinality_unknown", join)
        columns = list(rel.columns)
        if how not in ("left_anti", "left_semi"):
            columns += [c for c in right.columns if c not in columns]
        joined = Rel(node, columns)
        for condition in extra:
            joined = self.filter(joined, condition)
        return joined

    # --- filtres ---------------------------------------------------------------------------

    def condition(self, condition: exp.Expression) -> Any | None:
        """Condition Skifer `col:op:val` si possible, sinon `{expr: SQL}` ; None si refusée."""
        simple = self.simple_condition(condition)
        if simple is not None:
            return simple
        if self.problems(condition):
            return None
        return {"expr": self.neutral(condition)}

    def simple_condition(self, condition: exp.Expression) -> str | None:
        negated = isinstance(condition, exp.Not)
        inner = condition.this if negated else condition
        while isinstance(inner, exp.Paren):
            inner = inner.this
        if type(inner) in _COMPARISONS and not negated:
            column, value, op = inner.left, inner.right, _COMPARISONS[type(inner)]
            if isinstance(value, exp.Column) and isinstance(column, exp.Literal):
                column, value, op = value, column, _FLIPPED[op]
            if isinstance(column, exp.Column) and _plain(value):
                return f"{column_name(column)}:{op}:{value.this}"
            return None
        if isinstance(inner, exp.Is) and isinstance(inner.this, exp.Column) and isinstance(
            inner.expression, exp.Null
        ):
            return f"{column_name(inner.this)}:{'is_not_null' if negated else 'is_null'}"
        if isinstance(inner, exp.In) and isinstance(inner.this, exp.Column) and not inner.args.get(
            "query"
        ):
            values = inner.expressions
            if values and all(_plain(v) and "," not in v.this and ";" not in v.this for v in values):
                listed = ",".join(v.this for v in values)
                return f"{column_name(inner.this)}:{'not_in' if negated else 'in'}:{listed}"
            return None
        if isinstance(inner, exp.Like) and isinstance(inner.this, exp.Column) and _plain(
            inner.expression
        ):
            op = "not_like" if negated else "like"
            return f"{column_name(inner.this)}:{op}:{inner.expression.this}"
        if isinstance(inner, exp.Between) and isinstance(inner.this, exp.Column):
            low, high = inner.args.get("low"), inner.args.get("high")
            if all(_plain(v) and "," not in v.this for v in (low, high)):
                op = "not_between" if negated else "between"
                return f"{column_name(inner.this)}:{op}:{low.this},{high.this}"
        return None

    def filter(self, rel: Rel, condition: exp.Expression) -> Rel:
        translated = self.condition(condition)
        if translated is None:
            return rel
        keeps_nulls = isinstance(condition, exp.Or) and any(
            isinstance(c, exp.Is) and isinstance(c.expression, exp.Null)
            for c in condition.find_all(exp.Is) if c.find_ancestor(exp.Not) is None
        )
        node = self.add({
            "type": "filter", "note": NULLS_KEEP_NOTE if keeps_nulls else NULLS_DROP_NOTE,
            "inputs": [rel.node], "condition": translated,
            "nulls": "keep" if keeps_nulls else "drop",
        })
        return Rel(node, list(rel.columns))

    # --- dédoublonnage ---------------------------------------------------------------------

    def deduplicate(self, rel: Rel, window: exp.Window) -> Rel:
        keys = [column_name(c) for c in window.args.get("partition_by") or []
                if isinstance(c, exp.Column)]
        order = window.args.get("order")
        order_by = [
            [column_name(o.this), "desc" if o.args.get("desc") else "asc"]
            for o in (order.expressions if order else []) if isinstance(o.this, exp.Column)
        ]
        if not keys or not order_by:
            self.flag("window_function", window, "ROW_NUMBER")
            return rel
        node = self.add({
            "type": "deduplicate", "inputs": [rel.node], "keys": keys,
            "keep": {"order_by": order_by},
        })
        return Rel(node, list(rel.columns))

    def qualify(self, rel: Rel, condition: exp.Expression) -> Rel:
        if isinstance(condition, exp.EQ):
            window, value = condition.left, condition.right
            if isinstance(value, exp.Window):
                window, value = value, window
            if (isinstance(window, exp.Window) and isinstance(window.this, exp.RowNumber)
                    and isinstance(value, exp.Literal) and value.this == "1"):
                return self.deduplicate(rel, window)
        self.flag("window_function", condition, "QUALIFY")
        return rel

    # --- projection --------------------------------------------------------------------------

    def projection(self, rel: Rel, items: list[exp.Expression]) -> Rel:
        outputs: list[str] = []
        computes: list[tuple[str, exp.Expression]] = []
        for index, item in enumerate(items, start=1):
            expression = item.unalias()
            if (isinstance(expression, exp.Window) and isinstance(expression.this, exp.RowNumber)
                    and item.alias.lower() in self.dedup_aliases):
                rel = self.deduplicate(rel, expression)
                continue
            if isinstance(expression, exp.Column):
                name = item.alias.lower() if item.alias else column_name(expression)
                if name != column_name(expression):
                    computes.append((name, expression))
                outputs.append(name)
                continue
            name = item.alias.lower() if item.alias else ""
            if not name:
                name = f"col_{index}"
                self.flag("unnamed_expression", item)
            computes.append((name, expression))
            outputs.append(name)
        # Une colonne qui en remplace une autre passe en dernier : les autres expressions
        # lisent encore la valeur d'origine, comme en SQL.
        ordered = [c for c in computes if c[0] not in rel.columns]
        ordered += [c for c in computes if c[0] in rel.columns]
        for name, expression in ordered:
            rel = self.compute(rel, name, expression)
        rel.outputs = outputs
        return rel

    def temporal(self, expression: exp.Expression) -> dict[str, Any] | None:
        """Nœud temporel équivalent à une expression de date, s'il y en a un."""
        if isinstance(expression, (exp.TimestampTrunc, exp.DateTrunc)) and isinstance(
            expression.this, exp.Column
        ):
            unit = expression.args.get("unit")
            grain = _GRAINS.get((unit.name if unit is not None else "").upper())
            if grain:
                return {"operation": "period", "column": column_name(expression.this),
                        "grain": grain}
        if isinstance(expression, exp.TsOrDsToDate) and isinstance(expression.this, exp.Column):
            node = {"operation": "to_date", "column": column_name(expression.this),
                    "timezone": TODO}
            fmt = expression.args.get("format")
            if isinstance(fmt, exp.Literal):
                node["format"] = fmt.this
            return node
        if (isinstance(expression, exp.Cast) and isinstance(expression.this, exp.Column)
                and expression.to.is_type("date")):
            return {"operation": "to_date", "column": column_name(expression.this),
                    "timezone": TODO}
        if isinstance(expression, exp.AtTimeZone) and isinstance(expression.this, exp.Cast):
            # FROM_UTC_TIMESTAMP(col, zone) : SQLGlot le lit `CAST(col AS TIMESTAMP) AT TIME ZONE`.
            column, zone = expression.this.this, expression.args.get("zone")
            if isinstance(column, exp.Column) and isinstance(zone, exp.Literal):
                return {"operation": "convert_timezone", "column": column_name(column),
                        "to": zone.this, "note": "Fuseau d'origine dans le SQL : UTC."}
        if isinstance(expression, exp.ConvertTimezone):
            column = expression.args.get("timestamp")
            target, origin = expression.args.get("target_tz"), expression.args.get("source_tz")
            if isinstance(column, exp.Column) and isinstance(target, exp.Literal):
                node = {"operation": "convert_timezone", "column": column_name(column),
                        "to": target.this}
                if isinstance(origin, exp.Literal):
                    node["note"] = f"Fuseau d'origine dans le SQL : {origin.this}."
                return node
        return None

    def compute(self, rel: Rel, name: str, expression: exp.Expression) -> Rel:
        temporal = self.temporal(expression)
        if temporal is not None:
            note = temporal.pop("note", None)
            node: dict[str, Any] = {"type": "temporal"}
            if note:
                node["note"] = note
            node.update(inputs=[rel.node], operation=temporal.pop("operation"),
                        column=temporal.pop("column"), target=name, **temporal)
        else:
            if self.problems(expression):
                return rel
            node = {"type": "compute", "inputs": [rel.node], "column": name,
                    "expr": self.neutral(expression)}
        node_id = self.add(node)
        columns = rel.columns + ([name] if name not in rel.columns else [])
        return Rel(node_id, columns, list(rel.outputs))

    # --- regroupement ------------------------------------------------------------------------

    def aggregate(self, rel: Rel, select: exp.Select) -> Rel | None:
        items = select.expressions
        by_alias = {item.alias.lower(): item.unalias() for item in items if item.alias}
        group = select.args.get("group")
        group_by: list[str] = []
        before: list[tuple[str, exp.Expression]] = []  # calculs de ligne avant regroupement
        for index, expression in enumerate(group.expressions if group else []):
            name = None
            if isinstance(expression, exp.Literal) and expression.is_int:
                item = items[int(expression.this) - 1]
                expression, name = item.unalias(), item.alias_or_name.lower()
            elif (isinstance(expression, exp.Column) and not expression.table
                  and column_name(expression) in by_alias
                  and column_name(expression) not in rel.columns):
                name = column_name(expression)
                expression = by_alias[name]
            if isinstance(expression, exp.Column):
                group_by.append(column_name(expression))
                continue
            if name is None:
                name = next((i.alias.lower() for i in items
                             if i.alias and i.unalias() == expression), f"group_{index + 1}")
            before.append((name, expression))
            group_by.append(name)

        measures: list[list[str]] = []
        measure_of: dict[str, str] = {}

        def measure(aggregate: exp.AggFunc, target: str) -> str | None:
            key = aggregate.sql()
            if key in measure_of:
                return measure_of[key]
            function = _aggregate_function(aggregate)
            argument = aggregate.this
            if isinstance(argument, exp.Distinct):
                argument = argument.expressions[0] if argument.expressions else None
            if function is None or argument is None:
                self.flag("unsupported_construct", aggregate, f"agrégat {function_name(aggregate)}")
                return None
            if isinstance(argument, exp.Star):
                source = "*"
            elif isinstance(argument, exp.Column):
                source = column_name(argument)
            else:
                source = f"{target}__arg"
                before.append((source, argument))
            measures.append([source, target, function])
            measure_of[key] = target
            return target

        metrics: list[dict[str, str]] = []
        after: list[tuple[str, exp.Expression]] = []
        outputs: list[str] = []
        for index, item in enumerate(items, start=1):
            expression = item.unalias()
            name = item.alias.lower() if item.alias else (
                column_name(expression) if isinstance(expression, exp.Column) else f"col_{index}"
            )
            if not item.alias and not isinstance(expression, exp.Column):
                self.flag("unnamed_expression", item)
            # La position compte pour les unions : une colonne refusée garde sa place dans
            # `outputs` sans entrer dans les colonnes du flux.
            outputs.append(name)
            if isinstance(expression, exp.Column) and column_name(expression) in group_by:
                if name != column_name(expression):
                    after.append((name, expression))
            elif name in group_by:
                pass  # expression regroupée, calculée avant le regroupement
            elif expression.find(exp.Window, exp.Subquery):
                self.problems(expression)
            elif isinstance(expression, exp.AggFunc):
                measure(expression, name)
            elif _aggregates(expression):
                rewritten = self._over_measures(expression, name, measure)
                if rewritten is not None and not self.problems(rewritten):
                    metrics.append({"name": name, "expr": self.neutral(rewritten)})
            elif all(column_name(c) in group_by for c in expression.find_all(exp.Column)):
                after.append((name, expression))
            else:
                self.flag("unsupported_construct", expression, "colonne hors GROUP BY")

        having: list[Any] = []
        for condition in conjuncts(select.args["having"].this if select.args.get("having") else None):
            rewritten = self._over_measures(condition, "having", measure)
            translated = self.condition(rewritten) if rewritten is not None else None
            if translated is not None:
                having.append(translated)

        if not measures:
            self.flag("unsupported_construct", select, "regroupement sans agrégat")
            return None
        for name, expression in before:
            rel = self.compute(rel, name, expression)
        node: dict[str, Any] = {"type": "aggregate", "inputs": [rel.node], "group_by": group_by,
                                "measures": measures}
        if having:
            node["having"] = having
        result = Rel(self.add(node), [*group_by, *(m[1] for m in measures)])
        if metrics:
            result = Rel(self.add({"type": "metric_op", "inputs": [result.node],
                                   "order": "aggregate_first", "metrics": metrics}),
                         [*result.columns, *(m["name"] for m in metrics)])
        for name, expression in after:
            result = self.compute(result, name, expression)
        result.outputs = outputs
        return result

    def _over_measures(self, expression: exp.Expression, name: str, measure: Any) -> Any:
        """L'expression où chaque agrégat est remplacé par la mesure correspondante."""
        copy = expression.copy()
        for index, aggregate in enumerate(_aggregates(copy), start=1):
            target = measure(aggregate, f"{name}__{index}")
            if target is None:
                return None
            aggregate.replace(exp.Column(this=exp.to_identifier(target)))
        return copy

    # --- UNION -------------------------------------------------------------------------------

    def union(self, union: exp.Union, ctes: dict[str, _Cte]) -> Rel | None:
        distinct = bool(union.args.get("distinct"))
        branches: list[exp.Expression] = []

        def flatten(node: exp.Expression) -> None:
            if (isinstance(node, exp.Union) and bool(node.args.get("distinct")) == distinct
                    and not node.args.get("with_")):
                flatten(node.this)
                flatten(node.expression)
            else:
                branches.append(node)

        flatten(union.this)
        flatten(union.expression)
        rels = [self.query(branch, ctes) for branch in branches]
        if any(rel is None for rel in rels):
            return None
        names = rels[0].outputs
        if any(len(rel.outputs) != len(names) for rel in rels) or len(
            {rel.node for rel in rels}
        ) != len(rels):
            self.flag("unsupported_construct", union, "UNION")
            return None
        columns = [
            {"name": name, "from": {rel.node: rel.outputs[index] for rel in rels}}
            for index, name in enumerate(names)
            if all(rel.outputs[index] in rel.columns for rel in rels)
        ]
        node = self.add({
            "type": "union", "inputs": [rel.node for rel in rels],
            "mode": "distinct" if distinct else "all", "columns": columns,
        })
        kept = [column["name"] for column in columns]
        return Rel(node, list(kept), list(kept))


def _position(column: exp.Column) -> tuple[int, int]:
    meta = column.this.meta if isinstance(column.this, exp.Identifier) else {}
    return meta.get("line", 0), meta.get("col", 0)


def _within(column: exp.Column, items: list[exp.Expression]) -> bool:
    node: exp.Expression | None = column
    while node is not None:
        if any(node is item for item in items):
            return True
        node = node.parent
    return False


def _alias_of(rel: Rel | None, aliases: dict[str, Rel]) -> str | None:
    return next((alias for alias, candidate in aliases.items() if candidate is rel), None)


def _plain(value: Any) -> bool:
    """Littéral recopiable tel quel dans une condition `col:op:val`."""
    return (
        isinstance(value, exp.Literal) and value.this != "" and value.this == value.this.strip()
        and "\n" not in value.this
    )


def _aggregate_function(aggregate: exp.AggFunc) -> str | None:
    distinct = isinstance(aggregate.this, exp.Distinct)
    if isinstance(aggregate, exp.Count):
        return "count_distinct" if distinct else "count"
    if isinstance(aggregate, exp.Sum):
        return "sum_distinct" if distinct else "sum"
    if distinct:
        return None
    for kind, name in (
        (exp.Avg, "avg"), (exp.Min, "min"), (exp.Max, "max"), (exp.ApproxDistinct,
                                                             "approx_count_distinct"),
        (exp.Stddev, "stddev"), (exp.StddevSamp, "stddev"), (exp.Variance, "variance"),
        (exp.VariancePop, "variance"),
    ):
        if isinstance(aggregate, kind):
            return name
    return None
