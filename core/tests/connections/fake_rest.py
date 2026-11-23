"""Serveur REST de test en boucle locale, sans journal ni secret sur disque."""

import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


class FakeRest:
    def __init__(self):
        self.key = secrets.token_urlsafe(24)
        self.requests = []
        self.replies = []
        self.rows = [{"symbol": "EX", "t": "2026-01-02", "c": 10.0}]
        self.mode = "list"
        state = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                url = urlsplit(self.path)
                query = parse_qs(url.query)
                state.requests.append((url.path, query, dict(self.headers)))
                token = query.get("apikey", [None])[0] or self.headers.get("Authorization", "")
                if token not in (state.key, "Bearer " + state.key):
                    status, body, headers = 401, {}, {}
                elif state.replies:
                    status, body, headers = state.replies.pop(0)
                else:
                    status, headers = 200, {}
                    if state.mode == "list":
                        body = state.rows
                    else:
                        body = {"results": state.rows,
                                "next_url": state.url + "/v1/data?page=2" if "page" not in query
                                else None}
                raw = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(status)
                for name, value in headers.items():
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.host = "127.0.0.1:" + str(self.server.server_port)
        self.url = "http://" + self.host
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
