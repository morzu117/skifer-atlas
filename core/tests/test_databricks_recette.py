"""Politique de nettoyage des données de recette Databricks (ADR 0075), sans warehouse."""

import json
import sys
from pathlib import Path

import pytest
import sqlglot

from skifer_atlas.connectors.base import QueryResult

sys.path.insert(0, str(Path(__file__).parent))
import databricks_recette as recette

TABLES = ["`gold`.`finance`.`fact_facturation`", "`gold`.`finance`.`dim_date`"]


class Warehouse:
    """Faux warehouse : répond aux SHOW et à information_schema, retient chaque requête."""

    def __init__(self, catalogs=("main",), schemas=("default",), tables=(), fail=None):
        self.catalogs, self.schemas, self.tables, self.fail = catalogs, schemas, tables, fail
        self.sql = []

    def run_aggregate(self, sql, **_):
        self.sql.append(sql)
        if self.fail and sql.startswith(self.fail):
            raise RuntimeError("panne simulée")
        if sql == "SHOW CATALOGS":
            return QueryResult(["catalog"], ["string"], [(c,) for c in self.catalogs])
        if sql.startswith("SHOW SCHEMAS IN"):
            return QueryResult(["databaseName"], ["string"], [(s,) for s in self.schemas])
        if "information_schema.tables" in sql:
            return QueryResult(["table_name", "comment"], ["string", "string"], list(self.tables))
        return QueryResult([], [], [])


def created(warehouse):
    return [s.split(" AS ")[0] for s in warehouse.sql if s.startswith("CREATE OR REPLACE")]


def test_sources_exactes_des_documents():
    sources = {s.table: [name for name, _ in s.columns] for s in recette.nordis_sources()}
    assert sources == {
        "gold.finance.fact_facturation": ["facture_id", "commande_id", "entite", "statut",
                                          "date_facture", "montant_ttc", "montant_taxes", "avoirs"],
        "gold.finance.dim_date": ["date_jour", "date_comptable"],
    }


def test_catalogue_cree_puis_supprime(tmp_path):
    state, warehouse = tmp_path / "etat.json", Warehouse()
    recette.load(state, warehouse)
    assert warehouse.sql[:3] == ["SHOW CATALOGS", "CREATE CATALOG IF NOT EXISTS `gold`",
                                 "CREATE SCHEMA IF NOT EXISTS `gold`.`finance`"]
    assert created(warehouse) == [
        f"CREATE OR REPLACE TABLE {t} COMMENT '{recette.MARK}'" for t in TABLES]
    for sql in warehouse.sql:
        sqlglot.parse_one(sql, read="databricks")
    warehouse.sql.clear()
    recette.drop(state, warehouse)
    assert warehouse.sql == ["DROP CATALOG IF EXISTS `gold` CASCADE"]
    assert not state.exists()


def test_catalogue_existant_conserve(tmp_path):
    state, warehouse = tmp_path / "etat.json", Warehouse(catalogs=("GOLD",), schemas=("finance",))
    recette.load(state, warehouse)
    assert not any(s.startswith(("CREATE CATALOG", "CREATE SCHEMA")) for s in warehouse.sql)
    warehouse.sql.clear()
    recette.drop(state, warehouse)
    assert warehouse.sql == [f"DROP TABLE IF EXISTS {t}" for t in TABLES]


def test_schema_cree_dans_un_catalogue_existant(tmp_path):
    state, warehouse = tmp_path / "etat.json", Warehouse(catalogs=("gold",))
    recette.load(state, warehouse)
    warehouse.sql.clear()
    recette.drop(state, warehouse)
    assert warehouse.sql == ["DROP SCHEMA IF EXISTS `gold`.`finance` CASCADE"]


def test_table_existante_jamais_remplacee(tmp_path):
    state = tmp_path / "etat.json"
    warehouse = Warehouse(catalogs=("gold",), schemas=("finance",),
                          tables=[("fact_facturation", "données de production")])
    with pytest.raises(SystemExit, match="n'est pas une table de recette"):
        recette.load(state, warehouse)
    assert created(warehouse) == []
    recette.drop(state, warehouse)
    assert not any(s.startswith("DROP") for s in warehouse.sql)


def test_table_de_recette_laissee_remplacee(tmp_path):
    state = tmp_path / "etat.json"
    warehouse = Warehouse(catalogs=("gold",), schemas=("finance",),
                          tables=[("dim_date", recette.MARK)])
    recette.load(state, warehouse)
    assert len(created(warehouse)) == 2


def test_nettoyage_note_avant_la_creation(tmp_path):
    """Un chargement en échec laisse un état que `drop` sait nettoyer, et `drop` en échec
    garde l'état pour être relancé."""
    state = tmp_path / "etat.json"
    with pytest.raises(RuntimeError):
        recette.load(state, Warehouse(fail="CREATE SCHEMA"))
    assert json.loads(state.read_text(encoding="utf-8"))["catalogs"] == ["gold"]
    with pytest.raises(RuntimeError):
        recette.drop(state, Warehouse(fail="DROP CATALOG"))
    assert state.exists()
    warehouse = Warehouse()
    recette.drop(state, warehouse)
    assert warehouse.sql == ["DROP CATALOG IF EXISTS `gold` CASCADE"]
    assert not state.exists()


def test_etat_existant_refuse(tmp_path):
    state = tmp_path / "etat.json"
    state.write_text("{}", encoding="utf-8")
    with pytest.raises(SystemExit, match="drop"):
        recette.load(state, Warehouse())


def test_hote_sans_schema():
    point = recette.connector("dbc-exemple.cloud.databricks.com", "abc123", "jeton").point
    assert point.base_url == "https://dbc-exemple.cloud.databricks.com"
    assert point.catalog_and_schema() == (None, None)
