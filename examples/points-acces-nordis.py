"""Points d'accès de démonstration sur le dépôt de Groupe Nordis (plan 0016).

    examples/depot-nordis.sh "$DEMO"
    uv run --project core python core/tests/connections/fake_databricks.py 8796 &
    uv run --project core python examples/points-acces-nordis.py "$DEMO/distant.git" http://127.0.0.1:8796

Déclare trois points d'accès, comme sur la maquette 10.6 : Databricks pour nordis-fr, sur
l'hôte donné (un faux Databricks local, ou un vrai espace en https), et Snowflake pour
nordis-de et nordis-es. Julien H., seul référent d'espace, propose puis fusionne seul
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


def points(host: str) -> list[dict]:
    return [
        {"id": "dbx-fr", "platform": "databricks", "host": host, "warehouse_id": "abc123",
         "schema": "gold.finance", "entity": "nordis-fr", "owner": "claire.m",
         "freshness": "Quotidienne · 06:10"},
        {"id": "snow-de", "platform": "snowflake", "host": "https://nordis-de.snowflakecomputing.com",
         "schema": "FIN_GOLD.PUBLIC", "entity": "nordis-de", "owner": "anna.k",
         "freshness": "Quotidienne · 05:40"},
        {"id": "snow-es", "platform": "snowflake", "host": "https://nordis-es.snowflakecomputing.com",
         "schema": "VENTAS.GOLD", "entity": "nordis-es", "owner": "sofia.r",
         "freshness": "Hebdomadaire · lundi"},
    ]


def main(remote: Path, host: str) -> None:
    join_workspace(str(remote))
    for point in points(host):
        created = proposals.create_access_point_proposal(WS, point, "Point d'accès de l'entité.")
        proposals.merge_proposal(WS, created["id"])
        print(f"#{created['id']} {created['title']} (fusionnée)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage : points-acces-nordis.py <dépôt nu distant.git> <hôte Databricks>")
    main(Path(sys.argv[1]).resolve(), sys.argv[2])
