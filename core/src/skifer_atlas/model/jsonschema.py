"""JSON Schema publié du document Atlas, généré depuis le modèle pydantic.

Le schéma couvre la forme du document (clés, types, valeurs fermées, formats). Les
contrôles qui demandent du code (grammaire des conditions au-delà de l'opérateur, SQL
analysable, fonctions interdites, fuseaux IANA, champs requis selon un autre champ,
identifiants uniques) restent dans `validate_data`.
"""

from __future__ import annotations

import json
from typing import Any

from .document import DOCUMENT_ADAPTER, SCHEMA_VERSION

SCHEMA_FILENAME = f"atlas-document.v{SCHEMA_VERSION}.schema.json"


def document_json_schema() -> dict[str, Any]:
    schema = DOCUMENT_ADAPTER.json_schema()
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": f"Document Skifer Atlas (schema_version {SCHEMA_VERSION})",
        **schema,
    }


def schema_text() -> str:
    return json.dumps(document_json_schema(), indent=2, ensure_ascii=False) + "\n"
