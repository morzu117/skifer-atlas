"""Démo de dix minutes (`examples/demo/lancer-demo.sh`) : la préparation seule, sans l'app,
pour qu'une évolution des scripts d'`examples/` ne la casse pas sans bruit. Lente (dépôt,
propositions, serveur éphémère) : hors du pytest par défaut, `uv run pytest -m slow`.
Même nommé, ce fichier ne tourne qu'avec `-m slow` : sans, ses tests sont désélectionnés."""

import os
import subprocess
from pathlib import Path

import pytest
import yaml

pytestmark = pytest.mark.slow

SCRIPT = Path(__file__).parents[2] / "examples" / "demo" / "lancer-demo.sh"


def run(folder: Path) -> tuple[subprocess.CompletedProcess, list[str]]:
    """Lance la préparation dans son propre groupe de processus, puis rend aussi ce qu'il
    reste de ce groupe : le serveur éphémère, s'il a survécu au script."""
    env = {**os.environ, "DEMO_SANS_APP": "1"}
    for name in ("ATLAS_DATA_DIR", "ATLAS_ACCOUNT", "ATLAS_TOKEN", "ATLAS_PORT"):
        env.pop(name, None)
    # Sorties dans des fichiers : un serveur survivant garderait un tube ouvert.
    out, err = folder.with_name("sortie.txt"), folder.with_name("erreurs.txt")
    with out.open("w") as stdout, err.open("w") as stderr:
        script = subprocess.Popen(["bash", str(SCRIPT), str(folder)], env=env,
                                  stdout=stdout, stderr=stderr, start_new_session=True)
        try:
            script.wait(timeout=180)
        finally:
            left = group_processes(script.pid)
            if script.poll() is None or left:
                os.killpg(script.pid, 15)
    return subprocess.CompletedProcess(script.args, script.returncode, out.read_text(),
                                       err.read_text()), left


def group_processes(group: int) -> list[str]:
    # `-o pgid=,command=` existe sous macOS comme sous Linux (procps).
    listed = subprocess.run(["ps", "-A", "-o", "pgid=,command="], check=True,
                            capture_output=True, text=True).stdout
    return [command for pgid, _, command in (line.strip().partition(" ")
                                             for line in listed.splitlines())
            if pgid == str(group)]


def test_the_demo_is_prepared_and_joined(tmp_path):
    """L'espace est rejoint dans le dossier de la démo, avec ses propositions et ses points
    d'accès, et le serveur éphémère ne survit pas au script."""
    folder = tmp_path / "demo"
    done, left = run(folder)
    assert done.returncode == 0, done.stderr
    assert "Préparation terminée" in done.stdout
    registry = yaml.safe_load((folder / "donnees" / "workspaces.yaml").read_text())
    assert [ws["id"] for ws in registry["workspaces"]] == ["groupe-nordis"]
    # Cinq propositions ouvertes, puis trois points d'accès proposés et fusionnés.
    proposals = sorted((folder / "distant.git" / "atlas" / "proposals").glob("*.json"))
    assert len(proposals) == 8
    assert left == []


def test_a_folder_that_is_not_a_demo_is_left_alone(tmp_path):
    """Le dossier n'est recréé que s'il porte le marqueur d'une démo."""
    folder = tmp_path / "travail"
    folder.mkdir()
    (folder / "important.txt").write_text("à garder")
    done, _ = run(folder)
    assert done.returncode == 1
    assert "n'est pas un dossier de démo" in done.stderr
    assert (folder / "important.txt").read_text() == "à garder"
