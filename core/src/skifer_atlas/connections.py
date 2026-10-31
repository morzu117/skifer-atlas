"""Mes connexions dans un espace : points d'accès, coffre, OAuth, test, requête (plan 0008).

Le registre des points d'accès se lit dans le clone de l'espace ; les identifiants de
l'utilisateur, dans son coffre, sous `<espace>/<point d'accès>`. Aucune fonction de ce
module ne rend un jeton : seulement des états (`connected`, `expired`, `never`).
"""

from __future__ import annotations

import threading
import time

from pydantic import ValidationError

from .connectors import oauth
from .connectors.access_points import FILE, AccessPoint, AccessPoints, parse_access_points
from .connectors.base import MAX_ROWS, QUERY_TIMEOUT, AuthRejected, Connector, QueryResult
from .connectors.databricks import DatabricksConnector
from .model.errors import issues_from_validation_error
from .repo.git import RepoError
from .repo.layout import read_governance
from .vault import Credential, Vault
from .workspaces import repo_dir

SUPPORTED_PLATFORMS = ("databricks",)  # Snowflake : plan 0018


def registry(workspace_id: str) -> AccessPoints:
    path = repo_dir(workspace_id) / FILE
    found, issues = parse_access_points(
        path.read_text(encoding="utf-8") if path.exists() else "", None)
    if found is None:
        raise RepoError("invalid_access_points", f"{FILE} est invalide.",
                        [i.to_dict() for i in issues])
    return found


def _allowed(workspace_id: str) -> set[str]:
    governance = read_governance(repo_dir(workspace_id))
    return set(governance.allowed_platforms) if governance else set()


def _names(workspace_id: str) -> dict[str, str]:
    governance = read_governance(repo_dir(workspace_id))
    return {m.account: m.name for m in governance.members} if governance else {}


def access_point(workspace_id: str, access_point_id: str) -> AccessPoint:
    point = registry(workspace_id).get(access_point_id)
    if point is None:
        raise RepoError("not_found", f"Point d'accès « {access_point_id} » inconnu.")
    if point.platform not in _allowed(workspace_id):
        raise RepoError("platform_not_allowed", f"La plateforme « {point.platform} » n'est "
                        "plus autorisée dans cet espace.")
    return point


def _summary(point: AccessPoint, credential: Credential | None, allowed: set[str],
             names: dict[str, str] | None = None) -> dict:
    found = {"access_point": point.id, "platform": point.platform, "host": point.host,
             "schema": point.schema_, "entity": point.entity, "owner": point.owner,
             "owner_name": (names or {}).get(point.owner), "freshness": point.freshness,
             "allowed": point.platform in allowed,
             "supported": point.platform in SUPPORTED_PLATFORMS,
             "auth": None, "my_access": "never", "expires_in_days": None}
    if credential is not None:
        state = credential.describe()
        found.update(auth=state["kind"], my_access=state["my_access"],
                     expires_in_days=state["expires_in_days"])
    return found


def list_connections(workspace_id: str, vault: Vault | None = None) -> list[dict]:
    """Points d'accès de l'espace et mon accès à chacun, sans appel réseau."""
    points = registry(workspace_id).access_points
    vault = vault or Vault()
    mine = vault.list_my_connections(workspace_id, [p.id for p in points])
    allowed, names = _allowed(workspace_id), _names(workspace_id)
    return [_summary(p, mine.get(p.id), allowed, names) for p in points]


PLATFORM_LABELS = {"databricks": "Databricks", "snowflake": "Snowflake", "bigquery": "BigQuery",
                   "fabric": "Microsoft Fabric", "redshift": "Redshift", "duckdb": "DuckDB"}


def platforms(workspace_id: str) -> list[dict]:
    """Plateformes autorisées par le référent (0017), et celles qu'Atlas sait déjà
    connecter : le panneau « Nouveau point d'accès » ne propose rien d'autre."""
    allowed = _allowed(workspace_id)
    return [{"id": p, "label": PLATFORM_LABELS.get(p, p), "supported": p in SUPPORTED_PLATFORMS}
            for p in PLATFORM_LABELS if p in allowed]


