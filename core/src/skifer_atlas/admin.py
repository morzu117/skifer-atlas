"""Administration d'un espace (plan 0017) : la gouvernance telle que l'écran la modifie,
réservée aux référents d'espace, et son enregistrement en proposition.

Un référent seul (ADR 0008) voit sa proposition fusionnée aussitôt, avec la mention
« Fusionnée sans revue » ; à partir de deux référents, elle attend une revue. Aucun
token n'est lu ni rendu ici : les plateformes autorisées ne sont que des noms.
"""

from __future__ import annotations

import hashlib

import duckdb

from .connections import PLATFORM_LABELS, SUPPORTED_PLATFORMS
from .governance.model import (
    Governance,
    ValidatorsRequired,
    domain_referents,
    parse_governance,
    space_referents,
)
from .index import ensure_index, index_fresh
from .proposals import create_governance_proposal, merge_proposal
from .repo.git import RepoError
from .repo.layout import GOVERNANCE_FILE, read_meta
from .repo.sync import host_account
from .workspaces import Workspace, get_workspace, index_path, repo_dir

# Plateformes que l'écran propose, avec leur mode d'authentification (maquette 10.7).
# DuckDB, l'exécution locale, n'y figure pas : une autorisation existante est conservée.
PLATFORM_AUTH = {
    "databricks": "OAuth · token personnel",
    "snowflake": "SSO · paire de clés",
    "bigquery": "OAuth Google",
    "fabric": "Entra ID",
    "redshift": "IAM",
}


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _current(workspace_id: str) -> tuple[Workspace, Governance, str]:
    """L'espace, sa gouvernance et le texte de `governance.yaml` ; `forbidden` si
    l'utilisateur n'est pas référent de l'espace (un référent de domaine ne l'est pas)."""
    workspace = get_workspace(workspace_id)
    if workspace is None:
        raise RepoError("not_found", f"Espace « {workspace_id} » inconnu.")
    repo = repo_dir(workspace.id)
    path = repo / GOVERNANCE_FILE
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    governance = parse_governance(text)[0]
    # Le compte de l'hébergeur, comme pour les propositions qui en découlent.
    account = (host_account(workspace.git_remote, read_meta(repo).main_branch)
               if workspace.git_remote else "") or workspace.account
    if governance is None or account not in space_referents(governance):
        raise RepoError("forbidden", "L'administration est réservée aux référents de "
                        "l'espace.")
    return workspace.model_copy(update={"account": account}), governance, text


def is_space_referent(workspace: Workspace) -> bool:
    path = repo_dir(workspace.id) / GOVERNANCE_FILE
    if not path.exists():
        return False
    governance = parse_governance(path.read_text(encoding="utf-8"))[0]
    return governance is not None and workspace.account in space_referents(governance)


def _document_counts(workspace_id: str, kinds: tuple[str, ...]) -> dict[str, int]:
    try:
        connection = ensure_index(repo_dir(workspace_id), index_path(workspace_id))
    except (RepoError, OSError, duckdb.Error):
        return {}
    try:
        rows = connection.execute('SELECT domain, count(*) FROM "index".documents '
                                  "WHERE list_contains(?, kind) GROUP BY domain",
                                  [list(kinds)]).fetchall()
    finally:
        connection.close()
    return {domain: count for domain, count in rows if domain}


def _kpi_counts(workspace_id: str) -> dict[str, int]:
    return _document_counts(workspace_id, ("kpi",))


def _check_removed_domains(workspace_id: str, old: Governance, new: Governance) -> None:
    """Un domaine retiré ne doit plus porter de document : ses KPI, concepts et
    déclinaisons perdraient leurs référents et leurs validateurs (plan 0023)."""
    kept = {d.id for d in new.domains}
    counts = _document_counts(workspace_id, ("concept", "kpi", "variant"))
    used = [(d.label, counts[d.id]) for d in old.domains if d.id not in kept and counts.get(d.id)]
    if used:
        detail = ", ".join(f"« {label} » ({n} document{'s' if n > 1 else ''})"
                           for label, n in used)
        raise RepoError("domain_in_use", f"Domaine encore utilisé : {detail}. Rattacher ses "
                        "documents à un autre domaine avant de le retirer.")


