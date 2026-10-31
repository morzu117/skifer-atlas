"""Ce qui change d'un dialecte à l'autre (plan 0007, ADR 0004).

SQLGlot traduit l'AST ; ce module dit seulement où sa traduction ne serait pas fidèle
(`NotCompilable`) et fournit les quelques expressions qu'on écrit à la main : agrégats,
tri explicite des nulls, échec volontaire d'une requête, division et début de semaine
identiques d'un moteur à l'autre (plan 0021, ADR 0025).
"""

from __future__ import annotations

from sqlglot import exp

from ..model.functions import infer_type
from .errors import NotCompilable

DIALECTS = ("databricks", "snowflake", "duckdb")
DISTINCT_FUNCTIONS = frozenset({"count_distinct", "sum_distinct"})


def aggregate(function: str, source: str) -> exp.Expression:
    """Fonction d'agrégation du catalogue Skifer. Écart-type et variance sont ceux de
    l'échantillon, écrits explicitement : les défauts varient d'un moteur à l'autre."""
    if source == "*":
        return exp.Count(this=exp.Star())
    column = exp.column(source)
    if function == "count_distinct":
        return exp.Count(this=exp.Distinct(expressions=[column]))
    if function == "sum_distinct":
        return exp.Sum(this=exp.Distinct(expressions=[column]))
    builders = {
        "sum": exp.Sum, "avg": exp.Avg, "min": exp.Min, "max": exp.Max, "count": exp.Count,
        "approx_count_distinct": exp.ApproxDistinct, "stddev": exp.StddevSamp,
        "variance": exp.Variance,
    }
    return builders[function](this=column)


def ordered(column: str, direction: str) -> exp.Ordered:
    """Tri à l'ordre des nulls explicite (nulls en dernier en croissant, en premier en
    décroissant), pour que Databricks, Snowflake et DuckDB rangent pareil."""
    descending = direction == "desc"
    return exp.Ordered(this=exp.column(column), desc=descending, nulls_first=descending)


def fail(dialect: str, message: exp.Expression) -> exp.Expression:
    """Expression qui fait échouer la requête avec ce message (table de `cardinality.py`)."""
    if dialect == "databricks":
        return exp.Anonymous(this="RAISE_ERROR", expressions=[message])
    if dialect == "duckdb":
        return exp.Anonymous(this="error", expressions=[message])
    # Snowflake n'a pas de fonction d'erreur en SQL : un cast de texte en nombre échoue
    # en citant le texte. Le message dépend des données, il n'est pas plié à la compilation.
    return exp.Cast(this=message, to=exp.DataType.build("int"))


def _zero(node: exp.Expression) -> bool:
    return isinstance(node, exp.Literal) and not node.is_string and float(node.this) == 0


def _nonzero(divisor: exp.Expression) -> exp.Expression:
    """Diviseur nul → NULL. Un littéral non nul, ou un `NULLIF(x, 0)` déjà écrit par
    l'auteur, reste tel quel."""
    if isinstance(divisor, exp.Literal) and not divisor.is_string and not _zero(divisor):
        return divisor
    if isinstance(divisor, exp.Nullif) and _zero(divisor.expression):
        return divisor
    return exp.Nullif(this=divisor, expression=exp.Literal.number(0))


def safe_division(tree: exp.Expression, types: dict[str, str | None]) -> exp.Expression:
    """Division identique dans les trois moteurs : en DOUBLE, et NULL sur un diviseur nul.

    Sans cela, `1 / 3` rend 0,333333 en Snowflake (NUMBER à 6 décimales) et
    0,3333333333333333 ailleurs ; un diviseur nul fait échouer Databricks (ANSI) et
    Snowflake, et rend `inf` en DuckDB. Le numérateur passe en DOUBLE, sauf si un opérande
    l'est déjà. `DIV` et `%` gardent leur type : seul leur diviseur passe par `NULLIF`."""
    # Les divisions les plus profondes d'abord (ordre préfixe inversé) : `a / b / c` ne
    # recaste pas `a / b`, déjà en DOUBLE. L'arbre est modifié sur place.
    for node in reversed(list(tree.find_all(exp.Div, exp.IntDiv, exp.Mod))):
        numerator, divisor = node.this, node.expression
        if isinstance(node, exp.Div) and "double" not in (infer_type(numerator, types),
                                                          infer_type(divisor, types)):
            node.set("this", exp.cast(numerator, "double"))
        node.set("expression", _nonzero(divisor.copy()))
    return tree


def week_start(day: exp.Expression, dialect: str) -> exp.Expression:
    """Lundi de la semaine d'une date. `DATE_TRUNC('WEEK', …)` suit en Snowflake le
    paramètre de session `WEEK_START` ; `DAYOFWEEKISO` (lundi = 1) n'en dépend pas, ni de
    `WEEK_OF_YEAR_POLICY`. Databricks et DuckDB commencent toujours au lundi. Le cast en
    DATE, superflu en Snowflake, garde le type si le SQL est traduit ailleurs."""
    if dialect == "snowflake":
        return exp.cast(exp.DateAdd(this=day, expression=exp.Sub(
            this=exp.Literal.number(1), expression=exp.DayOfWeekIso(this=day.copy())),
            unit=exp.var("DAY")), "date")
    return exp.cast(exp.TimestampTrunc(this=day, unit=exp.var("WEEK")), "date")


def check_window(function: str, node_id: str, dialect: str) -> None:
    if function in DISTINCT_FUNCTIONS and dialect == "databricks":
        raise NotCompilable(dialect, node_id, f"« {function} » n'est pas admis en fenêtre "
                            "par Databricks.")
    if function in DISTINCT_FUNCTIONS and dialect == "snowflake":
        raise NotCompilable(dialect, node_id, f"« {function} » n'est admis en fenêtre par "
                            "Snowflake que sans ORDER BY ; une fenêtre temporelle est ordonnée.")


def check_expression(tree: exp.Expression, types: dict[str, str | None], node_id: str,
                     dialect: str) -> None:
    """Fonctions dont la traduction ne serait pas fidèle dans ce dialecte."""
    for cast in tree.find_all(exp.Cast, exp.TryCast):
        target = cast.to
        if target.is_type("decimal") and not target.expressions:
            raise NotCompilable(dialect, node_id, "DECIMAL sans précision : chaque moteur "
                                "applique sa propre échelle (Snowflake arrondit à l'entier). "
                                "Écrire DECIMAL(p, s).")
    if dialect != "snowflake":
        return
    for cast in tree.find_all(exp.TryCast):
        argument = cast.this
        known = types.get(argument.name) if isinstance(argument, exp.Column) else None
        if not (isinstance(argument, exp.Literal) and argument.is_string) and known != "string":
            raise NotCompilable(dialect, node_id, "TRY_CAST n'accepte en Snowflake qu'une "
                                "chaîne : l'argument n'en est pas une.")


def mark_strings(tree: exp.Expression, types: dict[str, str | None]) -> exp.Expression:
    """Annote les colonnes texte des TRY_CAST : SQLGlot garde alors TRY_CAST en Snowflake."""
    for cast in tree.find_all(exp.TryCast):
        if isinstance(cast.this, exp.Column) and types.get(cast.this.name) == "string":
            cast.this.type = exp.DataType.build("text")
    return tree
