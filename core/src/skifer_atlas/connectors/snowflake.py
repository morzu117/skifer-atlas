"""Connecteur Snowflake : `snowflake-connector-python`, sans l'extra pandas (plan 0018).

Deux authentifications, déclarées par le point d'accès :

- **SSO** (`externalbrowser`) : le connecteur ouvre le navigateur du système sur le
  fournisseur d'identité de l'entreprise et attend son retour sur un port local. Le jeton
  de session et le jeton maître obtenus vont au coffre ; on s'y reconnecte ensuite sans
  navigateur, jusqu'à l'expiration du jeton maître. Si le connecteur ne les livre pas, la
  session ne vit qu'en mémoire (`LIVE`).
- **Paire de clés** : la clé privée est relue à son emplacement à chaque connexion, et
  déchiffrée en mémoire avec la passphrase du coffre ; elle n'est jamais copiée.

Le cache de jetons du connecteur est coupé (`client_store_temporary_credential`) : aucun
jeton Snowflake n'est rangé ailleurs que dans le coffre d'Atlas. Les requêtes partent en
asynchrone et sont suivies jusqu'à leur fin, comme sur Databricks : le délai et
l'annulation passent par `abort_query`.
"""

from __future__ import annotations

import contextlib
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from ..repo.git import RepoError
from .access_points import AccessPoint
from .base import MAX_ROWS, QUERY_TIMEOUT, AuthRejected, QueryResult

POLL_SECONDS = 0.5
LOGIN_SECONDS = 60
SSO_SECONDS = 300  # le temps de passer par le fournisseur d'identité, comme l'OAuth
APPLICATION = "SkiferAtlas"
# Snowflake n'a pas de fonction d'erreur : la garde de compilation fait échouer un cast de
# texte en nombre (compile/cardinality.py). On rend le message d'Atlas tel quel.
_GUARD = re.compile(r"Numeric value '(atlas: .*)' is not recognized", re.DOTALL)
_LOGIN_TIMEOUT = 14  # code du connecteur : délai de connexion dépassé


def _snowflake():
    """Import tardif : le connecteur charge un cœur natif d'une vingtaine de Mo."""
    import snowflake.connector

    return snowflake.connector


def connection_params(point: AccessPoint, user: str, *, private_key: bytes | None = None,
                      session: tuple[str, str] | None = None,
                      keep_alive: bool = True) -> dict[str, Any]:
    """Paramètres de `snowflake.connector.connect` : paire de clés si `private_key`,
    jetons de session si `session`, SSO sinon."""
    url = urlparse(point.host)
    database, schema = point.catalog_and_schema()
    params: dict[str, Any] = {
        "account": point.snowflake_account(),
        "user": user,
        "host": url.hostname,
        "warehouse": point.warehouse_name,
        "application": APPLICATION,
        "login_timeout": LOGIN_SECONDS,
        # Aucun cache de jeton ni de liste de révocation sur le poste (critère 6).
        "client_store_temporary_credential": False,
        "crl_enable_disk_caching": False,
        "enable_server_session_keep_alive_auto_detection": False,
    }
    if url.port:
        params["port"] = url.port
    if url.scheme == "http":  # faux Snowflake local des tests et démonstrations
        params["protocol"] = "http"
    for name, value in (("role", point.role), ("database", database), ("schema", schema)):
        if value:
            params[name] = value
    if private_key is not None:
        params.update(authenticator="SNOWFLAKE_JWT", private_key=private_key)
    elif session is not None:
        # Fermer la connexion ne ferme pas la session : elle sert à la requête suivante.
        params.update(session_token=session[0], master_token=session[1],
                      server_session_keep_alive=keep_alive)
    else:
        params.update(authenticator="EXTERNALBROWSER", login_timeout=SSO_SECONDS,
                      server_session_keep_alive=True)
    return params


