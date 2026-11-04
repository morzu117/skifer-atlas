"""Fusionner une proposition prête, poser le tag de version, resynchroniser (plan 0006).

La fusion revérifie tout au dernier moment : décompte sur la tête de branche, base
toujours courante. Le message porte `Atlas-Review`, qui dit qui a approuvé, ou qu'aucun
autre compte n'était habilité (ADR 0008).
"""

from __future__ import annotations

import hashlib

from ..governance.rules import decide
from ..repo.git import RepoError
from ..repo.sync import sync_workspace
from ..repo.versions import tag_name
from .common import open_context, parse_body, review_domain
from .create import SHARED_FILES, current_version


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
    domain = review_domain(context, target, block.get("base_version"), block.get("domain"))
    decision = decide(context.governance, block["nature"], domain, pull.author,
                      context.host.get_reviews(number), pull.head)
    if not decision.ready_to_merge:
        raise RepoError("not_ready", decision.explanation or "Validations insuffisantes.")
    if target["kind"] in SHARED_FILES:
        current = context.show(target["path"]) or ""
        # `base_governance` : propositions de gouvernance créées avant le plan 0008.
        base = block.get("base_digest", block.get("base_governance"))
        if hashlib.sha256(current.encode("utf-8")).hexdigest() != base:
            raise RepoError("stale_base", f"{target['path']} a changé depuis la proposition : "
                            "la reproposer.")
    elif current_version(context, target["path"]) != block.get("base_version"):
        raise RepoError("stale_base", f"« {target['id']} » a changé depuis la proposition : "
                        "la reproposer à partir de la version courante.")
    review = ("none (no other eligible approver)" if decision.merge_mode == "no_other_eligible"
              else "approved by " + ", ".join(decision.approvers))
    message = (f"{justification}\n\nAtlas-Proposal: #{number}\nAtlas-Review: {review}"
               if justification else f"Atlas-Proposal: #{number}\nAtlas-Review: {review}")
    merged = context.host.merge(number, pull.head, f"Fusion de la proposition #{number} : "
                                f"{pull.title}", message)
    tag = None
    if target["kind"] not in SHARED_FILES:
        tag = tag_name(target["id"], block["version"])
    # La synchronisation retrouve les versions fusionnées et publie leurs tags.
    # Une panne après la fusion ne doit pas faire croire à l'appelant que la PR est ouverte.
    try:
        warnings = sync_workspace(workspace_id)["warnings"]
    except RepoError as error:
        warnings = [{"code": "post_merge_sync_failed", "message":
                     f"La proposition est fusionnée ; la synchronisation a échoué "
                     f"({error.code}). Relancer la synchronisation pour publier le tag."}]
    return {"id": number, "commit": merged, "tag": tag, "version": block.get("version"),
            "merge_mode": decision.merge_mode, "mention": decision.mention,
            "warnings": warnings}
