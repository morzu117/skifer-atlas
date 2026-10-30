"""Préparer puis exécuter une comparaison chiffrée (plan 0009, ADR 0012).

**Préparation**, sans rien exécuter : pour chaque déclinaison, résolution sur le
canonique, rebranchement du canonique sur ses sources, choix du point d'accès,
compilation des deux graphes dans le dialecte de la plateforme avec le scope, diff
structurel. Toute erreur arrête là : aucune exécution partielle.

**Exécution** : une file par plateforme, les plateformes en parallèle ; chaque
déclinaison exécute le canonique rebranché, puis son propre graphe. Les résultats
rapatriés restent en mémoire ; seules les cellules réconciliées sont enregistrées.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import duckdb
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..compile import Compiled, CompileError, NotCompilable, Scope, compile_document
from ..compile.scope import apply_granularity, output_aggregate
from ..connectors.base import MAX_ROWS, QueryResult
from ..diff import DiffContext, diff
from ..index.build import Analysis
from ..model.columns import propagate
from ..model.document import KpiDocument, KpiScope
from ..model.errors import issues_from_validation_error
from ..model.graph import GraphView
from ..model.resolve import ResolvedGraph, resolve
from ..repo.git import RepoError
from ..run import MissingData, open_database
from . import store
from .rebind import rebind
from .reconcile import Cell, divergent_node, keyed, reconcile, summarize, target_of

SIDES = ("canonical", "variant")


class CompareRequest(BaseModel):
    """Corps de `POST …/comparisons` ; `variants` désigne des entités."""

    model_config = ConfigDict(extra="forbid")

    kpi_id: str
    variants: list[str] = Field(min_length=1)
    scope_id: str | None = None
    scope: dict | None = None
    tolerance: float | None = Field(default=None, ge=0, le=100)
    access_points: dict[str, str] = Field(default_factory=dict)  # entité → point d'accès


@dataclass
class Side:
    compiled: Compiled
    dims: list[str]  # colonnes de sortie, dans l'ordre de la granularité
    value: str


@dataclass
class VariantPlan:
    variant_id: str
    entity: str
    version: int
    mode: str
    platform: str
    access_point: str | None
    canonical: Side
    variant: Side
    differences: list[dict]
    divergent: dict | None
    bypass: list[str]

    def alerts(self) -> list[dict]:
        found = []
        if self.bypass:
            found.append({"code": "cardinality_bypass", "entity": self.entity,
                          "nodes": self.bypass,
                          "message": f"{self.entity} : contrôle de cardinalité contourné "
                                     f"({', '.join(self.bypass)})."})
        undeclared = [target_of(d) for d in self.differences
                      if d["classification"] == "override_undeclared"]
        if undeclared:
            found.append({"code": "undeclared_override", "entity": self.entity,
                          "nodes": undeclared,
                          "message": f"{self.entity} surcharge {', '.join(undeclared)} hors des "
                                     "points de variation déclarés : l'écart sera signalé."})
        return found


@dataclass
class Prepared:
    kpi: KpiDocument
    scope: KpiScope
    granularity: list[str]
    tolerance: float
    plans: list[VariantPlan]

    def scope_dict(self) -> dict:
        found = self.scope.model_dump(mode="json", by_alias=True, exclude_none=True)
        found["granularity"] = self.granularity
        return found

    def alerts(self) -> list[dict]:
        return [alert for plan in self.plans for alert in plan.alerts()]


# --- préparation ---------------------------------------------------------------------------

def _scope(kpi: KpiDocument, request: CompareRequest) -> KpiScope:
    if request.scope_id is not None and request.scope is not None:
        raise RepoError("invalid_scope", "Donner scope_id ou scope, pas les deux.")
    if request.scope_id is not None:
        found = kpi.scope(request.scope_id)
        if found is None:
            raise RepoError("unknown_scope", f"Le KPI « {kpi.data_product.id} » ne déclare "
                            f"pas de scope « {request.scope_id} ».")
        return found
    if request.scope is None:
        raise RepoError("scope_required", "Choisir un scope déclaré avec le KPI (scope_id) "
                        "ou en donner un (scope).")
    raw = {"id": "ad-hoc", **request.scope}
    try:
        return KpiScope.model_validate(raw)
    except ValidationError as error:
        raise RepoError("invalid_scope", "Scope invalide.", [
            i.to_dict() for i in issues_from_validation_error(error, raw)]) from None


def _output_group_by(document: Any) -> list[str]:
    view = GraphView(document.graph)
    node = view.by_id[output_aggregate(view)]
    return list(node.group_by if node.type == "aggregate" else node.aggregate.group_by)


def _side(document: Any, dialect: str, scope: Scope, analysis: Analysis, calendars: dict,
          renames: dict | None, what: str) -> Side:
    try:
        compiled = compile_document(document, dialect, scope, analysis.library, calendars,
                                    renames)
    except CompileError as error:
        raise RepoError("not_compilable", f"{what} ne se compile pas.",
                        [i.to_dict() for i in error.issues]) from None
    except NotCompilable as error:
        raise RepoError("not_compilable", f"{what} ne se compile pas en {dialect} : "
                        f"{error.node_id}, {error.reason}.") from None
    rewritten = apply_granularity(document, scope, analysis.library)
    dims = _output_group_by(rewritten)
    schemas, _ = propagate(rewritten, analysis.library)
    values = [c for c in schemas[rewritten.graph.output] or {} if c not in dims]
    if len(values) != 1:
        raise RepoError("ambiguous_measure", f"{what} : la sortie doit porter une seule "
                        f"mesure hors dimensions ({', '.join(values) or 'aucune'}).")
    return Side(compiled, dims, values[0])


def _platform(document: Any, entity: str) -> str:
    platforms = {n.platform for n in document.graph.nodes if n.type == "source"}
    if len(platforms) != 1:
        raise RepoError("mixed_platforms", f"Les sources de « {entity} » doivent être sur une "
                        f"seule plateforme ({', '.join(sorted(platforms)) or 'aucune'}).")
    return platforms.pop()


AccessPointChooser = Callable[[str, str, str | None], str | None]
"""(entité, plateforme, point demandé) → point d'accès ; None en exécution locale."""


