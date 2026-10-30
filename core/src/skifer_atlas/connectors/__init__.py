"""Points d'accès et connecteurs de plateforme (plan 0008)."""

from .access_points import AccessPoint, AccessPoints, parse_access_points
from .base import MAX_ROWS, QueryResult

__all__ = ["MAX_ROWS", "AccessPoint", "AccessPoints", "QueryResult", "parse_access_points"]
