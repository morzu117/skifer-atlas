"""OAuth U2M avec PKCE (plan 0008, ADR 0011).

L'API rend l'URL d'autorisation ; le shell Tauri l'ouvre dans le navigateur système.
Atlas écoute le retour sur `127.0.0.1:<port>` cinq minutes au plus, vérifie `state`,
échange le code contre des jetons et les range au coffre. Rien d'autre ne garde de
jeton : ni fichier de cache, ni journal.

Le client public `databricks-cli` n'accepte que l'adresse de retour
`http://localhost:8020` ; un client propre au client déclare son port dans le point
d'accès (`oauth_redirect_port`).
"""

from __future__ import annotations

import base64
import hashlib
import html
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

from ..repo.git import RepoError
from ..vault.model import Credential
from .access_points import AccessPoint
from .http import message_of, request

DEFAULT_CLIENT_ID = "databricks-cli"
SCOPES = "all-apis offline_access"
LISTEN_SECONDS = 300


@dataclass(frozen=True)
class Endpoints:
    authorization: str
    token: str
    revocation: str | None = None


def discover(point: AccessPoint) -> Endpoints:
    """Métadonnées OIDC de l'espace Databricks."""
    url = f"{point.base_url}/oidc/.well-known/oauth-authorization-server"
    reply = request("GET", url)
    body = reply.body if isinstance(reply.body, dict) else {}
    if reply.status != 200 or "authorization_endpoint" not in body or "token_endpoint" not in body:
        raise RepoError("oauth_unavailable", f"OAuth indisponible sur {point.host} "
                        f"(HTTP {reply.status}) : utiliser un token personnel.")
    return Endpoints(body["authorization_endpoint"], body["token_endpoint"],
                     body.get("revocation_endpoint"))


def pkce() -> tuple[str, str]:
    """(verifier, challenge S256), RFC 7636."""
    verifier = secrets.token_urlsafe(64)[:96]
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return verifier, base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _credential(body: dict, client_id: str, previous: Credential | None = None) -> Credential:
    if not isinstance(body.get("access_token"), str):
        raise RepoError("oauth_failed", "Réponse OAuth sans jeton d'accès.")
    expires_in = body.get("expires_in")
    return Credential(
        kind="oauth",
        access_token=body["access_token"],
        refresh_token=body.get("refresh_token") or (previous.refresh_token if previous else None),
        expires_at=time.time() + float(expires_in) if expires_in is not None else None,
        client_id=client_id,
    )


def exchange(endpoints: Endpoints, client_id: str, code: str, verifier: str,
             redirect_uri: str) -> Credential:
    reply = request("POST", endpoints.token, form={
        "grant_type": "authorization_code", "client_id": client_id, "code": code,
        "code_verifier": verifier, "redirect_uri": redirect_uri,
    })
    if reply.status != 200 or not isinstance(reply.body, dict):
        raise RepoError("oauth_failed", f"Échange du code refusé (HTTP {reply.status}) : "
                        f"{message_of(reply.body)}")
    return _credential(reply.body, client_id)


class RefreshRefused(Exception):
    """Le serveur refuse le jeton de rafraîchissement : il faut se reconnecter."""


def refresh(endpoints: Endpoints, credential: Credential) -> Credential:
    if not credential.refresh_token:
        raise RefreshRefused
    client_id = credential.client_id or DEFAULT_CLIENT_ID
    reply = request("POST", endpoints.token, form={
        "grant_type": "refresh_token", "client_id": client_id,
        "refresh_token": credential.refresh_token,
    })
    if reply.status in (400, 401):
        raise RefreshRefused
    if reply.status != 200 or not isinstance(reply.body, dict):
        raise RepoError("oauth_failed", f"Rafraîchissement impossible (HTTP {reply.status}).")
    return _credential(reply.body, client_id, credential)


def revoke(endpoints: Endpoints, credential: Credential) -> bool:
    """Révocation côté serveur, si le serveur en publie le point d'entrée."""
    if endpoints.revocation is None:
        return False
    done = True
    for token, hint in ((credential.refresh_token, "refresh_token"),
                        (credential.access_token, "access_token")):
        if token:
            reply = request("POST", endpoints.revocation, form={
                "token": token, "token_type_hint": hint,
                "client_id": credential.client_id or DEFAULT_CLIENT_ID})
            done = done and reply.status == 200
    return done


# --- flux d'autorisation ------------------------------------------------------------------

