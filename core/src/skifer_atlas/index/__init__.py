"""Index DuckDB d'un espace : reconstructible depuis le clone (plan 0005)."""


from .build import build_index, ensure_index
from .search import catalog, dependencies, document

__all__ = ["build_index", "catalog", "dependencies", "document", "ensure_index"]
