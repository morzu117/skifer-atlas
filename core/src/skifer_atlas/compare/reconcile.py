"""Réconciliation de deux résultats agrégés, cellule par cellule (plan 0009, ADR 0012).

Une cellule est un jeu de valeurs des dimensions du scope. Les deux côtés se joignent
en jointure externe complète sur ces valeurs ; une cellule présente d'un seul côté est
hors tolérance. L'écart se mesure en pourcentage du canonique :
`gap_pct = (variant − canonical) / |canonical| × 100`. Un canonique nul donne un écart
nul si la déclinaison l'est aussi, sinon un écart indéfini, hors tolérance.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from ..repo.git import RepoError


@dataclass(frozen=True)
class Cell:
    dims: dict[str, Any]
    canonical: float | None
    variant: float | None
    gap_pct: float | None
    within: bool
    missing: str | None  # côté absent : "canonical" ou "variant"

    def to_dict(self) -> dict:
        return {"dims": self.dims, "canonical_value": self.canonical,
                "variant_value": self.variant, "gap_pct": self.gap_pct,
                "within_tolerance": self.within, "missing": self.missing}


@dataclass(frozen=True)
class Summary:
    cell_count: int
    validation_pct: float | None
    max_gap_pct: float | None


def dimension_value(value: Any) -> Any:
    """Valeur de dimension comparable d'une plateforme à l'autre, sérialisable en JSON."""
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _number(value: Any) -> float | None:
    return None if value is None else float(value)


def keyed(rows: list[tuple], positions: list[int], value: int,
          side: str) -> dict[str, float | None]:
    """Valeur par cellule ; la clé est la forme JSON des valeurs de dimensions."""
    found: dict[str, float | None] = {}
    for row in rows:
        key = json.dumps([dimension_value(row[p]) for p in positions], ensure_ascii=False,
                         default=str)
        if key in found:
            raise RepoError("duplicate_dimensions", f"Le résultat {side} a deux lignes pour "
                            f"la même cellule ({key}) : la granularité ne correspond pas à "
                            "la sortie du KPI.")
        found[key] = _number(row[value])
    return found


def gap(canonical: float | None, variant: float | None) -> float | None:
    if canonical is None or variant is None:
        return 0.0 if canonical is None and variant is None else None
    if canonical == 0:
        return 0.0 if variant == 0 else None
    return (variant - canonical) / abs(canonical) * 100


def reconcile(dimensions: list[str], canonical: dict[str, float | None],
              variant: dict[str, float | None], tolerance: float) -> list[Cell]:
    cells = []
    for key in sorted(canonical.keys() | variant.keys()):
        values = dict(zip(dimensions, json.loads(key), strict=True))
        if key not in canonical or key not in variant:
            cells.append(Cell(values, canonical.get(key), variant.get(key), None, False,
                              "canonical" if key not in canonical else "variant"))
            continue
        found = gap(canonical[key], variant[key])
        cells.append(Cell(values, canonical[key], variant[key], found,
                          found is not None and abs(found) <= tolerance, None))
    return cells


def summarize(cells: list[Cell]) -> Summary:
    if not cells:
        return Summary(0, None, None)
    gaps = [abs(c.gap_pct) for c in cells if c.gap_pct is not None]
    return Summary(len(cells), sum(c.within for c in cells) / len(cells) * 100,
                   max(gaps) if gaps else None)


def target_of(difference: dict) -> str:
    """Nœud de l'écart, ou attribut de sémantique (`semantics.timezone`)."""
    ref = difference.get("node_ref") or {}
    if ref:
        return ref.get("base") or ref.get("other")
    return f"semantics.{difference['changes'][0]['field']}"


# Ce qui dit où sont les données, pas comment on calcule : une source déplacée sur une
# autre plateforme (plan 0018) n'explique pas un écart.
PHYSICAL_FIELDS = frozenset({"platform"})


def _physical_only(difference: dict) -> bool:
    fields = {c.get("field") for c in difference.get("changes") or []}
    return bool(fields) and fields <= PHYSICAL_FIELDS


def divergent_node(differences: list[dict]) -> dict | None:
    """Premier écart `critical` du diff structurel, à défaut la première surcharge hors des
    points de variation ; un nœud passe avant un attribut de sémantique, et un simple
    changement de plateforme ne compte pas. Une piste, pas une preuve : l'écran le dit."""
    for on_node in (True, False):
        for wanted in ("critical", "override_undeclared"):
            for difference in differences:
                if difference["classification"] == wanted and not _physical_only(
                        difference) and bool(difference.get("node_ref")) == on_node:
                    return {"node_id": target_of(difference),
                            "node_type": difference["node_type"],
                            "classification": wanted, "message": difference["message"]}
    return None
