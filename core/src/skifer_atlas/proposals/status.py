"""Lister et décrire les propositions ; commenter, approuver (plan 0006).

Le décompte se refait à chaque lecture, avec la gouvernance de la branche principale :
une règle qui change s'applique aux propositions déjà ouvertes.
"""

from __future__ import annotations

from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

from ..diff import DiffContext, diff
from ..githost.base import PullRequest
from ..governance.model import member_domains
from ..governance.rules import decide, requirement
from ..model.io import read_yaml, validate_text
from ..model.resolve import ResolvedGraph, resolve
from ..repo.git import RepoError, run_git
from ..repo.layout import document_path
from ..repo.versions import document_at
from .common import Context, open_context, parse_body, review_domain
from .current import current_block


def _label(context: Context, target: dict, revision: str) -> str:
    """Libellé du document Git, indépendant d'un titre de PR modifié sur GitHub."""
    if target["kind"] == "variant":
        path = document_path("kpi", target["kpi_id"])
        revision = context.base
        fallback = target["kpi_id"]
    elif target["kind"] in ("kpi", "concept"):
        path = target["path"]
        fallback = target["id"]
    elif target["kind"] == "governance":
        return "Gouvernance de l'espace"
    else:
        return f"Point d'accès {target['id']}"
    text = context.show(path, revision)
    raw, _ = read_yaml(text) if text else (None, [])
    label = raw.get("label") if isinstance(raw, dict) else None
    return label if isinstance(label, str) and label.strip() else fallback


def _utc(value: str) -> str:
    """Dates du fil dans un format UTC commun, sans perdre la précision fournie."""
    if not value:
        return value
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return value
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z")


def describe(context: Context, pull: PullRequest, detail: bool = False) -> dict:
    justification, block = parse_body(pull.body)
    found = {"id": pull.number, "title": pull.title, "branch": pull.branch,
             "author": pull.author, "state": pull.state, "created_at": _utc(pull.created_at),
             "head": pull.head, "merged_commit": pull.merged_commit, "atlas": block is not None}
    if block is None:
        return found
    block = current_block(context, pull.head, block)
    target = block["target"]
    found.update(document_id=target["id"], document_kind=target["kind"],
                 document_label=_label(context, target, pull.merged_commit or pull.head),
                 kpi_id=target.get("kpi_id"), entity=target.get("entity"),
                 nature=block["nature"], domain=block.get("domain"),
                 base_version=block.get("base_version"), version=block.get("version"))
    reviews = context.host.get_reviews(pull.number) if pull.state == "open" or detail else []
    if pull.state == "open":
        domain = review_domain(context, target, block.get("base_version"), block.get("domain"))
        decision = decide(context.governance, block["nature"], domain,
                          pull.author, reviews, pull.head)
        found.update(decision.to_dict())
        found["awaiting_me"] = _awaiting(context, pull, block, decision)
        if block.get("mention") and decision.merge_mode == "reviewed":
            found["mention"] = block["mention"]
    if detail:
        revision = pull.merged_commit or pull.head
        latest = {r.account: i for i, r in enumerate(reviews) if r.state != "commented"}
        blocking = set(found.get("changes_requested_by", []))
        found.update(
            justification=justification, block=block,
            reviews=[{"account": r.account, "state": r.state, "commit": r.commit,
                      "submitted_at": _utc(r.submitted_at), "body": r.body,
                      "outdated": r.commit != pull.head,
                      "blocking": r.state == "changes_requested" and r.account in blocking
                      and latest.get(r.account) == i} for i, r in enumerate(reviews)],
            comments=[{**c.to_dict(), "created_at": _utc(c.created_at)}
                      for c in context.host.list_comments(pull.number)],
            revisions=_revisions(context, pull, target),
            content=context.show(target["path"], revision),
        )
    return found


def _revisions(context: Context, pull: PullRequest, target: dict) -> list[dict]:
    """Commits propres à la branche, du plus ancien au plus récent."""
    base = f"{pull.merged_commit}^1" if pull.merged_commit else context.base
    merge_base = run_git(["merge-base", base, pull.head], context.repo).strip()
    commits = run_git(["rev-list", "--reverse", f"{merge_base}..{pull.head}"], context.repo).splitlines()
    result = []
    previous = None
    for index, commit in enumerate(commits):
        metadata = run_git(["show", "-s", "--format=%an%x00%aI%x00%B", commit], context.repo)
        author, date, message = metadata.split("\0", 2)
        count = 0
        if previous is not None:
            count = _revision_difference(context.repo, target["path"], previous, commit,
                                         target.get("kpi_id"))
        message = message.strip()
        if index == 0:
            author = pull.author
        parts = message.split("\n\n", 1)
        result.append({"rank": index + 1, "commit": commit, "date": _utc(date), "author": author,
                       "note": parts[1].strip() if len(parts) > 1 else "", "differences": count})
        previous = commit
    return result


