"""`access_points.yaml` : registre partagé des points d'accès de l'espace (plan 0008).

Il vit dans le dépôt, sans aucun secret : où se connecter, à quel schéma, pour quelle
entité, qui en est propriétaire et à quelle fraîcheur. Les identifiants de chaque
utilisateur sont dans son coffre (`vault/`).

```yaml
schema_version: 1
access_points:
  - id: dbx-fr
    platform: databricks
    host: https://adb-123.4.azuredatabricks.net
    warehouse_id: 1234567890abcdef        # ou http_path: /sql/1.0/warehouses/…
    schema: gold.finance
    entity: nordis-fr
    owner: claire.m
    freshness: quotidienne, 6 h
    oauth_client_id: mon-app              # facultatif : client OAuth propre au client
    oauth_redirect_port: 8020             # facultatif : port déclaré pour ce client
  - id: snow-de
    platform: snowflake
    host: https://nordis-de.snowflakecomputing.com
    warehouse: WH_FINANCE                 # facultatif : entrepôt par défaut de l'utilisateur sinon
    schema: FIN_GOLD.PUBLIC               # base.schéma
    role: ANALYSTE                        # facultatif : rôle par défaut de l'utilisateur sinon
    auth: sso                             # sso (externalbrowser) ou keypair (plan 0018)
    account: nordis-de                    # facultatif : déduit de l'hôte *.snowflakecomputing.com
    entity: nordis-de
    owner: anna.k
```

L'identifiant Snowflake de chacun et le chemin de sa clé privée ne sont pas ici : ils
vivent dans le registre local de l'utilisateur (`connectors/logins.py`).
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal
from urllib.parse import urlparse

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ..governance.model import Governance
from ..model.errors import Issue, issues_from_validation_error
from ..model.nodes import PLATFORMS

FILE = "access_points.yaml"
DEFAULT_REDIRECT_PORT = 8020  # adresse de retour enregistrée pour le client `databricks-cli`
_WAREHOUSE_PATH = re.compile(r"^/sql/1\.0/warehouses/([0-9a-zA-Z]+)$")
_LOOPBACK = ("127.0.0.1", "localhost")
_SNOWFLAKE_DOMAIN = ".snowflakecomputing.com"
_DATABRICKS_ONLY = ("http_path", "warehouse_id", "oauth_client_id", "oauth_redirect_port")
_SNOWFLAKE_ONLY = ("warehouse_name", "role", "auth", "account")
_SNOWFLAKE_NAME = r"^[A-Za-z0-9_$.\-]+$"


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AccessPoint(_Model):
    id: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9-]{1,63}$")]
    platform: Literal[PLATFORMS]
    host: str = Field(min_length=1)
    http_path: str | None = None
    warehouse_id: Annotated[str, Field(pattern=r"^[0-9a-zA-Z]+$")] | None = None
    schema_: str | None = Field(default=None, alias="schema")
    entity: str | None = None
    owner: str = Field(min_length=1)
    freshness: str | None = None
    oauth_client_id: str | None = None
    oauth_redirect_port: Annotated[int, Field(ge=1024, le=65535)] | None = None
    # Entrepôt virtuel Snowflake ; `warehouse()` désigne le SQL warehouse Databricks.
    warehouse_name: Annotated[str, Field(pattern=_SNOWFLAKE_NAME)] | None = Field(
        default=None, alias="warehouse")
    role: Annotated[str, Field(pattern=_SNOWFLAKE_NAME)] | None = None
    auth: Literal["sso", "keypair"] | None = None
    account: Annotated[str, Field(pattern=_SNOWFLAKE_NAME)] | None = None

    @model_validator(mode="after")
    def _platform_fields(self) -> AccessPoint:
        url = urlparse(self.host)
        if url.path not in ("", "/") or url.query or url.username or not url.hostname:
            raise ValueError("« host » est une adresse sans chemin, ex. https://adb-1.2.net.")
        # http seulement en boucle locale : faux serveurs des tests et démonstrations.
        if url.scheme != "https" and not (url.scheme == "http" and url.hostname in _LOOPBACK):
            raise ValueError("« host » doit être en https.")
        if self.platform == "databricks":
            if self.http_path is not None and not _WAREHOUSE_PATH.match(self.http_path):
                raise ValueError("« http_path » d'un SQL warehouse attendu : "
                                 "/sql/1.0/warehouses/<id>.")
            if self.warehouse() is None:
                raise ValueError("Un point d'accès Databricks désigne son SQL warehouse "
                                 "(« warehouse_id » ou « http_path »).")
        foreign = {"databricks": _SNOWFLAKE_ONLY, "snowflake": _DATABRICKS_ONLY}.get(
            self.platform, ())
        for name in foreign:
            if getattr(self, name) is not None:
                key = "warehouse" if name == "warehouse_name" else name
                raise ValueError(f"« {key} » ne s'applique pas à un point d'accès "
                                 f"{self.platform}.")
        if self.platform == "snowflake" and self.snowflake_account() is None:
            raise ValueError("« account » est requis quand l'hôte n'est pas "
                             f"<compte>{_SNOWFLAKE_DOMAIN}.")
        return self

    @property
    def base_url(self) -> str:
        return self.host.rstrip("/")

    @property
    def redirect_port(self) -> int:
        return self.oauth_redirect_port or DEFAULT_REDIRECT_PORT

    def warehouse(self) -> str | None:
        if self.warehouse_id:
            return self.warehouse_id
        found = _WAREHOUSE_PATH.match(self.http_path or "")
        return found.group(1) if found else None

    def snowflake_account(self) -> str | None:
        """Identifiant du compte Snowflake : déclaré, ou l'hôte sans le domaine."""
        if self.account:
            return self.account
        hostname = urlparse(self.host).hostname or ""
        if hostname.endswith(_SNOWFLAKE_DOMAIN):
            return hostname.removesuffix(_SNOWFLAKE_DOMAIN).removesuffix(".privatelink")
        return None

    @property
    def auth_mode(self) -> str:
        """Mode d'authentification déclaré : OAuth pour Databricks, SSO par défaut pour
        Snowflake."""
        if self.platform == "snowflake":
            return self.auth or "sso"
        return "oauth"

    def catalog_and_schema(self) -> tuple[str | None, str | None]:
        if not self.schema_:
            return None, None
        catalog, _, schema = self.schema_.rpartition(".")
        return (catalog or None), schema

    def public(self) -> dict:
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


