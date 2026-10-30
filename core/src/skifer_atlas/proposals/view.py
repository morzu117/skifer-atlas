"""Écran des propositions (plan 0014) : la file avec ce qu'il faut pour la filtrer, ce
que le compte courant peut faire d'une proposition, et les deux graphes du diff.

Les règles restent celles du plan 0006 (`governance.rules`) : ce module ne fait que les
lire pour expliquer un bouton désactivé.
"""

from __future__ import annotations

from typing import Any

from ..diff import DiffContext, diff
from ..governance.model import ROLE_RANK, domain_approvers
from ..governance.rules import requirement
from ..index.build import Analysis, analyze
from ..model.io import validate_text
from ..model.layout import layout
from ..model.resolve import ResolvedGraph, resolve
from ..repo import versions as repo_versions
from ..repo.git import RepoError
from ..sheet import resolved_graph
from .common import Context, open_context, parse_body
from .status import list_proposals


def queue(workspace_id: str, status: str = "open") -> dict:
    """La file et ses filtres : domaines où le compte valide (« Mes domaines »), libellés
    des domaines, entités et noms des membres."""
    items = list_proposals(workspace_id, status=status)
    context = open_context(workspace_id, fetch=False)
    governance = context.governance
    reviewing = sorted(d.id for d in governance.domains
                       if context.account in domain_approvers(governance, d.id))
    entities = sorted({m.entity for m in governance.members if m.entity}
                      | set(context.workspace.entities)
                      | {i["entity"] for i in items if i.get("entity")})
    return {
        "account": context.account, "role": context.role(), "review_domains": reviewing,
        "domains": [{"id": d.id, "label": d.label} for d in governance.domains],
        "entities": entities,
        "members": {m.account: m.name for m in governance.members},
        "items": items,
    }


def viewer(context: Context, found: dict) -> dict:
    """Ce que le compte courant peut faire de la proposition, et pourquoi pas."""
    account = context.account
    open_ = found.get("state") == "open"
    eligible = requirement(context.governance, found["nature"], found.get("domain")).eligible
    if not open_:
        reason = "La proposition n'est plus ouverte."
    elif account == found["author"]:
        reason = "Vous êtes l'auteur de cette proposition : un autre compte doit l'approuver."
    elif account not in eligible:
        who = ", ".join(sorted(eligible - {found["author"]})) or "aucun autre compte"
        reason = f"Votre approbation ne compterait pas ici. Comptes habilités : {who}."
    else:
        reason = None
    contributor = ROLE_RANK[context.role()] >= ROLE_RANK["contributeur"]
    can_merge = open_ and bool(found.get("ready_to_merge")) and contributor
    return {
        "account": account, "can_review": reason is None, "review_reason": reason,
        "can_merge": can_merge,
        "merge_reason": None if can_merge else (
            "Rôle contributeur requis pour fusionner." if not contributor
            else found.get("explanation") or "Validations insuffisantes."),
    }


# --- graphes du diff -----------------------------------------------------------------------

def _graph(resolved: ResolvedGraph, label: str) -> dict:
    overrides = [o.node for o in resolved.overrides] if resolved.variant is not None else []
    return {"label": label, **layout(resolved.document), "overrides": overrides}


def _base(context: Context, analysis: Analysis, block: dict, document: Any) -> tuple[Any, str]:
    """Le graphe de référence : le canonique désigné pour une variante, la version de base
    pour une nouvelle version ; None pour une création."""
    target = block["target"]
    if document.kind == "variant":
        canonical = analysis.library.kpi(document.variant_of.id, document.variant_of.version)
        if canonical is None:
            raise RepoError("invalid_document", "Le canonique de la variante est introuvable.")
        return ResolvedGraph(canonical), f"Canonique v{document.variant_of.version}"
    version = block.get("base_version")
    if version is None:
        return None, ""
    text = repo_versions.document_at(context.repo, target["id"], version, target["path"])
    return resolved_graph(validate_text(text).document, analysis, f"La v{version}"), \
        f"Version {version}"


def _undeclared(resolved: ResolvedGraph, base: ResolvedGraph | None) -> list[dict]:
    labels = {n.id: n.label for n in base.document.graph.nodes} if base else {}
    return [{"node": o.node, "label": labels.get(o.node)}
            for o in resolved.overrides if o.classification == "undeclared"]


def _recurring(context: Context, analysis: Analysis, block: dict, number: int,
               undeclared: list[dict]) -> list[dict]:
    """Nœuds surchargés hors points déclarés par au moins deux entités : variantes de la
    branche principale et propositions ouvertes, celle-ci comprise."""
    target = block["target"]
    by_node: dict[str, set[str]] = {u["node"]: {target["entity"]} for u in undeclared}
    if not by_node:
        return []
    for entry in analysis.entries:
        document = entry.document
        if document is None or document.kind != "variant" or document.mode != "override" \
                or document.variant_of.id != target["kpi_id"]:
            continue
        canonical = analysis.library.kpi(document.variant_of.id, document.variant_of.version)
        if canonical is None:
            continue
        for override in resolve(document, canonical, analysis.library).overrides:
            if override.classification == "undeclared" and override.node in by_node:
                by_node[override.node].add(document.entity)
    for pull in context.host.list_pull_requests("open"):
        if pull.number == number:
            continue
        _, other = parse_body(pull.body)
        if not other or other["target"].get("kpi_id") != target["kpi_id"] \
                or other.get("nature") != "undeclared":
            continue
        for difference in (other.get("diff") or {}).get("differences", []):
            if difference.get("classification") == "override_undeclared" \
                    and difference.get("node") in by_node:
                by_node[difference["node"]].add(other["target"]["entity"])
    labels = {u["node"]: u["label"] for u in undeclared}
    return [{"node": node, "label": labels[node], "entities": sorted(entities)}
            for node, entities in by_node.items() if len(entities) >= 2]


def graphs(workspace_id: str, number: int) -> dict:
    """Les deux graphes disposés, le rapport de diff complet (plan 0003), les surcharges
    hors points déclarés et celles qui reviennent d'une entité à l'autre."""
    context = open_context(workspace_id, fetch=False)
    pull = context.host.get_pull_request(number)
    _, block = parse_body(pull.body)
    if block is None:
        raise RepoError("not_found", f"La pull request #{number} n'est pas une proposition "
                        "Atlas.")
    empty = {"base": None, "proposed": None, "report": None, "undeclared": [],
             "recurring": []}
    target = block["target"]
    if target["kind"] not in ("kpi", "concept", "variant"):
        return empty
    text = context.show(target["path"], pull.merged_commit or pull.head)
    document = validate_text(text).document if text else None
    if document is None or (document.kind != "variant" and document.graph is None):
        return empty
    analysis = analyze(context.repo)
    proposed = resolved_graph(document, analysis, "La proposition")
    base, base_label = _base(context, analysis, block, document)
    relation = document.mode if document.kind == "variant" else "version"
    report = diff(base, proposed, DiffContext(relation, analysis.library)) if base else None
    undeclared = _undeclared(proposed, base) if document.kind == "variant" else []
    entity = f"Déclinaison {target['entity']}" if target.get("entity") else "Proposition"
    return {
        "base": _graph(base, base_label) if base else None,
        "proposed": _graph(proposed, f"{entity} v{block.get('version')} (proposée)"),
        "report": report.model_dump(mode="json") if report else None,
        "undeclared": undeclared,
        "recurring": _recurring(context, analysis, block, number, undeclared),
    }
