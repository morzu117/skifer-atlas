"""Régressions portables pour les comportements observés sous Windows."""

import errno
import os
import stat
import subprocess
import sys

import pytest

from skifer_atlas.files import remove_tree


def test_git_decodes_utf8_with_an_ascii_python_locale(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "-c", "user.name=Élodie", "-c",
                    "user.email=e@example.test", "commit", "--allow-empty", "-qm", "Création"],
                   check=True)
    code = ("from pathlib import Path; from skifer_atlas.repo.git import run_git; "
            "assert 'Cr\\u00e9ation' in run_git(['log', '-1', '--format=%s'], Path(__import__('sys').argv[1]))")
    # Le code passe par argv, décodé selon la locale : l'accent y est donc échappé.
    env = os.environ | {"PYTHONUTF8": "0", "LC_ALL": "C", "PYTHONIOENCODING": "ascii"}
    subprocess.run([sys.executable, "-c", code, str(tmp_path)], env=env, check=True)


def test_remove_tree_retries_read_only_files(tmp_path, monkeypatch):
    path = tmp_path / "object"
    path.write_text("git", encoding="utf-8")
    real_unlink = os.unlink
    attempts = []

    def deny_once(name, *args, **kwargs):
        if not attempts:
            attempts.append(name)
            raise PermissionError("read only")
        return real_unlink(name, *args, **kwargs)

    # Force the portable shutil implementation so the callback receives a full path.
    monkeypatch.setattr("shutil._use_fd_functions", False, raising=False)
    monkeypatch.setattr(os, "unlink", deny_once)
    path.chmod(stat.S_IREAD)
    remove_tree(tmp_path)
    assert attempts and not tmp_path.exists()


def test_remove_tree_propagates_other_errors(tmp_path, monkeypatch):
    (tmp_path / "object").write_text("git", encoding="utf-8")

    def fail(*args, **kwargs):
        raise OSError(errno.EIO, "disk error")

    monkeypatch.setattr(os, "unlink", fail)
    with pytest.raises(OSError, match="disk error"):
        remove_tree(tmp_path)


def test_remove_tree_accepts_a_missing_directory(tmp_path):
    remove_tree(tmp_path / "absent")


def test_remove_tree_uses_the_callback_supported_by_python(tmp_path, monkeypatch):
    from skifer_atlas import files

    calls = []

    def fake_rmtree(path, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(files.shutil, "rmtree", fake_rmtree)
    monkeypatch.setattr(files.sys, "version_info", (3, 12))
    remove_tree(tmp_path)
    monkeypatch.setattr(files.sys, "version_info", (3, 11))
    remove_tree(tmp_path)
    assert list(calls[0]) == ["onexc"]
    assert list(calls[1]) == ["onerror"]
    for callback, error in ((calls[0]["onexc"], OSError("erreur")),
                            (calls[1]["onerror"], (OSError, OSError("erreur"), None))):
        with pytest.raises(OSError, match="erreur"):
            callback(os.unlink, str(tmp_path / "missing"), error)