class AccessPoints(_Model):
    schema_version: Literal[1] = 1
    access_points: list[AccessPoint] = Field(default_factory=list)

    def get(self, access_point_id: str) -> AccessPoint | None:
        return next((a for a in self.access_points if a.id == access_point_id), None)


def check_access_points(registry: AccessPoints, governance: Governance | None) -> list[Issue]:
    """Doublons, et plateformes hors `allowed_platforms` quand la gouvernance est donnée
    (à la déclaration ; à la lecture, un point d'accès devenu interdit reste lisible)."""
    issues = []
    seen: set[str] = set()
    allowed = set(governance.allowed_platforms) if governance else set()
    for index, point in enumerate(registry.access_points):
        if point.id in seen:
            issues.append(Issue(f"/access_points/{index}/id", None, "duplicate_access_point",
                                f"Point d'accès « {point.id} » répété."))
        seen.add(point.id)
        if governance is not None and point.platform not in allowed:
            issues.append(Issue(
                f"/access_points/{index}/platform", None, "platform_not_allowed",
                f"La plateforme « {point.platform} » n'est pas autorisée dans cet espace "
                f"(allowed_platforms : {', '.join(sorted(allowed)) or 'aucune'}).",
            ))
    return issues


def validate_access_points(raw: Any, governance: Governance | None
                           ) -> tuple[AccessPoints | None, list[Issue]]:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        return None, [Issue("", None, "invalid_value", f"{FILE} doit être un mapping.")]
    try:
        registry = AccessPoints.model_validate(raw)
    except ValidationError as error:
        return None, issues_from_validation_error(error, raw)
    issues = check_access_points(registry, governance)
    return (None if any(i.severity == "error" for i in issues) else registry), issues


def parse_access_points(text: str, governance: Governance | None
                        ) -> tuple[AccessPoints | None, list[Issue]]:
    try:
        raw = yaml.safe_load(text) if text.strip() else {}
    except yaml.YAMLError:
        return None, [Issue("", None, "invalid_yaml", f"{FILE} n'est pas un YAML lisible.")]
    return validate_access_points(raw, governance)


def dump_access_points(registry: AccessPoints) -> str:
    data = registry.model_dump(mode="json", by_alias=True, exclude_none=True)
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
