"""`LocalHost` : un dépôt nu local fait office d'hébergeur (tests, démos hors ligne).

Chaque pull request est un fichier JSON sous `<dépôt nu>/atlas/proposals/` et une
référence `refs/atlas/proposals/<n>` sur sa tête à la création. La fusion se fait dans
un clone temporaire, puis la branche principale est poussée. Comme GitHub, l'hôte
refuse que l'auteur approuve sa propre proposition.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
from datetime import UTC, datetime
from pathlib import Path

from ..governance.model import account_from_name
from ..governance.rules import Review
from ..repo.git import RepoError, run_git
from .base import Comment, GitHost, PullRequest, ReviewEvent

_lock = threading.Lock()
_STATES = {"approve": "approved", "request_changes": "changes_requested", "comment": "commented"}


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def local_account() -> str:
    """`ATLAS_ACCOUNT`, à défaut le nom Git de l'utilisateur."""
    account = os.environ.get("ATLAS_ACCOUNT")
    if account:
        return account
    try:
        return account_from_name(run_git(["config", "user.name"]).strip())
    except RepoError:
        return "referent"


class LocalHost(GitHost):
    def __init__(self, bare: Path, main_branch: str = "main"):
        self.bare = bare
        self.main_branch = main_branch
        self.folder = bare / "atlas" / "proposals"

    # --- stockage -----------------------------------------------------------------------

    def _path(self, number: int) -> Path:
        return self.folder / f"{number}.json"

    def _load(self, number: int) -> dict:
        path = self._path(number)
        if not path.exists():
            raise RepoError("not_found", f"Proposition #{number} introuvable.")
        return json.loads(path.read_text(encoding="utf-8"))

    def _save(self, data: dict) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        self._path(data["number"]).write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def _head(self, branch: str) -> str | None:
        try:
            return run_git(["rev-parse", "--verify", f"refs/heads/{branch}"], self.bare).strip()
        except RepoError:
            return None

    def _pull(self, data: dict) -> PullRequest:
        head = data["head"]
        if data["state"] == "open":
            head = self._head(data["branch"]) or head
        return PullRequest(data["number"], data["branch"], data["title"], data["body"],
                           data["author"], data["state"], head, data["created_at"],
                           data.get("merged_commit"))

    # --- GitHost ------------------------------------------------------------------------

    def current_account(self) -> str:
        return local_account()

    def create_pull_request(self, branch: str, title: str, body: str) -> PullRequest:
        head = self._head(branch)
        if head is None:
            raise RepoError("not_found", f"Branche « {branch} » absente du dépôt.")
        with _lock:
            numbers = [int(p.stem) for p in self.folder.glob("*.json")] if self.folder.exists() \
                else []
            data = {"number": max(numbers, default=0) + 1, "branch": branch, "title": title,
                    "body": body, "author": self.current_account(), "state": "open",
                    "head": head, "created_at": _now(), "merged_commit": None,
                    "reviews": [], "comments": []}
            self._save(data)
        run_git(["update-ref", f"refs/atlas/proposals/{data['number']}", head], self.bare)
        return self._pull(data)

    def list_pull_requests(self, state: str = "all") -> list[PullRequest]:
        if not self.folder.exists():
            return []
        pulls = [self._pull(json.loads(p.read_text(encoding="utf-8")))
                 for p in self.folder.glob("*.json")]
        return sorted((p for p in pulls if state == "all" or p.state == state),
                      key=lambda p: p.number)

    def get_pull_request(self, number: int) -> PullRequest:
        return self._pull(self._load(number))

    def get_reviews(self, number: int) -> list[Review]:
        return [Review(**review) for review in self._load(number)["reviews"]]

    def submit_review(self, number: int, event: ReviewEvent, body: str) -> None:
        account = self.current_account()
        with _lock:
            data = self._load(number)
            if data["state"] != "open":
                raise RepoError("not_open", f"La proposition #{number} n'est plus ouverte.")
            if event != "comment" and account == data["author"]:
                raise RepoError("cannot_review_own",
                                "L'auteur ne peut pas approuver sa propre proposition.")
            head = self._head(data["branch"]) or data["head"]
            data["reviews"].append({"account": account, "state": _STATES[event],
                                    "commit": head, "submitted_at": _now(), "body": body})
            self._save(data)

    def list_comments(self, number: int) -> list[Comment]:
        return [Comment(**comment) for comment in self._load(number)["comments"]]

    def add_comment(self, number: int, body: str) -> Comment:
        comment = Comment(self.current_account(), body, _now())
        with _lock:
            data = self._load(number)
            data["comments"].append(comment.to_dict())
            self._save(data)
        return comment

    def merge(self, number: int, head: str, title: str, message: str) -> str:
        with _lock:
            data = self._load(number)
            if data["state"] != "open":
                raise RepoError("not_open", f"La proposition #{number} n'est plus ouverte.")
            if self._head(data["branch"]) != head:
                raise RepoError("head_changed", "La branche a changé depuis le décompte.")
            work = Path(tempfile.mkdtemp(prefix="atlas-merge-"))
            try:
                clone = work / "clone"
                run_git(["clone", "--quiet", "--branch", self.main_branch, "--",
                         str(self.bare), str(clone)])
                run_git(["merge", "--no-ff", "--quiet", "-m", title, "-m", message,
                         f"origin/{data['branch']}"], clone, error_code="merge_conflict")
                merged = run_git(["rev-parse", "HEAD"], clone).strip()
                run_git(["push", "--quiet", "origin", self.main_branch], clone,
                        error_code="merge_refused")
            finally:
                shutil.rmtree(work, ignore_errors=True)
            data.update(state="merged", merged_commit=merged, head=head)
            self._save(data)
        return merged
