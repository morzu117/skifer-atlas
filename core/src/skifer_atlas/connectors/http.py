"""Appels HTTP des connecteurs : `urllib` seul, sans dépendance ni journal.

Aucune requête, réponse ou en-tête n'est journalisé : ils portent des jetons.
"""

from __future__ import annotations

import json
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
    parts, allowed = urllib.parse.urlsplit(url), urllib.parse.urlsplit(origin)
    if ((parts.scheme, parts.netloc) != (allowed.scheme, allowed.netloc)
            or parts.username is not None or parts.fragment):
        raise RepoError("rest_next_url_refused", "Adresse de pagination REST refusée.")
    query = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
             if k != key.name]
    headers = {"Accept": "application/json", "User-Agent": "skifer-atlas"}
    if key.placement == "query":
        query.append((key.name, key.value))
    else:
        headers[key.name] = key.prefix + key.value
    target = urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))
    call = urllib.request.Request(target, headers=headers, method="GET")
    try:
        try:
            reply = _OPENER.open(call, timeout=timeout)
        except urllib.error.HTTPError as error:
            reply = error
        with reply:
            raw = reply.read(max_bytes + 1)
            if len(raw) > max_bytes:
                raise RepoError("rest_response_too_large", "Réponse REST trop volumineuse.")
            return Response(reply.code, _decode(raw), len(raw),
                            {name.lower(): value for name, value in reply.headers.items()})
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, ValueError) as error:
        # Même masquage que les autres connecteurs, mais aucun texte distant n'est restitué.
        reason = type(getattr(error, "reason", error)).__name__
        message = mask_secrets(f"Hôte REST injoignable ({reason}).", key.value)
        raise RepoError("host_unreachable", message) from None


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
