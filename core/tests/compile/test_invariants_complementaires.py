"""Stabilité de compilation et erreurs de restriction des périodes."""

from datetime import date

import pytest
from compile_support import nordis_revenue
from hypothesis import given
from hypothesis import strategies as st

from skifer_atlas.compile import DIALECTS, CompileError, Scope, compile_document, parse_calendar
from skifer_atlas.compile.scope import period_bounds


@given(st.sampled_from(DIALECTS))
def test_compilation_repetee_donne_exactement_le_meme_sql(dialecte):
    document, calendriers = nordis_revenue()
    premier = compile_document(document, dialecte, calendars=calendriers).sql
    second = compile_document(document, dialecte, calendars=calendriers).sql
    assert premier == second
    assert "WITH n01 AS" in premier


@pytest.mark.parametrize(("periode", "code", "message"), [
    ("2024-13-01..2024-12-31", "scope_invalid_period", "bornes"),
    ("2024-12-31..2024-01-01", "scope_invalid_period", "fin précède"),
    ("janvier", "scope_unknown_period", "calendrier civil"),
])
def test_scope_explique_une_periode_invalide(periode, code, message):
    with pytest.raises(CompileError) as erreur:
        period_bounds(Scope(period=periode), None, "civil")
    [issue] = erreur.value.issues
    assert issue.code == code and message in issue.message


def test_scope_resout_une_periode_nommee_ou_des_bornes_incluses():
    calendrier = parse_calendar(
        "key: fiscal\nversion: 1\nperiods:\n"
        "  - {name: P1, start: 2024-01-01, end: 2024-01-28}\n"
    )
    attendu = (date(2024, 1, 1), date(2024, 1, 28))
    assert period_bounds(Scope(period="P1"), calendrier, "fiscal") == attendu
    assert period_bounds(Scope(period=" 2024-01-01 .. 2024-01-28 "), None, "civil") == attendu
    with pytest.raises(CompileError, match="calendrier « fiscal » ne la connaît pas"):
        period_bounds(Scope(period="P2"), calendrier, "fiscal")
