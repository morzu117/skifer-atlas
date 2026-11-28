"""Contrat REST BigQuery et conversions, sans accès au service Google."""

import datetime
import threading
from decimal import Decimal

import pytest
from fake_bigquery import FakeBigQuery
from pydantic import ValidationError

from skifer_atlas.connectors.access_points import AccessPoint, parse_access_points
from skifer_atlas.connectors.base import AuthRejected
from skifer_atlas.connectors.bigquery import BigQueryConnector, _value
from skifer_atlas.connectors.http import Response
from skifer_atlas.repo.git import RepoError


def point(**changes):
    return AccessPoint.model_validate({"id": "bq-test", "platform": "bigquery",
                                       "host": "https://bigquery.googleapis.com",
                                       "project": "projet-test", "owner": "claire", **changes})


@pytest.mark.parametrize("raw,kind,expected", [
    ("123", "int64", 123), ("1.20", "numeric", Decimal("1.20")),
    ("2.30", "bignumeric", Decimal("2.30")), ("1.5", "float64", 1.5),
    ("true", "bool", True), ("false", "bool", False), ("abc", "string", "abc"),
    ("2026-11-28", "date", datetime.date(2026, 11, 28)),
    ("2026-11-28T12:34:56.123456", "datetime", datetime.datetime(2026, 11, 28, 12, 34, 56, 123456)),
    ("-1", "timestamp", datetime.datetime(1969, 12, 31, 23, 59, 59, 999999, tzinfo=datetime.UTC)),
    (None, "int64", None),
])
def test_values(raw, kind, expected):
    assert _value(raw, kind) == expected


@pytest.mark.parametrize("raw,kind", [(1, "int64"), ("1.0", "int64"), ("TRUE", "bool"),
                                      ("nan", "float64"), ("20261128", "date"),
                                      ("2026-11-28 12:00:00", "datetime"),
                                      ("1.0", "timestamp"), ("NaN", "numeric")])
def test_invalid_values(raw, kind):
    with pytest.raises(RepoError, match="Valeur") as error:
        _value(raw, kind)
    assert error.value.code == "query_failed"


@pytest.fixture
def fake():
    server = FakeBigQuery()
    yield server
    server.close()


def test_pagination_and_parameters(fake):
    fake.state.rows = [["1"], ["2"], ["3"]]
    connector = BigQueryConnector(point(host=fake.url, schema="autre-projet.finance", location="EU"), fake.state.token)
    assert connector.run_aggregate("SELECT 1", max_rows=3).rows == [(1,), (2,), (3,)]
    calls = fake.state.calls
    assert calls[0][3]["defaultDataset"] == {"projectId": "autre-projet", "datasetId": "finance"}
    assert calls[0][3]["useLegacySql"] is False
    assert calls[0][3]["formatOptions"] == {"useInt64Timestamp": True}
    assert calls[0][3]["maxResults"] == 4 and "jobCreationMode" not in calls[0][3]
    assert all(c[2]["location"] == ["europe-west1"] for c in calls[1:])
    fake.state.rows = [["1"]]
    connector.test()


def test_limit_cancel_and_location(fake):
    fake.state.rows = [["1"], ["2"]]
    with pytest.raises(RepoError) as error:
        BigQueryConnector(point(host=fake.url), fake.state.token).run_aggregate("SELECT 1", max_rows=1)
    assert error.value.code == "result_too_large"
    assert fake.state.canceled == ["1"]
    assert len(fake.state.calls) == 2 and fake.state.calls[-1][2]["location"] == ["europe-west1"]


@pytest.mark.parametrize("canceled,code", [(False, "query_timeout"), (True, "query_canceled")])
def test_held_query(fake, canceled, code):
    fake.state.hold = True
    event = threading.Event()
    if canceled:
        event.set()
    with pytest.raises(RepoError) as error:
        BigQueryConnector(point(host=fake.url), fake.state.token).run_aggregate("SELECT 1", timeout=0, cancel=event)
    assert error.value.code == code and fake.state.canceled == ["1"]


