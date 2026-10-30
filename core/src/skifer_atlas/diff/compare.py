"""Comparaison champ par champ de deux nœuds appariés (plan 0003).

On compare les contenus de la forme normalisée (expressions réécrites par SQLGlot), plus
les métadonnées que la normalisation écarte (libellé, note, propriétaire, justification
d'un contournement). Le calendrier du KPI n'est pas recopié dans les `period` : il se
compare une fois, au niveau de `semantics`.

Renommage cohérent : quand un nœud produit une colonne sous un autre nom (cible d'un
calcul, d'un nœud temporel, d'une mesure…), le nouveau nom est substitué à l'ancien dans
les nœuds en aval avant de les comparer. Un renommage suivi partout n'apparaît donc
qu'une fois, sur le nœud qui produit la colonne.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any

from sqlglot import exp
from sqlglot.optimizer.simplify import simplify

from ..model.functions import parse_sql
from ..model.normalize import LogicalNode, _condition

# Nature d'un changement, d'où découlent classe et gravité (classify.py).
CRITICAL = "critical"
EXPRESSION = "expression"  # expressions différentes, équivalence non démontrée
EQUIVALENT = "equivalent"  # expressions réécrites mais équivalentes
RENAME = "rename"  # seul le nom d'une colonne produite change
METADATA = "metadata"  # libellé, note, propriétaire, justification
OTHER = "other"

METADATA_FIELDS = ("label", "note", "owner", "bypass_reason")

_CRITICAL_FIELDS = {
    "filter_set": {"condition", "nulls", "conditions"},
    "aggregate": {"group_by", "measures", "having"},
    "join": {"how", "keys", "cardinality", "check"},
    "temporal": {"timezone", "grain"},
    "metric_op": {"order", "aggregate"},
}


@dataclass(frozen=True)
class Change:
    field: str
    before: Any
    after: Any
    nature: str


# --- contenu comparé ---------------------------------------------------------------------

def compared_content(node: LogicalNode) -> dict:
    """Contenu normalisé ; une suite d'un seul filtre se lit `condition` + `nulls`."""
    if node.type == "filter_set":
        if len(node.members) == 1:
            member = node.members[0]
            return {"condition": _condition(member.condition), "nulls": member.nulls}
        return {"conditions": node.content["conditions"]}
    content = copy.deepcopy(node.content)
    content.pop("calendar", None)
    return content


def metadata(node: LogicalNode) -> dict:
    values: dict[str, Any] = {}
    for name in METADATA_FIELDS:
        found = [getattr(member, name, None) for member in node.members]
        if len(found) == 1:
            values[name] = found[0]
        elif any(value is not None for value in found):
            values[name] = found
    return {name: value for name, value in values.items() if value is not None}


# --- renommage -----------------------------------------------------------------------------

def _rename_sql(text: str, mapping: dict[str, str]) -> str:
    tree = parse_sql(text)
    for column in tree.find_all(exp.Column):
        if column.name in mapping:
            column.set("this", exp.to_identifier(mapping[column.name]))
    return tree.sql(normalize=True, pretty=False)


def _rename_condition(text: str, mapping: dict[str, str]) -> str:
    if text.startswith("expr:"):
        return "expr:" + _rename_sql(text.removeprefix("expr:"), mapping)
    column, rest = text.split(":", 1)
    return f"{mapping.get(column, column)}:{rest}"


def _names(values: list, mapping: dict[str, str]) -> list:
    return [mapping.get(value, value) for value in values]


def _measures(measures: list, mapping: dict[str, str]) -> list:
    return [[mapping.get(source, source), target, function] for source, target, function in measures]


def rename_references(kind: str, content: dict, mapping: dict[str, str]) -> dict:
    """Le contenu d'un nœud où les colonnes lues sont renommées selon `mapping`."""
    if not mapping:
        return content
    c = copy.deepcopy(content)
    if kind == "filter_set":
        if "condition" in c:
            c["condition"] = _rename_condition(c["condition"], mapping)
        else:
            c["conditions"] = sorted(
                "|".join([_rename_condition(text.rsplit("|", 1)[0], mapping), text.rsplit("|", 1)[1]])
                for text in c["conditions"]
            )
    elif kind == "compute":
        c["expr"] = _rename_sql(c["expr"], mapping)
    elif kind == "aggregate":
        c["group_by"] = _names(c["group_by"], mapping)
        c["measures"] = _measures(c["measures"], mapping)
        if "having" in c:
            c["having"] = [_rename_condition(text, mapping) for text in c["having"]]
    elif kind == "join":
        c["keys"] = [_names(pair, mapping) for pair in c["keys"]]
    elif kind == "deduplicate":
        c["keys"] = _names(c["keys"], mapping)
        c["keep"]["order_by"] = [[mapping.get(n, n), d] for n, d in c["keep"]["order_by"]]
    elif kind == "temporal":
        c["column"] = mapping.get(c["column"], c["column"])
        if "order_by" in c:
            c["order_by"] = [[mapping.get(n, n), d] for n, d in c["order_by"]]
        if "partition_by" in c:
            c["partition_by"] = _names(c["partition_by"], mapping)
    elif kind == "union":
        for column in c["columns"]:
            column["from"] = {k: mapping.get(v, v) for k, v in column["from"].items()}
    elif kind == "metric_op":
        for metric in c["metrics"]:
            metric["expr"] = _rename_sql(metric["expr"], mapping)
        if "aggregate" in c:
            c["aggregate"]["group_by"] = _names(c["aggregate"]["group_by"], mapping)
            c["aggregate"]["measures"] = _measures(c["aggregate"]["measures"], mapping)
    elif kind == "kpi_ref" and "columns" in c:
        c["columns"] = _names(c["columns"], mapping)
    return c


