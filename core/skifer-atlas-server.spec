# -*- mode: python -*-
# Spec PyInstaller du sidecar (plan 0019), lancée par scripts/build-sidecar.sh :
#   ATLAS_SIDECAR_NAME=skifer-atlas-server-<triple> uv run pyinstaller skifer-atlas-server.spec
#
# Un seul fichier exécutable (`--onefile`), que Tauri embarque sous le nom
# `skifer-atlas-server-<triple>`. Les imports chargés à la demande sont listés ici et
# vérifiés à l'exécution par `GET /api/_selftest` (skifer_atlas/selftest.py).

import os

from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata

name = os.environ.get("ATLAS_SIDECAR_NAME", "skifer-atlas-server")

datas, binaries, hiddenimports = [], [], []
# Paquets entiers : DuckDB (module natif), SQLGlot (dialectes chargés par leur nom),
# connecteur Snowflake (cœur Rust, fichiers de configuration).
for package in ("duckdb", "sqlglot", "snowflake.connector"):
    found = collect_all(package)
    datas += found[0]
    binaries += found[1]
    hiddenimports += found[2]

# Métadonnées lues par importlib.metadata à l'exécution (versions, points d'entrée).
for distribution in ("keyring", "snowflake-connector-python", "skifer", "skifer-atlas"):
    datas += copy_metadata(distribution)

hiddenimports += [
    "skifer_atlas.server",
    "skifer_atlas.selftest",
    *collect_submodules("keyring.backends"),  # backend choisi selon le système
    "skifer.core.op_catalog",
    "skifer.analyzer.frontends",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.h11_impl",
]

# Jamais utilisés par le serveur : Spark et MLflow sont des options de Skifer, le reste
# vient des outils de développement présents dans l'environnement de build.
excludes = ["pyspark", "mlflow", "matplotlib", "tkinter", "_tkinter", "IPython",
            "pytest", "_pytest", "hypothesis", "PyInstaller"]

a = Analysis(
    ["sidecar.py"],
    pathex=["src"],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=excludes,
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name=name,
    debug=False,
    strip=False,
    upx=False,
    console=True,  # Tauri lit sa sortie ; aucune fenêtre ne s'ouvre sous Windows (sidecar)
    runtime_tmpdir=None,
)
