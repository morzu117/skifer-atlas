"""Outils des tests d'extraction : extraire un texte SQL, compléter les `TODO`."""

import copy
import json
import subprocess
import sys
from pathlib import Path

import yaml

from skifer_atlas.extract import extract_file
from skifer_atlas.model import validate_data
from skifer_atlas.model.nodes import TODO

FIXTURES = Path(__file__).parents[1] / "fixtures"
SQL = FIXTURES / "sql"
GOLDEN = FIXTURES / "extract"
EXAMPLES = Path(__file__).parents[3] / "examples" / "extraction"
DIALECTS = ("databricks", "snowflake")
ATLAS = Path(sys.executable).with_name("atlas")


def run(*args, cwd=None):
    return subprocess.run([str(ATLAS), *map(str, args)], capture_output=True, text=True,
                          check=False, cwd=cwd)


def extract_sql(tmp_path: Path, sql: str, dialect: str = "databricks", name: str = "requete"):
    path = tmp_path / f"{name}.sql"
    path.write_text(sql.strip().rstrip(";") + ";\n", encoding="utf-8")
    return extract_file(path, dialect)


def single(tmp_path: Path, sql: str, dialect: str = "databricks"):
    """L'unique extraction d'une requête."""
    [extraction] = extract_sql(tmp_path, sql, dialect).extractions
    return extraction


def graph(extraction) -> list[dict]:
    return extraction.draft.data["graph"]["nodes"]


def by_type(extraction, kind: str) -> list[dict]:
    return [node for node in graph(extraction) if node["type"] == kind]


def codes(extraction) -> list[str]:
    return [found.code for found in extraction.draft.residues]


def column_names(node: dict) -> list[str]:
    return [column["name"] for column in node["columns"]]


def complete(data: dict, types: dict[str, str] | None = None) -> dict:
    """Le brouillon complété comme le ferait un curateur : statut et trace d'extraction
    retirés, chaque `TODO` remplacé par une valeur plausible."""
    data = copy.deepcopy(data)
    data.pop("status")
    data.pop("extraction")
    data["data_product"].update(owner="claire.m", domain="finance")
    if data["kind"] == "kpi":
        data["semantics"] = {"calendar": {"key": "civil"}, "timezone": "Europe/Paris"}
    elif data.get("entity") == TODO:
        data["entity"] = {"key": ["id"], "attributes": [{"name": "id", "type": "string"}]}
    for node in data.get("graph", {}).get("nodes", []):
        if node["type"] == "source":
            node["owner"] = "claire.m"
            for column in node["columns"]:
                column["type"] = (types or {}).get(column["name"], "decimal")
                if column["type"] == "timestamp":
                    column.update(timezone="UTC", format="yyyy-MM-dd HH:mm:ss")
        if node.get("cardinality") == TODO:
            node["cardinality"] = "N:1"
        for key in ("timezone", "to"):
            if node.get(key) == TODO:
                node[key] = "Europe/Paris"
    assert TODO not in json.dumps(data), "TODO restant"
    result = validate_data(data)
    assert result.valid and not result.issues, [i.to_dict() for i in result.issues]
    return data


def load_yaml(text: str) -> dict:
    return yaml.safe_load(text)
