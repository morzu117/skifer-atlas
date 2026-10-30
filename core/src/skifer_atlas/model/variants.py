"""Déclinaisons d'un KPI : surcharge de nœuds entiers, ou graphe from scratch (plan 0001).

La cohérence avec le canonique (nœud existant, point déclaré ou non, même type) est
vérifiée au plan 0002, qui charge les deux documents.
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from pydantic import Discriminator, Field, Tag, model_validator

from .nodes import (
    NODE_ID_PATTERN,
    CalendarRef,
    Graph,
    Node,
    NonEmptyStr,
    PositiveInt,
    Slug,
    _check_timezone,
    _Model,
    invalid,
    missing,
)

VARIATION_POINT_PATTERN = r"^(n[0-9]{2,4}|semantics\.(calendar|timezone|currency))$"
VariationPoint = Annotated[str, Field(pattern=VARIATION_POINT_PATTERN)]
CURRENCY_PATTERN = r"^[A-Z]{3}$"


class VariantDataProduct(_Model):
    id: Slug
    version: PositiveInt
    owner: NonEmptyStr
    description: str | None = None


class VariantOf(_Model):
    id: Slug
    version: PositiveInt


def _value_branch(value: Any) -> str:
    return "value-calendar" if isinstance(value, (dict, CalendarRef)) else "value-text"


OverrideValue = Annotated[
    Annotated[CalendarRef, Tag("value-calendar")] | Annotated[NonEmptyStr, Tag("value-text")],
    Discriminator(_value_branch),
]


class Override(_Model):
    node: VariationPoint
    justification: NonEmptyStr
    replace: Node | None = None
    value: OverrideValue | None = None

    @model_validator(mode="after")
    def _replace_or_value(self) -> Override:
        if re.match(NODE_ID_PATTERN, self.node):
            if self.value is not None:
                raise invalid("value", "Un nœud se surcharge par « replace », pas par « value ».")
            if self.replace is None:
                raise missing("replace", f"La surcharge de {self.node} doit donner le nœud complet.")
            if self.replace.id != self.node:
                raise invalid(
                    "replace/id",
                    f"Le nœud de remplacement doit garder l'identifiant {self.node}.",
                )
            return self
        if self.replace is not None:
            raise invalid("replace", f"« {self.node} » se surcharge par « value ».")
        if self.value is None:
            raise missing("value", f"La surcharge de « {self.node} » doit donner « value ».")
        attribute = self.node.removeprefix("semantics.")
        if attribute == "calendar" and not isinstance(self.value, CalendarRef):
            raise invalid("value", "Un calendrier se donne sous la forme {key, version}.")
        if attribute != "calendar" and isinstance(self.value, CalendarRef):
            raise invalid("value", f"« {self.node} » attend une valeur simple.")
        if attribute == "timezone":
            _check_timezone(self.value)
        if attribute == "currency" and not re.match(CURRENCY_PATTERN, self.value):
            raise invalid("value", f"Devise « {self.value} » : code ISO 4217 attendu (ex. EUR).")
        return self


class _Variant(_Model):
    schema_version: Literal[1]
    kind: Literal["variant"]
    data_product: VariantDataProduct
    variant_of: VariantOf
    entity: Slug
    mode: str
    justification: NonEmptyStr


class OverrideVariant(_Variant):
    mode: Literal["override"]
    overrides: Annotated[list[Override], Field(min_length=1)]


class FromScratchVariant(_Variant):
    mode: Literal["from_scratch"]
    graph: Graph
    concepts: Annotated[list[Slug], Field(min_length=1)]


VariantDocument = Annotated[
    OverrideVariant | FromScratchVariant, Field(discriminator="mode")
]
