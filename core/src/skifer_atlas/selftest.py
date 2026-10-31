"""Diagnostic du binaire figé (plan 0019) : `GET /api/_selftest`.

PyInstaller ne voit que les imports écrits en tête de module. Ce qui se charge à la
demande (dialectes SQLGlot, connecteur Snowflake, backend du trousseau selon le système,
boucle et protocole d'uvicorn, fuseaux horaires) ne casse qu'au premier usage, chez
l'utilisateur. Ce module l'importe d'avance, puis extrait, compile et exécute une petite
requête de bout en bout : si le binaire passe ici, rien ne manque. Aucun appel réseau,
aucun secret lu.
"""

from __future__ import annotations

import importlib
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from . import __version__

# Modules chargés à la demande, recensés par les plans 0001 à 0018. Une entrée ajoutée ici
# doit l'être aussi dans `skifer-atlas-server.spec` si PyInstaller ne la trouve pas seul.
DYNAMIC_MODULES = (
    "sqlglot.dialects.databricks",  # SQLGlot charge ses dialectes par leur nom
    "sqlglot.dialects.spark",
    "sqlglot.dialects.snowflake",
    "sqlglot.dialects.duckdb",
    "duckdb",
    "snowflake.connector",  # importé à la première connexion (plan 0018)
    "snowflake.connector.constants",
    "cryptography.hazmat.primitives.serialization",
    "skifer.core.op_catalog",
    "skifer.analyzer.frontends",
    "uvicorn.loops.asyncio",  # choisis explicitement dans server.py
    "uvicorn.protocols.http.h11_impl",
)

# Backend du trousseau, choisi selon le système (vault/keyring_vault.py).
KEYRING_BACKENDS = {"darwin": "keyring.backends.macOS", "win32": "keyring.backends.Windows"}

FIXTURE_SQL = """SELECT entite, SUM(montant_ht) AS revenu
FROM gold.finance.factures
WHERE statut = 'VALIDEE'
GROUP BY entite
"""
FIXTURE_ROWS = (("nordis-fr", 120.5, "VALIDEE"), ("nordis-fr", 30, "BROUILLON"),
                ("nordis-de", 80, "VALIDEE"))
EXPECTED = [("nordis-de", 80), ("nordis-fr", 120.5)]


def _modules() -> dict[str, str]:
    names = [*DYNAMIC_MODULES,
             KEYRING_BACKENDS.get(sys.platform, "keyring.backends.SecretService")]
    found = {}
    for name in names:
        try:
            importlib.import_module(name)
            found[name] = "ok"
        except Exception as error:  # noqa: BLE001 — on rapporte tout, sans s'arrêter
            found[name] = f"{type(error).__name__}: {error}"
    return found


def _pipeline() -> dict[str, Any]:
    """Extraction depuis chaque dialecte source, compilation vers chaque dialecte cible,
    exécution du SQL DuckDB sur trois lignes."""
    import duckdb

    from .compile import compile_document
    from .compile.dialects import DIALECTS
    from .extract import extract_file

    found: dict[str, Any] = {}
    with tempfile.TemporaryDirectory(prefix="atlas-selftest-") as folder:
        path = Path(folder) / "revenu.sql"
        path.write_text(FIXTURE_SQL, encoding="utf-8")
        for source in ("databricks", "snowflake"):
            draft = extract_file(path, source).extractions[0].draft
            if draft.document is None:
                found[f"extract.{source}"] = f"brouillon {draft.status}"
                continue
            found[f"extract.{source}"] = "ok"
            for dialect in DIALECTS:
                compile_document(draft.document, dialect)
            found[f"compile.{source}"] = "ok"
        document = extract_file(path, "databricks").extractions[0].draft.document
    if document is None:
        return found
    connection = duckdb.connect()
    try:
        connection.execute("ATTACH ':memory:' AS gold")
        connection.execute("CREATE SCHEMA gold.finance")
        connection.execute("CREATE TABLE gold.finance.factures "
                           "(entite VARCHAR, montant_ht DECIMAL(18, 2), statut VARCHAR)")
        connection.executemany("INSERT INTO gold.finance.factures VALUES (?, ?, ?)",
                               FIXTURE_ROWS)
        rows = connection.execute(compile_document(document, "duckdb").sql).fetchall()
    finally:
        connection.close()
    rows = sorted((entity, float(total)) for entity, total in rows)
    found["run.duckdb"] = "ok" if rows == EXPECTED else f"résultat inattendu : {rows}"
    return found


def run() -> dict[str, Any]:
    checks: dict[str, str] = {}
    modules = _modules()
    try:
        checks.update(_pipeline())
    except Exception as error:  # noqa: BLE001
        checks["pipeline"] = f"{type(error).__name__}: {error}"
    try:
        ZoneInfo("Europe/Paris")  # sous Windows, la base vient du paquet tzdata
        checks["zoneinfo"] = "ok"
    except Exception as error:  # noqa: BLE001
        checks["zoneinfo"] = f"{type(error).__name__}: {error}"
    # Git n'est pas embarqué : c'est un prérequis du poste (README, ADR 0023).
    checks["git"] = "ok" if shutil.which("git") else "absent du poste"
    ok = all(v == "ok" for v in modules.values()) and all(
        v == "ok" for k, v in checks.items() if k != "git")
    return {"ok": ok, "version": __version__, "frozen": bool(getattr(sys, "frozen", False)),
            "platform": sys.platform, "modules": modules, "checks": checks}