@pytest.mark.parametrize("status,code", [(403, "platform_forbidden"), (404, "platform_not_found"), (400, "query_failed")])
def test_http_errors(fake, status, code):
    fake.state.status = status
    with pytest.raises(RepoError) as error:
        BigQueryConnector(point(host=fake.url), fake.state.token).test()
    assert error.value.code == code and fake.state.token not in str(error.value)


def test_auth(fake):
    with pytest.raises(AuthRejected):
        BigQueryConnector(point(host=fake.url), "incorrect").test()


def test_errors_200(fake):
    fake.state.errors = [{"message": fake.state.token}]
    with pytest.raises(RepoError) as error:
        BigQueryConnector(point(host=fake.url), fake.state.token).test()
    assert error.value.code == "query_failed" and fake.state.token not in str(error.value)


@pytest.mark.parametrize("field", [{"name": "col", "type": "JSON"},
                                  {"name": "col", "type": "STRING", "mode": "REPEATED"}])
def test_unsupported(monkeypatch, field):
    reply = {"jobComplete": True, "jobReference": {"jobId": "1"},
             "schema": {"fields": [field]}, "totalRows": "0"}
    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request", lambda *a, **kw: Response(200, reply))
    with pytest.raises(RepoError, match="col") as error:
        BigQueryConnector(point(), "secret").test()
    assert error.value.code == "query_failed"


@pytest.mark.parametrize("changes", [{"project": "ABCD12"}, {"project": "abcde-"}])
def test_access_point_refuses_invalid(changes):
    with pytest.raises(ValidationError):
        point(**changes)


@pytest.mark.parametrize("platform,extra", [("databricks", {"warehouse_id": "abc"}),
                                            ("snowflake", {"account": "abc"})])
@pytest.mark.parametrize("field", ["project", "location"])
def test_foreign_fields(platform, extra, field):
    with pytest.raises(ValidationError):
        AccessPoint.model_validate({"id": "test", "platform": platform, "host": "https://example.com",
                                    "owner": "x", **extra, field: "projet-test"})


