"""Le verrou d'un clone entre processus, l'ordre des verrous et le clone orphelin (ADR 0039).

Pas de `monkeypatch.undo()` : il défait aussi `ATLAS_DATA_DIR` et `ATLAS_VAULT` des fixtures, et
le test écrirait dans le vrai dossier de données et le trousseau.
"""

import os
import subprocess
import sys
import threading
import time
from contextlib import contextmanager

import pytest
from workspace_helpers import atlas_env, git, remote

from skifer_atlas import workspaces
from skifer_atlas.paths import workspace_dir
from skifer_atlas.repo import RepoError
from skifer_atlas.repo import git as repo_git
from skifer_atlas.repo import sync as repo_sync
from skifer_atlas.repo.git import clone_lock, clone_lock_if_free, clone_lock_path
from skifer_atlas.repo.layout import WorkspaceMeta
from skifer_atlas.repo.sync import create_workspace, join_workspace
from skifer_atlas.workspaces import (
    Workspace,
    add_workspace,
    get_workspace,
    list_workspaces,
    repo_dir,
    update_workspace,
)

__all__ = ["atlas_env", "remote"]  # fixtures importées

# Un autre processus (la CLI, par exemple) tient le clone `sys.argv[1]` `sys.argv[2]` secondes.
HOLDER = """
import sys, time
from pathlib import Path
from skifer_atlas.repo.git import clone_lock
with clone_lock(Path(sys.argv[1])):
    print("tenu", flush=True)
    time.sleep(float(sys.argv[2]))
"""


@contextmanager
def held(repo, seconds):
    process = subprocess.Popen([sys.executable, "-c", HOLDER, str(repo), str(seconds)],
                               stdout=subprocess.PIPE, text=True, env=os.environ)
    try:
        assert process.stdout.readline().strip() == "tenu"
        yield process
    finally:
        process.kill()
        process.wait()


def test_the_lock_file_is_in_the_workspace_folder_outside_the_repository(atlas_env):
    create_workspace(WorkspaceMeta(id="groupe-nordis", name="Groupe Nordis"))
    repo = repo_dir("groupe-nordis")
    with clone_lock(repo):
        assert clone_lock_path(repo) == workspace_dir("groupe-nordis") / "repo.lock"
        assert clone_lock_path(repo).exists()
    assert git(repo, "status", "--porcelain") == ""  # l'arbre de travail reste propre


def test_another_process_excludes_the_clone_lock(atlas_env, perf_factor):
    repo = repo_dir("groupe-nordis")
    with held(repo, 0.8):
        started = time.monotonic()
        with clone_lock(repo):
            assert time.monotonic() - started > 0.3 / perf_factor
    with clone_lock_if_free(repo) as free:  # le second processus a fini : le clone est libre
        assert free is True


def test_the_clone_lock_if_free_does_not_wait_for_another_process(atlas_env, perf_factor):
    repo = repo_dir("groupe-nordis")
    with held(repo, 30):
        started = time.monotonic()
        with clone_lock_if_free(repo) as free:
            assert free is False
        assert time.monotonic() - started < 1 * perf_factor
        # Un autre clone n'est pas gêné.
        with clone_lock_if_free(repo_dir("maison-perrault")) as other:
            assert other is True


def test_a_clone_held_too_long_is_clone_busy(atlas_env, monkeypatch):
    monkeypatch.setattr(repo_git, "CLONE_WAIT_SECONDS", 0.3)
    repo = repo_dir("groupe-nordis")
    with held(repo, 30):
        with pytest.raises(RepoError) as error, clone_lock(repo):
            raise AssertionError("le clone est tenu par un autre processus")
        assert error.value.code == "clone_busy"
        assert "Réessayer" in error.value.message


def test_a_clone_left_by_a_dead_process_does_not_block(atlas_env, monkeypatch):
    monkeypatch.setattr(repo_git, "CLONE_WAIT_SECONDS", 2)
    repo = repo_dir("groupe-nordis")
    with held(repo, 30) as process:
        process.kill()
        process.wait()
    with clone_lock(repo):
        pass


def test_the_clone_lock_stays_reentrant_and_exclusive_between_threads(atlas_env):
    repo = repo_dir("groupe-nordis")
    outcomes = []
    with clone_lock(repo):
        with clone_lock(repo), clone_lock_if_free(repo) as free:
            assert free is True  # le thread qui tient le clone le retrouve

        def other_thread():
            with clone_lock_if_free(repo) as free:
                outcomes.append(free)

        thread = threading.Thread(target=other_thread)
        thread.start()
        thread.join()
    assert outcomes == [False]
    with clone_lock_if_free(repo) as free:
        assert free is True


