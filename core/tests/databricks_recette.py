"""Données de recette sur un vrai SQL warehouse Databricks (ADR 0072 et 0075).

Deux usages, hors CI :

- la sonde `tests/test_databricks_real.py` charge les fixtures de chaque scénario dans un
  schéma aléatoire (`load_sources`) ;
- le parcours Playwright `app/e2e/comparaison-databricks-reelle.spec.ts` charge les données
  de nordis-fr dans les tables exactes que lisent les documents de la démonstration, puis
  les retire :

      cd core
      uv run python tests/databricks_recette.py load <état.json>
      uv run python tests/databricks_recette.py drop <état.json>

Hôte, warehouse et jeton viennent de ATLAS_DATABRICKS_HOST, ATLAS_DATABRICKS_WAREHOUSE et
ATLAS_DATABRICKS_TOKEN, comme pour la sonde. L'état ne garde aucun secret : seulement les
objets que ce passage a créés, notés avant leur création, pour que `drop` ne supprime
qu'eux. Un catalogue qui existait déjà est conservé ; une table qui existait déjà sans être
une table de recette n'est jamais remplacée.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from collections.abc import Callable
from decimal import Decimal
from pathlib import Path

from sqlglot import exp

from skifer_atlas.compile import SourceTable
from skifer_atlas.connectors.access_points import AccessPoint
from skifer_atlas.connectors.databricks import DatabricksConnector
from skifer_atlas.run import open_database

VARIABLES = ("ATLAS_DATABRICKS_HOST", "ATLAS_DATABRICKS_WAREHOUSE", "ATLAS_DATABRICKS_TOKEN")
# Commentaire posé sur chaque table chargée : la marque d'une table de recette, qu'un
# passage suivant peut remplacer (celle d'un passage interrompu avant son nettoyage).
MARK = "skifer-atlas : table de recette (ADR 0075)"

NORDIS = Path(__file__).resolve().parents[2] / "examples" / "espace-nordis"
COMPARE_DATA = Path(__file__).resolve().parent / "fixtures" / "compare" / "revenu-net"
KPI, ENTITY, SCOPE = "revenu-net", "nordis-fr", "fy2026-mois-entite"


def settings() -> tuple[str, str, str] | None:
    """(hôte, warehouse, jeton) de l'environnement, ou None s'il en manque un."""
    values = tuple(os.environ.get(name) or "" for name in VARIABLES)
    return values if all(values) else None


def connector(host: str, warehouse: str, token: str) -> DatabricksConnector:
    """Connecteur du produit, sans schéma par défaut : les noms sont toujours complets."""
    host = host if "://" in host else f"https://{host}"
    point = AccessPoint(id="recette", platform="databricks", host=host,
                        warehouse_id=warehouse, owner="recette")
    return DatabricksConnector(point, token)


def quote(name: str) -> str:
    return "`" + name.replace("`", "``") + "`"


def literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float, Decimal)):
        return str(value)
    # Les valeurs temporelles ISO sont converties par CAST, comme les autres chaînes.
    return "'" + str(value).replace("\\", "\\\\").replace("'", "''") + "'"


def load_sources(warehouse: DatabricksConnector, sources: list[SourceTable], folder: Path,
                 target: Callable[[str], str], comment: str | None = None) -> None:
    """Charge chaque source depuis `folder` dans la table `target(source.table)`, avec les
    types du chargement DuckDB local (`open_database`), en une requête par table."""
    clause = f" COMMENT {literal(comment)}" if comment else ""
    with open_database(sources, folder) as db:
        for source in sources:
            source_name = ".".join('"' + p.replace('"', '""') + '"'
                                   for p in source.table.split("."))
            cursor = db.execute(f"SELECT * FROM {source_name}")
            description = cursor.description
            data = cursor.fetchall()
            if not data:
                raise ValueError(f"Fixture vide non prise en charge : {source.table}")
            types = [exp.DataType.build(str(col[1]), dialect="duckdb").sql(dialect="databricks")
                     for col in description]
            selects = []
            for row in data:
                columns = [f"CAST({literal(value)} AS {kind}) AS {quote(col[0])}"
                           for value, kind, col in zip(row, types, description, strict=True)]
                selects.append("SELECT " + ", ".join(columns))
            warehouse.run_aggregate(f"CREATE OR REPLACE TABLE {target(source.table)}{clause} "
                                    "AS " + " UNION ALL ".join(selects))


# --- données de nordis-fr pour la comparaison depuis l'écran ---------------------------------

def nordis_sources() -> list[SourceTable]:
    """Sources que lisent le canonique rebranché et la déclinaison de nordis-fr, telles que
    l'écran les compile : noms exacts des documents, colonnes réunies par table."""
    from skifer_atlas.compare import CompareRequest
    from skifer_atlas.compare.service import prepare_in

    request = CompareRequest(kpi_id=KPI, variants=[ENTITY], scope_id=SCOPE)
    prepared = prepare_in(NORDIS, request, None, True)
    merged: dict[str, dict[str, str | None]] = {}
    for plan in prepared.plans:
        for side in (plan.canonical, plan.variant):
            for source in side.compiled.sources:
                columns = merged.setdefault(source.table, {})
                for name, kind in source.columns:
                    if columns.setdefault(name, kind) != kind:
                        raise ValueError(f"Types divergents pour {source.table}.{name}.")
    return [SourceTable(table, tuple(columns.items())) for table, columns in merged.items()]