@lru_cache(maxsize=1024)
def _revision_difference(repo: Path, path: str, previous: str, commit: str,
                         kpi_id: str | None) -> int:
    """Diff du seul document ; les commits Git sont immuables, donc la paire est une clé stable."""
    def document(revision: str):
        try:
            return validate_text(run_git(["show", f"{revision}:{path}"], repo)).document
        except RepoError:
            return None

    old, new = document(previous), document(commit)
    if not old or not new:
        return 0
    if new.kind == "variant" and old.kind == "variant" and kpi_id:
        try:
            old_canonical = validate_text(document_at(repo, kpi_id, old.variant_of.version,
                                                      document_path("kpi", kpi_id))).document
            new_canonical = validate_text(document_at(repo, kpi_id, new.variant_of.version,
                                                      document_path("kpi", kpi_id))).document
        except RepoError:
            return 0
        if old_canonical is None or new_canonical is None:
            return 0
        before, after = resolve(old, old_canonical), resolve(new, new_canonical)
    elif old.kind != "variant" and new.kind != "variant" and old.graph and new.graph:
        before, after = ResolvedGraph(old), ResolvedGraph(new)
    else:
        return 0
    if before.document is None or after.document is None:
        return 0
    return len(diff(before, after, DiffContext("version")).differences)


def _awaiting(context: Context, pull: PullRequest, block: dict, decision) -> bool:
    """Ouverte, d'un autre auteur, et j'y suis habilité sans m'être encore prononcé sur le
    dernier commit : c'est le compteur orange de la navigation."""
    account = context.account
    domain = review_domain(context, block["target"], block.get("base_version"),
                           block.get("domain"))
    eligible = requirement(context.governance, block["nature"], domain).eligible
    return (account != pull.author and account in eligible
            and account not in decision.approvers
            and account not in decision.changes_requested_by)


def _matches(item: dict, filters: dict) -> bool:
    return all(value is None or item.get(key) == value for key, value in filters.items())


def list_proposals(workspace_id: str, domain: str | None = None, kpi: str | None = None,
                   author: str | None = None, entity: str | None = None,
                   status: str | None = "open", for_me: bool = False,
                   fetch: bool = True) -> list[dict]:
    """Propositions créées par Atlas ; celles des domaines de l'utilisateur d'abord.
    `for_me` : seulement celles qui attendent ma revue. `fetch=False` lit l'état connu du
    clone, sans réseau côté Git."""
    context = open_context(workspace_id, fetch=fetch)
    pulls = context.host.list_pull_requests("open" if for_me else status or "all")
    items = [describe(context, pull) for pull in pulls]
    filters = {"domain": domain, "kpi_id": kpi, "author": author, "entity": entity,
               "awaiting_me": True if for_me else None}
    items = [i for i in items if i["atlas"] and _matches(i, filters)]
    mine = member_domains(context.governance, context.account)
    return sorted(items, key=lambda i: (i.get("domain") not in mine, -i["id"]))


def get_proposal(workspace_id: str, number: int) -> dict:
    context = open_context(workspace_id)
    found = describe(context, context.host.get_pull_request(number), detail=True)
    if not found["atlas"]:
        raise RepoError("not_found", f"La pull request #{number} n'est pas une proposition "
                        "Atlas.")
    from .view import viewer  # évite un import circulaire

    found["viewer"] = viewer(context, found)
    return found


def comment(workspace_id: str, number: int, body: str) -> dict:
    context = open_context(workspace_id)
    comment = context.host.add_comment(number, body).to_dict()
    comment["created_at"] = _utc(comment["created_at"])
    return comment


def review(workspace_id: str, number: int, event: str, body: str) -> dict:
    """Approuver ou demander des changements. Tout compte peut le faire ; seuls les
    comptes habilités comptent dans le décompte."""
    if event == "request_changes" and not body.strip():
        raise RepoError("comment_required", "Une demande de changements s'accompagne d'un "
                        "commentaire qui dit quoi changer.")
    context = open_context(workspace_id)
    pull = context.host.get_pull_request(number)
    if pull.state != "open":
        raise RepoError("not_open", f"La proposition #{number} n'est plus ouverte.")
    context.host.submit_review(number, event, body)
    return describe(context, context.host.get_pull_request(number))
