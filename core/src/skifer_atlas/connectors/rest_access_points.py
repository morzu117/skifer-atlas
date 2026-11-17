"""Registre REST séparé du registre historique (plan 0036, ADR 0050)."""

from __future__ import annotations

import re
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ..governance.model import Governance
from ..model.errors import Issue, issues_from_validation_error
from .access_points import check_access_points

FILE = "rest_access_points.yaml"
PATH_PATTERN = r"^/[A-Za-z0-9._~/-]*$"
_DNS = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
                  r"[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_LOCAL = re.compile(r"^(127\.0\.0\.1|localhost)(?::([0-9]+))?$")


class RestAccessPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,63}$")
    platform: Literal["rest"]
    host: str
    http_path: str = Field(default="", pattern=r"^$|" + PATH_PATTERN)
    owner: str = Field(min_length=1)
    entity: str | None = None
    freshness: str | None = None
    key_in: Literal["header", "query"]
    key_name: str
    key_prefix: str | None = None
    calls_per_minute: int | None = Field(default=None, strict=True, ge=1, le=10000)
    bytes_per_day: int | None = Field(default=None, strict=True, ge=1, le=10**13)

    @model_validator(mode="after")
    def _fields(self) -> RestAccessPoint:
        local = _LOCAL.fullmatch(self.host)
        if not _DNS.fullmatch(self.host) and local is None:
            raise ValueError("Hôte DNS en minuscules attendu, sans schéma ni chemin.")
        if local and local[2] and not 1024 <= int(local[2]) <= 65535:
            raise ValueError("Port de boucle locale hors limites.")
        if ".." in self.http_path or "//" in self.http_path:
            raise ValueError("Chemin de base invalide.")
        pattern = (r"[A-Za-z][A-Za-z0-9-]{0,63}" if self.key_in == "header"
                   else r"[A-Za-z_][A-Za-z0-9_]{0,63}")
        if not re.fullmatch(pattern, self.key_name):
            raise ValueError("Nom de clé invalide.")
        if self.key_prefix is not None and (self.key_in != "header" or
                any(ord(c) < 32 or ord(c) >= 127 for c in self.key_prefix)):
            raise ValueError("Préfixe réservé aux en-têtes, sans caractère de contrôle.")
        return self

    @property
    def base_url(self) -> str:
        return self.host

    @property
    def auth_mode(self) -> str:
        return "apikey"

    def call_url(self, path: str) -> str:
        if not re.fullmatch(PATH_PATTERN, path) or ".." in path or "//" in path:
            raise ValueError("Chemin d'appel invalide.")
        scheme = "http" if _LOCAL.fullmatch(self.host) else "https"
        return scheme + "://" + self.host + self.http_path.rstrip("/") + path

    def public(self) -> dict:
        return self.model_dump(mode="json", exclude_none=True)


class RestAccessPoints(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    access_points: list[RestAccessPoint] = Field(default_factory=list)

    def get(self, access_point_id: str) -> RestAccessPoint | None:
        return next((p for p in self.access_points if p.id == access_point_id), None)


def parse_rest_access_points(text: str, governance: Governance | None
                             ) -> tuple[RestAccessPoints | None, list[Issue]]:
    try:
        raw = yaml.safe_load(text) if text.strip() else {}
    except yaml.YAMLError:
        return None, [Issue("", None, "invalid_yaml", f"{FILE} n'est pas un YAML lisible.")]
    try:
        found = RestAccessPoints.model_validate(raw)
    except ValidationError as error:
        return None, issues_from_validation_error(error, raw)
    issues = check_access_points(found, governance)
    issues += [Issue(f"/access_points/{i}", None, "rest_no_budget",
                     "Aucun budget REST déclaré.", "warning")
               for i, p in enumerate(found.access_points)
               if p.calls_per_minute is None and p.bytes_per_day is None]
    return (None if any(i.severity == "error" for i in issues) else found), issues
