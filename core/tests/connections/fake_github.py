"""GitHub local pour les scénarios front : code, autorisation explicite, /user, dépôts.

Le navigateur choisit autorisation, refus ou expiration ; aucun compte réel.
`/repos/<propriétaire>/<dépôt>` (plan 0033) répond d'après le préfixe du nom : `introuvable-`
donne 404, `lecture-` un compte sans droit de pousser, `archive-` un dépôt archivé ; tout
autre dépôt est accessible en écriture.

Les pull requests (plan 0006) : créées, listées et relues sans revue ni commentaire ; la
fusion répond ce que `/__test__/configure` lui demande (par exemple 405, une règle de
protection de la branche) et, sans réglage, 200 sans rien fusionner dans le dépôt.
"""

import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

TOKEN = "gho_jeton-du-device-flow"
FLOWS: dict[str, str] = {}
PULLS: dict[str, list[dict]] = {}  # « propriétaire/dépôt » → pull requests
SETTINGS: dict = {"merge_error": None}  # (statut, charge utile) rendus par la fusion


def head_sha(repo: str, branch: str) -> str:
    """Le commit de la branche dans le dépôt nu qui tient lieu de GitHub, s'il se trouve."""
    folder = os.environ.get("ATLAS_E2E_DATA")
    if folder:
        path = os.path.join(folder, "depots-github", f"{repo}.git")
        found = subprocess.run(["git", "ls-remote", path, f"refs/heads/{branch}"],
                               capture_output=True, text=True, check=False).stdout.split()
        if found:
            return found[0]
    return "a" * 40


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

    def _body(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        return json.loads(raw or b"{}")

    def _pulls(self, method, parts):
        """`parts` : propriétaire, dépôt, puis `pulls`/`issues` et ce qui suit."""
        pulls = PULLS.setdefault("/".join(parts[:2]), [])
        rest = parts[2:]
        if rest == ["pulls"] and method == "POST":
            body = self._body()
            pull = {"number": len(pulls) + 1, "title": body["title"], "body": body["body"],
                    "state": "open", "merged_at": None,
                    "head": {"ref": body["head"], "sha": head_sha(parts[1], body["head"])},
                    "user": {"login": "julien.h"}, "created_at": "2026-11-10T10:00:00Z"}
            pulls.append(pull)
            return self.send(201, pull)
        if rest == ["pulls"]:
            return self.send(200, pulls)
        if len(rest) >= 2 and rest[1].isdigit() and int(rest[1]) <= len(pulls):
            pull = pulls[int(rest[1]) - 1]
            tail = rest[2:]
            if not tail:
                return self.send(200, pull)
            if tail == ["reviews"] or tail == ["comments"]:
                return self.send(200, [])
            if tail == ["merge"] and method == "PUT":
                self._body()
                if SETTINGS["merge_error"]:
                    return self.send(*SETTINGS["merge_error"])
                pull.update(state="closed", merged_at="2026-11-10T12:00:00Z")
                return self.send(200, {"sha": "m" * 40, "merged": True})
        self.send(404, {"message": "Not Found"})

    def do_PUT(self):
        parts = urlparse(self.path).path.removeprefix("/repos/").split("/")
        if not self.path.startswith("/repos/") or self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self.send(401, {"message": "Bad credentials"})
        self._pulls("PUT", parts)

    def do_POST(self):
        if self.path == "/__test__/configure":
            # Pilotage du faux uniquement : la prochaine fusion répond `merge_error`.
            body = self._body()
            error = body.get("merge_error")
            SETTINGS["merge_error"] = (error["status"], {"message": error["message"]}) if error else None
            return self.send(200, {"configured": True})
        if self.path.startswith("/repos/"):
            if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                return self.send(401, {"message": "Bad credentials"})
            return self._pulls("POST", urlparse(self.path).path.removeprefix("/repos/").split("/"))
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
        if url.path.startswith("/repos/"):
            if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                return self.send(401, {"message": "Bad credentials"})
            parts = url.path.removeprefix("/repos/").split("/")
            if len(parts) > 2:
                return self._pulls("GET", parts)
            if len(parts) != 2:
                return self.send(404, {"message": "Not Found"})
            name = parts[1]
            if name.startswith("introuvable-"):
                return self.send(404, {"message": "Not Found"})
            return self.send(200, {"full_name": url.path.removeprefix("/repos/"),
                                   "archived": name.startswith("archive-"),
                                   "permissions": {"push": not name.startswith("lecture-"),
                                                   "pull": True}})
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
