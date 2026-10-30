"""Oracle de fidélité (plan 0004) : le graphe extrait dit-il la même chose que le SQL ?

En attendant la compilation du graphe en SQL (plan 0007), la comparaison est structurelle
et indépendante de la traduction : on relit l'AST SQLGlot de la requête source et on
compare ses traits (tables lues, prédicats, clés de jointure, regroupements, agrégats) à
ceux du graphe. `verified` si tout concorde, `differs` sinon (avec les traits en cause),
`skipped` quand le brouillon garde un résidu bloquant.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any

from sqlglot import exp

from .translate import _aggregate_function, _aggregates, column_name, conjuncts

FEATURES = ("tables", "predicates", "join_keys", "group_by", "aggregates")


@dataclass(frozen=True)
class Roundtrip:
    status: str  # verified | differs | skipped
    differs: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {"status": self.status}
        if self.differs:
            data["differs"] = list(self.differs)
        return data


def _query(ast: exp.Expression) -> exp.Expression:
    return ast.expression if isinstance(ast, (exp.Create, exp.Insert)) else ast


def sql_features(ast: exp.Expression) -> dict[str, Any]:
    query = _query(ast)
    ctes = {cte.alias.lower() for cte in query.find_all(exp.CTE)}
    tables = {
        ".".join(part.name for part in table.parts)
        for table in query.find_all(exp.Table)
        if not (not table.db and table.name.lower() in ctes)
    }
    predicates = 0
    keys: Counter[tuple[str, str]] = Counter()
    group_by = 0
    aggregates: Counter[str] = Counter()
    for select in query.find_all(exp.Select):
        for clause in ("where", "qualify"):
            if select.args.get(clause):
                predicates += len(list(conjuncts(select.args[clause].this)))
        for join in select.args.get("joins") or []:
            for identifier in join.args.get("using") or []:
                keys[(identifier.name.lower(),) * 2] += 1
            for condition in conjuncts(join.args.get("on")):
                if isinstance(condition, exp.EQ) and all(
                    isinstance(side, exp.Column) for side in (condition.left, condition.right)
                ):
                    pair = sorted((column_name(condition.left), column_name(condition.right)))
                    keys[(pair[0], pair[1])] += 1
                else:
                    predicates += 1
        if select.args.get("group"):
            group_by += len(select.args["group"].expressions)
        seen: set[str] = set()
        for item in [*select.expressions, *(
            [select.args["having"].this] if select.args.get("having") else []
        )]:
            for aggregate in _aggregates(item):
                if aggregate.sql() not in seen:
                    seen.add(aggregate.sql())
                    aggregates[_aggregate_function(aggregate) or "?"] += 1
    return {
        "tables": tables, "predicates": predicates, "join_keys": keys,
        "group_by": group_by, "aggregates": aggregates,
    }


def graph_features(nodes: list[dict[str, Any]]) -> dict[str, Any]:
    keys: Counter[tuple[str, str]] = Counter()
    for node in nodes:
        for left, right in node.get("keys", []) if node["type"] == "join" else []:
            pair = sorted((left, right))
            keys[(pair[0], pair[1])] += 1
    return {
        "tables": {n["table"] for n in nodes if n["type"] == "source"},
        "predicates": sum(n["type"] in ("filter", "deduplicate") for n in nodes),
        "join_keys": keys,
        "group_by": sum(len(n["group_by"]) for n in nodes if n["type"] == "aggregate"),
        "aggregates": Counter(
            m[2] for n in nodes if n["type"] == "aggregate" for m in n["measures"]
        ),
    }


def roundtrip(ast: Any, nodes: list[dict[str, Any]], blocking: bool) -> Roundtrip:
    if blocking or ast is None or not nodes:
        return Roundtrip("skipped")
    source, graph = sql_features(ast), graph_features(nodes)
    # Une table sans schéma est lue `TODO.<nom>` : on compare le nom écrit.
    graph["tables"] = {t.removeprefix("TODO.") for t in graph["tables"]}
    differs = tuple(name for name in FEATURES if source[name] != graph[name])
    return Roundtrip("differs" if differs else "verified", differs)
