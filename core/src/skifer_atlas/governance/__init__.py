"""Gouvernance d'un espace : `governance.yaml`, règles de décompte, `CODEOWNERS` (plan 0006)."""

from .model import (
    Governance,
    check_governance,
    dump_governance,
    parse_governance,
    validate_governance,
)

__all__ = [
    "Governance", "check_governance", "dump_governance", "parse_governance",
    "validate_governance",
]
