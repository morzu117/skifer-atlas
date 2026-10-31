"""Contrôles exécutés avec la requête : cardinalité des jointures, couverture du calendrier.

Chaque contrôle est une CTE qui compte les anomalies (`problems`). La requête finale ne
rend ses lignes que si la garde, qui regroupe tous les contrôles, vaut NULL ; sinon la
garde appelle l'échec du dialecte, avec un message qui cite le nœud. Une seconde branche
lit la garde seule, pour qu'elle soit évaluée même sur une sortie vide (`guarded`) :

| dialecte   | échec                                   |
|------------|-----------------------------------------|
| databricks | `RAISE_ERROR(message)`                  |
| snowflake  | `CAST(message AS INT)`, qui échoue      |
| duckdb     | `error(message)`                        |

Une requête de contrôle séparée, exécutée avant, aurait demandé deux allers-retours et
laissé la requête principale fausse si on la copiait seule dans un éditeur SQL.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlglot import exp

from .dialects import fail


@dataclass(frozen=True)
class Check:
    name: str  # nom de la CTE
    node_id: str
    message: str  # suivi du nombre d'anomalies
    query: exp.Select


def _not_null(keys: list[str]) -> exp.Expression | None:
    conditions = [exp.column(k).is_(exp.null()).not_() for k in keys]
    return exp.and_(*conditions) if conditions else None


def duplicates(source: str, keys: list[str]) -> exp.Select:
    """Nombre de clés présentes plusieurs fois dans `source` ; sans clé (jointure
    croisée), le nombre de lignes au-delà de la première."""
    if not keys:
        rows = exp.Count(this=exp.Star())
        return exp.select(
            exp.Case(ifs=[exp.If(this=rows.copy() > 1, true=rows.copy())],
                     default=exp.Literal.number(0)).as_("problems"),
        ).from_(source)
    inner = exp.select(*keys).from_(source)
    where = _not_null(keys)
    if where is not None:
        inner = inner.where(where)
    inner = inner.group_by(*keys).having(exp.Count(this=exp.Star()) > 1)
    return exp.select(exp.Count(this=exp.Star()).as_("problems")).from_(inner.subquery("d"))


def join_checks(node_id: str, cardinality: str, left: str, right: str,
                keys: list[tuple[str, str]]) -> list[Check]:
    """N:1 : chaque clé est unique à droite ; 1:N : à gauche ; 1:1 : des deux côtés."""
    found = []
    if cardinality in ("1:N", "1:1"):
        found.append(Check(f"chk_{node_id}_left", node_id,
                           f"atlas: cardinalité {cardinality} non respectée en {node_id}, "
                           "clés en double à gauche : ",
                           duplicates(left, [k[0] for k in keys])))
    if cardinality in ("N:1", "1:1"):
        found.append(Check(f"chk_{node_id}_right", node_id,
                           f"atlas: cardinalité {cardinality} non respectée en {node_id}, "
                           "clés en double à droite : ",
                           duplicates(right, [k[1] for k in keys])))
    return found


def guard(checks: list[Check], dialect: str) -> exp.Select:
    """Une ligne, une colonne `failure` : NULL si tous les contrôles passent."""
    ifs = []
    for check in checks:
        count = exp.column("problems", table=check.name)
        message = exp.DPipe(this=exp.Literal.string(check.message),
                            expression=exp.cast(count.copy(), "text"), safe=True)
        ifs.append(exp.If(this=count.copy() > 0, true=fail(dialect, message)))
    query = exp.select(exp.Case(ifs=ifs).as_("failure")).from_(checks[0].name)
    for check in checks[1:]:
        query = query.join(check.name, join_type="cross")
    return query


def guarded(query: exp.Select, columns: list[str]) -> exp.Expression:
    """Requête finale gardée (plan 0021, ADR 0025).

    La première branche ne rend ses lignes que si la garde vaut NULL. Sur une sortie vide,
    un moteur peut ne jamais évaluer ce filtre, et l'anomalie passerait inaperçue. La
    seconde branche lit la garde seule : elle ne rend jamais de ligne (sur anomalie, la
    garde échoue avant), mais aucun moteur ne peut l'écarter sans évaluer la garde. Ses
    NULL sans type prennent celui de la première branche."""
    failure = exp.column("failure", table="atlas_guard")
    rows = query.where(exp.select("failure").from_("atlas_guard").subquery().is_(exp.null()))
    witness = exp.select(*[exp.null().as_(c) for c in columns]).from_("atlas_guard").where(
        failure.is_(exp.null()).not_())
    return exp.union(rows, witness, distinct=False)