def prepare(analysis: Analysis, calendars: dict, governance_tolerance: float,
            request: CompareRequest, choose: AccessPointChooser, dialect_for: Callable[
                [str], str]) -> Prepared:
    entry = analysis.entry(request.kpi_id)
    if entry is None or entry.file.kind != "kpi":
        raise RepoError("not_found", f"KPI « {request.kpi_id} » introuvable.")
    kpi = entry.document
    if kpi is None or any(i.severity == "error" for i in entry.issues):
        raise RepoError("invalid_document", f"Le KPI « {request.kpi_id} » a des erreurs : "
                        "le corriger avant de comparer.",
                        [i.to_dict() for i in entry.issues if i.severity == "error"])
    declared = _scope(kpi, request)
    granularity = list(declared.granularity or _output_group_by(kpi))
    scope = Scope(declared.period.text() if declared.period else None,
                  tuple(declared.perimeter or ()), tuple(granularity))
    tolerance = next(t for t in (request.tolerance,
                                 kpi.tolerance.percent if kpi.tolerance else None,
                                 governance_tolerance) if t is not None)
    plans = []
    for entity in dict.fromkeys(request.variants):
        variant_id = f"{kpi.data_product.id}--{entity}"
        found = analysis.entry(variant_id)
        if found is None or found.file.kind != "variant":
            raise RepoError("not_found", f"Pas de déclinaison « {entity} » pour "
                            f"« {kpi.data_product.id} ».")
        variant = found.document
        if variant is None:
            raise RepoError("invalid_document", f"La déclinaison « {entity} » a des erreurs.",
                            [i.to_dict() for i in found.issues if i.severity == "error"])
        if variant.variant_of.version != kpi.data_product.version:
            raise RepoError("variant_outdated", f"La déclinaison « {entity} » porte sur "
                            f"v{variant.variant_of.version} ; le canonique est en "
                            f"v{kpi.data_product.version}.")
        resolved = resolve(variant, kpi, analysis.library)
        if not resolved.valid:
            raise RepoError("invalid_document", f"La déclinaison « {entity} » ne se résout "
                            "pas.", [i.to_dict() for i in resolved.issues
                                     if i.severity == "error"])
        platform = _platform(resolved.document, entity)
        access_point = choose(entity, platform, request.access_points.get(entity))
        dialect = dialect_for(platform)
        rebound = rebind(kpi, resolved, analysis.library)
        canonical = _side(rebound.document, dialect, scope, analysis, calendars,
                          rebound.renames, f"Le canonique rebranché sur « {entity} »")
        own = _side(resolved.document, dialect, scope, analysis, calendars, None,
                    f"La déclinaison « {entity} »")
        report = diff(ResolvedGraph(kpi), resolved, DiffContext(variant.mode,
                                                                analysis.library))
        differences = [d.model_dump(mode="json") for d in report.differences]
        plans.append(VariantPlan(
            variant_id, entity, variant.data_product.version, variant.mode, platform,
            access_point, canonical, own, differences, divergent_node(differences),
            sorted(set(canonical.compiled.bypassed) | set(own.compiled.bypassed))))
    return Prepared(kpi, declared, granularity, tolerance, plans)


