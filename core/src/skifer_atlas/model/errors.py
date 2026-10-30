"""Format des erreurs de validation : {path, node_id, code, message}.

`path` est un JSON pointer vers le champ fautif, `node_id` l'identifiant du nœud
concerné (ou None), `code` un code stable en anglais, `message` une phrase en français.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

from pydantic import ValidationError

NODE_ID_RE = re.compile(r"^n[0-9]{2,4}$")

# Discriminants des unions : pydantic les insère dans `loc`, ils ne sont pas des clés du YAML.
DISCRIMINATOR_KEYS = ("type", "kind", "mode", "operation")
# Branches des unions à discriminant calculé (voir nodes.py et variants.py).
BRANCH_TAGS = frozenset({
    "condition-text", "condition-expr", "value-calendar", "value-text", "value", "todo",
})

_TYPE_NAMES = {
    "string_type": "une chaîne de caractères",
    "int_type": "un entier",
    "int_from_float": "un entier",
    "bool_type": "un booléen",
    "list_type": "une liste",
    "tuple_type": "une liste",
    "dict_type": "un mapping (clé: valeur)",
    "model_type": "un mapping (clé: valeur)",
    "model_attributes_type": "un mapping (clé: valeur)",
}


@dataclass(frozen=True)
class Issue:
    path: str
    node_id: str | None
    code: str
    message: str
    severity: str = "error"  # error | warning | info

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class DocumentError(ValueError):
    """Document invalide : porte la liste complète des erreurs."""

    def __init__(self, issues: list[Issue]):
        self.issues = issues
        first = issues[0]
        more = f" (et {len(issues) - 1} autre(s))" if len(issues) > 1 else ""
        super().__init__(f"{first.path or '/'} : {first.message}{more}")


def pointer(segments: list[str | int]) -> str:
    return "".join("/" + str(s).replace("~", "~0").replace("/", "~1") for s in segments)


def _walk(raw: Any, loc: tuple) -> tuple[list[str | int], str | None]:
    """Retire de `loc` ce qui n'est pas une clé du YAML et repère le nœud traversé.

    Un nœud est un élément de `graph.nodes` ou le contenu d'un `replace` de surcharge ;
    une erreur dans une surcharge est rattachée au nœud surchargé.
    """
    segments: list[str | int] = []
    node_id = None
    current = raw
    for part in loc:
        if part in BRANCH_TAGS or part == "[key]":
            continue
        if (
            isinstance(part, str)
            and isinstance(current, dict)
            and part not in current
            and any(current.get(key) == part for key in DISCRIMINATOR_KEYS)
        ):
            continue
        is_node = part == "replace" or (
            isinstance(part, int) and len(segments) >= 1 and segments[-1] == "nodes"
        )
        segments.append(part)
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and isinstance(part, int) and part < len(current):
            current = current[part]
        else:
            current = None
        is_override = isinstance(part, int) and len(segments) >= 2 and segments[-2] == "overrides"
        if is_node or is_override:
            key = "node" if is_override else "id"
            candidate = current.get(key) if isinstance(current, dict) else None
            valid = isinstance(candidate, str) and NODE_ID_RE.match(candidate)
            node_id = candidate if valid else None
    return segments, node_id


def _choices(expected: Any) -> str:
    return str(expected).replace(" or ", " ou ")


def _message(error: dict, field: str) -> tuple[str, str]:
    kind = error["type"]
    ctx = error.get("ctx") or {}
    value = error.get("input")
    if kind == "missing":
        return "missing_field", f"Champ requis manquant : « {field} »."
    if kind == "extra_forbidden":
        return "unknown_key", f"Clé « {field} » non admise à cet endroit."
    if kind == "literal_error":
        hint = " Mettre la valeur entre guillemets." if not isinstance(value, str) else ""
        return "invalid_value", (
            f"Valeur « {value} » non admise pour « {field} ». "
            f"Valeurs admises : {_choices(ctx.get('expected'))}.{hint}"
        )
    if kind == "string_pattern_mismatch":
        if ctx.get("pattern") == r"\S":
            return "invalid_value", f"« {field} » ne doit pas être vide."
        return "invalid_value", (
            f"« {value} » ne respecte pas le format attendu pour « {field} » "
            f"({ctx.get('pattern')})."
        )
    if kind == "too_short":
        return "invalid_value", (
            f"« {field} » doit contenir au moins {ctx.get('min_length')} élément(s)."
        )
    if kind == "too_long":
        return "invalid_value", (
            f"« {field} » doit contenir au plus {ctx.get('max_length')} élément(s)."
        )
    if kind == "greater_than_equal":
        return "invalid_value", f"« {field} » doit être supérieur ou égal à {ctx.get('ge')}."
    if kind in _TYPE_NAMES:
        hint = ""
        if kind == "string_type" and isinstance(value, (int, float)):
            hint = " Mettre la valeur entre guillemets."
        return "invalid_value", f"« {field} » doit être {_TYPE_NAMES[kind]}.{hint}"
    return "invalid_value", f"Valeur invalide pour « {field} » : {error['msg']}"


def issues_from_validation_error(exc: ValidationError, raw: Any) -> list[Issue]:
    issues: list[Issue] = []
    for error in exc.errors(include_url=False):
        segments, node_id = _walk(raw, error["loc"])
        ctx = error.get("ctx") or {}
        kind = error["type"]
        if kind in ("union_tag_invalid", "union_tag_not_found"):
            discriminator = str(ctx.get("discriminator", "")).strip("'")
            segments.append(discriminator)
            if kind == "union_tag_not_found":
                code, message = "missing_field", f"Champ requis manquant : « {discriminator} »."
            elif discriminator == "type":
                code = "unknown_node_type"
                message = (
                    f"Type de nœud inconnu « {ctx.get('tag')} ». "
                    f"Types admis : {_choices(ctx.get('expected_tags'))}."
                )
            else:
                code = "invalid_value"
                message = (
                    f"Valeur « {ctx.get('tag')} » non admise pour « {discriminator} ». "
                    f"Valeurs admises : {_choices(ctx.get('expected_tags'))}."
                )
        elif "field" in ctx:
            # Erreurs levées par nos validateurs : ctx["field"] désigne le champ fautif.
            segments.extend(str(ctx["field"]).split("/"))
            code, message = kind, error["msg"]
        elif kind in ("invalid_value", "forbidden_function", "missing_field"):
            code, message = kind, error["msg"]
        else:
            field = next((s for s in reversed(segments) if isinstance(s, str)), "document")
            code, message = _message(error, field)
        issues.append(Issue(pointer(segments), node_id, code, message))
    return issues
