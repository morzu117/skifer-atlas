"""Fusionner une proposition prête, poser le tag de version, resynchroniser (plan 0006).

La fusion revérifie tout au dernier moment : décompte sur la tête de branche, base
toujours courante. Le message porte `Atlas-Review`, qui dit qui a approuvé, ou qu'aucun
autre compte n'était habilité (ADR 0008).
"""

from __future__ import annotations

import hashlib

from ..governance.rules import decide
from ..repo.git import RepoError, run_git
from ..repo.layout import GOVERNANCE_FILE
from ..repo.sync import sync_workspace
from ..repo.versions import tag_name
from .common import open_context, parse_body, push
from .create import _current_version


def merge_proposal(workspace_id: str, number: int) -> dict:
    context = open_context(workspace_id, sync=True)
    context.require("contributeur")
    pull = context.host.get_pull_request(number)
    if pull.state != "open":
        raise RepoError("not_open", f"La proposition #{number} n'est plus ouverte.")
    justification, block = parse_body(pull.body)
    if block is None:
        raise RepoError("not_found", f"La pull request #{number} n'est pas une proposition "
                        "Atlas.")
    target = block["target"]
    decision = decide(context.governance, block["nature"], block.get("domain"), pull.author,
                      context.host.get_reviews(number), pull.head)
    if not decision.ready_to_merge:
        raise RepoError("not_ready", decision.explanation or "Validations insuffisantes.")
    if target["kind"] == "governance":
        current = context.show(GOVERNANCE_FILE) or ""
        if hashlib.sha256(current.encode("utf-8")).hexdigest() != block.get("base_governance"):
            raise RepoError("stale_base", "La gouvernance a changé depuis la proposition : "
                            "la reproposer.")
    elif _current_version(context, target["path"]) != block.get("base_version"):
        raise RepoError("stale_base", f"« {target['id']} » a changé depuis la proposition : "
                        "la reproposer à partir de la version courante.")
    review = ("none (no other eligible approver)" if decision.merge_mode == "no_other_eligible"
              else "approved by " + ", ".join(decision.approvers))
    message = (f"{justification}\n\nAtlas-Proposal: #{number}\nAtlas-Review: {review}"
               if justification else f"Atlas-Proposal: #{number}\nAtlas-Review: {review}")
    merged = context.host.merge(number, pull.head, f"Fusion de la proposition #{number} : "
                                f"{pull.title}", message)
    tag = None
    if target["kind"] != "governance":
        tag = tag_name(target["id"], block["version"])
        run_git(["fetch", "--quiet", "origin"], context.repo, error_code="fetch_failed",
                token=context.token)
        run_git(["tag", tag, merged], context.repo)
        push(context, f"refs/tags/{tag}")
    synced = sync_workspace(workspace_id)
    return {"id": number, "commit": merged, "tag": tag, "version": block.get("version"),
            "merge_mode": decision.merge_mode, "mention": decision.mention,
            "warnings": synced["warnings"]}