# --- exécution -----------------------------------------------------------------------------

Runner = Callable[[VariantPlan, Compiled, threading.Event], QueryResult]


class LocalRunner:
    """Toutes les « plateformes » en DuckDB, sur des fichiers : `<données>/<entité>/` si ce
    dossier existe, sinon `<données>/` (plan 0007 pour le format)."""

    def __init__(self, data: Path, max_rows: int = MAX_ROWS):
        self.data = data
        self.max_rows = max_rows

    def __call__(self, plan: VariantPlan, compiled: Compiled,
                 cancel: threading.Event) -> QueryResult:
        folder = self.data / plan.entity
        try:
            connection = open_database(compiled.sources,
                                       folder if folder.is_dir() else self.data)
        except MissingData as error:
            raise RepoError("missing_data", str(error)) from None
        stop = threading.Event()

        def watch() -> None:
            while not stop.wait(0.02):
                if cancel.is_set():
                    connection.interrupt()
                    return

        watcher = threading.Thread(target=watch, daemon=True)
        watcher.start()
        try:
            cursor = connection.execute(compiled.sql)
            rows = cursor.fetchmany(self.max_rows + 1)
            if len(rows) > self.max_rows:
                raise RepoError("result_too_large", f"Le résultat dépasse {self.max_rows} "
                                "lignes.")
            return QueryResult([d[0] for d in cursor.description],
                               [str(d[1]).lower() for d in cursor.description], rows)
        except duckdb.InterruptException:
            raise RepoError("query_canceled", "Requête annulée.") from None
        except duckdb.Error as error:
            raise RepoError("query_failed", f"Échec de la requête : {error}") from None
        finally:
            stop.set()
            connection.close()


@dataclass
class Job:
    number: int
    db: Path
    prepared: Prepared
    cancel: threading.Event = field(default_factory=threading.Event)
    progress: dict[str, dict] = field(default_factory=dict)

    def snapshot(self) -> list[dict]:
        return [{"platform": p["platform"], "entities": p["entities"], "state": p["state"],
                 "percent": round(100 * p["done"] / p["total"]) if p["total"] else 100}
                for p in self.progress.values()]


_jobs: dict[tuple[str, int], Job] = {}
_jobs_lock = threading.Lock()


def job(db: Path, number: int) -> Job | None:
    with _jobs_lock:
        return _jobs.get((str(db), number))


def _position(columns: list[str], name: str) -> int:
    lowered = [c.lower() for c in columns]  # Snowflake rend les noms en majuscules
    if name.lower() not in lowered:
        raise RepoError("query_failed", f"Colonne « {name} » absente du résultat.")
    return lowered.index(name.lower())


def _keyed(result: QueryResult, side: Side, what: str) -> dict:
    return keyed(result.rows, [_position(result.columns, d) for d in side.dims],
                 _position(result.columns, side.value), what)


