"""Modèle des documents Atlas : dix types de nœuds, YAML versionné (plan 0001).

Python pur : n'importe ni Spark ni FastAPI.
"""

from .document import (
    SCHEMA_VERSION,
    ConceptDocument,
    Document,
    KpiDocument,
    ValidationResult,
    validate_data,
)
from .errors import DocumentError, Issue
from .io import dump_document, load_document, validate_file, validate_text
from .nodes import NODE_TYPES, Graph, Node
from .variants import FromScratchVariant, OverrideVariant, VariantDocument

__all__ = [
    "NODE_TYPES",
    "SCHEMA_VERSION",
    "ConceptDocument",
    "Document",
    "DocumentError",
    "FromScratchVariant",
    "Graph",
    "Issue",
    "KpiDocument",
    "Node",
    "OverrideVariant",
    "ValidationResult",
    "VariantDocument",
    "dump_document",
    "load_document",
    "validate_data",
    "validate_file",
    "validate_text",
]
