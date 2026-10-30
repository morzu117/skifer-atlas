"""Lister et décrire les propositions ; commenter, approuver (plan 0006).

Le décompte se refait à chaque lecture, avec la gouvernance de la branche principale :
une règle qui change s'applique aux propositions déjà ouvertes.
"""

from __future__ import annotations

from ..githost.base import PullRequest
from ..governance.model import member_domains
from ..governance.rules import decide, requirement
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
        found["awaiting_me"] = _awaiting(context, pull, block, decision)
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


def _awaiting(context: Context, pull: PullRequest, block: dict, decision) -> bool:
    """Ouverte, d'un autre auteur, et j'y suis habilité sans m'être encore prononcé sur le
    dernier commit : c'est le compteur orange de la navigation."""
    account = context.account
    eligible = requirement(context.governance, block["nature"], block.get("domain")).eligible
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
