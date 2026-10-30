"""Interface `GitHost` : ce qu'Atlas demande à l'hébergeur du dépôt (plan 0006).

Les branches se poussent avec la CLI git ; l'hébergeur porte les pull requests, les
revues, les commentaires et la fusion. Les erreurs sont des `RepoError` à code stable.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from typing import Literal

from ..governance.rules import Review

PullState = Literal["open", "merged", "closed"]
ReviewEvent = Literal["approve", "request_changes", "comment"]


@dataclass
class PullRequest:
    number: int
    branch: str
    title: str
    body: str
    author: str
    state: PullState
    head: str  # commit de tête de la branche
    created_at: str
    merged_commit: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class Comment:
    account: str
    body: str
    created_at: str

    def to_dict(self) -> dict:
        return asdict(self)


class GitHost(ABC):
    @abstractmethod
    def current_account(self) -> str: ...

    @abstractmethod
    def create_pull_request(self, branch: str, title: str, body: str) -> PullRequest: ...

    @abstractmethod
    def list_pull_requests(self, state: str = "all") -> list[PullRequest]: ...

    @abstractmethod
    def get_pull_request(self, number: int) -> PullRequest: ...

    @abstractmethod
    def get_reviews(self, number: int) -> list[Review]: ...

    @abstractmethod
    def submit_review(self, number: int, event: ReviewEvent, body: str) -> None: ...

    @abstractmethod
    def list_comments(self, number: int) -> list[Comment]: ...

    @abstractmethod
    def add_comment(self, number: int, body: str) -> Comment: ...

    @abstractmethod
    def merge(self, number: int, head: str, title: str, message: str) -> str:
        """Fusionne si la tête de branche est toujours `head` ; renvoie le commit de fusion."""
