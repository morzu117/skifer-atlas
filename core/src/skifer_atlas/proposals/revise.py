"""Révision et retrait d'une proposition ouverte."""

from ..governance.model import domain_referents, space_referents
from ..index.build import analyze
from ..model.io import dump_data, read_yaml
from ..repo.git import RepoError, run_git
from .common import checkout, commit_files, open_context, parse_body, review_domain
from .create import _issues, _target
from .status import describe


def _open(context, number):
    pull = context.host.get_pull_request(number)
    if pull.state != "open":
        raise RepoError("not_open", f"La proposition #{number} n'est plus ouverte.")
    justification, block = parse_body(pull.body)
    if block is None:
        raise RepoError("not_found", "Cette proposition n'est pas une proposition Atlas.")
    return pull, justification, block


def revise(workspace_id: str, number: int, document_yaml: str, note: str = "") -> dict:
    context = open_context(workspace_id)
    pull, _, block = _open(context, number)
    if context.account != pull.author:
        raise RepoError("forbidden", "Seul l'auteur peut modifier la proposition.")
    raw, issues = read_yaml(document_yaml)
    if issues or not isinstance(raw, dict):
        raise RepoError("invalid_document", "Le document n'est pas un YAML lisible.", _issues(issues))
    target = _target(raw)
    if target != block["target"]:
        raise RepoError("invalid_document", "Le document doit conserver son identité.")
    if not isinstance(raw.get("data_product"), dict):
        raise RepoError("invalid_document", "Le document doit contenir data_product.")
    raw["data_product"]["version"] = block["version"]
    message = "Révision de la proposition" + (f"\n\n{note.strip()}" if note.strip() else "")
    commit = commit_files(context.repo, pull.head, {target["path"]: dump_data(raw)}, message,
                          account=context.account)
    with checkout(context.repo, commit) as root:
        analysis = analyze(root, context.repo)
    entry = analysis.entry(target["id"])
    if entry is None:
        raise RepoError("invalid_document", "Document introuvable dans l'arbre proposé.")
    errors = [i for i in entry.issues if i.severity == "error"]
    if entry.document is None or errors:
        raise RepoError("invalid_document", "Le document est refusé.", _issues(errors or entry.issues))
    # Le bail compare la référence distante à la tête lue, même en cas de poussée concurrente.
    try:
        run_git(["push", "--quiet", f"--force-with-lease=refs/heads/{pull.branch}:{pull.head}",
                 "origin", f"{commit}:refs/heads/{pull.branch}"], context.repo,
                error_code="push_failed", token=context.token)
    except RepoError:
        remote = run_git(["ls-remote", "--heads", "origin", f"refs/heads/{pull.branch}"],
                         context.repo, token=context.token).split()
        if not remote or remote[0] != pull.head:
            raise RepoError("head_changed", "La branche a changé depuis sa lecture.") from None
        raise
    return describe(context, context.host.get_pull_request(number))


def close(workspace_id: str, number: int, reason: str = "") -> dict:
    context = open_context(workspace_id)
    pull, _, block = _open(context, number)
    domain = review_domain(context, block["target"], block.get("base_version"), block.get("domain"))
    allowed = space_referents(context.governance) | domain_referents(context.governance, domain)
    if context.account != pull.author and context.account not in allowed:
        raise RepoError("forbidden", "Seul l'auteur ou un référent peut retirer la proposition.")
    context.host.close(number, reason.strip())
    return describe(context, context.host.get_pull_request(number))
