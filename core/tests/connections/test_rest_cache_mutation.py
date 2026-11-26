"""Identité, durée de vie et contenu du cache REST."""

import hashlib
import json
from datetime import UTC, datetime, timedelta

from skifer_atlas.connectors.rest_cache import cache_key, cached, paths, write
from skifer_atlas.connectors.rest_datasets import Column, RestDataset


def test_key_contains_all_inputs_and_sorts_dicts():
    ds = RestDataset.model_validate({"table": "a.b.c", "access_point": "api-exemple", "path": "/x",
        "columns": [{"name": "x", "from": "x", "type": "integer"}]})
    value = ["api-exemple", ds.model_dump(mode="json", by_alias=True), {"b": 2, "a": 1}, None, "A"]
    expected = hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()
    assert cache_key("api-exemple", ds, {"a": 1, "b": 2}, None, "A") == expected
    assert cache_key("api-exemple", ds, {"a": 1, "b": 2}, None, "B") != expected


def test_cache_metadata_and_expiration(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    now = datetime(2026, 1, 1, tzinfo=UTC)
    columns = [Column(name="x", **{"from": "x", "type": "integer"})]
    meta = {"date": now.isoformat(), "provisional": True, "calls": 1, "bytes": 12}
    parquet = write("exemple", "abc", columns, [(42,)], meta)
    assert paths("exemple", "abc") == (parquet, parquet.with_suffix(".json"))
    assert json.loads(parquet.with_suffix(".json").read_text(encoding="utf-8")) == meta
    assert cached("exemple", "abc", now + timedelta(seconds=899)) == (parquet, meta)
    assert cached("exemple", "abc", now + timedelta(seconds=900)) is None
    assert cached("exemple", "abc", now, immutable=True) is None
    meta["provisional"] = False
    write("exemple", "abc", columns, [(42,)], meta)
    assert cached("exemple", "abc", now + timedelta(days=100), immutable=True) == (parquet, meta)
    parquet.unlink()
    assert cached("exemple", "abc", now) is None


def test_parquet_round_trip_and_invalid_value(tmp_path, monkeypatch):
    import duckdb
    import pytest

    from skifer_atlas.repo.git import RepoError

    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    columns = [Column(name="x", **{"from": "x", "type": "integer"}),
               Column(name="label", **{"from": "label", "type": "string"})]
    metadata = {"date": "2026-01-01T12:34:56+00:00", "provisional": True,
                "calls": 2, "bytes": 123}
    parquet = write("exemple", "roundtrip", columns, [(42, "été"), (-7, None)], metadata)
    assert parquet.parent.name == "rest_cache"
    with duckdb.connect(":memory:") as connection:
        result = connection.execute("SELECT * FROM read_parquet(?)", [str(parquet)])
        assert [item[0] for item in result.description] == ["x", "label"]
        assert result.fetchall() == [(42, "été"), (-7, None)]
    assert cached("exemple", "roundtrip", datetime(2026, 1, 1, 12, 35, tzinfo=UTC)) == (
        parquet, metadata)
    with pytest.raises(RepoError) as caught:
        write("exemple", "bad", columns, [(10**100, "secret")], metadata)
    assert caught.value.code == "rest_bad_response"
    assert str(caught.value) == "Données REST impossibles à charger."
