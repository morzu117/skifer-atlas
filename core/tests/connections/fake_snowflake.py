"""Faux compte Snowflake local : connexion par paire de clés (JWT vérifié), SSO
`externalbrowser` (le navigateur et le fournisseur d'identité sont simulés), jetons de
session et API de requêtes du connecteur. Il n'écoute que sur 127.0.0.1.

Les requêtes s'exécutent sur une base DuckDB en mémoire, après traduction du SQL Snowflake
par SQLGlot : de quoi comparer des chiffres et faire échouer un contrôle de cardinalité.

    uv run --project core python core/tests/connections/fake_snowflake.py 8794 [dossier]

le lance seul sur un port donné, pour les tests de bout en bout et les démonstrations.
Le SSO y est automatique et accepte tout identifiant : le faux fournisseur d'identité
rappelle le connecteur dès la demande d'authentification, sans navigateur
(`SF_TEST_BROWSER_OPENER=noop` côté Atlas). Avec un dossier, il y écrit une clé privée de
démonstration, `svc_es.p8`, chiffrée par `DEMO_PASSPHRASE`, pour l'identifiant `svc_es`."""

from __future__ import annotations

import base64
import datetime
import decimal
import hashlib
import itertools
import json
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import duckdb
import sqlglot
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding


def _b64decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def fingerprint(public_key) -> str:
    """Empreinte d'une clé publique telle que Snowflake la range (`RSA_PUBLIC_KEY_FP`)."""
    der = public_key.public_bytes(serialization.Encoding.DER,
                                  serialization.PublicFormat.SubjectPublicKeyInfo)
    return "SHA256:" + base64.b64encode(hashlib.sha256(der).digest()).decode()


class State:
    def __init__(self) -> None:
        self.counter = itertools.count(1)
        self.public_keys: dict[str, object] = {}  # LOGIN_NAME en majuscules → clé publique
        self.sso_users: set[str] = set()  # comptes acceptés par le faux fournisseur
        self.any_sso_user = False  # lancé seul : tout identifiant est accepté
        self.sso_tokens: dict[str, str] = {}  # jeton rendu par le fournisseur → compte
        self.sessions: dict[str, str] = {}  # jeton de session → compte
        self.masters: dict[str, str] = {}  # jeton maître → compte
        self.logins: list[dict] = []  # corps des login-request, pour les tests
        self.logged_out: list[str] = []
        self.seen_sql: list[str] = []
        self.sso_requests = 0
        self.results: dict[str, dict] = {}  # identifiant de requête → réponse (exécution asynchrone)
        self.running: set[str] = set()  # requêtes qui ne finissent jamais (« SELECT pg_sleep »)
        self.aborted: list[str] = []
        self.database = duckdb.connect()
        self.lock = threading.Lock()

    def open_session(self, user: str) -> dict:
        n = next(self.counter)
        token, master = f"sf-session-{n}", f"sf-master-{n}"
        self.sessions[token] = user
        self.masters[master] = user
        return {"token": token, "masterToken": master, "validityInSeconds": 3600,
                "masterValidityInSeconds": 14400, "sessionId": n}


def _column(name: str, value) -> dict:
    kind = {"type": "text", "length": 16777216, "byteLength": 16777216, "scale": None,
            "precision": None}
    if isinstance(value, bool):
        kind = {"type": "boolean"}
    elif isinstance(value, int):
        kind = {"type": "fixed", "precision": 38, "scale": 0}
    elif isinstance(value, decimal.Decimal):
        exponent = value.as_tuple().exponent
        kind = {"type": "fixed", "precision": 38,
                "scale": -exponent if isinstance(exponent, int) and exponent < 0 else 0}
    elif isinstance(value, float):
        kind = {"type": "real"}
    elif isinstance(value, datetime.datetime):
        kind = {"type": "timestamp_ntz", "precision": 0, "scale": 9}
    elif isinstance(value, datetime.date):
        kind = {"type": "date"}
    base = {"name": name, "database": "", "schema": "", "table": "", "nullable": True,
            "collation": None, "length": None, "byteLength": None, "scale": None,
            "precision": None}
    return {**base, **kind}


