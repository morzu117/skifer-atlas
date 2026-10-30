"""Interface commune des connecteurs de plateforme (plans 0008 et 0018)."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, Protocol

MAX_ROWS = 50_000  # garde contre le rapatriement de données détaillées (brief 8.3)
QUERY_TIMEOUT = 300  # secondes


@dataclass
class QueryResult:
    columns: list[str]
    types: list[str]  # types de la plateforme, en minuscules
    rows: list[tuple[Any, ...]]


class AuthRejected(Exception):
    """La plateforme refuse le jeton (401) : le rafraîchir, ou se reconnecter."""


class Connector(Protocol):
    def test(self) -> None:
        """Lève une `RepoError` si la connexion ne fonctionne pas."""

    def run_aggregate(self, sql: str, max_rows: int = MAX_ROWS,
                      timeout: float = QUERY_TIMEOUT,
                      cancel: threading.Event | None = None) -> QueryResult:
        """Exécute une requête en push-down ; refuse un résultat de plus de `max_rows`
        lignes (`result_too_large`)."""
