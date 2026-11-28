"""Chargement et nettoyage des fixtures BigQuery, sans bibliothèque Google."""

import argparse
import json
import os
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import quote as urlquote
from urllib.parse import urlencode

from sqlglot import exp

from skifer_atlas.connectors.access_points import AccessPoint
from skifer_atlas.connectors.bigquery import BigQueryConnector
from skifer_atlas.connectors.http import message_of, request
from skifer_atlas.repo.git import RepoError
from skifer_atlas.run import open_database

VARIABLES = ("ATLAS_BIGQUERY_PROJECT", "ATLAS_BIGQUERY_TOKEN")


def connector(project, token, location=None, host="https://bigquery.googleapis.com"):
    point = AccessPoint(id="recette", platform="bigquery", host=host, project=project,
                        location=location, owner="recette")
    return BigQueryConnector(point, token)


def quote(name):
    return "`" + name.replace("`", "\\`") + "`"


def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


def cast_type(kind):
    datatype = exp.DataType.build(kind, dialect="duckdb")
    if datatype.is_type("decimal") and datatype.expressions:
        params = [int(p.this.this) for p in datatype.expressions]
        precision, scale = params[0], params[1] if len(params) > 1 else 0
        return "BIGNUMERIC" if scale > 9 or precision - scale > 29 else "NUMERIC"
    datatype.set("expressions", [])
    return datatype.sql(dialect="bigquery")


def save(path, state):
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=".etat-", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(state, handle)
    os.replace(temp, path)


class Recette:
    def __init__(self, warehouse, dataset, path, token):
        self.warehouse, self.dataset, self.path, self.token = warehouse, dataset, path, token
        self.project = warehouse.point.project
        self.root = "/bigquery/v2/projects/" + urlquote(self.project, safe="")
        self.dataset_path = self.root + "/datasets/" + urlquote(dataset, safe="")
        self.state = {"project": self.project, "dataset_name": dataset, "dataset": False,
                      "marker": uuid.uuid4().hex, "tables": []}

    def call(self, method, path, body=None, *, missing=False):
        reply = request(method, self.warehouse.point.base_url + path,
                        token=self.token, json_body=body)
        if missing and reply.status == 404:
            return None
        if reply.status not in (200, 204):
            raise RepoError("query_failed", f"BigQuery HTTP {reply.status} : "
                            f"{message_of(reply.body, self.token)}")
        if reply.status == 204:
            return None
        if not isinstance(reply.body, dict):
            raise RepoError("query_failed", "Réponse BigQuery invalide.")
        if reply.body.get("errors"):
            raise RepoError("query_failed", "Requête BigQuery en échec : "
                            + message_of(reply.body["errors"], self.token))
        return reply.body

    def setup(self):
        if self.path.exists():
            raise ValueError("État existant : nettoyer avant un nouveau passage.")
        save(self.path, self.state)
        reply = self.call("GET", self.dataset_path, missing=True)
        if reply is None:
            self.state["dataset"] = True
            save(self.path, self.state)
            body = {"datasetReference": {"projectId": self.project, "datasetId": self.dataset},
                    "labels": {"atlas_recette": self.state["marker"]}}
            if self.warehouse.point.location:
                body["location"] = self.warehouse.point.location
            self.call("POST", self.root + "/datasets", body)

    def sql(self, sql):
        body = {"query": sql, "useLegacySql": False, "timeoutMs": 500}
        if self.warehouse.point.location:
            body["location"] = self.warehouse.point.location
        result = self.call("POST", self.root + "/queries", body)
        ref = result.get("jobReference", {})
        if not ref.get("jobId"):
            raise RepoError("query_failed", "Réponse BigQuery sans identifiant de requête.")
        deadline = time.monotonic() + 60
        last_poll = None
        while result.get("jobComplete") is False:
            if time.monotonic() >= deadline:
                raise RepoError("query_timeout", "Délai de chargement BigQuery dépassé.")
            if last_poll is not None:
                delay = min(0.5 - (time.monotonic() - last_poll), deadline - time.monotonic())
                if delay > 0:
                    time.sleep(delay)
                if time.monotonic() >= deadline:
                    raise RepoError("query_timeout", "Délai de chargement BigQuery dépassé.")
            last_poll = time.monotonic()
            params = {"timeoutMs": 500}
            if location := ref.get("location") or self.warehouse.point.location:
                params["location"] = location
            root = "/bigquery/v2/projects/" + urlquote(ref.get("projectId") or self.project, safe="")
            result = self.call("GET", root + "/queries/" +
                                          urlquote(ref["jobId"], safe="") + "?" + urlencode(params))
        if result.get("jobComplete") is not True:
            raise RepoError("query_failed", "État de requête BigQuery invalide.")

    def load(self, sources, folder):
        names = {}
        with open_database(sources, folder) as db:
            for source in sources:
                name = "r_" + uuid.uuid4().hex
                target = quote(f"{self.project}.{self.dataset}.{name}")
                names[source.table] = target
                cursor = db.execute("SELECT * FROM " + ".".join(
                    '"' + p.replace('"', '""') + '"' for p in source.table.split(".")))
                columns, data = cursor.description, cursor.fetchall()
                if not data:
                    raise ValueError(f"Fixture vide : {source.table}")
                types = [cast_type(str(c[1]))
                         for c in columns]
                selects = ["SELECT " + ", ".join(
                    f"CAST({literal(v)} AS {kind}) AS {quote(c[0])}"
                    for v, kind, c in zip(row, types, columns, strict=True)) for row in data]
                self.state["tables"].append(name)
                save(self.path, self.state)
                self.sql(f"CREATE TABLE {target} OPTIONS(description={literal(self.state['marker'])}) AS "
                         + " UNION ALL ".join(selects))
        return names

    def drop(self):
        if not self.path.exists():
            return
        state = json.loads(self.path.read_text(encoding="utf-8"))
        if state["project"] != self.project or state["dataset_name"] != self.dataset:
            raise ValueError("Projet ou jeu de données différent de l’état.")
        for name in state["tables"]:
            path = self.dataset_path + "/tables/" + urlquote(name, safe="")
            reply = self.call("GET", path, missing=True)
            if reply is not None and reply.get("description") == state["marker"]:
                self.call("DELETE", path, missing=True)
        if state["dataset"]:
            reply = self.call("GET", self.dataset_path, missing=True)
            if reply is not None and reply.get("labels", {}).get("atlas_recette") == state["marker"]:
                self.call("DELETE", self.dataset_path, missing=True)
        self.path.unlink()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Nettoyage d'une recette BigQuery interrompue.")
    parser.add_argument("action", choices=("drop",))
    parser.add_argument("state", type=Path)
    args = parser.parse_args(argv)
    project, token = (os.environ.get(name) for name in VARIABLES)
    if not project or not token:
        parser.error(", ".join(VARIABLES) + " sont requis.")
    dataset = json.loads(args.state.read_text(encoding="utf-8"))["dataset_name"]
    Recette(connector(project, token, os.environ.get("ATLAS_BIGQUERY_LOCATION")),
            dataset, args.state.resolve(), token).drop()


if __name__ == "__main__":
    main()
