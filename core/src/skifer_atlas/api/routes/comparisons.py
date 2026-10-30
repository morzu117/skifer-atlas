"""Comparaisons chiffrées d'un espace (plan 0009).

La comparaison démarre en tâche de fond : `POST` rend son identifiant, `GET …/{id}`
donne la progression par plateforme, puis les résultats.
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from ...compare import (
    CompareRequest,
    cancel_comparison,
    comparison_matrix,
    get_comparison,
    list_comparisons,
    start_comparison,
)

router = APIRouter(prefix="/api/workspaces/{ws}/comparisons")


@router.post("", status_code=202)
def post_comparison(ws: str, request: CompareRequest) -> dict:
    return start_comparison(ws, request)


@router.get("")
def get_comparisons(ws: str, kpi: str | None = None,
                    limit: int = Query(default=50, ge=1, le=500)) -> list[dict]:
    return list_comparisons(ws, kpi, limit)


@router.get("/matrix")
def get_matrix(ws: str, domain: str | None = None) -> list[dict]:
    return comparison_matrix(ws, domain)


@router.get("/{number}")
def get_one(ws: str, number: int) -> dict:
    return get_comparison(ws, number)


@router.post("/{number}/cancel")
def post_cancel(ws: str, number: int) -> dict:
    return cancel_comparison(ws, number)
