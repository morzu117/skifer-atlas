"""Fixtures communes aux tests."""

import math
import os

import pytest


@pytest.fixture
def perf_factor():
    """Tolérance des seuils de durée, stricte par défaut en local."""
    factor = float(os.environ.get("ATLAS_PERF_FACTOR", "1"))
    if not math.isfinite(factor) or factor < 1:
        raise ValueError("ATLAS_PERF_FACTOR doit être un nombre fini supérieur ou égal à 1")
    return factor