def _parts(table: str) -> tuple[str, str, str]:
    parts = table.split(".")
    if len(parts) != 3:
        raise ValueError(f"Nom catalogue.schéma.table attendu : {table}")
    return parts[0], parts[1], parts[2]


def _target(table: str) -> str:
    return ".".join(map(quote, _parts(table)))


def _save(path: Path, state: dict) -> None:
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(state, handle, ensure_ascii=False, indent=2)
    os.replace(temporary, path)


def _names(result) -> set[str]:
    """Première colonne d'un SHOW, en minuscules comme Unity Catalog range les noms."""
    return {str(row[0]).lower() for row in result.rows}


def load(path: Path, warehouse: DatabricksConnector) -> dict:
    """Charge les données de nordis-fr ; chaque création est notée dans `path` avant d'être
    lancée, pour qu'un nettoyage après un échec sache quoi supprimer."""
    if path.exists():
        raise SystemExit(f"{path} existe déjà : lancer d'abord « drop {path} ».")
    sources = nordis_sources()
    tables = [_parts(source.table) for source in sources]
    state: dict = {"catalogs": [], "schemas": [], "tables": []}
    _save(path, state)
    existing = _names(warehouse.run_aggregate("SHOW CATALOGS"))
    for catalog in dict.fromkeys(c for c, _, _ in tables):
        if catalog.lower() not in existing:
            state["catalogs"].append(catalog)
            _save(path, state)
            warehouse.run_aggregate(f"CREATE CATALOG IF NOT EXISTS {quote(catalog)}")
            print(f"Catalogue {catalog} créé : il sera supprimé au nettoyage.")
        else:
            print(f"Catalogue {catalog} déjà présent : il sera conservé.")
    for catalog, schema in dict.fromkeys((c, s) for c, s, _ in tables):
        if catalog in state["catalogs"]:
            known: set[str] = set()
        else:
            known = _names(warehouse.run_aggregate(f"SHOW SCHEMAS IN {quote(catalog)}"))
        if schema.lower() not in known:
            state["schemas"].append([catalog, schema])
            _save(path, state)
            warehouse.run_aggregate(f"CREATE SCHEMA IF NOT EXISTS {quote(catalog)}.{quote(schema)}")
            print(f"Schéma {catalog}.{schema} créé.")
            continue
        # Schéma préexistant : une table du même nom n'est remplacée que si c'est une
        # table de recette laissée par un passage précédent.
        found = warehouse.run_aggregate(
            f"SELECT table_name, comment FROM {quote(catalog)}.information_schema.tables "
            f"WHERE table_schema = {literal(schema.lower())}")
        wanted = {t.lower() for c, s, t in tables if (c, s) == (catalog, schema)}
        for name, comment in found.rows:
            if str(name).lower() in wanted and comment != MARK:
                raise SystemExit(f"{catalog}.{schema}.{name} existe déjà et n'est pas une "
                                 "table de recette : rien n'est remplacé.")
    state["tables"] = [list(table) for table in tables]
    _save(path, state)
    load_sources(warehouse, sources, COMPARE_DATA / ENTITY, _target, comment=MARK)
    for table in tables:
        print(f"Table {'.'.join(table)} chargée.")
    return state


def drop(path: Path, warehouse: DatabricksConnector) -> None:
    """Supprime ce que `load` a noté : les tables d'un schéma préexistant, les schémas
    créés d'un catalogue préexistant, puis les catalogues créés. L'état n'est effacé
    qu'une fois tout supprimé : un nouvel appel reprend un nettoyage interrompu."""
    if not path.exists():
        print(f"{path} absent : rien à supprimer.")
        return
    state = json.loads(path.read_text(encoding="utf-8"))
    catalogs = list(state.get("catalogs", []))
    schemas = [tuple(s) for s in state.get("schemas", [])]
    for catalog, schema, table in state.get("tables", []):
        if catalog in catalogs or (catalog, schema) in schemas:
            continue
        warehouse.run_aggregate(f"DROP TABLE IF EXISTS {_target(f'{catalog}.{schema}.{table}')}")
        print(f"Table {catalog}.{schema}.{table} supprimée.")
    for catalog, schema in schemas:
        if catalog in catalogs:
            continue
        warehouse.run_aggregate(f"DROP SCHEMA IF EXISTS {quote(catalog)}.{quote(schema)} CASCADE")
        print(f"Schéma {catalog}.{schema} supprimé.")
    for catalog in catalogs:
        warehouse.run_aggregate(f"DROP CATALOG IF EXISTS {quote(catalog)} CASCADE")
        print(f"Catalogue {catalog} supprimé.")
    path.unlink()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Données de nordis-fr sur un vrai SQL warehouse Databricks (ADR 0075).")
    parser.add_argument("action", choices=("load", "drop"))
    parser.add_argument("state", type=Path, help="fichier d'état JSON (objets créés)")
    args = parser.parse_args(argv)
    found = settings()
    if found is None:
        parser.error(", ".join(VARIABLES) + " sont requis.")
    warehouse = connector(*found)
    with tempfile.TemporaryDirectory(prefix="atlas-recette-") as data:
        # Rien ne doit toucher au vrai dossier de données ni au trousseau du poste.
        os.environ["ATLAS_DATA_DIR"] = data
        os.environ["ATLAS_VAULT"] = "memory"
        (load if args.action == "load" else drop)(args.state.resolve(), warehouse)


if __name__ == "__main__":
    main(sys.argv[1:])
