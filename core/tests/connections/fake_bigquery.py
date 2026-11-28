"""Faux service BigQuery local, avec jobs et pagination en mémoire."""

import itertools
import json
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


def _handler(state):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, status, data):
            raw = json.dumps(data).encode()
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
            if url.path.endswith("/cancel"):
                state.canceled.append(url.path.split("/")[-2])
                return self.send(200, {})
            if self.command == "POST":
                job = str(next(state.counter))
                state.jobs[job] = True
            else:
                job = url.path.split("/")[-1]
            ref = {"projectId": "projet-test", "jobId": job, "location": state.location}
            result = {"jobReference": ref, "jobComplete": not state.hold}
            if state.errors:
                result["errors"] = state.errors
            if not state.hold:
                offset = int(params.get("pageToken", ["0"])[0])
                data = state.rows[offset:offset + state.page_size]
                result.update(schema={"fields": state.fields}, totalRows=str(len(state.rows)),
                              rows=[{"f": [{"v": v} for v in row]} for row in data])
                if offset + state.page_size < len(state.rows):
                    result["pageToken"] = str(offset + state.page_size)
            self.send(200, result)

        do_GET = handle_call
        do_POST = handle_call

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
