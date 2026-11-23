"""Appels HTTP des connecteurs : `urllib` seul, sans dépendance ni journal.

Aucune requête, réponse ou en-tête n'est journalisé : ils portent des jetons.
"""

from __future__ import annotations

import http.client
import json
import queue
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from ..masking import mask_body, mask_secrets
from ..repo.git import RepoError

TIMEOUT = 30  # secondes, par appel
MAX_BODY = 50 * 1024 * 1024


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


@dataclass
class Response:
    status: int
    body: Any  # JSON décodé, ou texte brut s'il ne l'est pas
    size: int = 0
    headers: dict = field(default_factory=dict)


@dataclass(frozen=True)
class ApiKey:
    value: str = field(repr=False)
    placement: str
    name: str
    prefix: str = ""


def get(url: str, *, key: ApiKey, origin: str, timeout=TIMEOUT,
        max_bytes=MAX_BODY) -> Response:
    """GET borné, clé liée exactement à l'origine, sans suivi de redirection (ADR 0053)."""
    try:
        code, result = _get(url, key=key, origin=origin, timeout=timeout, max_bytes=max_bytes)
    except ValueError:
        code, result = "host_unreachable", None
    # La frame de cette fonction figure dans le traceback : aucun identifiant ne doit y rester.
    del key, url, origin
    if code == "rest_next_url_refused":
        raise RepoError(code, "Adresse de pagination REST refusée.")
    if code == "rest_timeout":
        raise RepoError(code, "Délai de l'appel REST dépassé.")
    if code == "rest_response_too_large":
        raise RepoError(code, "Réponse REST trop volumineuse.")
    if code:
        raise RepoError("host_unreachable", "Hôte REST injoignable.")
    return result


def _get(url: str, *, key: ApiKey, origin: str, timeout: float, max_bytes: int):
    parts, allowed = urllib.parse.urlsplit(url), urllib.parse.urlsplit(origin)
    if ((parts.scheme, parts.netloc) != (allowed.scheme, allowed.netloc)
            or parts.username is not None or parts.fragment):
        return "rest_next_url_refused", None
    query = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
             if k != key.name]
    headers = {"Accept": "application/json", "User-Agent": "skifer-atlas"}
    if key.placement == "query":
        query.append((key.name, key.value))
    else:
        headers[key.name] = key.prefix + key.value
    target = urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))
    call = urllib.request.Request(target, headers=headers, method="GET")
    deadline = time.monotonic() + timeout
    outcome = queue.Queue(maxsize=1)
    abandoned = threading.Event()
    socket_lock = threading.Lock()
    active_socket = [None]

    def fetch():
        try:
            try:
                reply = _OPENER.open(call, timeout=timeout)
            except urllib.error.HTTPError as error:
                reply = error
            with reply:
                response = reply.fp if isinstance(reply, urllib.error.HTTPError) else reply
                expected = response.length
                chunks, size = [], 0
                while True:
                    if response.fp is None:
                        break
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or abandoned.is_set():
                        raise TimeoutError()
                    # read1 effectue au plus une lecture de socket : une réponse lente
                    # ne peut pas prolonger l'échéance en envoyant des octets isolés.
                    sock = _response_socket(response)
                    with socket_lock:
                        if abandoned.is_set():
                            raise TimeoutError()
                        active_socket[0] = sock
                    sock.settimeout(remaining)
                    chunk = response.read1(min(65536, max_bytes + 1 - size))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    size += len(chunk)
                    if size > max_bytes:
                        outcome.put(("rest_response_too_large", None))
                        return
                if expected is not None and size != expected:
                    outcome.put(("host_unreachable", None))
                    return
                body = _decode(b"".join(chunks))
                result = Response(reply.code, body, size,
                                  {name.lower(): value for name, value in reply.headers.items()})
                outcome.put((None, result))
                return
        except TimeoutError:
            outcome.put(("rest_timeout", None))
            return
        except urllib.error.URLError as error:
            outcome.put(("rest_timeout" if isinstance(error.reason, TimeoutError) else "host_unreachable", None))
            return
        except (ConnectionError, OSError, ValueError,
                http.client.HTTPException, RecursionError):
            pass
        except Exception:  # noqa: BLE001 — ne jamais exposer une exception du worker
            outcome.put(("host_unreachable", None))
            return
        outcome.put(("host_unreachable", None))

    # L'ouverture et la lecture des en-têtes peuvent elles aussi recevoir des octets
    # lentement. Le délai de l'appelant reste borné même dans ce cas ; le worker
    # referme la réponse dès que l'ouverture ou la lecture en cours se termine.
    threading.Thread(target=fetch, daemon=True).start()
    try:
        code, result = outcome.get(timeout=max(0, deadline - time.monotonic()))
    except queue.Empty:
        abandoned.set()
        with socket_lock:
            sock = active_socket[0]
            if sock is not None:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
        code, result = "rest_timeout", None
    return code, result


def _response_socket(response):
    # urllib n'expose pas la socket de HTTPResponse par une API publique.
    return response.fp.raw._sock


def request(method: str, url: str, *, token: str | None = None, json_body: Any = None,
            form: dict | None = None, timeout: float = TIMEOUT) -> Response:
    """Appel HTTP ; une erreur réseau donne `host_unreachable`, un statut HTTP d'erreur
    est rendu tel quel à l'appelant."""
    headers = {"Accept": "application/json", "User-Agent": "skifer-atlas"}
    data = None
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif form is not None:
        data = urllib.parse.urlencode(form).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    call = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with _OPENER.open(call, timeout=timeout) as reply:
            return Response(reply.status, _decode(reply.read()))
    except urllib.error.HTTPError as error:
        return Response(error.code, _decode(error.read()))
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
        reason = getattr(error, "reason", error)
        raise RepoError("host_unreachable", f"Hôte injoignable : "
                        f"{urllib.parse.urlparse(url).netloc} "
                        f"({mask_secrets(str(reason), token)}).") from None


def _decode(raw: bytes) -> Any:
    text = raw.decode("utf-8", errors="replace")
    try:
        return json.loads(text) if text else None
    except ValueError:
        return text


def message_of(body: Any, *secrets: str | None) -> str:
    """Message d'erreur d'une réponse, borné ; les `secrets` envoyés (jeton, code,
    vérificateur) y sont remplacés par `***` avant la troncature."""
    body = mask_body(body, *secrets)
    if isinstance(body, dict):
        for key in ("message", "error_description", "error"):
            if isinstance(body.get(key), str):
                return body[key][:300]
    return str(body)[:300] if body else ""