def test_typed_result_and_dataset_without_socket(monkeypatch):
    fields = [{"name": name, "type": kind} for name, kind in [
        ("i", "INT64"), ("n", "NUMERIC"), ("bn", "BIGNUMERIC"), ("f", "FLOAT"),
        ("b", "BOOLEAN"), ("s", "STRING"), ("d", "DATE"), ("dt", "DATETIME"),
        ("ts", "TIMESTAMP"), ("nil", "INT64")]]
    values = ["42", "1.20", "2.3", "1.5", "true", "texte", "2026-11-28",
              "2026-11-28T12:00:00", "0", None]
    calls = []

    def respond(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return Response(200, {"jobComplete": True, "jobReference": {"jobId": "1"},
                              "schema": {"fields": fields}, "totalRows": "1",
                              "rows": [{"f": [{"v": v} for v in values]}]})

    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request", respond)
    result = BigQueryConnector(point(schema="finance"), "secret").run_aggregate("SELECT 1")
    assert result.types == ["int64", "numeric", "bignumeric", "float64", "bool", "string",
                            "date", "datetime", "timestamp", "int64"]
    assert result.rows == [(42, Decimal("1.20"), Decimal("2.3"), 1.5, True, "texte",
                            datetime.date(2026, 11, 28), datetime.datetime(2026, 11, 28, 12),
                            datetime.datetime(1970, 1, 1, tzinfo=datetime.UTC), None)]
    assert calls[0][2]["json_body"]["defaultDataset"] == {"projectId": "projet-test", "datasetId": "finance"}


def test_malformed_cell_without_socket(monkeypatch):
    reply = {"jobComplete": True, "jobReference": {"jobId": "1"}, "totalRows": "1",
             "schema": {"fields": [{"name": "i", "type": "INTEGER"}]},
             "rows": [{"f": [{"v": "incorrect"}]}]}
    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request", lambda *a, **kw: Response(200, reply))
    with pytest.raises(RepoError, match="Valeur int64"):
        BigQueryConnector(point(), "secret").test()


def test_poll_and_cancel_without_socket(monkeypatch):
    calls = []
    reply = {"jobComplete": False, "jobReference": {"jobId": "job-1", "projectId": "projet-test", "location": "EU"}}
    completed = {**reply, "jobComplete": True, "schema": {"fields": [{"name": "x", "type": "INT64"}]},
                 "totalRows": "1", "rows": [{"f": [{"v": "1"}]}]}

    def respond(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return Response(200, reply if len(calls) == 1 else completed)

    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request", respond)
    assert BigQueryConnector(point(), "secret").run_aggregate("SELECT 1").rows == [(1,)]
    assert calls[1][0] == "GET" and "location=EU" in calls[1][1]
    assert "formatOptions.useInt64Timestamp=true" in calls[1][1]

    calls.clear()
    event = threading.Event()
    event.set()
    with pytest.raises(RepoError) as error:
        BigQueryConnector(point(), "secret").run_aggregate("SELECT 1", cancel=event)
    assert error.value.code == "query_canceled"
    assert calls[1][0] == "POST" and "/jobs/job-1/cancel?location=EU" in calls[1][1]


@pytest.mark.parametrize("kind", ["BYTES", "TIME", "GEOGRAPHY", "JSON", "RECORD", "STRUCT", "RANGE"])
def test_unsupported_types_without_socket(monkeypatch, kind):
    reply = {"jobComplete": True, "jobReference": {"jobId": "1"}, "totalRows": "0",
             "schema": {"fields": [{"name": "colonne", "type": kind}]}}
    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request", lambda *a, **kw: Response(200, reply))
    with pytest.raises(RepoError, match=f"colonne.*{kind}"):
        BigQueryConnector(point(), "secret").test()


@pytest.mark.parametrize("field,value", [("http_path", "/sql/1.0/warehouses/abc"),
                                          ("warehouse_id", "abc"), ("oauth_client_id", "abc"),
                                          ("oauth_redirect_port", 8020), ("warehouse", "WH"),
                                          ("role", "R"), ("auth", "sso"), ("account", "abc")])
def test_bigquery_refuses_foreign_fields(field, value):
    with pytest.raises(RepoError, match=field):
        BigQueryConnector(point(**{field: value}), "secret")


@pytest.mark.parametrize("status,code", [(400, "query_failed"), (403, "platform_forbidden"),
                                         (404, "platform_not_found")])
def test_http_error_without_socket(monkeypatch, status, code):
    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request",
                        lambda *a, **kw: Response(status, {"error": {"message": "secret"}}))
    with pytest.raises(RepoError) as error:
        BigQueryConnector(point(), "secret").test()
    assert error.value.code == code and "secret" not in str(error.value)
    if status == 404:
        assert "projet-test" in str(error.value)


def test_errors_and_auth_without_socket(monkeypatch):
    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request",
                        lambda *a, **kw: Response(200, {"errors": [{"message": "secret"}]}))
    with pytest.raises(RepoError) as error:
        BigQueryConnector(point(), "secret").test()
    assert error.value.code == "query_failed" and "secret" not in str(error.value)
    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request", lambda *a, **kw: Response(401, {}))
    with pytest.raises(AuthRejected):
        BigQueryConnector(point(), "secret").test()


@pytest.mark.parametrize("extra", ["", "    warehouse_id: abc\n"])
def test_ancien_registre_bigquery(extra):
    registry, issues = parse_access_points(
        "access_points:\n  - id: ancien\n    platform: bigquery\n"
        "    host: https://exemple.fr\n    schema: finance\n    owner: claire\n" + extra, None)
    assert registry is not None and not issues
    assert registry.access_points[0].schema_ == "finance"


@pytest.mark.parametrize("changes,reason", [({"project": None}, "project"),
                                              ({"host": "https://evil.example"}, "host"),
                                              ({"warehouse_id": "abc"}, "warehouse_id")])
def test_refus_avant_appel_http(monkeypatch, changes, reason):
    calls = []
    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request", lambda *a, **kw: calls.append(a))
    with pytest.raises(RepoError, match=reason) as error:
        BigQueryConnector(point(**changes), "secret").test()
    assert error.value.code == "invalid_access_point" and not calls


@pytest.mark.parametrize("raw,kind", [(str(2**63), "int64"), ("1e9999", "float64"),
                                      ("abc", "inconnu")])
