"""Comparaisons chiffrées d'un espace du registre local : API et CLI (plan 0009).

Par défaut, chaque déclinaison s'exécute sur le point d'accès de son entité, avec mes
identifiants (plan 0008). `ATLAS_COMPARE_DATA=<dossier>` fait tout tourner en local
dans DuckDB, sur des fichiers : tests et démonstrations seulement.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path

from .. import connections
from ..compile import load_calendars
from ..connectors.base import QueryResult
from ..governance.model import DEFAULT_TOLERANCE
from ..index import ensure_index
from ..index.build import analyze
from ..model.resolve import resolve
from ..repo.git import RepoError
from ..repo.layout import read_governance
from ..workspaces import get_workspace, index_path, repo_dir
from . import orchestrate, store
from .orchestrate import CompareRequest, LocalRunner, Prepared, Runner, VariantPlan


def _workspace(workspace_id: str):
    workspace = get_workspace(workspace_id)
    if workspace is None:
        raise RepoError("not_found", f"Espace « {workspace_id} » inconnu.")
    return workspace


def local_data() -> Path | None:
    value = os.environ.get("ATLAS_COMPARE_DATA")
    return Path(value) if value else None


def prepare_in(root: Path, request: CompareRequest, workspace_id: str | None,
               local: bool) -> Prepared:
    """Prépare depuis un arbre de documents ; en exécution locale, aucun point d'accès."""
    governance = read_governance(root)
    tolerance = governance.tolerance_percent if governance else DEFAULT_TOLERANCE
    if local:
        return orchestrate.prepare(analyze(root), load_calendars(root / "calendars"),
                                   tolerance, request, lambda *_: None, lambda _: "duckdb")
    points = connections.registry(workspace_id)

    def choose(entity: str, platform: str, wanted: str | None) -> str:
        if wanted is not None:
            point = connections.access_point(workspace_id, wanted)
            if point.platform != platform:
                raise RepoError("access_point_mismatch", f"« {wanted} » est sur "
                                f"{point.platform}, les sources de « {entity} » sur {platform}.")
            return point.id
        found = [p for p in points.access_points
                 if p.entity == entity and p.platform == platform]
        if not found:
            raise RepoError("no_access_point", f"Aucun point d'accès {platform} déclaré pour "
                            f"l'entité « {entity} ».")
        if len(found) > 1:
            raise RepoError("ambiguous_access_point", f"Plusieurs points d'accès {platform} "
                            f"pour « {entity} » ({', '.join(p.id for p in found)}) : en "
                            "choisir un (access_points).")
        return connections.access_point(workspace_id, found[0].id).id

    def dialect(platform: str) -> str:
        if platform not in connections.SUPPORTED_PLATFORMS:
            raise RepoError("platform_not_supported", f"Pas encore de connecteur pour "
                            f"« {platform} ».")
        return platform

    return orchestrate.prepare(analyze(root), load_calendars(root / "calendars"), tolerance,
                               request, choose, dialect)


def missing_access(workspace_id: str, prepared: Prepared) -> list[dict]:
    """Points d'accès de la comparaison sans accès utilisable pour moi."""
    missing = []
    for point in sorted({p.access_point for p in prepared.plans if p.access_point}):
        try:
            connections.ensure_usable(workspace_id, point)
        except RepoError as error:
            if error.code not in ("not_connected", "access_expired"):
                raise
            missing.append({"access_point": point, "code": error.code,
                            "message": error.message})
    return missing


def check_access(workspace_id: str, prepared: Prepared) -> None:
    """Un accès utilisable pour chaque point d'accès, sinon `needs_auth` : rien ne part."""
    missing = missing_access(workspace_id, prepared)
    if missing:
        raise RepoError("needs_auth", "Se connecter d'abord à : "
                        f"{', '.join(m['access_point'] for m in missing)}.", missing)


def remote_runner(workspace_id: str) -> Runner:
    def run(plan: VariantPlan, compiled, cancel: threading.Event) -> QueryResult:
        return connections.run_aggregate(workspace_id, plan.access_point, compiled.sql,
                                         cancel=cancel)
    return run


def start_comparison(workspace_id: str, request: CompareRequest,
                     runner: Runner | None = None, wait: bool = False) -> dict:
    workspace = _workspace(workspace_id)
    data = local_data()
    prepared = prepare_in(repo_dir(workspace_id), request, workspace_id, data is not None)
    if data is None:
        check_access(workspace_id, prepared)
    runner = runner or (LocalRunner(data) if data is not None else remote_runner(workspace_id))
    started = orchestrate.start(index_path(workspace_id), workspace.account or None, prepared,
                                runner, wait)
    return {"id": started.number, "status": "running", "alerts": prepared.alerts()}


def _subsets(dimensions: list[str]) -> list[list[str]]:
    """Granularités proposées : les dimensions du scope, puis chaque sous-ensemble non
    vide, dans l'ordre du scope (« Mois × pays », « Mois », « Pays »)."""
    count = len(dimensions)
    found = [[d for i, d in enumerate(dimensions) if mask >> (count - 1 - i) & 1]
             for mask in range(2 ** count - 1, 0, -1)]
    return sorted(found, key=len, reverse=True)


