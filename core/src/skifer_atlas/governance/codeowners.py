"""`.github/CODEOWNERS` généré depuis `governance.yaml` (plan 0006, ADR 0005).

Le chemin d'un document ne dit pas son domaine : chaque document a donc sa ligne. Les
dossiers ont une ligne par défaut (tous les validateurs), pour un document créé après
la dernière modification de la gouvernance. Sur GitHub, la dernière ligne qui
correspond l'emporte : défauts, puis documents, puis gouvernance.

L'en-tête porte l'empreinte du corps : une modification à la main se voit au `sync`
(`codeowners_drift`) sans regénérer quoi que ce soit.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from .model import Governance, domain_approvers, space_referents

PATH = ".github/CODEOWNERS"
HEADER = "# Généré par Atlas depuis governance.yaml : ne pas modifier à la main."
_CHECKSUM = re.compile(r"^# atlas-checksum: sha256:([0-9a-f]{64})$", re.MULTILINE)


@dataclass(frozen=True)
class OwnedDocument:
    path: str  # relatif à la racine, séparateurs « / »
    kind: str  # concept | kpi
    domain: str | None


def _line(pattern: str, accounts: set[str]) -> str | None:
    if not accounts:
        return None
    return f"{pattern} " + " ".join(f"@{a}" for a in sorted(accounts))


def _body(governance: Governance, documents: list[OwnedDocument]) -> str:
    everyone = set().union(*(domain_approvers(governance, d.id) for d in governance.domains),
                           domain_approvers(governance, None))
    referents = space_referents(governance)
    lines = [_line(f"/{folder}/", everyone) for folder in ("concepts", "kpis", "variants")]
    for document in sorted(documents, key=lambda d: d.path):
        owners = domain_approvers(governance, document.domain)
        lines.append(_line(f"/{document.path}", owners))
        if document.kind == "kpi":
            kpi_id = document.path.rsplit("/", 1)[-1].removesuffix(".yaml")
            lines.append(_line(f"/variants/{kpi_id}/", owners))
    lines += [_line("/governance.yaml", referents), _line(f"/{PATH}", referents)]
    return "\n".join(line for line in lines if line) + "\n"


def _checksum(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def generate(governance: Governance, documents: list[OwnedDocument]) -> str:
    body = _body(governance, documents)
    return f"{HEADER}\n# atlas-checksum: sha256:{_checksum(body)}\n\n{body}"


def has_drifted(text: str) -> bool:
    """Vrai si le fichier a été modifié depuis sa génération."""
    match = _CHECKSUM.search(text)
    if match is None:
        return True
    body = text[match.end():].lstrip("\n")
    return _checksum(body) != match[1]
