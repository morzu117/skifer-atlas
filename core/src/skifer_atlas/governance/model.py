"""`governance.yaml` : domaines, membres, rôles, validations requises (plan 0006).

Un rôle sans `domains` vaut pour tout l'espace : un `referent` sans domaine est un
référent d'espace, qui seul peut faire approuver une modification de la gouvernance.
Les `referents` et `validators` d'un domaine s'ajoutent aux rôles des membres.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Annotated, Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..model.errors import Issue, issues_from_validation_error
from ..model.nodes import PLATFORMS

Role = Literal["referent", "validateur", "contributeur", "lecteur"]
ROLE_RANK: dict[str, int] = {"lecteur": 0, "contributeur": 1, "validateur": 2, "referent": 3}
ACCOUNT_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$"
DOMAIN_PATTERN = r"^[a-z0-9][a-z0-9-]{1,63}$"

Account = Annotated[str, Field(pattern=ACCOUNT_PATTERN)]
DomainId = Annotated[str, Field(pattern=DOMAIN_PATTERN)]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ValidatorsRequired(_Model):
    canonical: Annotated[int, Field(ge=1)] = 1
    variants: Annotated[int, Field(ge=1)] = 1


class Domain(_Model):
    id: DomainId
    label: str = Field(min_length=1)
    referents: list[Account] = Field(default_factory=list)
    validators: list[Account] = Field(default_factory=list)
    validators_required: ValidatorsRequired | None = None


class MemberRole(_Model):
    role: Role
    domains: list[DomainId] = Field(default_factory=list)  # vide : tout l'espace


class Member(_Model):
    account: Account
    name: str = Field(min_length=1)
    entity: str | None = None
    roles: list[MemberRole] = Field(default_factory=list)


class Tolerance(_Model):
    percent: Annotated[float, Field(ge=0, le=100)]


DEFAULT_TOLERANCE = 1.0  # sans tolérance déclarée dans l'espace (ADR 0012)


class Governance(_Model):
    schema_version: Literal[1] = 1
    validators_required: ValidatorsRequired = Field(default_factory=ValidatorsRequired)
    domains: list[Domain] = Field(default_factory=list)
    members: list[Member] = Field(default_factory=list)
    allowed_platforms: list[Literal[PLATFORMS]] = Field(default_factory=list)
    tolerance: Tolerance | None = None  # écart admis d'une comparaison chiffrée (plan 0009)

    @property
    def tolerance_percent(self) -> float:
        return self.tolerance.percent if self.tolerance else DEFAULT_TOLERANCE

    def domain(self, domain_id: str | None) -> Domain | None:
        return next((d for d in self.domains if d.id == domain_id), None)

    def member(self, account: str | None) -> Member | None:
        return next((m for m in self.members if m.account == account), None)


def initial_governance(account: str, name: str) -> Governance:
    """Gouvernance d'un espace qu'on vient de créer : son créateur en est le référent."""
    return Governance(members=[Member(account=account, name=name,
                                      roles=[MemberRole(role="referent")])])


def account_from_name(name: str) -> str:
    """Identifiant de compte tiré d'un nom (« Julien H. » → « julien-h »)."""
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", name.strip()).strip("-._").lower()
    return slug[:39] or "referent"


