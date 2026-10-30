"""Classe, gravité et message d'un écart (plan 0003, brief 8.2).

Une seule classe par écart, première règle qui s'applique :
override_declared, override_undeclared, from_scratch, critical, cosmetic, to_verify.
La gravité (info, warn, critical) se calcule indépendamment de la classe, pour que la
matrice des entités (10.5) puisse filtrer.
"""

from __future__ import annotations

from collections.abc import Sequence

from .align import STRUCTURING
from .compare import CRITICAL, EQUIVALENT, EXPRESSION, METADATA, RENAME, Change

CLASSIFICATIONS = (
    "override_declared", "override_undeclared", "from_scratch", "critical", "cosmetic",
    "to_verify",
)
SEVERITIES = ("info", "warn", "critical")
_COSMETIC = {EQUIVALENT, RENAME, METADATA}

TYPE_LABELS = {
    "source": "Source", "filter_set": "Filtre", "join": "Jointure", "union": "Union",
    "compute": "Calcul", "deduplicate": "Dédoublonnage", "aggregate": "Agrégation",
    "temporal": "Nœud temporel", "kpi_ref": "Référence à un KPI",
    "metric_op": "Opération entre métriques", "semantics": "Sémantique",
}
_SUFFIX = {
    "override_declared": "Surcharge d'un point de variation déclaré.",
    "override_undeclared": "Surcharge hors des points de variation déclarés : à examiner.",
    "from_scratch": "Variante from scratch : justifiée, à suivre.",
    "critical": "Le résultat change.",
    "cosmetic": "Sans effet sur le résultat.",
}


def severity(kind: str, node_type: str, changes: Sequence[Change]) -> str:
    if kind == "reordered":
        return "critical"
    if kind in ("added", "removed"):
        return "critical" if node_type in STRUCTURING or node_type == "filter_set" else "warn"
    natures = {change.nature for change in changes}
    if CRITICAL in natures:
        return "critical"
    if natures <= _COSMETIC:
        return "info"
    return "warn"


def classify(
    gravity: str, relation: str, override: str | None, low_score: bool
) -> str:
    """`override` : classement de la surcharge qui porte sur ce nœud, s'il y en a une."""
    if override is not None:
        return f"override_{override}"
    if relation == "from_scratch":
        return "from_scratch"
    if gravity == "critical":
        return "critical"
    if low_score:
        return "to_verify"
    return "cosmetic" if gravity == "info" else "to_verify"


def _subject(node_type: str, label: str | None, node_id: str | None) -> str:
    name = f"« {label} »" if label else node_id
    return f"{TYPE_LABELS[node_type]} {name}" if name else TYPE_LABELS[node_type]


def message(
    kind: str, node_type: str, label: str | None, node_id: str | None,
    changes: Sequence[Change], classification: str, low_score: bool,
    bypass_reason: str | None = None,
) -> str:
    subject = _subject(node_type, label, node_id)
    fields = [change.field for change in changes]
    if kind == "added":
        text = f"{subject} : nœud ajouté."
    elif kind == "removed":
        text = f"{subject} : nœud retiré."
    elif kind == "reordered":
        before, after = changes[0].before, changes[0].after
        text = f"Ordre inversé : {' → '.join(before)} devient {' → '.join(after)}."
    elif node_type == "semantics":
        text = f"Sémantique modifiée ({', '.join(fields)})."
    elif fields == ["inputs"]:
        text = f"{subject} : nœud déplacé dans le flux."
    else:
        text = f"{subject} : {', '.join(fields)} modifié(s)."
    if any(c.field == "check" and c.after == "bypass" for c in changes):
        text += f" Contrôle de cardinalité contourné : {bypass_reason}"
        if not text.endswith("."):
            text += "."
    if classification == "to_verify":
        expression = any(c.nature == EXPRESSION for c in changes)
        if low_score and not expression:
            text += " Appariement incertain : à vérifier."
        elif expression:
            text += " Équivalence des expressions non démontrée : à vérifier."
        else:
            text += " À vérifier."
    else:
        text += " " + _SUFFIX[classification]
    return text
