#!/usr/bin/env python3
"""Un seul numéro de version pour l'app, le sidecar et `skifer_atlas.__version__`
(plan 0019, critère 6).

    python3 scripts/version.py            # affiche la version, échoue si elle diverge
    python3 scripts/version.py 0.2.0      # la porte partout

La source est `core/src/skifer_atlas/__init__.py` : le paquet Python la lit (version
dynamique de hatch), le binaire figé la rend sur /health. `tauri.conf.json` lit celle de
`app/package.json`. Restent à recopier : `package.json`, `package-lock.json`,
`Cargo.toml` et `Cargo.lock`. Bibliothèque standard seulement : tourne avant toute
installation, en CI comme au poste.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INIT = ROOT / "core" / "src" / "skifer_atlas" / "__init__.py"
PACKAGE = ROOT / "app" / "package.json"
LOCK = ROOT / "app" / "package-lock.json"
CARGO = ROOT / "app" / "src-tauri" / "Cargo.toml"
CARGO_LOCK = ROOT / "app" / "src-tauri" / "Cargo.lock"
TAURI = ROOT / "app" / "src-tauri" / "tauri.conf.json"
PYPROJECT = ROOT / "core" / "pyproject.toml"

SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
INIT_LINE = re.compile(r'^__version__ = "([^"]+)"$', re.MULTILINE)
CARGO_LINE = re.compile(r'(\[package\]\nname = "skifer-atlas"\nversion = ")([^"]+)(")')
CARGO_LOCK_ENTRY = re.compile(r'(\[\[package\]\]\nname = "skifer-atlas"\nversion = ")([^"]+)(")')


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def found() -> dict[str, str | None]:
    """Version lue à chaque endroit ; None si l'endroit ne la porte pas comme prévu."""
    lock = json.loads(_read(LOCK))
    tauri = json.loads(_read(TAURI))
    init = INIT_LINE.search(_read(INIT))
    cargo = CARGO_LINE.search(_read(CARGO))
    cargo_lock = CARGO_LOCK_ENTRY.search(_read(CARGO_LOCK))
    package = json.loads(_read(PACKAGE))["version"]
    return {
        "core/src/skifer_atlas/__init__.py": init.group(1) if init else None,
        "core/pyproject.toml (dynamique)": (
            init.group(1) if init and 'dynamic = ["version"]' in _read(PYPROJECT) else None),
        "app/package.json": package,
        "app/package-lock.json": (lock.get("version") if lock.get("version") ==
                                  lock.get("packages", {}).get("", {}).get("version") else None),
        "app/src-tauri/tauri.conf.json (package.json)": (
            package if tauri.get("version") == "../package.json" else None),
        "app/src-tauri/Cargo.toml": cargo.group(2) if cargo else None,
        "app/src-tauri/Cargo.lock": cargo_lock.group(2) if cargo_lock else None,
    }


def check() -> str:
    versions = found()
    distinct = set(versions.values())
    if len(distinct) != 1 or None in distinct:
        lines = "\n".join(f"  {where} : {version}" for where, version in versions.items())
        raise SystemExit(f"Versions divergentes :\n{lines}")
    return distinct.pop()


def bump(version: str) -> None:
    if not SEMVER.match(version):
        raise SystemExit(f"« {version} » n'est pas une version x.y.z.")
    INIT.write_text(INIT_LINE.sub(f'__version__ = "{version}"', _read(INIT)), encoding="utf-8")
    for path in (PACKAGE, LOCK):
        data = json.loads(_read(path))
        data["version"] = version
        if path == LOCK:
            data["packages"][""]["version"] = version
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for path, pattern in ((CARGO, CARGO_LINE), (CARGO_LOCK, CARGO_LOCK_ENTRY)):
        path.write_text(pattern.sub(rf"\g<1>{version}\g<3>", _read(path)), encoding="utf-8")
    check()


if __name__ == "__main__":
    if len(sys.argv) > 2:
        raise SystemExit("usage : version.py [x.y.z]")
    if len(sys.argv) == 2:
        bump(sys.argv[1])
    print(check())
