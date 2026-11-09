"""Appels HTTP des connecteurs : `urllib` seul, sans dépendance ni journal.

Aucune requête, réponse ou en-tête n'est journalisé : ils portent des jetons.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from ..masking import mask_body, mask_secrets
from ..repo.git import RepoError

TIMEOUT = 30  # secondes, par appel


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


@dataclass
class Response:
    status: int
    body: Any  # JSON décodé, ou texte brut s'il ne l'est pas


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
