"""Livrable CLI REST de bout en bout, plan 0036."""

import io
import json
import shutil
import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parents[1] / "connections"))
from fake_rest import FakeRest
from test_rest_access_points import point, space, write_points

from skifer_atlas import connections
from skifer_atlas.cli import main
from skifer_atlas.repo.git import run_git

__all__ = ["space"]


@pytest.fixture
def rest_workspace(space):
    fixture = Path(__file__).parents[1] / "fixtures" / "rest"
    shutil.copytree(fixture, space, dirs_exist_ok=True)
    with FakeRest() as server:
        write_points(space, [point(host=server.host, entity="exemple", http_path="/v1")])
        ds = {"table": "marche.prix.cours_jour", "access_point": "api-exemple", "path": "/data",
              "columns": [{"name": "trade_date", "from": "t", "type": "date"},
                          {"name": "symbol", "from": "symbol", "type": "string"},
                          {"name": "close", "from": "c", "type": "double"}]}
        (space / "rest_datasets.yaml").write_text(yaml.safe_dump({"datasets": [ds]}),
                                                  encoding="utf-8")
        connections.store_api_key("exemple", "api-exemple", server.key)
        run_git(["init", "--initial-branch=main"], space)
        run_git(["add", "."], space)
        run_git(["-c", "user.name=Exemple", "-c", "user.email=exemple@example.test",
                 "commit", "-m", "Espace REST de test"], space)
        yield server


ARGS = ["compare", "exemple", "cours-total", "--variants", "exemple", "--scope", "total"]


def test_compare_text_on_rest_point(rest_workspace, capsys):
    assert main(ARGS) == 0
    output = capsys.readouterr().out
    assert "100,0 %" in output and "sources REST" in output and "clé : coffre" in output
    assert len(rest_workspace.requests) == 1


def test_compare_json_has_rest_report(rest_workspace, capsys):
    assert main(ARGS + ["--format", "json"]) == 0
    found = json.loads(capsys.readouterr().out)
    assert found["rest"][0]["calls"] == 1 and found["rest"][0]["key_source"] == "vault"
    assert main(ARGS + ["--format", "json"]) == 0
    found = json.loads(capsys.readouterr().out)
    assert found["rest"][0]["calls"] == 0 and found["rest"][0]["cache"] == "provisional"
    assert len(rest_workspace.requests) == 1


def test_refresh(rest_workspace, capsys):
    assert main(ARGS) == 0
    capsys.readouterr()
    assert main(ARGS + ["--refresh"]) == 0
    assert "cache rafraîchi" in capsys.readouterr().out
    assert len(rest_workspace.requests) == 2


def test_rest_key_reads_stdin(rest_workspace, monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO(rest_workspace.key + "\n"))
    assert main(["rest-key", "exemple", "api-exemple"]) == 0
    assert rest_workspace.key not in capsys.readouterr().out
    with pytest.raises(SystemExit):
        main(["rest-key", "exemple", "api-exemple", rest_workspace.key])
    assert rest_workspace.key not in capsys.readouterr().err

    from skifer_atlas.repo.git import RepoError
    from skifer_atlas.vault import keyring_vault

    def unavailable():
        raise RepoError("vault_unavailable", "Sans trousseau.")

    monkeypatch.setattr(keyring_vault, "system_keyring", unavailable)
    monkeypatch.setattr(sys, "stdin", io.StringIO(rest_workspace.key))
    assert main(["rest-key", "exemple", "api-exemple"]) == 1
    assert "ATLAS_REST_KEY_API_EXEMPLE" in capsys.readouterr().err


def test_rest_usage_command(rest_workspace, capsys):
    assert main(ARGS) == 0
    capsys.readouterr()
    assert main(["rest-usage", "exemple", "--point", "api-exemple", "--format", "json"]) == 0
    [row] = json.loads(capsys.readouterr().out)
    assert row["calls"] == 1 and row["cache_hits"] == 1 and row["bytes"] > 0


def test_compare_vault_unavailable_prints_rest_key_hint(rest_workspace, monkeypatch, capsys):
    from skifer_atlas.repo.git import RepoError
    from skifer_atlas.vault import keyring_vault

    def unavailable():
        raise RepoError("vault_unavailable", "Sans trousseau.")

    monkeypatch.setattr(keyring_vault, "system_keyring", unavailable)
    monkeypatch.delenv("ATLAS_VAULT", raising=False)
    monkeypatch.delenv("ATLAS_REST_KEY_API_EXEMPLE", raising=False)
    assert main(ARGS) == 1
    output = capsys.readouterr()
    assert "vault_unavailable" in output.err
    assert "ATLAS_REST_KEY_API_EXEMPLE" in output.err
    assert not rest_workspace.requests


