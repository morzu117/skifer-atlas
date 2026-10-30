"""Lister et décrire les propositions ; commenter, approuver (plan 0006).

Le décompte se refait à chaque lecture, avec la gouvernance de la branche principale :
une règle qui change s'applique aux propositions déjà ouvertes.
"""

from __future__ import annotations

from ..githost.base import PullRequest
from ..governance.model import member_domains
from ..governance.rules import decide
from ..repo.git import RepoError
from .common import Context, open_context, parse_body


def describe(context: Context, pull: PullRequest, detail: bool = False) -> dict:
    justification, block = parse_body(pull.body)
    found = {"id": pull.number, "title": pull.title, "branch": pull.branch,
             "author": pull.author, "state": pull.state, "created_at": pull.created_at,
             "head": pull.head, "merged_commit": pull.merged_commit, "atlas": block is not None}
    if block is None:
        return found
    target = block["target"]
    found.update(document_id=target["id"], document_kind=target["kind"],
                 kpi_id=target.get("kpi_id"), entity=target.get("entity"),
                 nature=block["nature"], domain=block.get("domain"),
                 base_version=block.get("base_version"), version=block.get("version"))
    reviews = context.host.get_reviews(pull.number) if pull.state == "open" or detail else []
    if pull.state == "open":
        decision = decide(context.governance, block["nature"], block.get("domain"),
                          pull.author, reviews, pull.head)
        found.update(decision.to_dict())
        if block.get("mention") and decision.merge_mode == "reviewed":
            found["mention"] = block["mention"]
    if detail:
        revision = pull.merged_commit or pull.head
        found.update(
            justification=justification, block=block,
            reviews=[{"account": r.account, "state": r.state, "commit": r.commit,
                      "submitted_at": r.submitted_at, "body": r.body,
                      "outdated": r.commit != pull.head} for r in reviews],
            comments=[c.to_dict() for c in context.host.list_comments(pull.number)],
            content=context.show(target["path"], revision),
        )
    return found


def _matches(item: dict, filters: dict) -> bool:
    return all(value is None or item.get(key) == value for key, value in filters.items())


def list_proposals(workspace_id: str, domain: str | None = None, kpi: str | None = None,
                   author: str | None = None, entity: str | None = None,
                   status: str | None = "open") -> list[dict]:
    """Propositions créées par Atlas ; celles des domaines de l'utilisateur d'abord."""
    context = open_context(workspace_id)
    pulls = context.host.list_pull_requests(status or "all")
    items = [describe(context, pull) for pull in pulls]
    filters = {"domain": domain, "kpi_id": kpi, "author": author, "entity": entity}
    items = [i for i in items if i["atlas"] and _matches(i, filters)]
    mine = member_domains(context.governance, context.account)
    return sorted(items, key=lambda i: (i.get("domain") not in mine, -i["id"]))


def get_proposal(workspace_id: str, number: int) -> dict:
    context = open_context(workspace_id)
    found = describe(context, context.host.get_pull_request(number), detail=True)
    if not found["atlas"]:
        raise RepoError("not_found", f"La pull request #{number} n'est pas une proposition "
                        "Atlas.")
    return found


def comment(workspace_id: str, number: int, body: str) -> dict:
    context = open_context(workspace_id)
    return context.host.add_comment(number, body).to_dict()


def review(workspace_id: str, number: int, event: str, body: str) -> dict:
    """Approuver ou demander des changements. Tout compte peut le faire ; seuls les
    comptes habilités comptent dans le décompte."""
    context = open_context(workspace_id)
    pull = context.host.get_pull_request(number)
    if pull.state != "open":
        raise RepoError("not_open", f"La proposition #{number} n'est plus ouverte.")
    context.host.submit_review(number, event, body)
    return describe(context, context.host.get_pull_request(number))
