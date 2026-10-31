"""Mes connexions dans un espace : points d'accès, coffre, OAuth, test, requête (plan 0008).

Le registre des points d'accès se lit dans le clone de l'espace ; les identifiants de
l'utilisateur, dans son coffre, sous `<espace>/<point d'accès>`. Aucune fonction de ce
module ne rend un jeton : seulement des états (`connected`, `expired`, `never`).

Snowflake (plan 0018) : SSO par le navigateur ou paire de clés, selon le point d'accès.
L'identifiant Snowflake de l'utilisateur et le chemin de sa clé privée vont dans son
registre local (`connectors/logins.py`) ; la passphrase et les jetons de session, au coffre.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

from pydantic import ValidationError

from .connectors import logins, oauth
from .connectors import snowflake as snowflake_connector
from .connectors.access_points import FILE, AccessPoint, AccessPoints, parse_access_points
from .connectors.base import MAX_ROWS, QUERY_TIMEOUT, AuthRejected, Connector, QueryResult
from .connectors.databricks import DatabricksConnector
from .connectors.logins import Login
from .connectors.snowflake import LIVE, SSO_FLOWS, SnowflakeConnector
from .model.errors import issues_from_validation_error
from .repo.git import RepoError
from .repo.layout import read_governance
from .vault import Credential, Vault
from .workspaces import repo_dir

SUPPORTED_PLATFORMS = ("databricks", "snowflake")


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


def _memory_only(workspace_id: str, point: AccessPoint, credential: Credential) -> bool:
    """Session SSO sans jeton exportable : elle ne vit que dans ce processus."""
    return credential.kind == "sso" and not credential.access_token


def _summary(workspace_id: str, point: AccessPoint, credential: Credential | None,
             allowed: set[str], names: dict[str, str] | None = None) -> dict:
    login = logins.get(workspace_id, point.id) if point.platform == "snowflake" else None
    found = {"access_point": point.id, "platform": point.platform, "host": point.host,
             "schema": point.schema_, "entity": point.entity, "owner": point.owner,
             "owner_name": (names or {}).get(point.owner), "freshness": point.freshness,
             "allowed": point.platform in allowed,
             "supported": point.platform in SUPPORTED_PLATFORMS,
             "auth_mode": point.auth_mode, "login": login.user if login else None,
             "private_key_file": login.private_key_file if login else None,
             "auth": None, "my_access": "never", "expires_in_days": None}
    if credential is not None:
        state = credential.describe()
        found.update(auth=state["kind"], my_access=state["my_access"],
                     expires_in_days=state["expires_in_days"])
        if (_memory_only(workspace_id, point, credential)
                and (workspace_id, point.id) not in LIVE):
            found["my_access"] = "expired"  # Atlas a redémarré : la session est perdue
    return found


def list_connections(workspace_id: str, vault: Vault | None = None) -> list[dict]:
    """Points d'accès de l'espace et mon accès à chacun, sans appel réseau."""
    points = registry(workspace_id).access_points
    vault = vault or Vault()
    mine = vault.list_my_connections(workspace_id, [p.id for p in points])
    allowed, names = _allowed(workspace_id), _names(workspace_id)
    return [_summary(workspace_id, p, mine.get(p.id), allowed, names) for p in points]


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


def _flow(workspace_id: str, point: AccessPoint) -> dict | None:
    flows = SSO_FLOWS if point.platform == "snowflake" else oauth.FLOWS
    flow = flows.last((workspace_id, point.id))
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
    found = _summary(workspace_id, point, credential, _allowed(workspace_id),
                     _names(workspace_id))
    found.update(flow=_flow(workspace_id, point), error=error)
    return found


def authorize(workspace_id: str, access_point_id: str, vault: Vault | None = None,
              listen_seconds: float = oauth.LISTEN_SECONDS, user: str | None = None) -> dict:
    """Lance le flux OAuth ; l'UI ouvre l'URL rendue dans le navigateur système. Pour un
    SSO Snowflake, le connecteur ouvre lui-même le navigateur : pas d'URL rendue."""
    return _authorize(workspace_id, access_point(workspace_id, access_point_id), vault,
                      listen_seconds, user)


def authorize_draft(workspace_id: str, raw: dict, vault: Vault | None = None,
                    listen_seconds: float = oauth.LISTEN_SECONDS,
                    user: str | None = None) -> dict:
    """OAuth sur un point d'accès pas encore déclaré : le jeton va au coffre sous son
    identifiant, et sert dès que la proposition est fusionnée."""
    return _authorize(workspace_id, draft_point(workspace_id, raw), vault, listen_seconds,
                      user)


