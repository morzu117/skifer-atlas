"""Classification du document à la tête, jamais celle d'un ancien bloc de PR."""

from dataclasses import replace
from functools import lru_cache
from pathlib import Path

from ..governance.rules import requirement
from ..index.build import analyze
from ..repo.git import RepoError, run_git
from ..repo.versions import tag_name
from .common import Context, checkout, review_domain
from .create import _diff, _domain, _issues, _nature


@lru_cache(maxsize=128)
def _analyzed(repo: Path, head: str):
    with checkout(repo, head) as root:
        return analyze(root, repo)


def current_block(context: Context, head: str, block: dict) -> dict:
    target = block["target"]
    if target["kind"] not in ("concept", "kpi", "variant"):
        return block
    analysis = _analyzed(context.repo, head)
    entry = analysis.entry(target["id"])
    if entry is None or entry.document is None or any(i.severity == "error" for i in entry.issues):
        raise RepoError("invalid_document", "Le document proposé est invalide.",
                        _issues(entry.issues) if entry else [])
    nature = _nature(target, entry)
    domain = _domain(target, analysis, entry)
    need = requirement(context.governance, nature,
                       review_domain(context, target, block.get("base_version"), domain))
    comparison = context
    version = block.get("base_version")
    if target["kind"] != "variant" and version is not None:
        try:
            base = run_git(["rev-parse", "--verify", f"refs/tags/{tag_name(target['id'], version)}^{{commit}}"],
                           context.repo).strip()
            comparison = replace(context, base=base)
        except RepoError:
            pass  # ancienne proposition sans tag : repli sur la branche principale
    differences = None if target["kind"] != "variant" and version is None else \
        _diff(comparison, target, analysis, entry)
    return {**block, "nature": nature, "domain": domain, "mention": need.mention,
            "diff": differences,
            "warnings": _issues([i for i in entry.issues if i.severity != "error"])}