def test_autres_valeurs_invalides(raw, kind):
    with pytest.raises(RepoError, match="Valeur"):
        _value(raw, kind)


@pytest.mark.parametrize("reply,message", [
    ([], "Réponse BigQuery invalide"),
    ({}, "sans identifiant"),
    ({"jobReference": {"jobId": "1"}}, "État de requête"),
    ({"jobReference": {"jobId": "1"}, "jobComplete": True}, "Schéma absent"),
    ({"jobReference": {"jobId": "1"}, "jobComplete": True,
      "schema": {"fields": [None]}}, "Colonne invalide"),
    ({"jobReference": {"jobId": "1"}, "jobComplete": True,
      "schema": {"fields": []}, "totalRows": "incorrect"}, "Nombre de lignes"),
])
def test_reponses_invalides_sans_socket(monkeypatch, reply, message):
    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request", lambda *a, **kw: Response(200, reply))
    with pytest.raises(RepoError, match=message):
        BigQueryConnector(point(), "secret").test()


def test_depassement_lignes_et_annulation_echouee(monkeypatch):
    calls = []
    reply = {"jobReference": {"jobId": "1"}, "jobComplete": True,
             "schema": {"fields": []}, "totalRows": "0", "rows": [{"f": []}, {"f": []}]}

    def respond(method, url, **kwargs):
        calls.append(url)
        return Response(500, {}) if "/cancel" in url else Response(200, reply)

    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request", respond)
    with pytest.raises(RepoError) as error:
        BigQueryConnector(point(), "secret").run_aggregate("SELECT 1", max_rows=1)
    assert error.value.code == "result_too_large" and len(calls) == 2


def test_pause_entre_interrogations(monkeypatch):
    calls, sleeps = [], []
    waiting = {"jobReference": {"jobId": "1"}, "jobComplete": False}
    done = {**waiting, "jobComplete": True, "schema": {"fields": []}, "totalRows": "0"}

    def respond(*args, **kwargs):
        calls.append(args)
        return Response(200, done if len(calls) == 3 else waiting)

    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request", respond)
    monkeypatch.setattr("skifer_atlas.connectors.bigquery.time.sleep", sleeps.append)
    BigQueryConnector(point(), "secret").test()
    assert len(calls) == 3 and len(sleeps) == 1 and sleeps[0] > 0


def test_delai_sans_socket(monkeypatch):
    calls = []

    def respond(method, url, **kwargs):
        calls.append(url)
        return Response(200, {"jobReference": {"jobId": "1"}, "jobComplete": False})

    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request", respond)
    with pytest.raises(RepoError) as error:
        BigQueryConnector(point(), "secret").run_aggregate("SELECT 1", timeout=0)
    assert error.value.code == "query_timeout" and "/cancel" in calls[-1]


def test_pagination_sans_socket(monkeypatch):
    calls = []
    reply = {"jobReference": {"jobId": "1"}, "jobComplete": True,
             "schema": {"fields": []}, "totalRows": "0", "pageToken": "suite"}

    def respond(method, url, **kwargs):
        calls.append((url, kwargs))
        return Response(200, reply if len(calls) == 1 else {**reply, "pageToken": None})

    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request", respond)
    assert BigQueryConnector(point(location="EU"), "secret").run_aggregate("SELECT 1").rows == []
    assert calls[0][1]["json_body"]["location"] == "EU" and "pageToken=suite" in calls[1][0]


@pytest.mark.parametrize("total,rows,code", [("2", [], "result_too_large"),
                                             ("1", [{}], "query_failed")])
def test_limite_et_ligne_incomplete_sans_socket(monkeypatch, total, rows, code):
    reply = {"jobReference": {"jobId": "1"}, "jobComplete": True,
             "schema": {"fields": []}, "totalRows": total, "rows": rows}
    monkeypatch.setattr("skifer_atlas.connectors.bigquery.request", lambda *a, **kw: Response(200, reply))
    with pytest.raises(RepoError) as error:
        BigQueryConnector(point(), "secret").run_aggregate("SELECT 1", max_rows=1)
    assert error.value.code == code
