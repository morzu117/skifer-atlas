"""Jeton GitHub par le device flow d'OAuth, rangé au coffre de l'espace (plan 0025, ADR 0029).

Atlas affiche un code ; l'utilisateur le saisit sur `github.com/login/device`, depuis le
navigateur de son choix. Aucun champ ne reçoit de jeton, et aucune adresse de retour
n'est à ouvrir sur le poste : c'est le flux prévu par GitHub pour les applications de
bureau.

- Le client OAuth est celui de l'organisation qui distribue Atlas :
  `ATLAS_GITHUB_CLIENT_ID`. Sans lui, `github_not_configured`.
- L'interface relit le flux (`poll`) ; Atlas n'interroge GitHub qu'au rythme demandé
  (`interval`, allongé à chaque `slow_down`).
- Le jeton obtenu va droit au coffre de l'espace (`<espace>/@github`). Pour rejoindre un
  dépôt privé, l'espace n'existe pas encore : le jeton reste en mémoire du processus,
  dans son flux, jusqu'à ce que `join_workspace` le reprenne (`pending`) et le range sous
  l'identifiant lu dans `atlas.yaml`. Un flux expire avec son code.
"""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

from ..paths import is_workspace_id
from ..repo.git import RepoError
from ..vault import GITHUB_ENTRY, Credential, Vault

GITHUB_URL = "https://github.com"
SCOPE = "repo"  # dépôts privés, branches et pull requests
GRANT = "urn:ietf:params:oauth:grant-type:device_code"
KEEP_AFTER_CONNECT = 15 * 60  # secondes : délai laissé pour rejoindre l'espace


def client_id() -> str | None:
    return os.environ.get("ATLAS_GITHUB_CLIENT_ID") or None


def _base() -> str:
    return (os.environ.get("ATLAS_GITHUB_URL") or GITHUB_URL).rstrip("/")


def _post(path: str, fields: dict[str, str]) -> dict:
    request = urllib.request.Request(
        f"{_base()}{path}", method="POST", data=urllib.parse.urlencode(fields).encode(),
        headers={"Accept": "application/json", "User-Agent": "skifer-atlas",
                 "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        try:
            return json.loads(error.read() or b"{}")
        except ValueError:
            raise RepoError("device_flow_failed", f"GitHub a répondu {error.code}.") from None
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise RepoError("host_unreachable", f"GitHub injoignable : {error}") from None


@dataclass
class Flow:
    id: str
    workspace_id: str | None
    device_code: str = field(repr=False)
    interval: int
    expires_at: float
    next_poll: float = 0
    status: str = "pending"  # pending, connected, denied, expired
    credential: Credential | None = field(default=None, repr=False)


_flows: dict[str, Flow] = {}
_lock = threading.Lock()


def _purge(now: float) -> None:
    for key in [k for k, f in _flows.items()
                if now > f.expires_at + (KEEP_AFTER_CONNECT if f.status == "connected" else 0)]:
        del _flows[key]


def start(workspace_id: str | None = None) -> dict:
    """Demande un code à GitHub. Rend ce que l'interface affiche, jamais le `device_code`."""
    if workspace_id is not None and not is_workspace_id(workspace_id):
        raise RepoError("not_found", "Espace invalide.")
    client = client_id()
    if client is None:
        raise RepoError("github_not_configured", "Aucun client OAuth GitHub configuré pour "
                        "Atlas (ATLAS_GITHUB_CLIENT_ID).")
    answer = _post("/login/device/code", {"client_id": client, "scope": SCOPE})
    if "device_code" not in answer:
        raise RepoError("device_flow_failed", "GitHub a refusé la demande de code : "
                        f"{answer.get('error_description') or answer.get('error') or '?'}.")
    now = time.time()
    flow = Flow(id=secrets.token_urlsafe(16), workspace_id=workspace_id,
                device_code=answer["device_code"], interval=int(answer.get("interval", 5)),
                expires_at=now + int(answer.get("expires_in") or 900))
    with _lock:
        _purge(now)
        _flows[flow.id] = flow
    return {"flow": flow.id, "user_code": answer["user_code"],
            "verification_uri": answer["verification_uri"],
            "expires_in": int(flow.expires_at - now), "interval": flow.interval}


def _account(token: str) -> str | None:
    from .github import GitHubHost

    try:
        return GitHubHost("", "", token).current_account()
    except RepoError:
        return None


def _flow(flow_id: str) -> Flow:
    with _lock:
        _purge(time.time())
        flow = _flows.get(flow_id)
    if flow is None:
        raise RepoError("not_found", "Connexion GitHub inconnue ou expirée : recommencer.")
    return flow


def poll(flow_id: str) -> dict:
    """Où en est le flux. Au plus une requête à GitHub par intervalle."""
    flow = _flow(flow_id)
    now = time.time()
    if flow.status == "pending" and now > flow.expires_at:
        flow.status = "expired"
    if flow.status != "pending" or now < flow.next_poll:
        return _state(flow)
    flow.next_poll = now + flow.interval
    answer = _post("/login/oauth/access_token", {"client_id": client_id() or "",
                                                 "device_code": flow.device_code,
                                                 "grant_type": GRANT})
    error = answer.get("error")
    if error == "slow_down":
        # GitHub rend le nouvel intervalle ; à défaut, +5 s comme le dit sa documentation.
        flow.interval = int(answer["interval"]) if "interval" in answer else flow.interval + 5
        flow.next_poll = now + flow.interval
    elif error == "access_denied":
        flow.status = "denied"
    elif error == "expired_token":
        flow.status = "expired"
    elif error and error != "authorization_pending":
        flow.status = "denied"
        raise RepoError("device_flow_failed", "GitHub a refusé la connexion : "
                        f"{answer.get('error_description') or error}.")
    elif not error and answer.get("access_token"):
        token = answer["access_token"]
        expires_in = answer.get("expires_in")
        flow.credential = Credential(
            kind="github", access_token=token, refresh_token=answer.get("refresh_token"),
            expires_at=now + int(expires_in) if expires_in else None,
            client_id=client_id(), account=_account(token))
        flow.status = "connected"
        if flow.workspace_id is not None:
            Vault().put(flow.workspace_id, GITHUB_ENTRY, flow.credential)
            with _lock:
                _flows.pop(flow.id, None)
    return _state(flow)


def _state(flow: Flow) -> dict:
    found: dict = {"status": flow.status, "interval": flow.interval}
    if flow.credential is not None:
        found["account"] = flow.credential.account
    if flow.workspace_id is not None:
        found["workspace"] = flow.workspace_id
    return found


def pending(flow_id: str) -> Credential:
    """Le jeton d'un flux abouti sans espace (adhésion). Il reste dans le flux jusqu'à
    `release` : une adhésion qui échoue peut être retentée sans refaire le flux."""
    flow = _flow(flow_id)
    if flow.status != "connected" or flow.credential is None or flow.workspace_id is not None:
        raise RepoError("not_found", "Connexion GitHub inconnue, inachevée ou expirée.")
    return flow.credential


def release(flow_id: str) -> None:
    with _lock:
        _flows.pop(flow_id, None)


def stored(workspace_id: str) -> Credential | None:
    return Vault().get(workspace_id, GITHUB_ENTRY)


def store(workspace_id: str, credential: Credential) -> None:
    Vault().put(workspace_id, GITHUB_ENTRY, credential)


def forget(workspace_id: str) -> bool:
    return Vault().delete(workspace_id, GITHUB_ENTRY)
