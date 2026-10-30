"""Index DuckDB d'un espace : reconstructible depuis le clone (plan 0005)."""


from .build import build_index, ensure_index, index_fresh
from .search import catalog, dependencies, document, facets
from .summary import summary

__all__ = ["build_index", "catalog", "dependencies", "document", "ensure_index", "facets",
           "index_fresh", "summary"]
