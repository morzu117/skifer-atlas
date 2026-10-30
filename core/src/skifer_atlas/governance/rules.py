"""Décompte des validations d'une proposition (plan 0006, ADR 0008).

La gouvernance qui fait foi est celle de la branche principale, jamais celle de la
proposition : une proposition ne peut pas assouplir les règles qui la jugent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .model import Governance, domain_approvers, space_referents

Nature = Literal["new_version", "declared_point", "undeclared", "from_scratch", "governance",
                 "access_points"]
NATURES: tuple[str, ...] = ("new_version", "declared_point", "undeclared", "from_scratch",
                            "governance", "access_points")
CANONICAL_MENTION = "Validation canonique exigée"
NO_REVIEW_MENTION = "Fusionnée sans revue : aucun autre compte habilité"


@dataclass(frozen=True)
class Review:
    account: str
    state: Literal["approved", "changes_requested", "commented"]
    commit: str  # commit de la branche au moment de la revue
    submitted_at: str = ""
    body: str = ""


@dataclass(frozen=True)
class Requirement:
    required: int
    eligible: frozenset[str]
    mention: str | None = None


@dataclass
class Decision:
    obtained: int
    required: int
    approvers: list[str] = field(default_factory=list)
    changes_requested_by: list[str] = field(default_factory=list)
    ready_to_merge: bool = False
    merge_mode: Literal["reviewed", "no_other_eligible"] = "reviewed"
    mention: str | None = None
    explanation: str = ""

    def to_dict(self) -> dict:
        return {
            "approvals": {"obtained": self.obtained, "required": self.required},
            "approvers": self.approvers, "changes_requested_by": self.changes_requested_by,
            "ready_to_merge": self.ready_to_merge, "merge_mode": self.merge_mode,
            "mention": self.mention, "explanation": self.explanation,
        }


def requirement(governance: Governance, nature: str, domain_id: str | None) -> Requirement:
    if nature in ("governance", "access_points"):
        return Requirement(1, frozenset(space_referents(governance)))
    domain = governance.domain(domain_id)
    levels = (domain.validators_required if domain and domain.validators_required
              else governance.validators_required)
    eligible = frozenset(domain_approvers(governance, domain_id))
    if nature == "declared_point":
        return Requirement(levels.variants, eligible)
    mention = CANONICAL_MENTION if nature in ("undeclared", "from_scratch") else None
    return Requirement(levels.canonical, eligible, mention)


def decide(governance: Governance, nature: str, domain_id: str | None, author: str,
           reviews: list[Review], head: str) -> Decision:
    """Ne comptent que les approbations, sur le dernier commit de la branche, de comptes
    habilités autres que l'auteur ; la dernière revue d'un compte remplace les précédentes.
    Une demande de changements d'un compte habilité bloque la fusion."""
    need = requirement(governance, nature, domain_id)
    others = need.eligible - {author}
    latest: dict[str, Review] = {}
    for review in reviews:
        if review.state != "commented":
            latest[review.account] = review
    approvers = sorted(a for a, r in latest.items()
                       if a in others and r.state == "approved" and r.commit == head)
    blocking = sorted(a for a, r in latest.items()
                      if a in others and r.state == "changes_requested")
    decision = Decision(len(approvers), need.required, approvers, blocking,
                        mention=need.mention)
    if not others:
        decision.ready_to_merge = True
        decision.merge_mode = "no_other_eligible"
        decision.mention = NO_REVIEW_MENTION
        decision.explanation = "Aucun autre compte n'est habilité à approuver."
    elif blocking:
        decision.explanation = f"Changements demandés par {', '.join(blocking)}."
    elif len(approvers) >= need.required:
        decision.ready_to_merge = True
    elif len(others) < need.required:
        decision.explanation = (f"{need.required} validations requises, {len(others)} seul(s) "
                                "autre(s) compte(s) habilité(s).")
    else:
        decision.explanation = f"{len(approvers)} validation(s) sur {need.required}."
    return decision
