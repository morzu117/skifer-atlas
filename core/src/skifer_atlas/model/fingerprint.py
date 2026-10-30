"""Empreinte d'un graphe (plan 0002) : sha256 du JSON canonique de sa forme normalisée.

Le préfixe versionné (`sha256:atlas1:`) permet de changer la normalisation sans
confondre les anciennes empreintes avec les nouvelles.
"""

from __future__ import annotations

import hashlib
from typing import Any

from .normalize import NORMALIZATION, _canonical_json, normalized_form


def fingerprint(document: Any) -> str:
    """Empreinte versionnée de la forme normalisée : `sha256:atlas1:<hex>`."""
    payload = _canonical_json(normalized_form(document)["graph"]).encode("utf-8")
    return f"sha256:{NORMALIZATION}:{hashlib.sha256(payload).hexdigest()}"
