"""Démo de dix minutes (`examples/demo/lancer-demo.sh`) : la préparation seule, sans l'app,
pour qu'une évolution des scripts d'`examples/` ne la casse pas sans bruit."""

import os
import subprocess
from pathlib import Path

import yaml

SCRIPT = Path(__file__).parents[2] / "examples" / "demo" / "lancer-demo.sh"


def run(folder: Path) -> subprocess.CompletedProcess:
    env = {**os.environ, "DEMO_SANS_APP": "1"}
    for name in ("ATLAS_DATA_DIR", "ATLAS_ACCOUNT", "ATLAS_TOKEN", "ATLAS_PORT"):
        env.pop(name, None)
    return subprocess.run(["bash", str(SCRIPT), str(folder)], env=env, check=False,
                          capture_output=True, text=True, timeout=180)


def server_processes(folder: Path) -> list[str]:
    # `ps eww` montre l'environnement : le serveur de la démo a son ATLAS_DATA_DIR.
    listed = subprocess.run(["ps", "eww", "-A", "-o", "command"], check=True,
                            capture_output=True, text=True).stdout
    return [line for line in listed.splitlines()
            if "skifer-atlas-server" in line and f"ATLAS_DATA_DIR={folder}" in line]


def test_the_demo_is_prepared_and_joined(tmp_path):
    """L'espace est rejoint dans le dossier de la démo, avec ses propositions et ses points
    d'accès, et le serveur éphémère ne survit pas au script."""
    folder = tmp_path / "demo"
    done = run(folder)
    assert done.returncode == 0, done.stderr
    assert "Préparation terminée" in done.stdout
    registry = yaml.safe_load((folder / "donnees" / "workspaces.yaml").read_text())
    assert [ws["id"] for ws in registry["workspaces"]] == ["groupe-nordis"]
    # Cinq propositions ouvertes, puis trois points d'accès proposés et fusionnés.
    proposals = sorted((folder / "distant.git" / "atlas" / "proposals").glob("*.json"))
    assert len(proposals) == 8
    assert server_processes(folder) == []


def test_a_folder_that_is_not_a_demo_is_left_alone(tmp_path):
    """Le dossier n'est recréé que s'il porte le marqueur d'une démo."""
    folder = tmp_path / "travail"
    folder.mkdir()
    (folder / "important.txt").write_text("à garder")
    done = run(folder)
    assert done.returncode == 1
    assert "n'est pas un dossier de démo" in done.stderr
    assert (folder / "important.txt").read_text() == "à garder"
