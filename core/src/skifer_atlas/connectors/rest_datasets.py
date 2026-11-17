"""Déclarations des tables servies par REST (plan 0036, ADR 0051)."""

from __future__ import annotations

from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ..model.errors import Issue, issues_from_validation_error
from ..model.nodes import TABLE_PATTERN, ColumnType
from ..repo.git import RepoError
from .rest_access_points import PATH_PATTERN, RestAccessPoint

FILE = "rest_datasets.yaml"
_NAME = r"^[A-Za-z_][A-Za-z0-9_]*$"


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Window(_Model):
    from_param: str = Field(pattern=_NAME)
    to_param: str = Field(pattern=_NAME)
    format: str = "%Y-%m-%d"


class Perimeter(_Model):
    param: str = Field(pattern=_NAME)
    column: str = Field(pattern=_NAME)
    mode: Literal["each", "list"] = "each"
    required: bool = True


class Pagination(_Model):
    kind: Literal["next_url"]
    next_path: str = "next_url"
    max_pages: int = Field(default=20, strict=True, ge=1, le=200)


class Column(_Model):
    name: str = Field(pattern=_NAME)
    from_: str = Field(alias="from")
    type: ColumnType
    format: str | None = None
    timezone: str = "UTC"

    @model_validator(mode="after")
    def _zone(self):
        try:
            ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Fuseau de colonne inconnu.") from None
        return self


class RestDataset(_Model):
    table: str = Field(pattern=TABLE_PATTERN)
    access_point: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,63}$")
    path: str = Field(pattern=PATH_PATTERN)
    params: dict[str, str | int | float | bool] = Field(default_factory=dict)
    window: Window | None = None
    perimeter: Perimeter | None = None
    rows_path: str = ""
    error_keys: list[str] = Field(default_factory=list)
    pagination: Pagination | None = None
    columns: list[Column] = Field(min_length=1)

    @model_validator(mode="after")
    def _path(self):
        if ".." in self.path or "//" in self.path:
            raise ValueError("Chemin d'appel REST invalide.")
        if len({c.name for c in self.columns}) != len(self.columns):
            raise ValueError("Colonne REST répétée.")
        return self


class RestDatasets(_Model):
    schema_version: Literal[1] = 1
    datasets: list[RestDataset] = Field(default_factory=list)

    def get(self, table: str, access_point: str) -> RestDataset | None:
        return next((d for d in self.datasets
                     if d.table == table and d.access_point == access_point), None)

    def require(self, table: str, access_point: str) -> RestDataset:
        found = self.get(table, access_point)
        if found is None:
            message = ("Jeu de données déclaré sur un autre point REST."
                if any(d.table == table for d in self.datasets)
                else "Table sans jeu de données sur ce point REST.")
            raise RepoError("rest_dataset_missing", message)
        return found


def parse_rest_datasets(text: str, points: list[RestAccessPoint], *, legacy_ids=()
                        ) -> tuple[RestDatasets | None, list[Issue]]:
    try:
        raw = yaml.safe_load(text) if text.strip() else {}
    except yaml.YAMLError:
        return None, [Issue("", None, "invalid_yaml", f"{FILE} n'est pas un YAML lisible.")]
    try:
        found = RestDatasets.model_validate(raw)
    except ValidationError as error:
        return None, issues_from_validation_error(error, raw)
    issues = []
    seen = set()
    by_id = {p.id: p for p in points}
    for i, ds in enumerate(found.datasets):
        def issue(code, message, index=i):
            issues.append(Issue(f"/datasets/{index}", None, code, message))

        pair = ds.table, ds.access_point
        if pair in seen:
            issue("duplicate_rest_dataset", "Jeu de données répété.")
        seen.add(pair)
        point = by_id.get(ds.access_point)
        if point is None:
            issue("access_point_not_rest" if ds.access_point in legacy_ids else "unknown_access_point",
                  "Le point du jeu de données n'est pas déclaré dans le registre REST.")
            continue
        params = list(ds.params)
        if ds.window:
            params += [ds.window.from_param, ds.window.to_param]
        if ds.perimeter:
            params.append(ds.perimeter.param)
            if ds.perimeter.column not in {c.name for c in ds.columns}:
                issue("perimeter_column_unknown", "Colonne de périmètre absente du jeu de données.")
        if point.key_name in params:
            issue("key_param_in_dataset", "La clé d'API ne se déclare pas dans un jeu de données.")
        if len(params) != len(set(params)):
            issue("param_clash", "Paramètres fixes, fenêtre et périmètre doivent être distincts.")
    return (None if issues else found), issues
