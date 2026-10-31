"""`GitHubHost` : pull requests, revues et fusion par l'API REST de GitHub (plan 0006).

`urllib` de la bibliothèque standard : aucune dépendance de plus à empaqueter. Le jeton
vient du coffre de l'espace, obtenu par le device flow (`device.py`, plan 0025) ; à
défaut, de `ATLAS_GITHUB_TOKEN` (tests, intégration continue). Il ne figure dans aucun
message d'erreur : seuls le statut HTTP et le message de GitHub remontent.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

from ..governance.rules import Review
from ..repo.git import RepoError
from .base import Comment, GitHost, PullRequest, ReviewEvent

API_URL = "https://api.github.com"
_EVENTS = {"approve": "APPROVE", "request_changes": "REQUEST_CHANGES", "comment": "COMMENT"}
_STATES = {"APPROVED": "approved", "CHANGES_REQUESTED": "changes_requested"}
_REMOTE = re.compile(r"^(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)"
                     r"(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+?)(?:\.git)?/?$")
_ERRORS = {401: "host_auth_failed", 403: "host_forbidden", 404: "not_found",
           409: "head_changed", 422: "host_rejected"}


def github_repository(remote_url: str) -> tuple[str, str] | None:
    match = _REMOTE.match(remote_url)
    return (match["owner"], match["repo"]) if match else None


def github_token(workspace_id: str | None = None) -> str | None:
    """Le jeton de l'espace au coffre s'il est utilisable, sinon `ATLAS_GITHUB_TOKEN`."""
    if workspace_id:
        from .device import stored  # import tardif : device importe ce module

        try:
            credential = stored(workspace_id)
        except RepoError:
            credential = None  # coffre indisponible : le repli de l'environnement
        if credential is not None and credential.state() == "connected":
            return credential.access_token
    return os.environ.get("ATLAS_GITHUB_TOKEN") or None


class GitHubHost(GitHost):
    def __init__(self, owner: str, repo: str, token: str | None, main_branch: str = "main",
                 api_url: str | None = None):
        self.owner, self.repo, self.main_branch = owner, repo, main_branch
        self._token = token
        self.api_url = (api_url or os.environ.get("ATLAS_GITHUB_API_URL") or API_URL).rstrip("/")
        self._account: str | None = None

    def _request(self, method: str, path: str, payload: dict | None = None) -> Any:
        if not self._token:
            raise RepoError("host_auth_failed", "Aucun jeton GitHub pour cet espace : se "
                            "connecter à GitHub dans Mes connexions.")
        request = urllib.request.Request(
            f"{self.api_url}{path}", method=method,
            data=None if payload is None else json.dumps(payload).encode("utf-8"),
            headers={"Authorization": f"Bearer {self._token}",
                     "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "skifer-atlas",
                     "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read()
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read() or b"{}").get("message", "")
            except ValueError:
                detail = ""
            code = _ERRORS.get(error.code, "host_failed")
            if error.code == 405:
                # Atlas a déjà vérifié le décompte : hors conflit, c'est une règle de branche.
                code = "merge_conflict" if "not mergeable" in detail.lower() else \
                    "branch_protected"
            raise RepoError(code, f"GitHub a répondu {error.code}"
                            + (f" : {detail}" if detail else ".")) from None
        except (urllib.error.URLError, TimeoutError) as error:
            raise RepoError("host_unreachable", f"GitHub injoignable : {error}") from None
        return json.loads(body) if body else None

    def _repo(self) -> str:
        return f"/repos/{self.owner}/{self.repo}"

    def _paged(self, path: str) -> list:
        found, page = [], 1
        while True:
            separator = "&" if "?" in path else "?"
            batch = self._request("GET", f"{path}{separator}per_page=100&page={page}")
            found.extend(batch)
            if len(batch) < 100:
                return found
            page += 1

    @staticmethod
    def _pull(data: dict) -> PullRequest:
        state = "merged" if data.get("merged_at") else data["state"]
        return PullRequest(data["number"], data["head"]["ref"], data["title"],
                           data.get("body") or "", data["user"]["login"], state,
                           data["head"]["sha"], data["created_at"],
                           data.get("merge_commit_sha") if state == "merged" else None)

    def current_account(self) -> str:
        if self._account is None:
            self._account = self._request("GET", "/user")["login"]
        return self._account

    def create_pull_request(self, branch: str, title: str, body: str) -> PullRequest:
        return self._pull(self._request("POST", f"{self._repo()}/pulls", {
            "title": title, "head": branch, "base": self.main_branch, "body": body}))

    def list_pull_requests(self, state: str = "all") -> list[PullRequest]:
        query = "all" if state in ("all", "merged") else state
        pulls = [self._pull(p) for p in self._paged(f"{self._repo()}/pulls?state={query}")]
        return sorted((p for p in pulls if state == "all" or p.state == state),
                      key=lambda p: p.number)

    def get_pull_request(self, number: int) -> PullRequest:
        return self._pull(self._request("GET", f"{self._repo()}/pulls/{number}"))

    def get_reviews(self, number: int) -> list[Review]:
        return [Review(r["user"]["login"], _STATES.get(r["state"], "commented"),
                       r.get("commit_id") or "", r.get("submitted_at") or "", r.get("body") or "")
                for r in self._paged(f"{self._repo()}/pulls/{number}/reviews")
                if r.get("state") != "PENDING"]

    def submit_review(self, number: int, event: ReviewEvent, body: str) -> None:
        self._request("POST", f"{self._repo()}/pulls/{number}/reviews",
                      {"event": _EVENTS[event], "body": body})

    def list_comments(self, number: int) -> list[Comment]:
        return [Comment(c["user"]["login"], c.get("body") or "", c["created_at"])
                for c in self._paged(f"{self._repo()}/issues/{number}/comments")]

    def add_comment(self, number: int, body: str) -> Comment:
        data = self._request("POST", f"{self._repo()}/issues/{number}/comments", {"body": body})
        return Comment(data["user"]["login"], data.get("body") or "", data["created_at"])

    def merge(self, number: int, head: str, title: str, message: str) -> str:
        data = self._request("PUT", f"{self._repo()}/pulls/{number}/merge", {
            "merge_method": "merge", "sha": head, "commit_title": title,
            "commit_message": message})
        return data["sha"]
