"""Résidus d'extraction (plan 0004) : ce que la traduction ne sait pas faire.

Règle du moteur reprise telle quelle : un message ne cite jamais de valeur de données ni
de nom de table, pour qu'un rapport se colle dans un ticket. L'extrait SQL fautif n'est
désigné que par son empreinte (`sql_excerpt_hash`). Seuls des mots-clés et des noms de
fonctions SQL peuvent compléter un message (`detail`).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

# code → (bloquant, message ; `{detail}` est remplacé par un mot-clé ou un nom de fonction)
CODES: dict[str, tuple[bool, str]] = {
    "window_function": (
        True, "Fonction de fenêtre sans équivalent dans le graphe ({detail}) : la reprendre à la main.",
    ),
    "rounding_in_definition": (
        True, "Arrondi dans la définition ({detail}) : l'arrondi se fait à la restitution.",
    ),
    "non_deterministic": (
        True, ("Fonction non déterministe ({detail}) : une définition doit donner le même "
               "résultat à chaque exécution."),
    ),
    "unsupported_construct": (True, "Construction SQL non traduite ({detail})."),
    "parse_error": (True, "Instruction illisible par l'analyseur SQL ({detail})."),
    "invalid_draft": (True, "Le brouillon ne passe pas le contrôle {detail}."),
    "cardinality_unknown": (
        False, "Cardinalité de la jointure inconnue : la renseigner (1:1, N:1 ou 1:N).",
    ),
    "ambiguous_column_origin": (
        False, "Colonne sans préfixe de table, rattachée au premier flux possible : vérifier.",
    ),
    "unqualified_table": (False, "Table sans schéma : compléter le nom qualifié."),
    "unnamed_expression": (False, "Expression sans alias : un nom de colonne a été attribué."),
    "ignored_clause": (False, "Clause sans effet sur la définition, ignorée ({detail})."),
    "unsupported_statement": (False, "Instruction autre qu'une requête, ignorée ({detail})."),
    "notebook_cell_unreadable": (False, "Cellule de notebook non lisible comme SQL."),
}


@dataclass(frozen=True)
class Residue:
    code: str
    message: str
    blocking: bool
    sql_excerpt_hash: str | None = None

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {"code": self.code, "message": self.message,
                                "blocking": self.blocking}
        if self.sql_excerpt_hash is not None:
            data["sql_excerpt_hash"] = self.sql_excerpt_hash
        return data


def excerpt_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def residue(code: str, excerpt: str | None = None, detail: str = "") -> Residue:
    blocking, template = CODES[code]
    return Residue(
        code, template.format(detail=detail), blocking,
        excerpt_hash(excerpt) if excerpt is not None else None,
    )