def load_private_key(path: str, passphrase: str | None) -> bytes:
    """La clé privée RSA du fichier, déchiffrée en mémoire (DER, PKCS#8)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    try:
        data = Path(path).expanduser().read_bytes()
    except OSError:
        raise RepoError("key_file_unreadable", f"Fichier de clé introuvable ou illisible : "
                        f"{path}.") from None
    password = passphrase.encode("utf-8") if passphrase else None
    loaders = (serialization.load_pem_private_key, serialization.load_der_private_key)
    key = None
    for load in loaders if data.lstrip().startswith(b"-----") else reversed(loaders):
        try:
            key = load(data, password=password)
            break
        except TypeError:
            if password is None:
                raise RepoError("passphrase_required", "La clé privée est chiffrée : "
                                "saisir sa passphrase.") from None
            raise RepoError("passphrase_unexpected", "Cette clé privée n'est pas chiffrée : "
                            "laisser la passphrase vide.") from None
        except ValueError:
            if password is not None and b"ENCRYPTED" in data:
                raise RepoError("wrong_passphrase", "Passphrase incorrecte.") from None
    if not isinstance(key, rsa.RSAPrivateKey):
        raise RepoError("invalid_key_file", "Ce fichier n'est pas une clé privée RSA "
                        "(PEM ou DER) : Snowflake n'accepte que des clés RSA.")
    return key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())


def _message(error: Exception) -> str:
    return str(getattr(error, "msg", None) or error).strip()


def translate(error: Exception) -> Exception:
    """Une erreur du connecteur, en `AuthRejected` (identifiants refusés, session
    expirée) ou en `RepoError`."""
    sf = _snowflake()
    errno = getattr(error, "errno", None) or 0
    message = _message(error)
    if 390000 <= errno < 391000:  # codes d'authentification de Snowflake
        return AuthRejected()
    guard = _GUARD.search(message)
    if guard:
        return RepoError("query_failed", guard.group(1))
    if errno == _LOGIN_TIMEOUT or isinstance(error, sf.errors.OperationalError):
        return RepoError("host_unreachable", f"Snowflake injoignable : {message[:300]}")
    if isinstance(error, sf.errors.ProgrammingError) and 2000 <= errno < 3000:
        return RepoError("platform_not_found", f"Introuvable sur Snowflake : {message[:300]}")
    return RepoError("query_failed", f"Snowflake a refusé la requête : {message[:500]}")


def session_tokens(connection: Any) -> tuple[str, str, float | None] | None:
    """Jeton de session, jeton maître et expiration de ce dernier (epoch), si le
    connecteur les livre."""
    try:
        info = connection._get_connection_info(include_master_token=True)
    except Exception:  # noqa: BLE001 — API interne du connecteur : au mieux
        return None
    if not (info.session_token and info.master_token):
        return None
    expires = info.master_token_expires_at_ms / 1000 if info.master_token_expires_at_ms else None
    return info.session_token, info.master_token, expires


def close_quietly(connection: Any) -> None:
    """Ferme sans lever : la fermeture ne doit pas masquer le résultat."""
    with contextlib.suppress(Exception):
        connection.close()


class SnowflakeConnector:
    """Une connexion par appel ; avec des jetons de session, la session survit à la
    fermeture, et `renewed` porte les jetons si le connecteur les a renouvelés."""

    def __init__(self, point: AccessPoint, user: str, *, private_key: bytes | None = None,
                 session: tuple[str, str] | None = None, live: Any = None):
        self.point = point
        self.user = user
        self._private_key = private_key
        self._session = session
        self._live = live
        self.renewed: tuple[str, str, float | None] | None = None

    def _open(self) -> Any:
        if self._live is not None:
            return self._live
        sf = _snowflake()
        try:
            return sf.connect(**connection_params(self.point, self.user,
                                                  private_key=self._private_key,
                                                  session=self._session))
        except sf.errors.Error as error:
            raise translate(error) from None

    def _release(self, connection: Any) -> None:
        if connection is self._live:
            return
        if self._session is not None:
            tokens = session_tokens(connection)
            if tokens is not None and tokens[:2] != self._session:
                self.renewed = tokens
        close_quietly(connection)

    def test(self) -> None:
        self.run_aggregate("SELECT 1 AS ok", max_rows=1, timeout=60)

    def run_aggregate(self, sql: str, max_rows: int = MAX_ROWS,
                      timeout: float = QUERY_TIMEOUT,
                      cancel: threading.Event | None = None) -> QueryResult:
        connection = self._open()
        try:
            return self._run(connection, sql, max_rows, timeout, cancel)
        finally:
            self._release(connection)

    def _run(self, connection: Any, sql: str, max_rows: int, timeout: float,
             cancel: threading.Event | None) -> QueryResult:
        sf = _snowflake()
        deadline = time.monotonic() + timeout
        cursor = connection.cursor()
        try:
            query_id = cursor.execute_async(sql)["queryId"]
            while connection.is_still_running(
                    connection.get_query_status_throw_if_error(query_id)):
                if cancel is not None and cancel.is_set():
                    self._abort(cursor, query_id)
                    raise RepoError("query_canceled", "Requête annulée.")
                if time.monotonic() >= deadline:
                    self._abort(cursor, query_id)
                    raise RepoError("query_timeout", f"Requête interrompue après {timeout:g} s.")
                time.sleep(POLL_SECONDS)
            cursor.get_results_from_sfqid(query_id)
            rows = cursor.fetchmany(max_rows + 1)
            if len(rows) > max_rows:
                raise RepoError("result_too_large", f"Le résultat dépasse {max_rows} lignes : "
                                "seul un résultat agrégé est rapatrié.")
            description = cursor.description or []
            from snowflake.connector.constants import FIELD_ID_TO_NAME

            return QueryResult([d.name for d in description],
                               [FIELD_ID_TO_NAME.get(d.type_code, "text").lower()
                                for d in description],
                               [tuple(row) for row in rows])
        except sf.errors.Error as error:
            raise translate(error) from None
        finally:
            close_quietly(cursor)

    @staticmethod
    def _abort(cursor: Any, query_id: str) -> None:
        with contextlib.suppress(Exception):  # au mieux : l'entrepôt finira par abandonner
            cursor.abort_query(query_id)


def logout(point: AccessPoint, user: str, session: tuple[str, str]) -> bool:
    """Ferme la session côté Snowflake ; faux si elle n'était déjà plus valide."""
    sf = _snowflake()
    params = connection_params(point, user, session=session, keep_alive=False)
    params["login_timeout"] = 10  # révoquer ne doit pas faire attendre l'écran
    try:
        connection = sf.connect(**params)
    except sf.errors.Error:
        return False
    try:
        connection.close()
    except sf.errors.Error:
        return False
    return True


