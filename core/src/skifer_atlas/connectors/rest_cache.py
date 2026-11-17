"""Cache Parquet REST hors du clone ; métadonnées publiées en dernier (plan 0036)."""

import hashlib
import json
import os
import tempfile
from datetime import datetime

import duckdb

from ..paths import workspace_dir
from ..repo.git import RepoError

SQL_TYPES = {"string": "VARCHAR", "integer": "BIGINT", "double": "DOUBLE",
             "decimal": "DECIMAL(38,10)", "boolean": "BOOLEAN", "date": "DATE",
             "timestamp": "TIMESTAMP"}


def cache_key(point_id, dataset, params, window, perimeter):
    value = [point_id, dataset.model_dump(mode="json", by_alias=True), params, window, perimeter]
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def paths(workspace_id, key):
    folder = workspace_dir(workspace_id) / "rest_cache"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / (key + ".parquet"), folder / (key + ".json")


def cached(workspace_id, key, now, *, immutable=False):
    parquet, metadata = paths(workspace_id, key)
    try:
        data = json.loads(metadata.read_text(encoding="utf-8"))
        if parquet.is_file() and (not data["provisional"] or not immutable and
                (now - datetime.fromisoformat(data["date"])).total_seconds() < 900):
            return parquet, data
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def write(workspace_id, key, columns, rows, metadata):
    parquet, info = paths(workspace_id, key)
    with tempfile.TemporaryDirectory(dir=parquet.parent) as temporary:
        from pathlib import Path

        target = Path(temporary) / "data.parquet"
        try:
            with duckdb.connect(":memory:") as connection:
                fields = ", ".join('"' + c.name + '" ' + SQL_TYPES[c.type] for c in columns)
                connection.execute("CREATE TABLE data (" + fields + ")")
                if rows:
                    connection.executemany("INSERT INTO data VALUES (" +
                        ",".join("?" for _ in columns) + ")", rows)
                connection.execute("COPY data TO ? (FORMAT PARQUET)", [str(target)])
        except duckdb.Error:
            # Le diagnostic DuckDB peut citer la valeur brute de la réponse.
            raise RepoError("rest_bad_response", "Données REST impossibles à charger.") from None
        meta = Path(temporary) / "data.json"
        meta.write_text(json.dumps(metadata), encoding="utf-8")
        os.replace(target, parquet)
        os.replace(meta, info)
    return parquet
