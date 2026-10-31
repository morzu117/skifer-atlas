#!/usr/bin/env python3
"""Rapport de taille d'un build (plan 0019, critère 5) : sidecar et installateurs.

    python3 scripts/size-report.py [dossier des bundles]

Écrit un tableau Markdown (dans `$GITHUB_STEP_SUMMARY` en CI) et échoue si un
installateur dépasse 250 Mo. Le sidecar seul a un seuil d'alerte de 200 Mo (plan 0018),
signalé sans faire échouer. Bibliothèque standard seulement.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLES = ROOT / "app" / "src-tauri" / "target" / "release" / "bundle"
SIDECARS = ROOT / "app" / "src-tauri" / "binaries"
INSTALLER_LIMIT = 250 * 1024 * 1024
SIDECAR_ALERT = 200 * 1024 * 1024
INSTALLERS = (".dmg", ".msi", ".exe", ".AppImage", ".deb")


def megabytes(size: int) -> str:
    return f"{size / 1024 / 1024:.1f} Mo"


def installers(folder: Path) -> list[Path]:
    """Installateurs produits par `tauri build` : dmg/, nsis/, msi/, appimage/…"""
    return sorted(p for p in folder.rglob("*") if p.is_file() and p.suffix in INSTALLERS
                  and p.parent.name != "macos")


def report(folder: Path) -> tuple[str, bool]:
    rows, ok = [], True
    for sidecar in sorted(SIDECARS.glob("skifer-atlas-server-*")):
        size = sidecar.stat().st_size
        state = "alerte (> 200 Mo)" if size > SIDECAR_ALERT else "ok"
        rows.append((f"sidecar `{sidecar.name}`", megabytes(size), state))
    found = installers(folder) if folder.exists() else []
    for installer in found:
        size = installer.stat().st_size
        over = size > INSTALLER_LIMIT
        ok = ok and not over
        rows.append((f"installateur `{installer.name}`", megabytes(size),
                     "**trop gros (> 250 Mo)**" if over else "ok"))
    if not found:
        ok = False
        rows.append((f"installateur (aucun sous {folder})", "—", "**absent**"))
    lines = ["### Taille du build", "", "| Fichier | Taille | État |", "|---|---|---|",
             *(f"| {name} | {size} | {state} |" for name, size, state in rows)]
    return "\n".join(lines) + "\n", ok


if __name__ == "__main__":
    text, ok = report(Path(sys.argv[1]) if len(sys.argv) > 1 else BUNDLES)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write(text)
    sys.exit(0 if ok else 1)