def comparison_setup(workspace_id: str, kpi_id: str) -> dict:
    """Ce que le panneau de lancement (10.5) propose pour un KPI : déclinaisons avec leur
    plateforme, scopes déclarés et granularités, tolérances du KPI et de l'espace."""
    _workspace(workspace_id)
    root = repo_dir(workspace_id)
    analysis = analyze(root)
    entry = analysis.entry(kpi_id)
    if entry is None or entry.file.kind != "kpi" or entry.document is None:
        raise RepoError("not_found", f"KPI « {kpi_id} » introuvable.")
    kpi = entry.document
    governance = read_governance(root)
    local = local_data() is not None
    first_scope = kpi.scopes[0].id if kpi.scopes else None
    variants = []
    for found in analysis.entries:
        document = found.document
        if document is None or document.kind != "variant" or document.variant_of.id != kpi_id:
            continue
        platform, unavailable = None, None
        outdated = document.variant_of.version != kpi.data_product.version
        if outdated:
            unavailable = (f"Déclinaison de la v{document.variant_of.version} du KPI, "
                           f"canonique en v{kpi.data_product.version}.")
        else:
            resolved = resolve(document, kpi, analysis.library)
            try:
                if not resolved.valid:
                    raise RepoError("invalid", "La déclinaison ne se résout pas sur le canonique.")
                platform = orchestrate._platform(resolved.document, document.entity)
                # Préparée seule, comme au lancement : une déclinaison qui ne se compare pas
                # n'est pas cochée et dit pourquoi, au lieu de bloquer les autres.
                prepare_in(root, CompareRequest(kpi_id=kpi_id, variants=[document.entity],
                                                scope_id=first_scope),
                           workspace_id, local)
            except RepoError as error:
                unavailable = error.message
        variants.append({
            "entity": document.entity, "variant_id": document.data_product.id, "mode": document.mode,
            "version": document.data_product.version, "platform": platform,
            "outdated": outdated, "unavailable": unavailable})
    output = orchestrate._output_group_by(kpi)
    scopes = []
    for scope in kpi.scopes or []:
        dimensions = list(scope.granularity or output)
        scopes.append({**scope.model_dump(mode="json", by_alias=True, exclude_none=True),
                       "granularity": dimensions, "granularities": _subsets(dimensions)})
    return {
        "kpi_id": kpi_id, "label": kpi.label, "version": kpi.data_product.version,
        "variants": sorted(variants, key=lambda v: v["entity"]),
        "scopes": scopes,
        "tolerance": {"kpi": kpi.tolerance.percent if kpi.tolerance else None,
                      "workspace": governance.tolerance_percent if governance
                      else DEFAULT_TOLERANCE},
        "local": local,
    }


def preview_comparison(workspace_id: str, request: CompareRequest) -> dict:
    """La préparation seule, sans rien exécuter : alertes (bypass de cardinalité, surcharge
    hors points déclarés), plateforme et point d'accès de chaque déclinaison, accès qui
    manquent. Une erreur de préparation répond comme le lancement."""
    _workspace(workspace_id)
    data = local_data()
    prepared = prepare_in(repo_dir(workspace_id), request, workspace_id, data is not None)
    return {
        "alerts": prepared.alerts(),
        "plans": [{"entity": p.entity, "platform": p.platform, "access_point": p.access_point}
                  for p in prepared.plans],
        "tolerance": prepared.tolerance,
        "granularity": prepared.granularity,
        "missing_access": [] if data is not None else missing_access(workspace_id, prepared),
    }


def get_comparison(workspace_id: str, number: int) -> dict:
    _workspace(workspace_id)
    db = index_path(workspace_id)
    # Le job avant la base : `finish` est validé avant que le job quitte le registre, donc
    # un job déjà absent ici avec une ligne encore « running » a vraiment été interrompu.
    running = orchestrate.job(db, number)
    found = store.get(db, number)
    if found is None:
        raise RepoError("not_found", f"Comparaison {number} introuvable.")
    found["progress"] = None
    if found["status"] == "running":
        if running is None:
            found["status"] = "interrupted"  # le processus s'est arrêté pendant l'exécution
        else:
            found["progress"] = running.snapshot()
            found["alerts"] = running.prepared.alerts()
    return found


def cancel_comparison(workspace_id: str, number: int) -> dict:
    _workspace(workspace_id)
    running = orchestrate.job(index_path(workspace_id), number)
    if running is None:
        get_comparison(workspace_id, number)  # 404 si elle n'existe pas
        raise RepoError("not_running", f"La comparaison {number} n'est plus en cours.")
    running.cancel.set()
    return {"id": number, "status": "cancelling"}


def list_comparisons(workspace_id: str, kpi_id: str | None = None, limit: int = 50) -> list:
    _workspace(workspace_id)
    return store.history(index_path(workspace_id), kpi_id, limit)


def comparison_matrix(workspace_id: str, domain: str | None = None) -> list[dict]:
    _workspace(workspace_id)
    connection = ensure_index(repo_dir(workspace_id), index_path(workspace_id))
    try:
        rows = store.matrix(connection, domain)
    finally:
        connection.close()
    governance = read_governance(repo_dir(workspace_id))
    labels = {d.id: d.label for d in governance.domains} if governance else {}
    for row in rows:
        row["domain_label"] = labels.get(row["domain"])
    return rows