def _user(workspace_id: str, point: AccessPoint, user: str | None) -> str:
    """Identifiant Snowflake : celui saisi, sinon celui du registre local."""
    if user is None:
        known = logins.get(workspace_id, point.id)
        if known is None:  # depuis Comparer : la première connexion se fait dans Mes connexions
            raise RepoError("invalid_login", "Aucun identifiant Snowflake enregistré : se "
                            "connecter depuis Mes connexions.")
        user = known.user
    user = user.strip()
    if not user or len(user) > 255 or any(c.isspace() for c in user):
        raise RepoError("invalid_login", "Identifiant Snowflake vide ou mal formé.")
    return user


def _wrong_mode(point: AccessPoint) -> RepoError:
    mode = "le SSO" if point.auth_mode == "sso" else "une paire de clés"
    return RepoError("wrong_auth_mode", f"« {point.id} » s'authentifie par {mode}.")


def _authorize_sso(workspace_id: str, point: AccessPoint, vault: Vault | None,
                   user: str | None) -> dict:
    if point.auth_mode != "sso":
        raise _wrong_mode(point)
    user = _user(workspace_id, point, user)
    vault = vault or Vault()
    key = (workspace_id, point.id)

    def store(connection) -> None:
        tokens = snowflake_connector.session_tokens(connection)
        previous = LIVE.pop(key, None)
        if previous is not None:
            snowflake_connector.close_quietly(previous)
        if tokens is not None:
            vault.put(workspace_id, point.id, Credential("sso", tokens[0], tokens[1],
                                                         expires_at=tokens[2]))
            snowflake_connector.close_quietly(connection)  # la session survit (keep-alive)
        else:
            LIVE[key] = connection
            vault.put(workspace_id, point.id, Credential("sso", ""))
        logins.put(workspace_id, point.id, Login(user))

    SSO_FLOWS.start(key, point, user, store)
    return {"authorize_url": None}


def _authorize(workspace_id: str, point: AccessPoint, vault: Vault | None,
               listen_seconds: float, user: str | None = None) -> dict:
    if point.platform == "snowflake":
        return _authorize_sso(workspace_id, point, vault, user)
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
    return _summary(workspace_id, point, vault.get(workspace_id, point.id),
                    _allowed(workspace_id), _names(workspace_id))


def store_key_pair(workspace_id: str, access_point_id: str, user: str, private_key_file: str,
                   passphrase: str | None = None, vault: Vault | None = None) -> dict:
    """Paire de clés Snowflake : la clé est lue pour vérifier la passphrase, puis laissée
    à sa place ; la passphrase va au coffre, le chemin au registre local."""
    return _store_key_pair(workspace_id, access_point(workspace_id, access_point_id), user,
                           private_key_file, passphrase, vault)


def store_key_pair_draft(workspace_id: str, raw: dict, user: str, private_key_file: str,
                         passphrase: str | None = None, vault: Vault | None = None) -> dict:
    return _store_key_pair(workspace_id, draft_point(workspace_id, raw), user,
                           private_key_file, passphrase, vault)


def _store_key_pair(workspace_id: str, point: AccessPoint, user: str, private_key_file: str,
                    passphrase: str | None, vault: Vault | None) -> dict:
    if point.platform != "snowflake" or point.auth_mode != "keypair":
        raise _wrong_mode(point) if point.platform == "snowflake" else RepoError(
            "platform_not_supported", f"Pas de paire de clés pour « {point.platform} ».")
    user = _user(workspace_id, point, user)
    path = Path(private_key_file.strip()).expanduser()
    if not path.is_absolute():
        raise RepoError("key_file_unreadable", "Chemin complet du fichier de clé attendu.")
    snowflake_connector.load_private_key(str(path), passphrase or None)
    vault = vault or Vault()
    vault.put(workspace_id, point.id, Credential("keypair", passphrase or ""))
    logins.put(workspace_id, point.id, Login(user, str(path)))
    return _summary(workspace_id, point, vault.get(workspace_id, point.id),
                    _allowed(workspace_id), _names(workspace_id))


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
    if credential.rejected or (credential.kind in ("pat", "sso") and credential.expired()):
        raise RepoError("access_expired", "Accès expiré : se reconnecter.")
    if (_memory_only(workspace_id, point, credential)
            and (workspace_id, point.id) not in LIVE):
        raise RepoError("access_expired", "Session SSO terminée : se reconnecter.")
    if point.platform == "snowflake" and logins.get(workspace_id, point.id) is None:
        raise RepoError("not_connected", f"Pas encore connecté à « {point.id} ».")
    if credential.needs_refresh():
        credential = _refresh(workspace_id, point, credential, vault)
    return credential