def _duplicates(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    found = []
    for value in values:
        if value in seen and value not in found:
            found.append(value)
        seen.add(value)
    return found


def check_governance(governance: Governance) -> list[Issue]:
    """Règles de cohérence au-delà du schéma."""
    issues = []
    for value in _duplicates(d.id for d in governance.domains):
        issues.append(Issue("/domains", None, "duplicate_domain", f"Domaine « {value} » répété."))
    for value in _duplicates(m.account for m in governance.members):
        issues.append(Issue("/members", None, "duplicate_member", f"Membre « {value} » répété."))
    accounts = {m.account for m in governance.members}
    domain_ids = {d.id for d in governance.domains}
    for i, domain in enumerate(governance.domains):
        for field in ("referents", "validators"):
            for account in getattr(domain, field):
                if account not in accounts:
                    issues.append(Issue(f"/domains/{i}/{field}", None, "unknown_member",
                                        f"« {account} » n'est pas membre de l'espace."))
    for i, member in enumerate(governance.members):
        for j, role in enumerate(member.roles):
            for domain_id in role.domains:
                if domain_id not in domain_ids:
                    issues.append(Issue(f"/members/{i}/roles/{j}/domains", None,
                                        "unknown_domain", f"Domaine « {domain_id} » inconnu."))
    if not space_referents(governance):
        issues.append(Issue("/members", None, "no_referent",
                            "L'espace doit avoir au moins un référent (rôle referent sans "
                            "restriction de domaine)."))
    for i, domain in enumerate(governance.domains):
        if not domain_referents(governance, domain.id):
            issues.append(Issue(f"/domains/{i}", None, "domain_without_referent",
                                f"Le domaine « {domain.label} » n'a pas de référent.",
                                "warning"))
    return issues


def validate_governance(raw: Any) -> tuple[Governance | None, list[Issue]]:
    if not isinstance(raw, dict):
        return None, [Issue("", None, "invalid_value", "governance.yaml doit être un mapping.")]
    try:
        governance = Governance.model_validate(raw)
    except ValidationError as error:
        return None, issues_from_validation_error(error, raw)
    issues = check_governance(governance)
    errors = any(i.severity == "error" for i in issues)
    return (None if errors else governance), issues


def parse_governance(text: str) -> tuple[Governance | None, list[Issue]]:
    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as error:
        return None, [Issue("", None, "invalid_yaml", f"YAML illisible : {error}")]
    return validate_governance(raw if raw is not None else {})


def dump_governance(governance: Governance) -> str:
    data = governance.model_dump(mode="json", exclude_none=True)
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=100)


# --- rôles effectifs ---------------------------------------------------------------------

def _with_role(governance: Governance, roles: set[str], domain_id: str | None) -> set[str]:
    """Membres qui ont l'un de ces rôles sur tout l'espace, ou sur ce domaine."""
    return {
        member.account for member in governance.members for role in member.roles
        if role.role in roles and (not role.domains or domain_id in role.domains)
    }


def space_referents(governance: Governance) -> set[str]:
    return {m.account for m in governance.members for r in m.roles
            if r.role == "referent" and not r.domains}


def domain_referents(governance: Governance, domain_id: str) -> set[str]:
    domain = governance.domain(domain_id)
    listed = set(domain.referents) if domain else set()
    return listed | {m.account for m in governance.members for r in m.roles
                     if r.role == "referent" and domain_id in r.domains}


def domain_approvers(governance: Governance, domain_id: str | None) -> set[str]:
    """Comptes dont l'approbation compte pour un document de ce domaine."""
    domain = governance.domain(domain_id)
    listed = set(domain.referents) | set(domain.validators) if domain else set()
    return listed | _with_role(governance, {"referent", "validateur"}, domain_id)


def role_of(governance: Governance, account: str | None) -> str:
    """Rôle le plus élevé du compte dans l'espace (« lecteur » s'il n'est pas membre)."""
    member = governance.member(account)
    if member is None:
        return "lecteur"
    ranks = [ROLE_RANK[r.role] for r in member.roles]
    ranks += [ROLE_RANK["referent"] for d in governance.domains if account in d.referents]
    ranks += [ROLE_RANK["validateur"] for d in governance.domains if account in d.validators]
    best = max(ranks, default=ROLE_RANK["lecteur"])
    return next(role for role, rank in ROLE_RANK.items() if rank == best)


def member_domains(governance: Governance, account: str | None) -> set[str]:
    """Domaines où le compte a un rôle (tous s'il a un rôle d'espace)."""
    member = governance.member(account)
    if member is None:
        return set()
    if any(not r.domains for r in member.roles if r.role != "lecteur"):
        return {d.id for d in governance.domains}
    found = {d for r in member.roles for d in r.domains}
    return found | {d.id for d in governance.domains
                    if account in d.referents or account in d.validators}
