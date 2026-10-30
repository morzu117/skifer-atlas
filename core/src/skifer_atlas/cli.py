"""CLI `atlas` : validation, contrôle, résolution, empreinte, diff et extraction.

argparse seulement, sans chargement dynamique de sous-commandes (PyInstaller).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import extract
from .diff import RELATIONS, DiffContext, diff, diff_schema_text, report_text
from .model import DocumentError, Issue, load_document, validate_file
from .model.check import check_document, has_errors
from .model.fingerprint import fingerprint
from .model.graph import Library
from .model.io import dump_data, dump_document
from .model.jsonschema import schema_text
from .model.normalize import normalized_form
from .model.resolve import ResolvedGraph, resolve

_SEVERITY = {"error": "erreur", "warning": "avertissement", "info": "info"}


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
            issues = report["errors"]
            errors = sum(issue["severity"] == "error" for issue in issues)
            others = len(issues) - errors
            if report["valid"]:
                extra = f", {others} avertissement(s)" if others else ""
                print(f"{report['file']} : valide{extra}")
            else:
                print(f"{report['file']} : {errors} erreur(s)")
            for issue in issues:
                node = f" ({issue['node_id']})" if issue["node_id"] else ""
                marker = "" if issue["severity"] == "error" else f"{_SEVERITY[issue['severity']]} "
                print(f"  {marker}{issue['path'] or '/'}{node} [{issue['code']}] {issue['message']}")
    return 0 if all(report["valid"] for report in reports) else 1


def _print_issues(issues: list[Issue], file=None) -> None:
    for issue in issues:
        node = f" ({issue.node_id})" if issue.node_id else ""
        print(
            f"  {_SEVERITY[issue.severity]:<13} {issue.path or '/'}{node} "
            f"[{issue.code}] {issue.message}",
            file=file or sys.stdout,
        )


def _library(paths: list[str]) -> Library:
    return Library(load_document(Path(path)) for path in paths)


def _target(path: str, library: Library) -> tuple[object | None, list[Issue], list]:
    """Document contrôlé, avec ses erreurs ; une variante est d'abord résolue sur son
    canonique (passé avec --with)."""
    try:
        document = load_document(Path(path))
    except DocumentError as error:
        return None, error.issues, []
    if document.kind != "variant":
        return document, check_document(document, library), []
    canonical = library.kpi(document.variant_of.id, document.variant_of.version)
    if canonical is None:
        return None, [Issue(
            "/variant_of", None, "missing_canonical",
            f"Canonique {document.variant_of.id} v{document.variant_of.version} introuvable : "
            "le passer avec --with.",
        )], []
    resolved = resolve(document, canonical, library)
    return resolved.document, resolved.issues, resolved.overrides


def _check(args: argparse.Namespace) -> int:
    library = _library(args.with_)
    reports = [(path, *_target(path, library)) for path in args.files]
    if args.format == "json":
        print(json.dumps([
            {
                "file": path,
                "valid": not has_errors(issues),
                "issues": [issue.to_dict() for issue in issues],
                "overrides": [vars(o) for o in overrides],
            }
            for path, _, issues, overrides in reports
        ], indent=2, ensure_ascii=False))
    else:
        for path, _, issues, overrides in reports:
            counts = {key: sum(i.severity == key for i in issues) for key in _SEVERITY}
            print(
                f"{path} : {counts['error']} erreur(s), {counts['warning']} avertissement(s), "
                f"{counts['info']} info(s)"
            )
            for override in overrides:
                kind = "point déclaré" if override.classification == "declared" else "hors points"
                print(f"  surcharge     {override.node} ({kind}) : {override.justification}")
            _print_issues(issues)
    return 1 if any(has_errors(issues) for _, _, issues, _ in reports) else 0


def _checked_graph(path: str, library: Library) -> object | None:
    """Document dont le graphe est sans erreur, ou None après avoir signalé pourquoi."""
    document, issues, _ = _target(path, library)
    if document is not None and document.graph is None:
        issues = [Issue("/graph", None, "missing_field", "Ce document n'a pas de graphe.")]
    if document is None or has_errors(issues):
        print(f"{path} : à corriger d'abord (voir atlas check)", file=sys.stderr)
        for issue in issues:
            if issue.severity == "error":
                print(f"  {issue.path or '/'} [{issue.code}] {issue.message}", file=sys.stderr)
        return None
    return document


def _resolve(args: argparse.Namespace) -> int:
    library = _library([args.canonical])
    document = load_document(Path(args.variant))
    canonical = library.kpi(document.variant_of.id, document.variant_of.version)
    if canonical is None or document.kind != "variant":
        print("La variante ne porte pas sur ce canonique.", file=sys.stderr)
        return 1
    resolved = resolve(document, canonical, library)
    for override in resolved.overrides:
        print(f"{override.node} : {override.classification}", file=sys.stderr)
    _print_issues(resolved.issues, sys.stderr)
    if not resolved.valid:
        return 1
    text = dump_document(resolved.document)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


def _normalize(args: argparse.Namespace) -> int:
    document = _checked_graph(args.file, _library(args.with_))
    if document is None:
        return 1
    sys.stdout.write(dump_data(normalized_form(document)))
    return 0


def _fingerprint(args: argparse.Namespace) -> int:
    library = _library(args.with_)
    status = 0
    for path in args.files:
        document = _checked_graph(path, library)
        if document is None:
            status = 1
            continue
        print(f"{fingerprint(document)}  {path}")
    return status


def _diff_side(path: str, library: Library) -> ResolvedGraph | None:
    """Document prêt à comparer (variante résolue), ou None après avoir dit pourquoi."""
    try:
        document = load_document(Path(path))
    except DocumentError as error:
        _report_failure(path, error.issues)
        return None
    if document.kind == "variant":
        canonical = library.kpi(document.variant_of.id, document.variant_of.version)
        if canonical is None:
            _report_failure(path, [Issue(
                "/variant_of", None, "missing_canonical",
                f"Canonique {document.variant_of.id} v{document.variant_of.version} "
                "introuvable : le passer avec --canonical.",
            )])
            return None
        resolved = resolve(document, canonical, library)
    elif document.graph is None:
        _report_failure(path, [Issue("/graph", None, "missing_field", "Ce document n'a pas de graphe.")])
        return None
    else:
        resolved = ResolvedGraph(document, issues=check_document(document, library))
    if not resolved.valid:
        _report_failure(path, resolved.issues)
        return None
    return resolved


def _report_failure(path: str, issues: list[Issue]) -> None:
    print(f"{path} : à corriger d'abord (voir atlas check)", file=sys.stderr)
    _print_issues([i for i in issues if i.severity == "error"], sys.stderr)


def _relation(base: ResolvedGraph, other: ResolvedGraph) -> str:
    variant = other.variant
    product = base.document.data_product
    if base.variant is None and variant is not None and (
        (variant.variant_of.id, variant.variant_of.version) == (product.id, product.version)
    ):
        return variant.mode
    if base.variant is None and variant is None and (
        other.document.data_product.id == product.id
    ):
        return "version"
    return "free"


def _diff(args: argparse.Namespace) -> int:
    paths = [*args.with_, *([args.canonical] if args.canonical else [])]
    library = _library(paths)
    for path in (args.base, args.other):
        try:
            library.add(load_document(Path(path)))
        except DocumentError:
            pass  # signalé ci-dessous
    base = _diff_side(args.base, library)
    other = _diff_side(args.other, library)
    if base is None or other is None:
        return 1
    report = diff(base, other, DiffContext(args.relation or _relation(base, other), library))
    sys.stdout.write(report.to_json() if args.format == "json" else report_text(report))
    if report.identical:
        return 0
    return 3 if report.has_critical else 2


def _extract(args: argparse.Namespace) -> int:
    results: list[extract.FileExtraction] = []
    for name in args.files:
        path = Path(name)
        if not path.is_file() or path.suffix not in extract.SUFFIXES:
            print(f"{name} : fichier introuvable ou extension non prise en charge "
                  f"({', '.join(extract.SUFFIXES)})", file=sys.stderr)
            return 1
        results.append(extract.extract_file(path, args.dialect, name))
    drafts = [draft for result in results for draft in result.drafts]
    ids = [draft.id for draft in drafts]
    if len(set(ids)) != len(ids):
        twice = sorted({i for i in ids if ids.count(i) > 1})
        print(f"Brouillons de même identifiant : {', '.join(twice)} (fichiers de même nom ?)",
              file=sys.stderr)
        return 1
    report = (extract.report_json if args.format == "json" else extract.report_text)(results)
    if args.out:
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        for draft in drafts:
            (out / f"{draft.id}.yaml").write_text(draft.text(), encoding="utf-8")
        sys.stdout.write(report)
    else:
        sys.stdout.write("---\n".join(draft.text() for draft in drafts))
        sys.stderr.write(report)
    extractions = [e for result in results for e in result.extractions]
    if any(e.blocking for e in extractions):
        return 3
    residues = any(e.draft.residues for e in extractions) or any(r.residues for r in results)
    return 2 if residues else 0


def _schema(args: argparse.Namespace) -> int:
    text = diff_schema_text() if args.kind == "diff" else schema_text()
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

    check = commands.add_parser("check", help="contrôler le graphe et les colonnes")
    check.add_argument("files", nargs="+", metavar="fichier")
    check.add_argument("--with", dest="with_", action="append", default=[], metavar="fichier",
                       help="document référencé (kpi_ref) ou canonique d'une variante")
    check.add_argument("--format", choices=("text", "json"), default="text")
    check.set_defaults(handler=_check)

    resolve_cmd = commands.add_parser("resolve", help="résoudre une variante sur son canonique")
    resolve_cmd.add_argument("variant")
    resolve_cmd.add_argument("canonical")
    resolve_cmd.add_argument("--out", metavar="fichier")
    resolve_cmd.set_defaults(handler=_resolve)

    normalize = commands.add_parser("normalize", help="écrire la forme normalisée")
    normalize.add_argument("file", metavar="fichier")
    normalize.add_argument("--with", dest="with_", action="append", default=[], metavar="fichier")
    normalize.set_defaults(handler=_normalize)

    fingerprint_cmd = commands.add_parser("fingerprint", help="empreinte des graphes")
    fingerprint_cmd.add_argument("files", nargs="+", metavar="fichier")
    fingerprint_cmd.add_argument("--with", dest="with_", action="append", default=[],
                                 metavar="fichier")
    fingerprint_cmd.set_defaults(handler=_fingerprint)

    diff_cmd = commands.add_parser(
        "diff", help="écarts entre deux graphes (0 identiques, 2 écarts, 3 écart critique)"
    )
    diff_cmd.add_argument("base", metavar="a")
    diff_cmd.add_argument("other", metavar="b")
    diff_cmd.add_argument("--canonical", metavar="fichier",
                          help="canonique d'une variante, s'il n'est pas déjà a")
    diff_cmd.add_argument("--with", dest="with_", action="append", default=[], metavar="fichier")
    diff_cmd.add_argument("--relation", choices=RELATIONS,
                          help="par défaut : déduite des deux documents")
    diff_cmd.add_argument("--format", choices=("text", "json"), default="text")
    diff_cmd.set_defaults(handler=_diff)

    extract_cmd = commands.add_parser(
        "extract", help="brouillons Atlas depuis du SQL existant (0 tout traduit, 2 résidus "
        "à revoir, 3 brouillon à reprendre)",
    )
    extract_cmd.add_argument("files", nargs="+", metavar="fichier",
                             help="script .sql, notebook .py ou .ipynb")
    extract_cmd.add_argument("--dialect", choices=extract.DIALECTS, required=True)
    extract_cmd.add_argument("--out", metavar="dossier",
                             help="un fichier YAML par brouillon ; sinon sur la sortie standard")
    extract_cmd.add_argument("--format", choices=("text", "json"), default="text",
                             help="format du rapport")
    extract_cmd.set_defaults(handler=_extract)

    schema = commands.add_parser("schema", help="écrire le JSON Schema des documents")
    schema.add_argument("--kind", choices=("document", "diff"), default="document",
                        help="document Atlas ou rapport de diff")
    schema.add_argument("--out", metavar="fichier")
    schema.set_defaults(handler=_schema)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