def produced(kind: str, content: dict) -> list[str]:
    """Noms des colonnes que le nœud produit, dans l'ordre."""
    if kind == "compute":
        return [content["column"]]
    if kind == "temporal":
        return [content["target"]]
    if kind == "aggregate":
        return [target for _, target, _ in content["measures"]]
    if kind == "union":
        return [column["name"] for column in content["columns"]]
    if kind == "metric_op":
        names = [metric["name"] for metric in content["metrics"]]
        if "aggregate" in content:
            names.extend(target for _, target, _ in content["aggregate"]["measures"])
        return names
    return []


def _with_produced(kind: str, content: dict, names: list[str]) -> dict:
    c = copy.deepcopy(content)
    if kind == "compute":
        c["column"] = names[0]
    elif kind == "temporal":
        c["target"] = names[0]
    elif kind == "aggregate":
        for measure, name in zip(c["measures"], names, strict=True):
            measure[1] = name
    elif kind == "union":
        for column, name in zip(c["columns"], names, strict=True):
            column["name"] = name
    elif kind == "metric_op":
        targets = iter(names)
        for metric in c["metrics"]:
            metric["name"] = next(targets)
        for measure in c.get("aggregate", {}).get("measures", []):
            measure[1] = next(targets)
    return c


# --- comparaison ---------------------------------------------------------------------------

_COMMUTATIVE = (exp.Add, exp.Mul, exp.And, exp.Or, exp.EQ, exp.NEQ)


def _canonical_tree(text: str) -> str:
    """Arbre comparable : parenthèses retirées (l'arbre porte déjà les priorités),
    simplification SQLGlot, opérandes des opérations commutatives triés."""
    tree = parse_sql(text).transform(lambda n: n.this if isinstance(n, exp.Paren) else n)
    tree = simplify(tree)

    def order(node: exp.Expression) -> exp.Expression:
        if isinstance(node, _COMMUTATIVE):
            left, right = sorted((node.left, node.right), key=repr)
            return node.__class__(this=left, expression=right)
        return node

    return repr(tree.transform(order))


def _equivalent(before: str, after: str) -> bool:
    """Vrai seulement si l'équivalence est démontrée ; faux en cas de doute."""
    try:
        return _canonical_tree(before) == _canonical_tree(after)
    except Exception:  # noqa: BLE001 — une simplification qui échoue ne prouve rien
        return False


def _nature(kind: str, field: str, before: Any, after: Any) -> str:
    if field in _CRITICAL_FIELDS.get(kind, ()):
        return CRITICAL
    if kind == "compute" and field == "expr":
        return EQUIVALENT if _equivalent(before, after) else EXPRESSION
    if kind == "metric_op" and field == "metrics":
        if all(_equivalent(b["expr"], a["expr"]) for b, a in zip(before, after, strict=True)):
            return EQUIVALENT
        return EXPRESSION
    if kind == "source" and field == "columns":
        zones = {c["name"]: (c.get("timezone"), c.get("format")) for c in before}
        if any(c["name"] in zones and zones[c["name"]] != (c.get("timezone"), c.get("format"))
               for c in after):
            return CRITICAL
    return OTHER


def node_changes(
    base: LogicalNode, other: LogicalNode, renames: dict[str, str]
) -> list[Change]:
    """Changements d'un nœud apparié ; complète `renames` avec les colonnes renommées."""
    kind = base.type
    raw = compared_content(base)
    after = compared_content(other)
    before = rename_references(kind, raw, renames)
    names_before, names_after = produced(kind, before), produced(kind, after)
    aligned = before
    if len(names_before) == len(names_after) and names_before != names_after:
        aligned = _with_produced(kind, before, names_after)
        renames.update({b: a for b, a in zip(names_before, names_after, strict=True) if b != a})

    changes = []
    for field in sorted(raw.keys() | after.keys()):
        if aligned.get(field) != after.get(field):
            if field == "metrics" and len(aligned[field]) != len(after[field]):
                nature = EXPRESSION
            else:
                nature = _nature(kind, field, aligned.get(field), after.get(field))
            changes.append(Change(field, raw.get(field), after.get(field), nature))
        elif before.get(field) != after.get(field):
            changes.append(Change(field, raw.get(field), after.get(field), RENAME))
    meta_before, meta_after = metadata(base), metadata(other)
    for field in METADATA_FIELDS:
        if meta_before.get(field) != meta_after.get(field):
            changes.append(Change(field, meta_before.get(field), meta_after.get(field), METADATA))
    return changes
