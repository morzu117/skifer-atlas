"""Disposition du dépôt d'un espace (plan 0005).

```
atlas.yaml                         # schema_version, id, name, sector, entities[], main_branch
governance.yaml                    # domaines, membres, rôles (plan 0006)
calendars/<key>.yaml               # format calendrier du moteur Skifer
concepts/<id>.yaml
kpis/<id>.yaml
variants/<kpi-id>/<entity>.yaml
implementations/<kpi-id>/<entity>/<platform>.sql
```

Le nom de fichier est l'identifiant : renommer un domaine ne déplace aucun fichier.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from ..governance.model import Governance, parse_governance
from ..paths import WORKSPACE_ID_PATTERN

META_FILE = "atlas.yaml"
GOVERNANCE_FILE = "governance.yaml"
FOLDERS = {"concept": "concepts", "kpi": "kpis", "variant": "variants"}
SLUG = r"^[a-z0-9][a-z0-9-]{1,63}$"


class WorkspaceMeta(BaseModel):
    """`atlas.yaml` : identité de l'espace."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    id: str = Field(pattern=WORKSPACE_ID_PATTERN)
    name: str = Field(min_length=1)
    sector: str = ""
    entities: list[str] = Field(default_factory=list)
    main_branch: str = Field(default="main", pattern=r"^[A-Za-z0-9._/-]+$")


@dataclass(frozen=True)
class DocumentFile:
    kind: str  # concept | kpi | variant, d'après le dossier
    expected_id: str  # identifiant que le chemin impose
    path: str  # relatif à la racine du dépôt, séparateurs « / »


def read_meta(root: Path) -> WorkspaceMeta:
    return WorkspaceMeta.model_validate(_load(root / META_FILE))


def read_governance(root: Path) -> Governance | None:
    """La gouvernance du dépôt, ou None si elle manque ou n'est pas valide."""
    path = root / GOVERNANCE_FILE
    if not path.exists():
        return None
    return parse_governance(path.read_text(encoding="utf-8"))[0]


def _load(path: Path) -> dict:
    """Mapping YAML du fichier ; `ValueError` si son contenu n'en est pas un."""
    with path.open(encoding="utf-8") as handle:
        try:
            data = yaml.safe_load(handle)
        except yaml.YAMLError as error:
            raise ValueError(f"{path.name} : YAML illisible.") from error
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} doit être un mapping YAML.")  # noqa: TRY004
    return data


def document_files(root: Path) -> list[DocumentFile]:
    """Documents du dépôt, dans un ordre stable. Une variante a pour identifiant
    `<kpi-id>--<entité>`, comme dans les exemples du plan 0001."""
    files = []
    for kind in ("concept", "kpi"):
        for path in sorted((root / FOLDERS[kind]).glob("*.yaml")):
            files.append(DocumentFile(kind, path.stem, path.relative_to(root).as_posix()))
    for path in sorted((root / FOLDERS["variant"]).glob("*/*.yaml")):
        files.append(DocumentFile(
            "variant", f"{path.parent.name}--{path.stem}", path.relative_to(root).as_posix(),
        ))
    return files


def variant_path(kpi_id: str, entity: str) -> str:
    return f"{FOLDERS['variant']}/{kpi_id}/{entity}.yaml"


def document_path(kind: str, document_id: str) -> str:
    return f"{FOLDERS[kind]}/{document_id}.yaml"
