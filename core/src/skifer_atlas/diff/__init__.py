"""Diff structurel et classification des écarts (plan 0003)."""

from .report import (
    DIFF_SCHEMA_FILENAME,
    RELATIONS,
    DiffContext,
    DiffReport,
    diff,
    diff_schema_text,
    report_text,
)

__all__ = [
    "DIFF_SCHEMA_FILENAME", "RELATIONS", "DiffContext", "DiffReport", "diff", "diff_schema_text",
    "report_text",
]
