"""Faux espace Databricks local : OIDC (découverte, autorisation, jetons, révocation) et
API d'exécution de requêtes SQL. Il n'écoute que sur 127.0.0.1, sur un port libre."""

from __future__ import annotations

import base64
import hashlib
import itertools
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class State:
    def __init__(self) -> None:
        self.counter = itertools.count(1)
        self.challenges: dict[str, str] = {}  # code → challenge PKCE
        self.valid: set[str] = set()  # jetons d'accès acceptés
        self.refresh_tokens: set[str] = set()
        self.refuse_refresh = False
        self.expires_in = 3600
        self.revoked: list[str] = []
        self.statements: dict[str, dict] = {}
        self.canceled: list[str] = []
        self.rows = 3  # lignes rendues par une requête autre que SELECT 1
        self.chunk_size = 2
        self.seen_sql: list[str] = []
        self.token_requests: list[dict] = []

    def issue(self) -> dict:
        n = next(self.counter)
        access, refresh = f"at-secret-{n}", f"rt-secret-{n}"
        self.valid.add(access)
        self.refresh_tokens.add(refresh)
        return {"access_token": access, "refresh_token": refresh, "token_type": "Bearer",
                "expires_in": self.expires_in}


def _handler(state: State, base: list[str]):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, status, payload=None, headers=None):
            body = b"" if payload is None else json.dumps(payload).encode()
            self.send_response(status)
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _form(self):
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode()
            if self.headers.get("Content-Type", "").startswith("application/json"):
                return json.loads(raw or "{}")
            return {k: v[0] for k, v in parse_qs(raw).items()}

        def _authorized(self):
            token = (self.headers.get("Authorization") or "").removeprefix("Bearer ")
            if token not in state.valid:
                self._send(401, {"error_code": "UNAUTHENTICATED", "message": "jeton refusé"})
                return False
            return True

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == "/oidc/.well-known/oauth-authorization-server":
                root = base[0]
                self._send(200, {"authorization_endpoint": f"{root}/oidc/v1/authorize",
                                 "token_endpoint": f"{root}/oidc/v1/token",
                                 "revocation_endpoint": f"{root}/oidc/v1/revoke"})
            elif url.path == "/oidc/v1/authorize":
                query = {k: v[0] for k, v in parse_qs(url.query).items()}
                assert query["code_challenge_method"] == "S256"
                assert query["scope"] == "all-apis offline_access"
                code = f"code-{next(state.counter)}"
                state.challenges[code] = query["code_challenge"]
                target = query["redirect_uri"] + "?" + urlencode(
                    {"code": code, "state": query["state"]})
                self._send(302, None, {"Location": target})
            elif url.path.startswith("/api/2.0/sql/statements/"):
                if not self._authorized():
                    return
                parts = url.path.split("/")
                statement = state.statements[parts[5]]
                if len(parts) > 7:  # …/result/chunks/<n>
                    self._send(200, statement["chunks"][int(parts[8])])
                else:
                    self._send(200, statement["reply"])
            else:
                self._send(404, {"message": "inconnu"})

        def do_POST(self):
            url = urlparse(self.path)
            if url.path == "/oidc/v1/token":
                form = self._form()
                state.token_requests.append(form)
                if form["grant_type"] == "authorization_code":
                    challenge = state.challenges.pop(form["code"], None)
                    digest = hashlib.sha256(form["code_verifier"].encode()).digest()
                    expected = base64.urlsafe_b64encode(digest).decode().rstrip("=")
                    if challenge != expected:
                        self._send(400, {"error": "invalid_grant"})
                        return
                    self._send(200, state.issue())
                elif state.refuse_refresh or form["refresh_token"] not in state.refresh_tokens:
                    self._send(400, {"error": "invalid_grant",
                                     "error_description": "refresh token expired"})
                else:
                    state.refresh_tokens.discard(form["refresh_token"])
                    self._send(200, state.issue())
            elif url.path == "/oidc/v1/revoke":
                form = self._form()
                state.revoked.append(form["token"])
                state.valid.discard(form["token"])
                self._send(200, {})
            elif url.path == "/api/2.0/sql/statements":
                if self._authorized():
                    self._send(200, self._execute(self._form()))
            elif url.path.endswith("/cancel"):
                if self._authorized():
                    state.canceled.append(url.path.split("/")[5])
                    self._send(200, {})
            else:
                self._send(404, {"message": "inconnu"})

        def _execute(self, body):
            sql = body["statement"]
            state.seen_sql.append(sql)
            statement_id = f"st-{next(state.counter)}"
            if sql == "SELECT pg_sleep":
                reply = {"statement_id": statement_id, "status": {"state": "RUNNING"}}
                state.statements[statement_id] = {"reply": reply, "chunks": []}
                return reply
            if sql.startswith("BROKEN"):
                return {"statement_id": statement_id, "status": {
                    "state": "FAILED", "error": {"message": "[PARSE_SYNTAX_ERROR] near BROKEN"}}}
            if sql == "SELECT 1 AS ok":
                columns = [{"name": "ok", "type_name": "INT", "position": 0}]
                data = [["1"]]
            else:
                columns = [{"name": "mois", "type_name": "DATE", "position": 0},
                           {"name": "ca", "type_name": "DECIMAL", "position": 1}]
                data = [[f"2025-{m:02d}-01", f"{m}00.50"] for m in range(1, state.rows + 1)]
            limit = body.get("row_limit") or len(data)
            truncated = len(data) > limit
            data = data[:limit]
            chunks = [data[i:i + state.chunk_size]
                      for i in range(0, len(data), state.chunk_size)] or [[]]
            rendered = []
            for index, rows in enumerate(chunks):
                chunk = {"chunk_index": index, "row_count": len(rows), "data_array": rows}
                if index + 1 < len(chunks):
                    chunk["next_chunk_internal_link"] = (
                        f"/api/2.0/sql/statements/{statement_id}/result/chunks/{index + 1}")
                rendered.append(chunk)
            reply = {"statement_id": statement_id, "status": {"state": "SUCCEEDED"},
                     "manifest": {"schema": {"columns": columns}, "total_row_count": len(data),
                                  "total_chunk_count": len(chunks), "truncated": truncated},
                     "result": rendered[0]}
            state.statements[statement_id] = {"reply": reply, "chunks": rendered}
            return reply

    return Handler


class FakeDatabricks:
    def __init__(self) -> None:
        self.state = State()
        base: list[str] = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(self.state, base))
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        base.append(self.url)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