def _execute(job: Job, runner: Runner) -> None:
    prepared = job.prepared
    groups: dict[str, list[VariantPlan]] = {}
    for plan in prepared.plans:
        groups.setdefault(plan.platform, []).append(plan)
    for platform, plans in groups.items():
        job.progress[platform] = {"platform": platform, "entities": [p.entity for p in plans],
                                  "state": "pending", "done": 0, "total": 2 * len(plans)}
    fetched: dict[tuple[str, str], QueryResult] = {}
    runs: list[dict] = []

    def work(platform: str) -> None:
        progress = job.progress[platform]
        progress["state"] = "running"
        for plan in groups[platform]:
            failed = False  # le canonique en échec : inutile d'exécuter la déclinaison
            for side in SIDES:
                compiled = getattr(plan, side).compiled
                run = {"variant_id": plan.variant_id, "side": side, "platform": platform,
                       "access_point": plan.access_point, "sql_text": compiled.sql,
                       "sql_sha256": hashlib.sha256(compiled.sql.encode()).hexdigest(),
                       "started_at": None, "finished_at": None, "status": "skipped",
                       "error": None, "row_count": None}
                runs.append(run)
                if not (job.cancel.is_set() or failed):
                    run["started_at"] = store.now()
                    try:
                        result = runner(plan, compiled, job.cancel)
                    except RepoError as error:
                        canceled = job.cancel.is_set() or error.code == "query_canceled"
                        run["status"] = "cancelled" if canceled else "failed"
                        run["error"] = f"{error.code}: {error.message}"
                        failed = True
                    else:
                        run["status"], run["row_count"] = "done", len(result.rows)
                        fetched[(plan.variant_id, side)] = result
                    run["finished_at"] = store.now()
                progress["done"] += 1
        mine = [r for r in runs if r["platform"] == platform]
        progress["state"] = "cancelled" if job.cancel.is_set() else (
            "failed" if any(r["status"] == "failed" for r in mine) else "done")

    with ThreadPoolExecutor(max_workers=len(groups)) as pool:
        list(pool.map(work, groups))

    cells: list[tuple] = []
    summaries: list[dict] = []
    errors = [r["error"] for r in runs if r["status"] == "failed"]
    if not job.cancel.is_set():
        for plan in prepared.plans:
            canonical = fetched.get((plan.variant_id, "canonical"))
            variant = fetched.get((plan.variant_id, "variant"))
            if canonical is None or variant is None:
                continue
            try:
                found = reconcile(prepared.granularity,
                                  _keyed(canonical, plan.canonical, "du canonique"),
                                  _keyed(variant, plan.variant, f"de « {plan.entity} »"),
                                  prepared.tolerance)
            except RepoError as error:
                errors.append(f"{error.code}: {error.message}")
                continue
            cells.extend(_cell_row(plan, cell) for cell in found)
            summary = summarize(found)
            summaries.append({
                "variant_id": plan.variant_id, "entity": plan.entity,
                "variant_version": plan.version, "platform": plan.platform,
                "access_point": plan.access_point, "cell_count": summary.cell_count,
                "validation_pct": summary.validation_pct, "max_gap_pct": summary.max_gap_pct,
                "divergent_node": (plan.divergent or {}).get("node_id"),
                "divergent": plan.divergent, "bypass_nodes": plan.bypass,
                "differences": plan.differences})
    if job.cancel.is_set():
        status = "cancelled"
    elif len(summaries) == len(prepared.plans):
        status = "done"
    else:
        status = "partial" if summaries else "failed"
    store.finish(job.db, job.number, status, errors[0] if errors else None, runs, cells,
                 summaries)


def _cell_row(plan: VariantPlan, cell: Cell) -> tuple:
    return (plan.variant_id, json.dumps(cell.dims, ensure_ascii=False),
            cell.canonical, cell.variant, cell.gap_pct, cell.within, cell.missing)


def _guarded(job: Job, runner: Runner) -> None:
    try:
        _execute(job, runner)
    except Exception as error:  # noqa: BLE001 — la comparaison ne reste jamais « running »
        store.finish(job.db, job.number, "failed", f"internal_error: {error}", [], [], [])
    finally:
        with _jobs_lock:
            _jobs.pop((str(job.db), job.number), None)


def start(db: Path, account: str | None, prepared: Prepared, runner: Runner,
          wait: bool = False) -> Job:
    """Enregistre la comparaison (`running`) puis l'exécute, en tâche de fond par défaut."""
    number = store.create(db, account, prepared.kpi.data_product.id,
                          prepared.kpi.data_product.version, prepared.scope_dict(),
                          prepared.tolerance)
    current = Job(number, db, prepared)
    with _jobs_lock:
        _jobs[(str(db), number)] = current
    if wait:
        _guarded(current, runner)
    else:
        threading.Thread(target=_guarded, args=(current, runner), daemon=True,
                         name=f"comparison-{number}").start()
    return current
