"""CLI `atlas` : validation des documents et publication du JSON Schema.

argparse seulement, sans chargement dynamique de sous-commandes (PyInstaller).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .model import validate_file
from .model.jsonschema import schema_text


def _validate(args: argparse.Namespace) -> int:
    reports = []
    for name in args.files:
        result = validate_file(Path(name))
        reports.append({
            "file": name,
            "valid": result.valid,
            "errors": [issue.to_dict() for issue in result.issues],
        })
    if args.format == "json":
        print(json.dumps(reports, indent=2, ensure_ascii=False))
    else:
        for report in reports:
            if report["valid"]:
                print(f"{report['file']} : valide")
                continue
            print(f"{report['file']} : {len(report['errors'])} erreur(s)")
            for error in report["errors"]:
                node = f" ({error['node_id']})" if error["node_id"] else ""
                print(f"  {error['path'] or '/'}{node} [{error['code']}] {error['message']}")
    return 0 if all(report["valid"] for report in reports) else 1


def _schema(args: argparse.Namespace) -> int:
    text = schema_text()
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="atlas", description="Skifer Atlas")
    commands = parser.add_subparsers(dest="command", required=True)

    validate = commands.add_parser("validate", help="valider des documents YAML")
    validate.add_argument("files", nargs="+", metavar="fichier")
    validate.add_argument("--format", choices=("text", "json"), default="text")
    validate.set_defaults(handler=_validate)

    schema = commands.add_parser("schema", help="écrire le JSON Schema des documents")
    schema.add_argument("--out", metavar="fichier")
    schema.set_defaults(handler=_schema)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