def draft_point(workspace_id: str, raw: dict) -> AccessPoint:
    """Un point d'accès pas encore déclaré, pour s'y connecter et le tester avant de le
    proposer (10.6). Rien n'est écrit dans le dépôt."""
    try:
        point = AccessPoint.model_validate(raw)
    except ValidationError as error:
        raise RepoError("invalid_access_point", "Le point d'accès est refusé.",
                        [i.to_dict() for i in issues_from_validation_error(error, raw)]) from None
    if point.platform not in _allowed(workspace_id):
        raise RepoError("platform_not_allowed", f"La plateforme « {point.platform} » n'est pas "
                        "autorisée dans cet espace.")
    if registry(workspace_id).get(point.id) is not None:
        raise RepoError("access_point_exists", f"« {point.id} » est déjà déclaré : s'y "
                        "connecter depuis la liste.")
    return point


def _flow(workspace_id: str, access_point_id: str) -> dict | None:
    flow = oauth.FLOWS.last((workspace_id, access_point_id))
    return None if flow is None else {"status": flow.status, "error": flow.error}


def status(workspace_id: str, access_point_id: str, vault: Vault | None = None) -> dict:
    """État de mon accès ; un jeton OAuth près d'expirer est rafraîchi au passage."""
    return _status(workspace_id, access_point(workspace_id, access_point_id), vault)


def draft_status(workspace_id: str, raw: dict, vault: Vault | None = None) -> dict:
    return _status(workspace_id, draft_point(workspace_id, raw), vault)


def _status(workspace_id: str, point: AccessPoint, vault: Vault | None) -> dict:
    vault = vault or Vault()
    credential = vault.get(workspace_id, point.id)
    error = None
    if credential is not None and credential.needs_refresh() and not credential.rejected:
        try:
            credential = _refresh(workspace_id, point, credential, vault)
        except RepoError as failure:
            error = {"code": failure.code, "message": failure.message}
            credential = vault.get(workspace_id, point.id)
    found = _summary(point, credential, _allowed(workspace_id), _names(workspace_id))
    found.update(flow=_flow(workspace_id, point.id), error=error)
    return found


def authorize(workspace_id: str, access_point_id: str, vault: Vault | None = None,
              listen_seconds: float = oauth.LISTEN_SECONDS) -> dict:
    """Lance le flux OAuth ; l'UI ouvre l'URL rendue dans le navigateur système."""
    return _authorize(workspace_id, access_point(workspace_id, access_point_id), vault,
                      listen_seconds)


def authorize_draft(workspace_id: str, raw: dict, vault: Vault | None = None,
                    listen_seconds: float = oauth.LISTEN_SECONDS) -> dict:
    """OAuth sur un point d'accès pas encore déclaré : le jeton va au coffre sous son
    identifiant, et sert dès que la proposition est fusionnée."""
    return _authorize(workspace_id, draft_point(workspace_id, raw), vault, listen_seconds)


def _authorize(workspace_id: str, point: AccessPoint, vault: Vault | None,
               listen_seconds: float) -> dict:
    if point.platform != "databricks":
        raise RepoError("platform_not_supported", f"OAuth n'est pas encore pris en charge "
                        f"pour « {point.platform} ».")
    vault = vault or Vault()

    def store(credential: Credential) -> None:
        vault.put(workspace_id, point.id, credential)

    url = oauth.FLOWS.start((workspace_id, point.id), point, store, listen_seconds)
    return {"authorize_url": url}


def store_personal_token(workspace_id: str, access_point_id: str, token: str,
                         expires_at: float | None = None, vault: Vault | None = None) -> dict:
    """Repli : le token personnel va droit au coffre, et n'en ressort jamais."""
    point = access_point(workspace_id, access_point_id)
    token = token.strip()
    if not token or any(c.isspace() for c in token):
        raise RepoError("invalid_token", "Token personnel vide ou mal formé.")
    vault = vault or Vault()
    vault.put(workspace_id, point.id, Credential("pat", token, expires_at=expires_at))
    return _summary(point, vault.get(workspace_id, point.id), _allowed(workspace_id),
                    _names(workspace_id))


def _refresh(workspace_id: str, point: AccessPoint, credential: Credential,
             vault: Vault) -> Credential:
    try:
        renewed = oauth.refresh(oauth.discover(point), credential)
    except oauth.RefreshRefused:
        credential.rejected = True
        vault.put(workspace_id, point.id, credential)
        raise RepoError("access_expired", "Session expirée : se reconnecter.") from None
    vault.put(workspace_id, point.id, renewed)
    return renewed