def admin_state(workspace_id: str) -> dict:
    """Ce que l'écran 10.7 affiche et modifie, lu sur le clone."""
    workspace, governance, text = _current(workspace_id)
    referents = space_referents(governance)
    repo = repo_dir(workspace.id)
    return {
        "governance": governance.model_dump(mode="json"),
        "base_digest": _digest(text),
        "warnings": [d.label for d in governance.domains
                     if not domain_referents(governance, d.id)],
        "space_referents": sorted(referents),
        "single_referent": len(referents) == 1,
        "kpi_counts": _kpi_counts(workspace.id),
        # Tous les documents d'un domaine : un domaine qui en porte ne se retire pas.
        "document_counts": _document_counts(workspace.id, ("concept", "kpi", "variant")),
        "platforms": [{"id": p, "label": PLATFORM_LABELS[p], "auth": auth,
                       "supported": p in SUPPORTED_PLATFORMS}
                      for p, auth in PLATFORM_AUTH.items()],
        "repository": {
            "url": workspace.git_remote,
            "main_branch": read_meta(repo).main_branch,
            "synced_at": workspace.synced_at or None,
            "index_fresh": index_fresh(repo, index_path(workspace.id)),
        },
    }


def _names(accounts: list[str], governance: Governance) -> str:
    names = {m.account: m.name for m in governance.members}
    return ", ".join(names.get(a, a) for a in accounts) or "aucun"


def _levels(levels: ValidatorsRequired | None) -> str:
    return f"canonique {levels.canonical} · déclinaisons {levels.variants}" if levels else "globaux"


def describe_changes(old: Governance, new: Governance) -> list[str]:
    """Les modifications, en phrases : la justification de la proposition."""
    changes = []
    if old.validators_required != new.validators_required:
        changes.append(f"Validateurs requis : {_levels(old.validators_required)} → "
                       f"{_levels(new.validators_required)}.")
    before = {d.id: d for d in old.domains}
    after = {d.id: d for d in new.domains}
    for domain in new.domains:
        previous = before.get(domain.id)
        if previous is None:
            changes.append(f"Domaine « {domain.label} » ajouté.")
            continue
        if previous.label != domain.label:
            changes.append(f"Domaine « {previous.label} » renommé « {domain.label} ».")
        if previous.referents != domain.referents:
            changes.append(f"Référents de « {domain.label} » : "
                           f"{_names(domain.referents, new)}.")
        if previous.validators != domain.validators:
            changes.append(f"Validateurs de « {domain.label} » : "
                           f"{_names(domain.validators, new)}.")
        if previous.validators_required != domain.validators_required:
            changes.append(f"Validateurs requis pour « {domain.label} » : "
                           f"{_levels(domain.validators_required)}.")
    changes += [f"Domaine « {d.label} » retiré." for i, d in before.items() if i not in after]
    members = {m.account: m for m in old.members}
    for member in new.members:
        previous = members.get(member.account)
        roles = ", ".join(r.role + (f" ({', '.join(r.domains)})" if r.domains else "")
                          for r in member.roles) or "aucun rôle"
        if previous is None:
            changes.append(f"{member.name} ({member.account}) invité : {roles}.")
        elif previous != member:
            changes.append(f"{member.name} ({member.account}) : {roles}"
                           + (f", entité {member.entity}" if member.entity else "") + ".")
    kept = {m.account for m in new.members}
    changes += [f"{m.name} ({m.account}) retiré." for m in old.members if m.account not in kept]
    if old.allowed_platforms != new.allowed_platforms:
        changes.append("Plateformes autorisées : "
                       f"{', '.join(new.allowed_platforms) or 'aucune'}.")
    if old.tolerance != new.tolerance:
        changes.append(f"Tolérance : {new.tolerance_percent} %.")
    # Un nom abrégé (« Claire M. ») termine déjà la phrase.
    return [change[:-1] if change.endswith("..") else change for change in changes]


def save_governance(workspace_id: str, data: dict, base_digest: str) -> dict:
    """Crée la proposition « Gouvernance » ; la fusionne aussitôt si aucun autre compte
    n'est habilité à l'approuver (référent seul, ADR 0008)."""
    workspace, governance, _ = _current(workspace_id)
    try:
        proposed = Governance.model_validate(data)
    except ValueError:
        proposed = None  # create_governance_proposal dira pourquoi
    if proposed is not None:
        _check_removed_domains(workspace.id, governance, proposed)
    changes = describe_changes(governance, proposed) if proposed else []
    justification = ("Paramètres modifiés depuis l'administration de l'espace :\n"
                     + "\n".join(f"- {change}" for change in changes)
                     if changes else "Paramètres de l'espace.")
    created = create_governance_proposal(workspace.id, data, justification, base_digest)
    alone = not (space_referents(governance) - {workspace.account})
    if not alone:
        return {**created, "merged": False, "mention": None, "changes": changes}
    merged = merge_proposal(workspace.id, created["id"])
    return {**created, "merged": True, "mention": merged["mention"], "changes": changes}


__all__ = ["PLATFORM_AUTH", "admin_state", "describe_changes", "is_space_referent",
           "save_governance"]
