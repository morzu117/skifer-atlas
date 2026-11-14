"""Un verrou non bloquant indique l'occupation et reste disponible après une erreur."""

import threading

import pytest

from skifer_atlas.filelock import LockTimeout, file_lock, file_lock_if_free


def test_verrou_occupe_puis_libere_apres_une_exception(tmp_path):
    chemin = tmp_path / "verrous" / "atlas.lock"
    pris, liberer = threading.Event(), threading.Event()
    erreurs = []

    def detenir():
        try:
            with file_lock(chemin, 1):
                pris.set()
                if not liberer.wait(5):
                    erreurs.append("délai de libération dépassé")
        except Exception as erreur:  # noqa: BLE001
            erreurs.append(erreur)

    thread = threading.Thread(target=detenir)
    thread.start()
    try:
        assert pris.wait(5)
        with file_lock_if_free(chemin) as libre:
            assert libre is False
        with pytest.raises(LockTimeout), file_lock(chemin, 0):
            pytest.fail("le verrou occupé a été obtenu")
    finally:
        liberer.set()
        thread.join(5)
    assert not thread.is_alive() and erreurs == []
    with pytest.raises(ValueError, match="échec métier"), file_lock(chemin, 1):
        raise ValueError("échec métier")
    with file_lock_if_free(chemin) as libre:
        assert libre is True
    assert chemin.exists() and chemin.read_bytes() == b""