def ensure_usable(workspace_id: str, access_point_id: str, vault: Vault | None = None) -> None:
    """Lève `not_connected` ou `access_expired` si mon accès ne permet pas d'exécuter ;
    rafraîchit au passage un jeton OAuth près d'expirer."""
    point = access_point(workspace_id, access_point_id)
    _usable(workspace_id, point, vault or Vault())


def _connector(workspace_id: str, point: AccessPoint, credential: Credential) -> Connector:
    if point.platform == "databricks":
        return DatabricksConnector(point, credential.access_token)
    if point.platform == "snowflake":
        login = logins.get(workspace_id, point.id)
        if login is None:
            raise RepoError("not_connected", f"Pas encore connecté à « {point.id} ».")
        if credential.kind == "keypair":
            key = snowflake_connector.load_private_key(login.private_key_file or "",
                                                       credential.access_token or None)
            return SnowflakeConnector(point, login.user, private_key=key)
        if credential.access_token:
            return SnowflakeConnector(point, login.user, session=(
                credential.access_token, credential.refresh_token or ""))
        return SnowflakeConnector(point, login.user, live=LIVE.get((workspace_id, point.id)))
    raise RepoError("platform_not_supported", f"Pas encore de connecteur pour "
                    f"« {point.platform} ».")


def _attempt(workspace_id: str, point: AccessPoint, credential: Credential, vault: Vault,
             action):
    """Un essai ; des jetons de session renouvelés par le connecteur vont au coffre."""
    connector = _connector(workspace_id, point, credential)
    try:
        return action(connector)
    finally:
        renewed = getattr(connector, "renewed", None)
        if renewed is not None:
            vault.put(workspace_id, point.id, Credential("sso", renewed[0], renewed[1],
                                                         expires_at=renewed[2]))


def _with_connector(workspace_id: str, access_point_id: str | AccessPoint, vault: Vault | None,
                    action):
    """Exécute `action(connector)` ; un 401 déclenche un rafraîchissement, puis un seul
    nouvel essai. Un refus persistant marque l'accès expiré."""
    point = (access_point_id if isinstance(access_point_id, AccessPoint)
             else access_point(workspace_id, access_point_id))
    vault = vault or Vault()
    credential = _usable(workspace_id, point, vault)
    try:
        return _attempt(workspace_id, point, credential, vault, action)
    except AuthRejected:
        if credential.kind == "oauth" and credential.refresh_token:
            credential = _refresh(workspace_id, point, credential, vault)
            try:
                return _attempt(workspace_id, point, credential, vault, action)
            except AuthRejected:
                pass
        credential = vault.get(workspace_id, point.id) or credential
        credential.rejected = True
        vault.put(workspace_id, point.id, credential)
        live = LIVE.pop((workspace_id, point.id), None)
        if live is not None:
            snowflake_connector.close_quietly(live)
        raise RepoError("access_expired", "La plateforme refuse vos identifiants : se "
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
    if point.platform == "snowflake":
        login = logins.get(workspace_id, point.id)
        if credential is not None and credential.kind == "sso" and credential.access_token \
                and login is not None and not credential.rejected:
            remote = snowflake_connector.logout(point, login.user, (
                credential.access_token, credential.refresh_token or ""))
        live = LIVE.pop((workspace_id, point.id), None)
        if live is not None:
            snowflake_connector.close_quietly(live)
        logins.delete(workspace_id, point.id)
    return {"revoked": vault.delete(workspace_id, point.id), "remote_revoked": remote}


def run_aggregate(workspace_id: str, access_point_id: str, sql: str, max_rows: int = MAX_ROWS,
                  timeout: float = QUERY_TIMEOUT, cancel: threading.Event | None = None,
                  vault: Vault | None = None) -> QueryResult:
    """Requête en push-down ; plus de `max_rows` lignes donne `result_too_large`."""
    return _with_connector(workspace_id, access_point_id, vault,
                           lambda c: c.run_aggregate(sql, max_rows, timeout, cancel))