def _usable(workspace_id: str, point: AccessPoint, vault: Vault) -> Credential:
    credential = vault.get(workspace_id, point.id)
    if credential is None:
        raise RepoError("not_connected", f"Pas encore connecté à « {point.id} ».")
    if credential.rejected or (credential.kind == "pat" and credential.expired()):
        raise RepoError("access_expired", "Accès expiré : se reconnecter.")
    if credential.needs_refresh():
        credential = _refresh(workspace_id, point, credential, vault)
    return credential


def ensure_usable(workspace_id: str, access_point_id: str, vault: Vault | None = None) -> None:
    """Lève `not_connected` ou `access_expired` si mon accès ne permet pas d'exécuter ;
    rafraîchit au passage un jeton OAuth près d'expirer."""
    point = access_point(workspace_id, access_point_id)
    _usable(workspace_id, point, vault or Vault())


def _connector(point: AccessPoint, credential: Credential) -> Connector:
    if point.platform == "databricks":
        return DatabricksConnector(point, credential.access_token)
    raise RepoError("platform_not_supported", f"Pas encore de connecteur pour "
                    f"« {point.platform} ».")


def _with_connector(workspace_id: str, access_point_id: str | AccessPoint, vault: Vault | None,
                    action):
    """Exécute `action(connector)` ; un 401 déclenche un rafraîchissement, puis un seul
    nouvel essai. Un refus persistant marque l'accès expiré."""
    point = (access_point_id if isinstance(access_point_id, AccessPoint)
             else access_point(workspace_id, access_point_id))
    vault = vault or Vault()
    credential = _usable(workspace_id, point, vault)
    try:
        return action(_connector(point, credential))
    except AuthRejected:
        if credential.kind == "oauth" and credential.refresh_token:
            credential = _refresh(workspace_id, point, credential, vault)
            try:
                return action(_connector(point, credential))
            except AuthRejected:
                pass
        credential.rejected = True
        vault.put(workspace_id, point.id, credential)
        raise RepoError("access_expired", "La plateforme refuse le jeton : se "
                        "reconnecter.") from None


def check_connection(workspace_id: str, access_point_id: str, vault: Vault | None = None) -> dict:
    return _check(workspace_id, access_point_id, vault)


def check_draft(workspace_id: str, raw: dict, vault: Vault | None = None) -> dict:
    return _check(workspace_id, draft_point(workspace_id, raw), vault)


def _check(workspace_id: str, point: str | AccessPoint, vault: Vault | None) -> dict:
    started = time.monotonic()
    try:
        _with_connector(workspace_id, point, vault, lambda c: c.test())
    except RepoError as error:
        if error.code in ("not_found", "platform_not_allowed"):
            raise
        return {"ok": False, "latency_ms": None,
                "error": {"code": error.code, "message": error.message}}
    return {"ok": True, "latency_ms": round((time.monotonic() - started) * 1000),
            "error": None}


def revoke(workspace_id: str, access_point_id: str, vault: Vault | None = None) -> dict:
    """Supprime l'entrée du coffre ; révoque aussi le jeton OAuth côté plateforme quand
    elle le permet. Les autres espaces ne sont pas touchés."""
    point = registry(workspace_id).get(access_point_id)
    if point is None:
        raise RepoError("not_found", f"Point d'accès « {access_point_id} » inconnu.")
    vault = vault or Vault()
    credential = vault.get(workspace_id, point.id)
    remote = False
    if credential is not None and credential.kind == "oauth":
        try:
            remote = oauth.revoke(oauth.discover(point), credential)
        except RepoError:
            remote = False  # hôte injoignable : la suppression locale suffit
    return {"revoked": vault.delete(workspace_id, point.id), "remote_revoked": remote}


def run_aggregate(workspace_id: str, access_point_id: str, sql: str, max_rows: int = MAX_ROWS,
                  timeout: float = QUERY_TIMEOUT, cancel: threading.Event | None = None,
                  vault: Vault | None = None) -> QueryResult:
    """Requête en push-down ; plus de `max_rows` lignes donne `result_too_large`."""
    return _with_connector(workspace_id, access_point_id, vault,
                           lambda c: c.run_aggregate(sql, max_rows, timeout, cancel))