# --- SSO ------------------------------------------------------------------------------

LIVE: dict[tuple[str, str], Any] = {}  # sessions SSO gardées en mémoire, faute de jetons


@dataclass
class SsoFlow:
    key: tuple[str, str]  # (espace, point d'accès)
    status: str = "pending"  # pending | connected | failed | expired
    error: str | None = None
    done: threading.Event = field(default_factory=threading.Event, repr=False)

    def finish(self, status: str, error: str | None = None) -> None:
        if self.status == "pending":
            self.status, self.error = status, error
        self.done.set()


class SsoFlows:
    """Connexions SSO en cours : le connecteur ouvre le navigateur et attend son retour
    dans un fil à part ; l'écran relit l'état comme pour l'OAuth."""

    def __init__(self) -> None:
        self._last: dict[tuple[str, str], SsoFlow] = {}
        self._lock = threading.Lock()

    def start(self, key: tuple[str, str], point: AccessPoint, user: str,
              on_success: Callable[[Any], None]) -> SsoFlow:
        flow = SsoFlow(key)
        with self._lock:
            previous = self._last.get(key)
            if previous is not None:
                previous.finish("failed", "Remplacé par une nouvelle connexion.")
            self._last[key] = flow

        def run() -> None:
            sf = _snowflake()
            try:
                connection = sf.connect(**connection_params(point, user))
            except sf.errors.Error as error:
                if getattr(error, "errno", None) == _LOGIN_TIMEOUT:
                    flow.finish("expired", "Délai de connexion dépassé (5 minutes).")
                else:
                    flow.finish("failed", _message(error)[:300])
                return
            if flow.status != "pending":  # remplacé entre-temps
                close_quietly(connection)
                return
            try:
                on_success(connection)
            except RepoError as error:
                close_quietly(connection)
                flow.finish("failed", error.message)
                return
            flow.finish("connected")

        threading.Thread(target=run, daemon=True).start()
        return flow

    def last(self, key: tuple[str, str]) -> SsoFlow | None:
        with self._lock:
            return self._last.get(key)


SSO_FLOWS = SsoFlows()
