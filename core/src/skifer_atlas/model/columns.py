"""Propagation des colonnes nœud par nœud (plan 0002).

Chaque nœud calcule son schéma de sortie à partir de ses entrées ; toute colonne citée
doit exister en entrée. `columns_at` alimente l'onglet « Colonnes en sortie » et les
listes de clés de l'éditeur (10.3).

Une colonne est « datée » (`zoned`) quand son fuseau est explicite : colonne `date` de
source, ou cible d'un `to_date` ou d'un `convert_timezone`. Seule une colonne datée peut
être découpée en périodes ; sinon la conversion de fuseau serait implicite.
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass
from typing import Any

import sqlglot

from .errors import Issue
from .functions import expression_problems, infer_type, parse_sql, referenced_columns
from .graph import GraphView, Library, node_inputs
from .nodes import TODO

_COUNT_FUNCTIONS = {"count", "count_distinct", "approx_count_distinct"}
_DOUBLE_FUNCTIONS = {"avg", "stddev", "variance"}


@dataclass(frozen=True)
class Column:
    name: str
    type: str | None
    zoned: bool | None = False  # None : type encore à compléter (brouillon)


Schema = dict[str, Column]


def _aggregate_type(function: str, source: Column | None) -> str | None:
    if function in _COUNT_FUNCTIONS:
        return "integer"
    if function in _DOUBLE_FUNCTIONS:
        return "double"
    return source.type if source else None


class _Propagation:
    def __init__(self, document: Any, library: Library, stack: tuple):
        self.document = document
        self.library = library
        self.stack = stack
        self.view = GraphView(document.graph)
        self.schemas: dict[str, Schema | None] = {}
        self.issues: list[Issue] = []

    # --- outils ---

    def need(self, schema: Schema, name: str, node_id: str, *path: str | int) -> Column | None:
        if name in schema:
            return schema[name]
        close = difflib.get_close_matches(name, list(schema), n=3, cutoff=0.6)
        hint = f" Voulez-vous dire : {', '.join(close)} ?" if close else ""
        self.issues.append(Issue(
            self.view.path(node_id, *path), node_id, "unknown_column",
            f"Colonne « {name} » absente en entrée de {node_id}.{hint}",
        ))
        return None

    def expression(self, text: str, schema: Schema, node_id: str, *path: str | int) -> str | None:
        """Contrôle une expression SQL ; renvoie son type inféré."""
        try:
            tree = parse_sql(text)
        except sqlglot.errors.SqlglotError:
            return None  # déjà signalé à la validation de schéma (plan 0001)
        for problem in expression_problems(tree):
            self.issues.append(Issue(
                self.view.path(node_id, *path), node_id, problem.code, problem.message
            ))
        for name in referenced_columns(tree):
            self.need(schema, name, node_id, *path)
        return infer_type(tree, {c.name: c.type for c in schema.values()})

    def condition(self, condition: Any, schema: Schema, node_id: str, *path: str | int) -> None:
        if isinstance(condition, str):
            self.need(schema, condition.split(":", 1)[0], node_id, *path)
        else:
            self.expression(condition.expr, schema, node_id, *path, "expr")

    def measures(self, measures: list, schema: Schema, node_id: str, *path: str | int) -> Schema:
        out: Schema = {}
        for index, (source, target, function) in enumerate(measures):
            column = None if source == "*" else self.need(schema, source, node_id, *path, index, 0)
            out[target] = Column(target, _aggregate_type(function, column))
        return out

    # --- nœuds ---

    def run(self) -> None:
        for node_id in self.view.topological_order():
            node = self.view.by_id[node_id]
            inputs = [self.schemas[s] for s in node_inputs(node)]
            if any(schema is None for schema in inputs):
                self.schemas[node_id] = None
                continue
            self.schemas[node_id] = getattr(self, f"_{node.type}")(node, *inputs)

    def _source(self, node: Any) -> Schema:
        return {
            c.name: Column(c.name, None, None) if c.type == TODO
            else Column(c.name, c.type, c.type == "date")
            for c in node.columns
        }

    def _filter(self, node: Any, schema: Schema) -> Schema:
        self.condition(node.condition, schema, node.id, "condition")
        return dict(schema)

    def _deduplicate(self, node: Any, schema: Schema) -> Schema:
        for index, key in enumerate(node.keys):
            self.need(schema, key, node.id, "keys", index)
        for index, (column, _direction) in enumerate(node.keep.order_by):
            self.need(schema, column, node.id, "keep", "order_by", index, 0)
        return dict(schema)

    def _join(self, node: Any, left: Schema, right: Schema) -> Schema:
        for index, (left_key, right_key) in enumerate(node.keys):
            self.need(left, left_key, node.id, "keys", index, 0)
            self.need(right, right_key, node.id, "keys", index, 1)
        if node.how in ("left_anti", "left_semi"):
            return dict(left)
        merged = {name for name, other in node.keys if name == other}
        clashes = [name for name in right if name in left and name not in merged]
        if clashes:
            self.issues.append(Issue(
                self.view.path(node.id), node.id, "ambiguous_column",
                f"Colonnes présentes des deux côtés de la jointure : {', '.join(clashes)}. "
                "Les renommer en amont ou les joindre comme clés égales.",
            ))
        out = dict(left)
        for name, column in right.items():
            out.setdefault(name, column)
        return out

    def _union(self, node: Any, *schemas: Schema) -> Schema:
        by_input = dict(zip(node.inputs, schemas, strict=True))
        out: Schema = {}
        for index, column in enumerate(node.columns):
            found: list[Column] = []
            for source_id, source_column in column.source.items():
                if source_id not in by_input:
                    self.issues.append(Issue(
                        self.view.path(node.id, "columns", index, "from", source_id), node.id,
                        "unknown_input", f"{source_id} n'est pas une entrée de cette union.",
                    ))
                    continue
                hit = self.need(by_input[source_id], source_column, node.id,
                                "columns", index, "from", source_id)
                if hit:
                    found.append(hit)
            types = {c.type for c in found}
            out[column.name] = Column(
                column.name,
                types.pop() if len(types) == 1 else None,
                bool(found) and all(c.zoned for c in found),
            )
        return out

    def _compute(self, node: Any, schema: Schema) -> Schema:
        inferred = self.expression(node.expr, schema, node.id, "expr")
        out = dict(schema)
        out[node.column] = Column(node.column, node.column_type or inferred)
        return out

    def _aggregate(self, node: Any, schema: Schema) -> Schema:
        out: Schema = {}
        for index, name in enumerate(node.group_by):
            column = self.need(schema, name, node.id, "group_by", index)
            out[name] = column or Column(name, None)
        out.update(self.measures(node.measures, schema, node.id, "measures"))
        for index, condition in enumerate(node.having or []):
            self.condition(condition, out, node.id, "having", index)
        return out

    def _temporal(self, node: Any, schema: Schema) -> Schema:
        column = self.need(schema, node.column, node.id, "column")
        out = dict(schema)
        if node.operation == "convert_timezone":
            out[node.target] = Column(node.target, "timestamp", True)
        elif node.operation == "to_date":
            out[node.target] = Column(node.target, "date", True)
        elif node.operation == "period":
            if column is not None and column.zoned is False:
                self.issues.append(Issue(
                    self.view.path(node.id, "column"), node.id, "implicit_timezone_conversion",
                    f"« {node.column} » ({column.type}) n'a pas de fuseau explicite : ajouter un "
                    "nœud temporel to_date ou convert_timezone en amont (cas de la commande "
                    "passée en fin de journée).",
                ))
            out[node.target] = Column(node.target, "date", True)
        else:
            for index, (name, _direction) in enumerate(node.order_by):
                self.need(schema, name, node.id, "order_by", index, 0)
            for index, name in enumerate(node.partition_by or []):
                self.need(schema, name, node.id, "partition_by", index)
            out[node.target] = Column(node.target, _aggregate_type(node.function, column))
        return out

    def _kpi_ref(self, node: Any) -> Schema | None:
        referenced = self.library.kpi(node.kpi, node.version)
        key = (node.kpi, node.version)
        if referenced is None or key in self.stack:
            return None  # signalé par les contrôles structurels
        inner = _Propagation(referenced, self.library, (*self.stack, key))
        if not inner.view.is_dag():
            return None
        inner.run()
        schema = inner.schemas.get(referenced.graph.output)
        if schema is None or node.columns is None:
            return schema
        out: Schema = {}
        for index, name in enumerate(node.columns):
            column = self.need(schema, name, node.id, "columns", index)
            if column:
                out[name] = column
        return out

    def _metric_op(self, node: Any, schema: Schema) -> Schema:
        rows = dict(schema)
        for index, metric in enumerate(node.metrics):
            kind = self.expression(metric.expr, rows, node.id, "metrics", index, "expr")
            rows[metric.name] = Column(metric.name, kind)
        if node.order == "aggregate_first":
            return rows
        out: Schema = {}
        for index, name in enumerate(node.aggregate.group_by):
            out[name] = self.need(rows, name, node.id, "aggregate", "group_by", index) or Column(
                name, None
            )
        out.update(self.measures(node.aggregate.measures, rows, node.id, "aggregate", "measures"))
        return out


def propagate(
    document: Any, library: Library | None = None
) -> tuple[dict[str, Schema | None], list[Issue]]:
    """Schéma de sortie de chaque nœud et erreurs de colonnes. Suppose un DAG."""
    key = (document.data_product.id, getattr(document.data_product, "version", None))
    propagation = _Propagation(document, library or Library(), (key,))
    if not propagation.view.is_dag():
        return {}, []
    propagation.run()
    return propagation.schemas, propagation.issues


def columns_at(
    document: Any, node_id: str, library: Library | None = None
) -> list[tuple[str, str | None]] | None:
    """Colonnes en sortie d'un nœud, ou None si elles ne sont pas connues."""
    schema = propagate(document, library)[0].get(node_id)
    return None if schema is None else [(c.name, c.type) for c in schema.values()]