@dataclass
class Flow:
    key: tuple[str, str]  # (espace, point d'accès)
    state: str
    verifier: str
    redirect_uri: str
    client_id: str
    endpoints: Endpoints
    on_success: Callable[[Credential], None]
    status: str = "pending"  # pending | connected | failed | expired
    error: str | None = None
    server: ThreadingHTTPServer | None = field(default=None, repr=False)

    def finish(self, status: str, error: str | None = None, wait: bool = False) -> None:
        """Fixe l'issue du flux et ferme l'écoute ; `wait` attend que le port soit libre."""
        if self.status == "pending":
            self.status, self.error = status, error
        server, self.server = self.server, None
        if server is None:
            return
        if wait:
            _close(server)
        else:
            threading.Thread(target=_close, args=(server,), daemon=True).start()


def _close(server: ThreadingHTTPServer) -> None:
    server.shutdown()
    server.server_close()


_PAGE = """<!doctype html><html lang="fr"><meta charset="utf-8"><title>Skifer Atlas</title>
<body style="font-family: system-ui, sans-serif; margin: 3rem"><p>{message}</p></body></html>"""


def _handler(flow: Flow) -> type[BaseHTTPRequestHandler]:
    class Callback(BaseHTTPRequestHandler):
        def log_message(self, *args) -> None:  # l'URL porte le code : rien au journal
            pass

        def do_GET(self) -> None:
            query = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            if not query:
                self._reply(404, "Adresse inconnue.")
                return
            if query.get("state") != flow.state:
                self._reply(400, "Réponse OAuth inattendue : relancer la connexion depuis Atlas.")
                return
            if "error" in query:
                flow.finish("failed", query.get("error_description") or query["error"])
                self._reply(400, "Connexion refusée. Revenir dans Atlas pour réessayer.")
                return
            try:
                credential = exchange(flow.endpoints, flow.client_id, query.get("code", ""),
                                      flow.verifier, flow.redirect_uri)
                flow.on_success(credential)
            except RepoError as error:
                flow.finish("failed", error.message)
                self._reply(502, "La connexion a échoué. Revenir dans Atlas pour réessayer.")
                return
            flow.finish("connected")
            self._reply(200, "Connexion réussie : vous pouvez fermer cet onglet et revenir "
                        "dans Atlas.")

        def _reply(self, status: int, message: str) -> None:
            body = _PAGE.format(message=html.escape(message)).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    return Callback


class Flows:
    """Flux en cours, un par port d'écoute : en relancer un remplace le précédent."""

    def __init__(self) -> None:
        self._by_port: dict[int, Flow] = {}
        self._last: dict[tuple[str, str], Flow] = {}
        self._lock = threading.Lock()

    def start(self, key: tuple[str, str], point: AccessPoint,
              on_success: Callable[[Credential], None],
              listen_seconds: float = LISTEN_SECONDS) -> str:
        endpoints = discover(point)
        port = point.redirect_port
        client_id = point.oauth_client_id or DEFAULT_CLIENT_ID
        verifier, challenge = pkce()
        flow = Flow(key, secrets.token_urlsafe(24), verifier, f"http://localhost:{port}",
                    client_id, endpoints, on_success)
        with self._lock:
            previous = self._by_port.pop(port, None)
            if previous is not None:
                previous.finish("failed", "Remplacé par une nouvelle connexion.", wait=True)
            try:
                # 127.0.0.1 seulement : le retour ne vient que du navigateur de ce poste.
                server = ThreadingHTTPServer(("127.0.0.1", port), _handler(flow))
            except OSError:
                raise RepoError("oauth_port_busy", f"Le port {port} est occupé : fermer "
                                "l'autre connexion OAuth en cours (CLI Databricks…) puis "
                                "réessayer.") from None
            server.daemon_threads = True
            flow.server = server
            self._by_port[port] = flow
            self._last[key] = flow
        threading.Thread(target=server.serve_forever, daemon=True).start()
        timer = threading.Timer(listen_seconds, flow.finish, args=("expired",
                                "Délai de connexion dépassé (5 minutes).",))
        timer.daemon = True
        timer.start()
        return endpoints.authorization + "?" + urlencode({
            "client_id": client_id, "response_type": "code", "redirect_uri": flow.redirect_uri,
            "scope": SCOPES, "state": flow.state, "code_challenge": challenge,
            "code_challenge_method": "S256",
        })

    def last(self, key: tuple[str, str]) -> Flow | None:
        with self._lock:
            return self._last.get(key)

    def stop_all(self) -> None:
        with self._lock:
            flows, self._by_port = list(self._by_port.values()), {}
        for flow in flows:
            flow.finish("failed", "Arrêt.", wait=True)


FLOWS = Flows()