def test_rest_key_unknown_point_never_echoes_argument(rest_workspace, monkeypatch, capsys):
    import secrets

    sentinel = secrets.token_urlsafe(24)
    monkeypatch.setattr(sys, "stdin", io.StringIO(rest_workspace.key))
    assert main(["rest-key", "exemple", sentinel]) == 1
    output = capsys.readouterr()
    assert "not_found" in output.err
    assert sentinel not in output.out + output.err


@pytest.mark.parametrize("case", ["mixed", "lower"])
def test_rest_key_workspace_argument_never_echoes_key(space, case):
    import os
    import secrets
    import subprocess

    sentinel = "Aa" + secrets.token_hex(18)
    if case == "lower":
        sentinel = sentinel.lower()
    process = subprocess.run(
        [sys.executable, "-m", "skifer_atlas.cli", "rest-key", sentinel, "api-exemple"],
        check=False, input="", text=True, capture_output=True, env=os.environ.copy(), timeout=15)
    output = process.stdout + process.stderr
    assert process.returncode != 0
    assert "not_found : Espace inconnu." in process.stderr
    assert "Traceback" not in output, "La CLI doit rendre un refus simple."
    assert sentinel not in output, "L'argument sensible ne doit jamais être recopié."


def test_rest_key_unknown_workspace_names_workspace_without_echo(space, capsys):
    import secrets

    workspace = "absent-" + secrets.token_hex(8)
    assert main(["rest-key", workspace, "api-exemple"]) == 1
    output = capsys.readouterr()
    assert "Espace inconnu." in output.err
    assert "Point d'accès inconnu." not in output.err
    assert workspace not in output.out + output.err


def test_local_data_wins_over_rest_point(space, rest_workspace, tmp_path, capsys):
    data = tmp_path / "local"
    data.mkdir()
    (data / "marche.prix.cours_jour.csv").write_text(
        "trade_date,symbol,close\n2026-01-02,EX,10\n", encoding="utf-8")
    assert main(ARGS + ["--duckdb-data", str(data)]) == 0
    output = capsys.readouterr()
    assert "ne sont pas appelés" in output.err and not rest_workspace.requests


@pytest.mark.parametrize("rest_declared", [True, False])
def test_compare_environment_data_applies_to_all_workspaces(
        space, rest_workspace, tmp_path, monkeypatch, capsys, rest_declared):
    data = tmp_path / "local-env"
    data.mkdir()
    (data / "marche.prix.cours_jour.csv").write_text(
        "trade_date,symbol,close\n2026-01-02,EX,10\n", encoding="utf-8")
    if not rest_declared:
        from test_rest_access_points import legacy

        (space / "rest_access_points.yaml").unlink()
        platform = yaml.safe_load(legacy(space))["access_points"][0]["platform"]
        path = space / "kpis/cours-total.yaml"
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        raw["graph"]["nodes"][0]["platform"] = platform
        path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    monkeypatch.setenv("ATLAS_COMPARE_DATA", str(data))
    assert main(ARGS) == 0
    assert not rest_workspace.requests
    output = capsys.readouterr()
    assert "ATLAS_COMPARE_DATA" in output.err and "données locales" in output.out.lower()
    assert main(ARGS + ["--format", "json"]) == 0
    output = capsys.readouterr()
    assert "ATLAS_COMPARE_DATA" in output.err
    assert json.loads(output.out)["data_source"] == "données locales"


def test_invalid_rest_file_diagnostic(space, rest_workspace, capsys):
    (space / "rest_access_points.yaml").write_text("[broken", encoding="utf-8")
    assert main(ARGS) == 1
    output = capsys.readouterr()
    assert "invalid_rest_access_points" in output.err and "invalid_yaml" in output.err
    assert not rest_workspace.requests


@pytest.mark.parametrize("source", ["vault", "env"])
def test_key_masked_everywhere(space, rest_workspace, monkeypatch, capsys, caplog, source):
    from urllib.parse import quote

    from skifer_atlas.repo.git import RepoError
    from skifer_atlas.vault import keyring_vault

    key = rest_workspace.key
    if source == "env":
        keyring_vault.Vault().delete("exemple", "api-exemple")
        monkeypatch.setenv("ATLAS_REST_KEY_API_EXEMPLE", key)

        def unavailable():
            raise RepoError("vault_unavailable", "Sans trousseau.")

        monkeypatch.setattr(keyring_vault, "system_keyring", unavailable)
    assert main(ARGS) == 0
    successful = capsys.readouterr()
    rest_workspace.replies = [(500, {"message": "x" * 295 + key + quote(key, safe="")}, {})]
    assert main(ARGS + ["--refresh", "--format", "json"]) == 1
    failed = capsys.readouterr()
    for text in (successful.out, successful.err, failed.out, failed.err, caplog.text):
        assert key not in text and quote(key, safe="") not in text
    # Le clone, la base, le registre et les métadonnées de cache sont tous sous ATLAS_DATA_DIR.
    for path in space.parents[2].rglob("*"):
        if path.is_file():
            assert key.encode() not in path.read_bytes()
    if source == "env":
        assert all(key not in value for value in keyring_vault._memory._items.values())
