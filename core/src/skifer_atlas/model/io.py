"""Lecture et écriture des documents YAML.

Lecture sûre : `yaml.safe_load`, et refus des ancres, alias, balises explicites et clés
dupliquées. Écriture déterministe : ordre des clés du modèle, indentation 2, UTF-8, LF ;
`dump_document(load_document(x)) == x` pour tout fichier déjà en forme canonique.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from .document import ValidationResult, validate_data
from .errors import DocumentError, Issue


def _yaml_issue(message: str, mark: Any = None) -> Issue:
    where = f" (ligne {mark.line + 1}, colonne {mark.column + 1})" if mark is not None else ""
    return Issue("", None, "invalid_yaml", message + where)


def read_yaml(text: str) -> tuple[Any, list[Issue]]:
    """Charge le YAML sans rien construire d'autre que des mappings, listes et scalaires."""
    try:
        for event in yaml.parse(text, Loader=yaml.SafeLoader):
            if isinstance(event, yaml.AliasEvent):
                return None, [_yaml_issue("Les alias YAML (*) ne sont pas admis", event.start_mark)]
            if getattr(event, "anchor", None) is not None:
                return None, [_yaml_issue("Les ancres YAML (&) ne sont pas admises", event.start_mark)]
            if isinstance(event, yaml.NodeEvent) and getattr(event, "tag", None) not in (None, "!"):
                return None, [_yaml_issue("Les balises YAML (!!) ne sont pas admises", event.start_mark)]
        root = yaml.compose(text, Loader=yaml.SafeLoader)
        duplicate = _first_duplicate_key(root)
        if duplicate is not None:
            return None, [_yaml_issue(f"Clé « {duplicate.value} » répétée", duplicate.start_mark)]
        return yaml.safe_load(text), []
    except yaml.MarkedYAMLError as error:
        return None, [_yaml_issue(f"YAML illisible : {error.problem}", error.problem_mark)]
    except yaml.YAMLError as error:
        return None, [_yaml_issue(f"YAML illisible : {error}")]


def _first_duplicate_key(node: Any) -> Any:
    if isinstance(node, yaml.MappingNode):
        seen: set[str] = set()
        for key, value in node.value:
            if key.value in seen:
                return key
            seen.add(key.value)
            found = _first_duplicate_key(value)
            if found is not None:
                return found
    elif isinstance(node, yaml.SequenceNode):
        for item in node.value:
            found = _first_duplicate_key(item)
            if found is not None:
                return found
    return None


def validate_text(text: str) -> ValidationResult:
    raw, issues = read_yaml(text)
    if issues:
        return ValidationResult(None, issues)
    return validate_data(raw)


def validate_file(path: Path) -> ValidationResult:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        return ValidationResult(None, [Issue("", None, "unreadable_file", f"Lecture impossible : {error}")])
    return validate_text(text)


def load_document(source: Path | str) -> Any:
    """Charge un document depuis un chemin (Path) ou un texte YAML (str)."""
    result = validate_file(source) if isinstance(source, Path) else validate_text(source)
    if not result.valid:
        raise DocumentError(result.issues)
    return result.document


# --- Écriture ---------------------------------------------------------------------------

_SCALARS = (str, int, float, bool, type(None))


class _CanonicalDumper(yaml.SafeDumper):
    """Listes indentées sous leur clé ; style compact pour les petites structures plates."""

    def increase_indent(self, flow: bool = False, indentless: bool = False) -> None:
        return super().increase_indent(flow, False)


def _is_flat_list(data: list) -> bool:
    return all(
        isinstance(item, _SCALARS) or (isinstance(item, list) and _is_flat_list(item))
        for item in data
    )


def _represent_list(dumper: yaml.SafeDumper, data: list) -> yaml.Node:
    return dumper.represent_sequence(
        "tag:yaml.org,2002:seq", data, flow_style=_is_flat_list(data)
    )


def _represent_dict(dumper: yaml.SafeDumper, data: dict) -> yaml.Node:
    # Une petite structure plate (colonne, calendrier, entrées de jointure) tient sur une
    # ligne ; un nœud du graphe et le bloc data_product restent toujours en bloc.
    flat = (
        len(data) <= 4
        and all(isinstance(value, _SCALARS) for value in data.values())
        and not {"id", "type"} <= data.keys()
        and "owner" not in data
    )
    return dumper.represent_mapping("tag:yaml.org,2002:map", data, flow_style=flat)


def _represent_str(dumper: yaml.SafeDumper, data: str) -> yaml.Node:
    style = "|" if "\n" in data else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=style)


_CanonicalDumper.add_representer(list, _represent_list)
_CanonicalDumper.add_representer(dict, _represent_dict)
_CanonicalDumper.add_representer(str, _represent_str)


def dump_data(data: Any) -> str:
    return yaml.dump(
        data,
        Dumper=_CanonicalDumper,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
        indent=2,
        width=4096,
        line_break="\n",
    )


def dump_document(document: Any) -> str:
    return dump_data(document.model_dump(mode="json", by_alias=True, exclude_none=True))
