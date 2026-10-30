"""Propositions de démonstration sur le dépôt de Groupe Nordis (plan 0014).

    examples/depot-nordis.sh "$DEMO"
    uv run --project core python examples/propositions-nordis.py "$DEMO/distant.git"

Cinq propositions ouvertes sur l'hébergeur local (`LocalHost`), avec leurs revues et un
commentaire, comme sur la maquette 10.4. Chaque auteur et chaque validateur agit sous
son compte (`ATLAS_ACCOUNT`), dans un dossier de données temporaire : le registre des
espaces du poste n'est pas touché. La version de chaque document est posée par la
proposition elle-même (base + 1).
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

os.environ["ATLAS_DATA_DIR"] = tempfile.mkdtemp(prefix="atlas-propositions-")
os.environ.setdefault("ATLAS_VAULT", "memory")

from skifer_atlas import proposals  # noqa: E402 (après ATLAS_DATA_DIR)
from skifer_atlas.repo.sync import join_workspace  # noqa: E402
from skifer_atlas.workspaces import repo_dir  # noqa: E402

WS = "groupe-nordis"


def as_account(account: str) -> None:
    os.environ["ATLAS_ACCOUNT"] = account


def edited(path: str, *changes: tuple[str, str]) -> str:
    text = (repo_dir(WS) / path).read_text(encoding="utf-8")
    for before, after in changes:
        if before not in text:
            raise SystemExit(f"{path} : « {before} » introuvable.")
        text = text.replace(before, after, 1)
    return text


def propose(account: str, path: str, base: int, justification: str,
            *changes: tuple[str, str]) -> int:
    as_account(account)
    created = proposals.create_proposal(WS, edited(path, *changes), justification, base)
    print(f"#{created['id']} {created['title']} ({account})")
    return created["id"]


def review(account: str, number: int, event: str = "approve", body: str = "") -> None:
    as_account(account)
    proposals.review(WS, number, event, body)


def comment(account: str, number: int, body: str) -> None:
    as_account(account)
    proposals.comment(WS, number, body)


def main(remote: Path) -> None:
    as_account("julien.h")
    join_workspace(str(remote))

    es = propose(
        "sofia.r", "variants/revenu-net/nordis-es.yaml", 1,
        "Les factures clôturées arrivent désormais de la table consolidée du groupe.",
        ("publie directement un montant net par facture clôturée.",
         "publie directement un montant net par facture clôturée, consolidé chaque nuit."),
    )
    review("claire.m", es)

    service = propose(
        "julien.h", "kpis/taux-de-service.yaml", 2,
        "Précise la date de référence : celle promise au client, pas celle du stock.",
        ("livrées complètes à la date promise.",
         "livrées complètes à la date promise au client."),
    )
    review("sami.b", service)

    canonical = propose(
        "julien.h", "kpis/revenu-net.yaml", 4,
        "Les remises de fin d'année sont déduites comme les avoirs.",
        ("net des avoirs, sur", "net des avoirs et des remises, sur"),
    )
    review("marc.d", canonical)

    propose(
        "claire.m", "variants/revenu-net/nordis-fr.yaml", 2,
        "En France aussi, une commande expédiée est comptée en revenu avant sa validation.",
        ("overrides:\n", "overrides:\n"
         "  - node: n02\n"
         "    justification: Reconnaissance du revenu à l'expédition, comme en Allemagne.\n"
         "    replace:\n"
         "      id: n02\n"
         "      type: filter\n"
         "      label: Factures validées ou expédiées\n"
         "      inputs: [n01]\n"
         "      condition: statut:in:validée,expédiée\n"
         "      nulls: drop\n"),
    )

    de = propose(
        "anna.k", "variants/revenu-net/nordis-de.yaml", 3,
        "En Allemagne, une commande expédiée est comptabilisée comme revenu avant sa "
        "validation comptable (règle locale de reconnaissance). Sans ce filtre élargi, le "
        "revenu DE est sous-estimé d'environ 6 % en fin de mois.",
        ("      label: déduction des taxes\n",
         "      label: déduction des taxes (MwSt DE 19 %)\n"),
    )
    comment("claire.m", de, "Le statut « expédiée » devrait-il devenir un point de "
            "variation du canonique ? FR a la même demande.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage : propositions-nordis.py <dépôt nu distant.git>")
    main(Path(sys.argv[1]).resolve())