def test_clone_then_registry_never_deadlocks(atlas_env):
    """L'ordre fixé par l'ADR 0039 : le clone, puis le registre. Des threads qui l'appliquent
    (synchronisation : verrou du clone, puis `update_workspace`) et d'autres qui n'ont besoin
    que du registre (`add_workspace`) finissent tous."""
    add_workspace(Workspace(id="groupe-nordis", name="Groupe Nordis"))
    repo = repo_dir("groupe-nordis")
    errors = []

    def syncing():
        try:
            for index in range(20):
                with clone_lock(repo):
                    update_workspace(Workspace(id="groupe-nordis", name="Groupe Nordis",
                                               synced_at=f"2026-11-06T10:{index:02d}"))
        except BaseException as error:  # noqa: BLE001
            errors.append(error)

    def adding(prefix):
        try:
            for index in range(20):
                add_workspace(Workspace(id=f"{prefix}-{index:02d}", name=prefix))
        except BaseException as error:  # noqa: BLE001
            errors.append(error)

    threads = [threading.Thread(target=syncing),
               threading.Thread(target=adding, args=("ajout-a",)),
               threading.Thread(target=adding, args=("ajout-b",))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(30)
    assert not any(thread.is_alive() for thread in threads)
    assert not errors
    assert len(list_workspaces()) == 41
    assert get_workspace("groupe-nordis").synced_at == "2026-11-06T10:19"


def test_the_registry_lock_does_not_take_any_clone_lock(atlas_env, monkeypatch):
    """Le registre est le dernier verrou de l'ordre : rien de ce qu'il fait ne prend un clone."""
    taken = []
    real = repo_git.file_lock
    with monkeypatch.context() as patched:
        patched.setattr(repo_git, "file_lock",
                        lambda *args, **kwargs: (taken.append(args), real(*args, **kwargs))[1])
        add_workspace(Workspace(id="groupe-nordis", name="Groupe Nordis"))
        update_workspace(Workspace(id="groupe-nordis", name="Autre"))
        list_workspaces()
    assert taken == []


def test_a_workspace_created_by_two_threads_exists_once_and_is_not_erased(atlas_env):
    meta = WorkspaceMeta(id="groupe-nordis", name="Groupe Nordis")
    outcomes = []

    def create():
        try:
            outcomes.append(create_workspace(meta))
        except RepoError as error:
            outcomes.append(error.code)

    threads = [threading.Thread(target=create) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(60)
    assert sorted(o for o in outcomes if isinstance(o, str)) == ["workspace_exists"] * 2
    assert (repo_dir("groupe-nordis") / "atlas.yaml").exists()
    assert [w.id for w in list_workspaces()] == ["groupe-nordis"]


@pytest.mark.parametrize("failure", [OSError("disque plein"),
                                     RepoError("registry_busy", "occupé")])
def test_the_clone_is_removed_when_the_registry_refuses_the_workspace(atlas_env, monkeypatch,
                                                                       failure):
    """#146 : un clone créé puis laissé orphelin ferait refuser toute nouvelle création."""
    def refuse(workspace):
        raise failure

    with monkeypatch.context() as patched:
        patched.setattr(repo_sync, "add_workspace", refuse)
        with pytest.raises(type(failure)):
            create_workspace(WorkspaceMeta(id="groupe-nordis", name="Groupe Nordis"))
    assert not repo_dir("groupe-nordis").exists()
    assert get_workspace("groupe-nordis") is None
    created = create_workspace(WorkspaceMeta(id="groupe-nordis", name="Groupe Nordis"))
    assert created.id == "groupe-nordis"
    assert workspaces.registry_path().exists()


# --- création et adhésion concurrentes du même identifiant (revue de 146) ------------------

IDENT = "groupe-nordis"  # l'identifiant de `atlas.yaml` du dépôt de la fixture `remote`


def _create():
    return create_workspace(WorkspaceMeta(id=IDENT, name="Création locale"))


def _outcome(operation):
    try:
        operation()
    except RepoError as error:
        return error.code
    return "ok"


def _assert_intact(winner):
    """Le dépôt de celle qui a réussi est là, enregistré, avec son contenu."""
    registered = get_workspace(IDENT)
    assert registered is not None and [w.id for w in list_workspaces()] == [IDENT]
    repo = repo_dir(IDENT)
    assert (repo / "atlas.yaml").exists() and (repo / "governance.yaml").exists()
    assert git(repo, "status", "--porcelain") == ""
    assert git(repo, "rev-parse", "HEAD").strip()
    if winner == "join":
        assert registered.git_remote and (repo / "kpis" / "revenu-net.yaml").exists()
    else:
        assert not registered.git_remote and registered.name == "Création locale"


@pytest.mark.parametrize("first", ["create", "join"])
def test_a_concurrent_create_and_join_of_one_identifier_keep_the_winner(remote, monkeypatch,
                                                                         first):
    """Le premier est arrêté juste avant `add_workspace`, après avoir posé son dossier ; le
    second doit attendre le verrou du clone, puis échouer proprement. Sans verrou dans
    `join_workspace`, la création échouait à `add_workspace` et supprimait le dépôt rejoint."""
    bare, _ = remote
    operations = {"create": _create, "join": lambda: join_workspace(str(bare))}
    second = "join" if first == "create" else "create"
    inside, go = threading.Event(), threading.Event()
    real_add = repo_sync.add_workspace
    paused = []

    def pausing_add(workspace):
        if not paused:  # seul le premier appelant s'arrête
            paused.append(workspace.id)
            inside.set()
            assert go.wait(30)
        return real_add(workspace)

    outcomes = {}

    def run(name):
        outcomes[name] = _outcome(operations[name])

    with monkeypatch.context() as patched:
        patched.setattr(repo_sync, "add_workspace", pausing_add)
        winner = threading.Thread(target=run, args=(first,))
        winner.start()
        assert inside.wait(30)
        loser = threading.Thread(target=run, args=(second,))
        loser.start()
        loser.join(1.5)
        assert loser.is_alive()  # il attend le verrou du clone
        assert get_workspace(IDENT) is None
        go.set()
        winner.join(30)
        loser.join(30)
    assert not winner.is_alive() and not loser.is_alive()
    assert outcomes == {first: "ok", second: "workspace_exists"}
    _assert_intact(first)


# Un autre processus (la CLI) crée ou rejoint, et s'arrête avant `add_workspace` jusqu'à ce
# qu'on lui écrive une ligne.
PROCESS = """
import sys
from skifer_atlas.repo import sync
from skifer_atlas.repo.git import RepoError
from skifer_atlas.repo.layout import WorkspaceMeta
real = sync.add_workspace
def paused(workspace):
    print("inside", flush=True)
    sys.stdin.readline()
    return real(workspace)
sync.add_workspace = paused
try:
    if sys.argv[1] == "create":
        sync.create_workspace(WorkspaceMeta(id=sys.argv[2], name="Création locale"))
    else:
        sync.join_workspace(sys.argv[3])
except RepoError as error:
    print(error.code, flush=True)
else:
    print("ok", flush=True)
"""


@pytest.mark.parametrize("first", ["create", "join"])
def test_a_create_and_a_join_in_two_processes_keep_the_winner(remote, monkeypatch, first):
    bare, _ = remote
    monkeypatch.setenv("ATLAS_VAULT", "memory")
    child = subprocess.Popen([sys.executable, "-c", PROCESS, first, IDENT, str(bare)],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
                             env=os.environ)
    outcomes = {}
    try:
        assert child.stdout.readline().strip() == "inside"
        operation = (lambda: join_workspace(str(bare))) if first == "create" else _create
        second = "join" if first == "create" else "create"
        thread = threading.Thread(target=lambda: outcomes.update({second: _outcome(operation)}))
        thread.start()
        thread.join(1.5)
        assert thread.is_alive()  # l'autre processus tient le clone
        child.stdin.write("\n")
        child.stdin.flush()
        thread.join(30)
        outcomes[first] = child.stdout.readline().strip()
    finally:
        child.kill()
        child.wait()
    assert not thread.is_alive()
    assert outcomes == {first: "ok", second: "workspace_exists"}
    _assert_intact(first)


def test_a_failed_create_never_removes_a_folder_it_did_not_make(atlas_env, monkeypatch):
    """Le nettoyage ne supprime que le dossier posé par l'appel : si `mkdir` échoue parce que
    le dossier existe, il reste."""
    repo = repo_dir(IDENT)
    real_exists = type(repo).exists

    def hide(self):  # `_ensure_new` ne voit pas le dossier, `mkdir` le trouve
        return False if self == repo else real_exists(self)

    repo.mkdir(parents=True)
    (repo / "marqueur").write_text("à moi", encoding="utf-8")
    with monkeypatch.context() as patched:
        patched.setattr(type(repo), "exists", hide)
        with pytest.raises(FileExistsError):
            _create()
    assert (repo / "marqueur").read_text(encoding="utf-8") == "à moi"
