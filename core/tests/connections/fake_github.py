"""GitHub local pour les scénarios front : code, autorisation explicite, /user.

Le navigateur choisit autorisation, refus ou expiration ; aucun compte réel.
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

TOKEN = "gho_jeton-du-device-flow"
FLOWS: dict[str, str] = {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, value, content_type="application/json"):
        body = (json.dumps(value) if content_type == "application/json" else value).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        form = parse_qs(self.rfile.read(int(self.headers.get("Content-Length", 0))).decode())
        if form.get("client_id") != ["Iv1.atlas-test"]:
            return self.send(401, {"error": "incorrect_client_credentials"})
        if self.path == "/login/device/code":
            code = uuid4().hex[:8].upper()
            FLOWS[code] = "authorization_pending"
            return self.send(200, {
                "device_code": code, "user_code": code,
                "verification_uri": f"http://127.0.0.1:{self.server.server_port}/login/device?code={code}",
                "expires_in": 900, "interval": 1,
            })
        if self.path == "/login/oauth/access_token":
            state = FLOWS.get(form.get("device_code", [""])[0], "expired_token")
            return self.send(200, {"access_token": TOKEN, "token_type": "bearer", "scope": "repo"}
                             if state == "connected" else {"error": state})
        self.send(404, {})

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/health":
            return self.send(200, {"ok": True})
        if url.path == "/user":
            return self.send(200, {"login": "julien.h"}) if self.headers.get(
                "Authorization") == f"Bearer {TOKEN}" else self.send(401, {})
        if url.path == "/login/device":
            query = parse_qs(url.query)
            code = query.get("code", [""])[0]
            if code not in FLOWS:
                return self.send(404, {})
            action = query.get("action", [""])[0]
            if action in {"connected", "access_denied", "expired_token"}:
                FLOWS[code] = action
                return self.send(200, "Autorisation enregistrée", "text/html; charset=utf-8")
            links = "".join(f'<p><a href="?code={code}&action={action}">{label}</a></p>'
                            for action, label in [("connected", "Autoriser"),
                                                  ("access_denied", "Refuser"),
                                                  ("expired_token", "Expirer")])
            return self.send(200, f"<!doctype html><html lang='fr'><h1>GitHub de test</h1>{links}</html>",
                             "text/html; charset=utf-8")
        self.send(404, {})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
