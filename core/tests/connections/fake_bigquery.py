"""Faux service BigQuery local, avec jobs et pagination en mémoire."""

import itertools
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


class State:
    def __init__(self):
        self.token = "secret-bq"
        self.jobs = {}
        self.canceled = []
        self.calls = []
        self.counter = itertools.count(1)
        self.hold = False
        self.status = 200
        self.errors = None
        self.fields = [{"name": "ok", "type": "INTEGER"}]
        self.rows = [["1"]]
        self.page_size = 1
        self.location = "europe-west1"
        self.datasets = {}
        self.fail_create = False
        self.fail_dataset_insert = False
        self.polls_before_complete = 0
        self.poll_errors = None


def _handler(state):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, status, data):
            raw = b"" if status == 204 else json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def handle_call(self):
            url = urlparse(self.path)
            params = parse_qs(url.query)
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            state.calls.append((self.command, url.path, params, body))
            if self.headers.get("Authorization") != f"Bearer {state.token}":
                return self.send(401, {"error": {"message": "jeton refusé"}})
            if state.status != 200:
                return self.send(state.status, {"error": {"message": f"erreur {state.token}"}})
            parts = url.path.split("/")
            if "datasets" in parts:
                index = parts.index("datasets")
                dataset = parts[index + 1] if len(parts) > index + 1 else None
                if dataset is None and self.command == "POST":
                    if state.fail_dataset_insert:
                        return self.send(500, {"error": "insertion interrompue"})
                    dataset = body["datasetReference"]["datasetId"]
                    if dataset in state.datasets:
                        return self.send(409, {"error": "jeu existant"})
                    state.datasets[dataset] = {"labels": body.get("labels", {}), "tables": {}}
                    return self.send(200, body)
                found = state.datasets.get(dataset)
                if found is None:
                    return self.send(404, {"error": "jeu absent"})
                if len(parts) > index + 2 and parts[index + 2] == "tables":
                    name = parts[index + 3]
                    table = found["tables"].get(name)
                    if table is None:
                        return self.send(404, {"error": "table absente"})
                    if self.command == "DELETE":
                        del found["tables"][name]
                        return self.send(204, None)
                    return self.send(200, table)
                if self.command == "DELETE":
                    if found["tables"]:
                        return self.send(400, {"error": "jeu non vide"})
                    del state.datasets[dataset]
                    return self.send(204, None)
                return self.send(200, {"labels": found["labels"]})
            if self.command == "POST" and body.get("query", "").startswith("CREATE TABLE "):
                if state.fail_create:
                    return self.send(200, {"errors": [{"message": f"échec {state.token}"}]})
                match = re.match(r"CREATE TABLE `[^.]+\.([^.]+)\.([^`]+)` OPTIONS\(description='([^']+)'\) AS ", body["query"])
                if not match:
                    return self.send(400, {"error": "DDL invalide"})
                dataset, name, marker = match.groups()
                found = state.datasets.get(dataset)
                if found is None:
                    return self.send(404, {"error": "jeu absent"})
                if name in found["tables"]:
                    return self.send(409, {"error": "table existante"})
                found["tables"][name] = {"description": marker}
            if url.path.endswith("/cancel"):
                state.canceled.append(url.path.split("/")[-2])
                return self.send(200, {})
            if self.command == "POST":
                job = str(next(state.counter))
                state.jobs[job] = True
            else:
                job = url.path.split("/")[-1]
            ref = {"projectId": "projet-test", "jobId": job, "location": state.location}
            pending = state.hold or (self.command == "POST" and state.polls_before_complete > 0)
            if self.command == "GET" and state.polls_before_complete:
                state.polls_before_complete -= 1
                pending = state.polls_before_complete > 0
            result = {"jobReference": ref, "jobComplete": not pending}
            if self.command == "GET" and state.poll_errors:
                result["errors"] = state.poll_errors
            if state.errors:
                result["errors"] = state.errors
            if not pending:
                offset = int(params.get("pageToken", ["0"])[0])
                data = state.rows[offset:offset + state.page_size]
                result.update(schema={"fields": state.fields}, totalRows=str(len(state.rows)),
                              rows=[{"f": [{"v": v} for v in row]} for row in data])
                if offset + state.page_size < len(state.rows):
                    result["pageToken"] = str(offset + state.page_size)
            self.send(200, result)

        do_GET = handle_call
        do_POST = handle_call
        do_DELETE = handle_call

    return Handler


class FakeBigQuery:
    def __init__(self):
        self.state = State()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(self.state))
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