def _cell(value) -> str | None:
    """Les valeurs comme Snowflake les sérialise en JSON."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, datetime.datetime):
        seconds = value.replace(tzinfo=datetime.UTC).timestamp()
        return f"{seconds:.9f}"
    if isinstance(value, datetime.date):
        return str((value - datetime.date(1970, 1, 1)).days)
    return str(value)


def _handler(state: State, base: list[str]):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, payload: dict, status: int = 200):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _ok(self, data: dict | None):
            self._send({"data": data, "code": None, "message": None, "success": True})

        def _fail(self, code: str, message: str, data: dict | None = None):
            self._send({"data": data, "code": code, "message": message, "success": False})

        def _body(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length)
            if self.headers.get("Content-Encoding") == "gzip":
                import gzip

                raw = gzip.decompress(raw)
            return json.loads(raw or b"{}")

        def _session_user(self) -> str | None:
            header = self.headers.get("Authorization") or ""
            token = header.removeprefix('Snowflake Token="').removesuffix('"')
            return state.sessions.get(token)

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == "/health":  # prêt, pour le lanceur des tests de bout en bout
                self._send({"status": "ok"})
            elif self._session_user() is None:
                self._fail("390112", "Your session has expired. Please login again.")
            elif url.path.startswith("/monitoring/queries/"):
                query_id = url.path.rsplit("/", 1)[1]
                found = state.results.get(query_id) or {}
                status = ("RUNNING" if query_id in state.running
                          else "ABORTED" if query_id in state.aborted
                          else "SUCCESS" if found.get("success")
                          else "FAILED_WITH_ERROR")
                entry = {"id": query_id, "status": status}
                if status == "FAILED_WITH_ERROR":
                    entry.update(errorCode=found.get("code"), errorMessage=found.get("message"))
                self._ok({"queries": [entry]})
            elif url.path.startswith("/queries/") and url.path.endswith("/result"):
                self._send(state.results[url.path.split("/")[2]])
            else:
                self._send({"message": "inconnu"}, 404)

        def _issue_sso_token(self, user: str) -> str:
            token = f"idp-{next(state.counter)}"
            state.sso_tokens[token] = user
            return token

        def _redirect_to_client(self, user: str, port: int) -> None:
            """Ce que ferait le navigateur, revenu du fournisseur d'identité : appeler le
            port local du connecteur avec le jeton SAML."""
            token = self._issue_sso_token(user)

            def call():
                time.sleep(0.2)
                try:
                    urllib.request.urlopen(f"http://localhost:{port}/?token={token}",
                                           timeout=10).read()
                except OSError:
                    pass

            threading.Thread(target=call, daemon=True).start()

        def do_POST(self):
            url = urlparse(self.path)
            body = self._body()
            data = body.get("data") or {}
            if url.path == "/session/authenticator-request":
                state.sso_requests += 1
                user = data.get("LOGIN_NAME", "").upper()
                port = int(data.get("BROWSER_MODE_REDIRECT_PORT") or 0)
                if user not in state.sso_users and not state.any_sso_user:
                    self._fail("390190", "Utilisateur inconnu du fournisseur d'identité.")
                    return
                self._redirect_to_client(user, port)
                # Le connecteur n'accepte qu'une adresse https ; le navigateur n'est pas
                # ouvert (`SF_TEST_BROWSER_OPENER=noop`), le rappel part d'ici.
                self._ok({"ssoUrl": f"https://idp.invalid/sso?user={user}&port={port}",
                          "proofKey": f"proof-{next(state.counter)}"})
            elif url.path == "/session/v1/login-request":
                state.logins.append(data)
                self._login(data)
            elif url.path == "/session/token-request":
                header = self.headers.get("Authorization") or ""
                master = header.removeprefix('Snowflake Token="').removesuffix('"')
                user = state.masters.get(master)
                if user is None:
                    self._fail("390114", "Authentication token has expired.")
                    return
                session = state.open_session(user)
                state.masters[master] = user
                self._ok({"sessionToken": session["token"], "validityInSecondsST": 3600,
                          "masterToken": master, "validityInSecondsMT": 14400,
                          "sessionId": session["sessionId"]})
            elif url.path == "/session" and "delete=true" in (url.query or ""):
                header = self.headers.get("Authorization") or ""
                token = header.removeprefix('Snowflake Token="').removesuffix('"')
                user = state.sessions.pop(token, None)
                if user is not None:
                    state.logged_out.append(user)
                    for master in [m for m, u in state.masters.items() if u == user]:
                        state.masters.pop(master)
                self._ok(None)
            elif url.path in ("/session/heartbeat", "/telemetry/send"):
                self._ok(None)
            elif url.path == "/queries/v1/query-request":
                user = self._session_user()
                if user is None:
                    self._fail("390112", "Your session has expired. Please login again.")
                    return
                self._query(body.get("sqlText", ""), bool(body.get("asyncExec")))
            elif url.path.startswith("/queries/") and url.path.endswith("/abort-request"):
                query_id = url.path.split("/")[2]
                state.running.discard(query_id)
                state.aborted.append(query_id)
                self._ok(None)
            else:
                self._send({"message": "inconnu"}, 404)

        def _login(self, data: dict):
            user = (data.get("LOGIN_NAME") or "").upper()
            authenticator = data.get("AUTHENTICATOR")
            if authenticator == "SNOWFLAKE_JWT":
                if not self._valid_jwt(data.get("ACCOUNT_NAME", ""), user,
                                       data.get("TOKEN", "")):
                    self._fail("390144", "JWT token is invalid.")
                    return
            elif authenticator == "EXTERNALBROWSER":
                if state.sso_tokens.pop(data.get("TOKEN", ""), None) != user:
                    self._fail("390195", "The provided SAML response is invalid.")
                    return
            else:
                self._fail("390100", f"Authentification {authenticator} non simulée.")
                return
            session = state.open_session(user)
            self._ok({**session, "displayUserName": user, "serverVersion": "9.99.0",
                      "firstLogin": False, "healthCheckInterval": 45,
                      "parameters": [{"name": "AUTOCOMMIT", "value": True},
                                     {"name": "TIMEZONE", "value": "UTC"}],
                      "sessionInfo": {"databaseName": None, "schemaName": None,
                                      "warehouseName": None, "roleName": "PUBLIC"},
                      "idToken": None, "idTokenValidityInSeconds": 0})

        def _valid_jwt(self, account: str, user: str, token: str) -> bool:
            key = state.public_keys.get(user)
            try:
                header, payload, signature = token.split(".")
                claims = json.loads(_b64decode(payload))
                key.verify(_b64decode(signature), f"{header}.{payload}".encode(),
                           padding.PKCS1v15(), hashes.SHA256())
            except Exception:  # noqa: BLE001 — clé absente, jeton mal formé ou faux
                return False
            expected = f"{account.upper()}.{user}"
            return (claims.get("sub") == expected
                    and claims.get("iss") == f"{expected}.{fingerprint(key)}"
                    and claims.get("exp", 0) > time.time())

        def _query(self, sql: str, asynchronous: bool = False):
            state.seen_sql.append(sql)
            query_id = f"01b00000-0000-0000-0000-{next(state.counter):012d}"
            if sql.strip() == "SELECT pg_sleep":
                state.running.add(query_id)
                payload = {"data": {"queryId": query_id}, "code": None, "message": None,
                           "success": True}
            else:
                payload = self._execute(sql, query_id)
            state.results[query_id] = payload
            if asynchronous:
                self._send({"data": {"queryId": query_id,
                                     "getResultUrl": f"/queries/{query_id}/result"},
                            "code": "333334", "message": "Asynchronous execution in progress.",
                            "success": True})
            else:
                self._send(payload)

        def _execute(self, sql: str, query_id: str) -> dict:
            try:
                translated = sqlglot.transpile(sql, read="snowflake", write="duckdb")
                with state.lock:
                    cursor = state.database.execute(";\n".join(translated))
                    names = [d[0] for d in cursor.description]
                    rows = cursor.fetchall()
            except (duckdb.Error, sqlglot.errors.ParseError) as error:
                message = str(error).splitlines()[0]
                # Ce que Snowflake répond à un cast de texte en nombre (cardinality.py).
                if "Could not convert string" in message:
                    text = message.split("'")[1] if "'" in message else message
                    message = f"Numeric value '{text}' is not recognized"
                return {"data": {"errorCode": "100038", "sqlState": "22018",
                                 "queryId": query_id, "type": "COMPILATION"},
                        "code": "100038", "message": message, "success": False}
            first = rows[0] if rows else (None,) * len(names)
            rowtype = [_column(n.upper(), v) for n, v in zip(names, first, strict=True)]
            return {"data": {"rowtype": rowtype, "rowset": [[_cell(v) for v in r] for r in rows],
                             "total": len(rows), "returned": len(rows), "queryId": query_id,
                             "queryResultFormat": "json", "parameters": [],
                             "statementTypeId": 4096},
                    "code": None, "message": None, "success": True}

    return Handler


class FakeSnowflake:
    def __init__(self, port: int = 0) -> None:
        self.state = State()
        base: list[str] = []
        self.server = ThreadingHTTPServer(("127.0.0.1", port), _handler(self.state, base))
        self.port = self.server.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        base.append(self.url)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def add_key_user(self, user: str, public_key) -> None:
        self.state.public_keys[user.upper()] = public_key

    def add_sso_user(self, user: str) -> None:
        self.state.sso_users.add(user.upper())

    def use_database(self, connection) -> None:
        """Les tables du compte : une base DuckDB déjà chargée (`run.open_database`)."""
        with self.state.lock:
            self.state.database.close()
            self.state.database = connection

    def expire_sessions(self) -> None:
        self.state.sessions.clear()
        self.state.masters.clear()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


DEMO_USER = "svc_es"
DEMO_PASSPHRASE = "demo-snowflake"


def write_demo_key(fake: FakeSnowflake, folder) -> None:
    from pathlib import Path

    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    fake.add_key_user(DEMO_USER, key.public_key())
    path = Path(folder) / f"{DEMO_USER}.p8"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.BestAvailableEncryption(DEMO_PASSPHRASE.encode())))


if __name__ == "__main__":
    import sys

    fake = FakeSnowflake(int(sys.argv[1]) if len(sys.argv) > 1 else 0)
    fake.state.any_sso_user = True
    if len(sys.argv) > 2:
        write_demo_key(fake, sys.argv[2])
    print(fake.url, flush=True)
    fake.thread.join()
