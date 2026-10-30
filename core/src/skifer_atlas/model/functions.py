"""Expressions SQL des nœuds : liste blanche des fonctions, colonnes citées, type inféré.

Les expressions sont analysées par SQLGlot en dialecte neutre. Seules les fonctions
déterministes de la liste blanche sont admises (plan 0002) ; l'étendre passe par une
modification du plan.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlglot
from sqlglot import exp

# Fonctions admises. Arithmétique, comparaisons et logique ne sont pas des fonctions
# pour SQLGlot (exp.Binary, exp.In, exp.Not…) : elles passent sans liste.
ALLOWED_FUNCTIONS: dict[type[exp.Func], str] = {
    exp.Coalesce: "COALESCE",
    exp.Nullif: "NULLIF",
    exp.Case: "CASE",
    exp.If: "IF",
    exp.Cast: "CAST",
    exp.TryCast: "TRY_CAST",
    exp.Upper: "UPPER",
    exp.Lower: "LOWER",
    exp.Trim: "TRIM",
    exp.Substring: "SUBSTRING",
    exp.Abs: "ABS",
}
ALLOWED_NAMES = ", ".join(sorted(set(ALLOWED_FUNCTIONS.values())))

NUMERIC_RANK = {"integer": 0, "decimal": 1, "double": 2}
_CAST_TYPES = {
    "TEXT": "string", "VARCHAR": "string", "CHAR": "string", "NVARCHAR": "string",
    "NCHAR": "string",
    "TINYINT": "integer", "SMALLINT": "integer", "INT": "integer", "BIGINT": "integer",
    "DECIMAL": "decimal", "BIGDECIMAL": "decimal",
    "FLOAT": "double", "DOUBLE": "double",
    "BOOLEAN": "boolean", "DATE": "date",
    "TIMESTAMP": "timestamp", "TIMESTAMPTZ": "timestamp", "TIMESTAMPLTZ": "timestamp",
    "TIMESTAMPNTZ": "timestamp", "DATETIME": "timestamp",
}
_BOOLEAN_NODES = (
    exp.Predicate, exp.Connector, exp.Not, exp.In, exp.Between, exp.Is, exp.Like, exp.ILike,
    exp.Boolean,
)


@dataclass(frozen=True)
class ExpressionProblem:
    code: str  # forbidden_function | subquery_in_expr | invalid_value
    message: str


def parse_sql(text: str) -> exp.Expression:
    """Analyse en dialecte neutre ; lève sqlglot.errors.SqlglotError si illisible."""
    tree = sqlglot.parse_one(text)
    if tree is None:
        raise sqlglot.errors.ParseError("expression vide")
    return tree


def function_name(func: exp.Func) -> str:
    return (func.name if isinstance(func, exp.Anonymous) else func.sql_name()).upper()


def expression_problems(tree: exp.Expression) -> list[ExpressionProblem]:
    problems: list[ExpressionProblem] = []
    for node in tree.walk():
        if isinstance(node, (exp.Subquery, exp.Select)):
            return [ExpressionProblem(
                "subquery_in_expr", "Les sous-requêtes sont interdites dans une expression."
            )]
        if isinstance(node, exp.Window):
            problems.append(ExpressionProblem(
                "forbidden_function",
                "Les fonctions de fenêtre sont interdites ici : utiliser un nœud temporel "
                "« window ».",
            ))
        elif isinstance(node, exp.AggFunc) and node.find_ancestor(exp.Window) is None:
            problems.append(ExpressionProblem(
                "forbidden_function",
                f"« {function_name(node)} » est une agrégation : utiliser un nœud d'agrégation.",
            ))
        elif (
            isinstance(node, exp.Func)
            and type(node) not in ALLOWED_FUNCTIONS
            and node.find_ancestor(exp.Window) is None
        ):
            problems.append(ExpressionProblem(
                "forbidden_function",
                f"Fonction « {function_name(node)} » non admise (non déterministe ou hors "
                f"liste blanche). Fonctions admises : {ALLOWED_NAMES}.",
            ))
    return problems


def referenced_columns(tree: exp.Expression) -> list[str]:
    """Colonnes citées, dans l'ordre de première apparition."""
    names: list[str] = []
    for column in tree.find_all(exp.Column):
        if column.name and column.name not in names:
            names.append(column.name)
    return names


def normalized_sql(text: str) -> str:
    """Forme canonique d'une expression, pour la normalisation et l'empreinte."""
    return parse_sql(text).sql(normalize=True, pretty=False)


def _widest(types: list[str | None]) -> str | None:
    numeric = [t for t in types if t in NUMERIC_RANK]
    if not numeric or len(numeric) != len(types):
        return None
    return max(numeric, key=NUMERIC_RANK.__getitem__)


def infer_type(tree: exp.Expression, columns: dict[str, str | None]) -> str | None:
    """Type d'une expression d'après les types des colonnes ; None si incertain."""
    if isinstance(tree, exp.Paren):
        return infer_type(tree.this, columns)
    if isinstance(tree, exp.Column):
        return columns.get(tree.name)
    if isinstance(tree, exp.Literal):
        if tree.is_string:
            return "string"
        return "integer" if tree.this.lstrip("-").isdigit() else "decimal"
    if isinstance(tree, _BOOLEAN_NODES):
        return "boolean"
    if isinstance(tree, (exp.Neg, exp.Abs)):
        return infer_type(tree.this, columns)
    if isinstance(tree, exp.Div):
        widest = _widest([infer_type(tree.left, columns), infer_type(tree.right, columns)])
        return "double" if widest == "double" else ("decimal" if widest else None)
    if isinstance(tree, (exp.Add, exp.Sub, exp.Mul, exp.Mod)):
        return _widest([infer_type(tree.left, columns), infer_type(tree.right, columns)])
    if isinstance(tree, (exp.Cast, exp.TryCast)):
        return _CAST_TYPES.get(tree.to.this.name if tree.to.this else "")
    if isinstance(tree, (exp.Upper, exp.Lower, exp.Trim, exp.Substring, exp.DPipe)):
        return "string"
    if isinstance(tree, (exp.Coalesce, exp.Nullif)):
        return infer_type(tree.this, columns)
    if isinstance(tree, exp.Case):
        branches = [infer_type(branch.args.get("true"), columns) for branch in tree.args["ifs"]]
        if tree.args.get("default") is not None:
            branches.append(infer_type(tree.args["default"], columns))
        return _common(branches)
    if isinstance(tree, exp.If):
        return _common([
            infer_type(tree.args.get("true"), columns),
            infer_type(tree.args.get("false"), columns) if tree.args.get("false") else None,
        ])
    return None


def _common(types: list[str | None]) -> str | None:
    known = [t for t in types if t is not None]
    if not known:
        return None
    if len(set(known)) == 1:
        return known[0]
    return _widest(known)
