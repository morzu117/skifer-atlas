"""Points d'accès de démonstration sur le dépôt de Groupe Nordis (plans 0016 et 0018).

    examples/depot-nordis.sh "$DEMO"
    uv run --project core python core/tests/connections/fake_databricks.py 8796 &
    uv run --project core python core/tests/connections/fake_snowflake.py 8794 "$DEMO/cles" &
    uv run --project core python examples/points-acces-nordis.py "$DEMO/distant.git" \
        http://127.0.0.1:8796 http://127.0.0.1:8794

Déclare trois points d'accès, comme sur la maquette 10.6 : Databricks pour nordis-fr, sur
l'hôte donné (un faux Databricks local, ou un vrai espace en https), et Snowflake pour
nordis-de (SSO) et nordis-es (paire de clés), sur l'hôte Snowflake donné s'il l'est (un
faux compte local), sinon sur des comptes `*.snowflakecomputing.com` fictifs. Julien H., seul référent d'espace, propose puis fusionne seul
(ADR 0008), dans un dossier de données temporaire. Aucun secret n'est écrit : chacun se
connecte ensuite depuis Mes connexions.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

os.environ["ATLAS_DATA_DIR"] = tempfile.mkdtemp(prefix="atlas-points-acces-")
os.environ.setdefault("ATLAS_VAULT", "memory")
os.environ["ATLAS_ACCOUNT"] = "julien.h"

from skifer_atlas import proposals  # noqa: E402 (après ATLAS_DATA_DIR)
from skifer_atlas.repo.sync import join_workspace  # noqa: E402

WS = "groupe-nordis"


def snowflake(host: str | None, account: str) -> dict:
    if host is None:
        return {"host": f"https://{account}.snowflakecomputing.com"}
    return {"host": host, "account": account}  # hôte local : le compte se déclare


def points(host: str, snowflake_host: str | None = None) -> list[dict]:
    return [
        {"id": "dbx-fr", "platform": "databricks", "host": host, "warehouse_id": "abc123",
         "schema": "gold.finance", "entity": "nordis-fr", "owner": "claire.m",
         "freshness": "Quotidienne · 06:10"},
        {"id": "snow-de", "platform": "snowflake", **snowflake(snowflake_host, "nordis-de"),
         "warehouse": "WH_FINANCE", "role": "ANALYSTE", "auth": "sso",
         "schema": "FIN_GOLD.PUBLIC", "entity": "nordis-de", "owner": "anna.k",
         "freshness": "Quotidienne · 05:40"},
        {"id": "snow-es", "platform": "snowflake", **snowflake(snowflake_host, "nordis-es"),
         "warehouse": "WH_VENTAS", "auth": "keypair",
         "schema": "VENTAS.GOLD", "entity": "nordis-es", "owner": "sofia.r",
         "freshness": "Hebdomadaire · lundi"},
    ]


def main(remote: Path, host: str, snowflake_host: str | None = None) -> None:
    join_workspace(str(remote))
    for point in points(host, snowflake_host):
        created = proposals.create_access_point_proposal(WS, point, "Point d'accès de l'entité.")
        proposals.merge_proposal(WS, created["id"])
        print(f"#{created['id']} {created['title']} (fusionnée)")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage : points-acces-nordis.py <dépôt nu distant.git> "
                         "<hôte Databricks> [hôte Snowflake]")
    main(Path(sys.argv[1]).resolve(), sys.argv[2], *sys.argv[3:])
