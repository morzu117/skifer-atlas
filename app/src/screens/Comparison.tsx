import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  api,
  ApiError,
  UnreachableError,
  type Comparison as Run,
  type ComparisonPreview,
  type ComparisonProgress,
  type ComparisonRequest,
  type ComparisonSetup,
  type HistoryEntry,
  type MatrixRow,
  type MissingAccess,
  type Workspace,
} from "../api";
import { Banner } from "../components/Banner";
import { Select } from "../components/Select";
import { openExternal } from "../external";
import { amount, dimension, gap, percent, tolerance } from "../format";
import { explain, type Explained } from "../messages";
import { href, setParams, type Params } from "../router";

// Comparaison (guide 10.5, plan 0015) : le panneau de lancement à gauche ; à droite le
// bandeau d'historique, la matrice des dernières comparaisons et le détail d'une cellule.
// Ce qui est ouvert vit dans l'adresse : `?kpi=…` (lancement), `?id=…&variant=…` (détail),
// `?domain=…` (matrice), `?vue=historique` (liste complète).

/** Seuils de couleur de la matrice, en % de cellules dans la tolérance (plan 0015, à valider). */
export const PASS_THRESHOLD = 99;
export const WARN_THRESHOLD = 90;

const PLATFORMS: Record<string, string> = { databricks: "Databricks", snowflake: "Snowflake", duckdb: "DuckDB" };
const DIMENSIONS: Record<string, string> = { mois_fiscal: "Mois fiscal", entite: "Entité", semaine: "Semaine", pays: "Pays" };
export const STATUSES: Record<string, string> = {
  running: "en cours",
  done: "terminée",
  partial: "partielle",
  failed: "en échec",
  cancelled: "annulée",
  interrupted: "interrompue",
};
const STATES: Record<string, string> = { pending: "En attente", running: "En cours", done: "Terminé", cancelled: "Annulé", failed: "Échec" };
const POLL_MS = 400;
const ALL = "tous";

type Load<T> = { kind: "loading" } | { kind: "ready"; value: T } | { kind: "error"; error: Explained };

/** `keep` : un rechargement garde la valeur affichée jusqu'à la suivante (la synthèse après
 * une comparaison, sans démonter le panneau de lancement qui en dépend). */
function useLoad<T>(load: () => Promise<T>, deps: unknown[], keep = false): Load<T> {
  const [state, setState] = useState<Load<T>>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    setState((previous) => (keep && previous.kind === "ready" ? previous : { kind: "loading" }));
    load()
      .then((value) => alive && setState({ kind: "ready", value }))
      .catch((reason) => {
        // Serveur injoignable : le bandeau de la coque suffit.
        if (alive && !(reason instanceof UnreachableError)) setState({ kind: "error", error: explain(reason) });
      });
    return () => {
      alive = false;
    };
  }, deps);
  return state;
}

const dimensionLabel = (name: string) => DIMENSIONS[name] ?? name;
const platformLabel = (name: string | null) => (name ? (PLATFORMS[name] ?? name) : "plateforme inconnue");

/** Teinte d'une cellule de la matrice d'après son % de validation. */
export function tone(validation: number | null | undefined): "pass" | "warn" | "bad" {
  if (validation === null || validation === undefined) return "bad";
  if (validation >= PASS_THRESHOLD) return "pass";
  return validation >= WARN_THRESHOLD ? "warn" : "bad";
}

/** Horodatage UTC du serveur (sans fuseau) → « 30/10/2026 14:05 », à l'heure du poste. */
function when(timestamp: string): string {
  const utc = /Z|[+-]\d\d:?\d\d$/.test(timestamp) ? timestamp : `${timestamp}Z`;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(utc));
}

export function Comparison({ ws, params, heading }: { ws: Workspace; params: Params; heading: RefObject<HTMLHeadingElement> }) {
  const [revision, setRevision] = useState(0);
  const matrix = useLoad(() => api.matrix(ws.id), [ws.id, revision], true);
  const rows = matrix.kind === "ready" ? matrix.value : [];
  const labels = Object.fromEntries(rows.map((r) => [r.kpi_id, r.label]));

  const finished = (run: Run) => {
    setRevision((n) => n + 1);
    const first = run.results[0]?.entity;
    setParams({ id: String(run.id), variant: first ?? "" }, { push: false });
  };

  const head = (
    <div className="main-head comparison-head">
      <h1 ref={heading} tabIndex={-1}>
        {params.vue === "historique" ? "Historique des comparaisons" : "Comparaison"}
      </h1>
      <span className="muted">Exécutée avec vos droits · résultats agrégés uniquement · historique local (DuckDB, espace {ws.name})</span>
    </div>
  );

  if (params.vue === "historique") {
    return (
      <>
        {head}
        <FullHistory ws={ws} params={params} labels={labels} />
      </>
    );
  }

  return (
    <>
      {head}
      <div className="comparison">
        <Launch ws={ws} rows={rows} kpi={params.kpi} onFinished={finished} />
        <div className="comparison-results">
          <RecentHistory ws={ws} labels={labels} revision={revision} />
          {matrix.kind === "loading" && (
            <p className="muted" role="status">
              Chargement de la synthèse…
            </p>
          )}
          {matrix.kind === "error" && (
            <Banner tone="bad" title={matrix.error.title}>
              {matrix.error.text}
            </Banner>
          )}
          {matrix.kind === "ready" && <Matrix wsId={ws.id} rows={rows} params={params} />}
          {params.id && <Detail ws={ws} id={Number(params.id)} variant={params.variant} labels={labels} />}
        </div>
      </div>
    </>
  );
}

// --- lancement ---------------------------------------------------------------------------

type Running = { id: number; progress: ComparisonProgress[]; run: Run | null };

function Launch({ ws, rows, kpi: wanted, onFinished }: { ws: Workspace; rows: MatrixRow[]; kpi?: string; onFinished: (run: Run) => void }) {
  const kpis = rows.filter((r) => r.variants.length > 0);
  const kpi = wanted && kpis.some((r) => r.kpi_id === wanted) ? wanted : (kpis[0]?.kpi_id ?? "");
  const setup = useLoad<ComparisonSetup | null>(() => (kpi ? api.comparisonSetup(ws.id, kpi) : Promise.resolve(null)), [ws.id, kpi]);
  return (
    <section className="card launch" aria-labelledby="launch-title">
      <h2 id="launch-title" className="section-label">
        Lancement
      </h2>
      <div className="field">
        <label htmlFor="launch-kpi">KPI</label>
        <Select id="launch-kpi" value={kpi} onChange={(event) => setParams({ kpi: event.target.value, id: "", variant: "" }, { push: true })}>
          {kpis.map((r) => (
            <option key={r.kpi_id} value={r.kpi_id}>
              {r.label} (v{r.version})
            </option>
          ))}
        </Select>
      </div>
      {kpis.length === 0 && rows.length > 0 && <p className="muted">Aucun KPI n'a de déclinaison à comparer.</p>}
      {setup.kind === "loading" && kpi && (
        <p className="muted" role="status">
          Chargement du KPI…
        </p>
      )}
      {setup.kind === "error" && (
        <Banner tone="bad" title={setup.error.title}>
          {setup.error.text}
        </Banner>
      )}
      {setup.kind === "ready" && setup.value && <LaunchForm key={setup.value.kpi_id} ws={ws} setup={setup.value} onFinished={onFinished} />}
    </section>
  );
}

function LaunchForm({ ws, setup, onFinished }: { ws: Workspace; setup: ComparisonSetup; onFinished: (run: Run) => void }) {
  const usable = setup.variants.filter((v) => v.unavailable === null);
  const [entities, setEntities] = useState<string[]>(usable.map((v) => v.entity));
  const [scopeId, setScopeId] = useState(setup.scopes[0]?.id ?? "");
  const scope = setup.scopes.find((s) => s.id === scopeId) ?? null;
  const [from, setFrom] = useState(scope?.period?.from ?? "");
  const [to, setTo] = useState(scope?.period?.to ?? "");
  const [granularity, setGranularity] = useState(0);
  const fallback = setup.tolerance.kpi ?? setup.tolerance.workspace;
  const [chosen, setChosen] = useState<number | null>(null);
  const [preview, setPreview] = useState<Load<ComparisonPreview> | null>(null);
  const [missing, setMissing] = useState<MissingAccess[]>([]);
  const [running, setRunning] = useState<Running | null>(null);
  const [done, setDone] = useState<Run | null>(null);
  const [failure, setFailure] = useState<Explained | null>(null);
  const [attempted, setAttempted] = useState(false);

  const chooseScope = (id: string) => {
    const next = setup.scopes.find((s) => s.id === id);
    setScopeId(id);
    setFrom(next?.period?.from ?? "");
    setTo(next?.period?.to ?? "");
    setGranularity(0);
  };

  // Le scope déclaré tel quel, ou restreint (période, granularité) : un scope ad hoc.
  const body = useMemo<ComparisonRequest | null>(() => {
    if (entities.length === 0 || !scope) return null;
    const dims = scope.granularities[granularity] ?? scope.granularity;
    const declared = (scope.period?.from ?? "") === from && (scope.period?.to ?? "") === to && granularity === 0;
    const request: ComparisonRequest = { kpi_id: setup.kpi_id, variants: entities };
    if (declared) request.scope_id = scope.id;
    else {
      const period = scope.period?.calendar_period ? { calendar_period: scope.period.calendar_period } : { from, to };
      request.scope = { period, granularity: dims, ...(scope.perimeter ? { perimeter: scope.perimeter } : {}) };
    }
    if (chosen !== null) request.tolerance = chosen;
    return request;
  }, [entities, scope, from, to, granularity, chosen, setup.kpi_id]);
  const key = JSON.stringify(body);

  // Aperçu sans exécution : alertes (bypass, surcharge hors points déclarés), accès manquants.
  useEffect(() => {
    if (!body) {
      setPreview(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      setPreview({ kind: "loading" });
      api
        .previewComparison(ws.id, body)
        .then((value) => {
          if (!alive) return;
          setPreview({ kind: "ready", value });
          setMissing(value.missing_access);
        })
        .catch((reason) => alive && !(reason instanceof UnreachableError) && setPreview({ kind: "error", error: explain(reason) }));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ws.id, key]);

  // Progression : relue tant que la comparaison tourne.
  useEffect(() => {
    if (!running || running.run) return;
    let alive = true;
    const timer = setInterval(() => {
      api
        .comparison(ws.id, running.id)
        .then((run) => {
          if (!alive) return;
          if (run.status === "running") {
            setRunning({ ...running, progress: run.progress ?? running.progress });
            return;
          }
          const state = run.status === "cancelled" ? "cancelled" : run.status === "failed" ? "failed" : "done";
          setRunning({
            ...running,
            run,
            progress: running.progress.map((p) => (p.state === "done" ? p : { ...p, state, percent: state === "done" ? 100 : p.percent })),
          });
          setDone(run);
          onFinished(run);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [ws.id, running]);

  const blocked = !body || preview?.kind === "error" || (running !== null && running.run === null);

  async function launch(authenticated = false) {
    setAttempted(true);
    if (!body || blocked) return;
    if (missing.length > 0 && !authenticated) return; // l'authentification d'abord, le lancement reprend ensuite
    setFailure(null);
    setDone(null);
    try {
      const started = await api.startComparison(ws.id, body);
      const plans = preview?.kind === "ready" ? preview.value.plans : [];
      const platforms = [...new Set(plans.map((p) => p.platform))];
      setRunning({
        id: started.id,
        run: null,
        progress: platforms.map((platform) => ({
          platform,
          entities: plans.filter((p) => p.platform === platform).map((p) => p.entity),
          state: "pending",
          percent: 0,
        })),
      });
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "needs_auth") setMissing(reason.issues as MissingAccess[]);
      else setFailure(explain(reason));
    }
  }

  const cancel = () => {
    if (running && !running.run) void api.cancelComparison(ws.id, running.id).catch(() => undefined);
  };

  const shownTolerance = chosen ?? (preview?.kind === "ready" ? preview.value.tolerance : fallback);
  const alerts = preview?.kind === "ready" ? preview.value.alerts : [];
  const label = running?.run || done ? "Relancer" : "Lancer la comparaison";

  return (
    <div className="launch-form">
      <fieldset className="launch-variants">
        <legend>Déclinaisons</legend>
        {setup.variants.length === 0 && <p className="muted">Ce KPI n'a pas de déclinaison.</p>}
        {setup.variants.map((v) => {
          const reason = `launch-reason-${v.entity}`;
          return (
            <div key={v.entity} className="launch-variant">
              <label className="check">
                <input
                  type="checkbox"
                  checked={entities.includes(v.entity)}
                  disabled={v.unavailable !== null}
                  aria-describedby={v.unavailable ? reason : undefined}
                  onChange={(event) =>
                    setEntities(event.target.checked ? [...entities, v.entity] : entities.filter((e) => e !== v.entity))
                  }
                />
                {v.entity}
                <span className="muted launch-platform"> · {platformLabel(v.platform)}</span>
              </label>
              {v.unavailable && (
                <p id={reason} className="launch-reason">
                  Non comparable : {v.unavailable}
                </p>
              )}
            </div>
          );
        })}
        {attempted && entities.length === 0 && <span className="field-error">Cocher au moins une déclinaison.</span>}
      </fieldset>
      {setup.scopes.length === 0 ? (
        <p className="muted">Ce KPI ne déclare aucun scope de comparaison : en déclarer un dans son YAML (plan 0009).</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="launch-scope">Scope</label>
            <Select id="launch-scope" value={scopeId} onChange={(event) => chooseScope(event.target.value)}>
              {setup.scopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                </option>
              ))}
            </Select>
          </div>
          {scope?.period?.calendar_period ? (
            <p className="launch-period">
              Période : <span className="mono">{scope.period.calendar_period}</span>
            </p>
          ) : (
            <div className="launch-grid">
              <div className="field">
                <label htmlFor="launch-from">Du</label>
                <input id="launch-from" type="date" value={from} min={scope?.period?.from} max={to || scope?.period?.to} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="launch-to">Au</label>
                <input id="launch-to" type="date" value={to} min={from || scope?.period?.from} max={scope?.period?.to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="launch-granularity">Granularité</label>
            <Select id="launch-granularity" value={String(granularity)} onChange={(event) => setGranularity(Number(event.target.value))}>
              {(scope?.granularities ?? []).map((dims, index) => (
                <option key={dims.join("×")} value={index}>
                  {dims.map(dimensionLabel).join(" × ")}
                </option>
              ))}
            </Select>
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="launch-tolerance">
          Tolérance : {tolerance(shownTolerance)}{" "}
          <span className="muted">
            (globale {tolerance(setup.tolerance.workspace)}
            {setup.tolerance.kpi !== null && ` · KPI ${tolerance(setup.tolerance.kpi)}`})
          </span>
        </label>
        <input
          id="launch-tolerance"
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={shownTolerance}
          aria-valuetext={tolerance(shownTolerance)}
          onChange={(event) => setChosen(Number(event.target.value))}
        />
      </div>
      {alerts.map((alert) => (
        <Banner key={`${alert.code}-${alert.entity}`} tone="warn" title={alert.code === "cardinality_bypass" ? "Contrôle de cardinalité contourné" : "Surcharge hors des points déclarés"}>
          {alert.message}
        </Banner>
      ))}
      {preview?.kind === "error" && (
        <Banner tone="bad" title={preview.error.title}>
          {preview.error.text}
        </Banner>
      )}
      {missing.length > 0 && <Authenticate ws={ws} missing={missing} onReady={() => setMissing([])} resume={attempted ? () => void launch(true) : undefined} />}
      {failure && (
        <Banner tone="bad" title={failure.title}>
          {failure.text}
        </Banner>
      )}
      {running && <Progress running={running} onCancel={cancel} />}
      {done && done.status !== "done" && (
        <p className="muted" role="status">
          Comparaison n° {done.id} {STATUSES[done.status] ?? done.status}
          {done.error ? ` : ${done.error}` : "."}
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary"
        aria-disabled={blocked || missing.length > 0 || undefined}
        onClick={() => void launch()}
      >
        {label}
      </button>
    </div>
  );
}

function Progress({ running, onCancel }: { running: Running; onCancel: () => void }) {
  return (
    <div className="progress" aria-live="polite">
      {running.progress.map((p) => {
        const name = `${platformLabel(p.platform)} · ${p.entities.join(", ")}`;
        const state = p.state === "running" ? `En cours · ${p.percent} %` : (STATES[p.state] ?? p.state);
        return (
          <div key={p.platform} className="progress-item">
            <div className="progress-head">
              <span>{name}</span>
              <span className={`progress-state state-${p.state}`}>{state}</span>
            </div>
            <div className="progress-bar" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent}>
              <div className="progress-fill" style={{ width: `${p.percent}%` }} />
            </div>
          </div>
        );
      })}
      {!running.run && (
        <button type="button" className="btn btn-neutral" onClick={onCancel}>
          Annuler
        </button>
      )}
    </div>
  );
}

/** Pas d'accès utilisable : on se connecte ici (OAuth dans le navigateur), puis le
 * lancement reprend de lui-même. Jamais de champ de token (guide 10.6). */
function Authenticate({ ws, missing, onReady, resume }: { ws: Workspace; missing: MissingAccess[]; onReady: () => void; resume?: () => void }) {
  const [waiting, setWaiting] = useState<string[]>([]);
  const [failure, setFailure] = useState<Explained | null>(null);
  const done = useRef(false);
  const latest = useRef({ onReady, resume });
  latest.current = { onReady, resume };

  useEffect(() => {
    if (waiting.length === 0) return;
    const timer = setInterval(async () => {
      try {
        const states = await Promise.all(missing.map((m) => api.connectionStatus(ws.id, m.access_point)));
        const refused = states.find((s) => s.flow?.status === "error");
        if (refused) {
          setFailure({ title: "Connexion refusée", text: refused.flow?.error ?? "Le fournisseur a refusé la connexion." });
          setWaiting([]);
          return;
        }
        if (states.every((s) => s.my_access === "connected") && !done.current) {
          done.current = true;
          latest.current.onReady();
          latest.current.resume?.();
        }
      } catch {
        // la prochaine relecture dira
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [waiting, ws.id]);

  async function connect(point: string) {
    setFailure(null);
    try {
      const { authorize_url } = await api.authorize(ws.id, point);
      await openExternal(authorize_url);
      setWaiting((w) => [...new Set([...w, point])]);
    } catch (reason) {
      setFailure(explain(reason));
    }
  }

  return (
    <Banner tone="warn" title="Connexion requise">
      La comparaison s'exécute avec vos droits : se connecter d'abord à{" "}
      {missing.map((m) => m.access_point).join(", ")}.
      <span className="auth-actions">
        {missing.map((m) => (
          <button key={m.access_point} type="button" className="btn btn-secondary" onClick={() => void connect(m.access_point)}>
            {waiting.includes(m.access_point) ? `En attente de ${m.access_point}…` : `Se connecter à ${m.access_point}`}
          </button>
        ))}
        <a href={href.view(ws.id, "connexions")}>Mes connexions</a>
      </span>
      {waiting.length > 0 && <span> Terminer la connexion dans le navigateur : le lancement reprendra ensuite.</span>}
      {failure && <span className="field-error"> {failure.title} : {failure.text}</span>}
    </Banner>
  );
}

// --- synthèse ----------------------------------------------------------------------------

function Matrix({ wsId, rows, params }: { wsId: string; rows: MatrixRow[]; params: Params }) {
  const domain = params.domain || ALL;
  const domains = [...new Map(rows.filter((r) => r.domain).map((r) => [r.domain!, r.domain_label ?? r.domain!])).entries()];
  const shown = rows.filter((r) => r.variants.length > 0 && (domain === ALL || r.domain === domain));
  const entities = [...new Set(shown.flatMap((r) => r.variants.map((v) => v.entity)))].sort();
  return (
    <section className="card matrix-card" aria-labelledby="matrix-title">
      <div className="card-head">
        <h2 id="matrix-title" className="section-label">
          Synthèse · % validation / écart max
        </h2>
        <Select aria-label="Domaine" className="select-filter" value={domain} onChange={(e) => setParams({ domain: e.target.value }, { push: true })}>
          <option value={ALL}>Tous domaines</option>
          {domains.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      {shown.length === 0 ? (
        <p className="muted">Aucun KPI décliné dans ce domaine.</p>
      ) : (
        <div className="table-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th scope="col">KPI \ Déclinaison</th>
                {entities.map((e) => (
                  <th key={e} scope="col">
                    {e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.kpi_id}>
                  <th scope="row">{row.label}</th>
                  {entities.map((entity) => {
                    const cell = row.variants.find((v) => v.entity === entity);
                    if (!cell) return <td key={entity} className="matrix-none" />;
                    if (!cell.compared || cell.validation_pct === undefined) {
                      return (
                        <td key={entity} className="matrix-cell matrix-never">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">non comparé</span>
                        </td>
                      );
                    }
                    const validation = cell.validation_pct === null ? "sans cellule" : percent(cell.validation_pct);
                    const max = cell.max_gap_pct === null || cell.max_gap_pct === undefined ? "—" : gap(cell.max_gap_pct, false);
                    const current = params.id === String(cell.comparison_id) && params.variant === entity;
                    return (
                      <td key={entity} className={`matrix-cell tone-cell-${tone(cell.validation_pct)}`}>
                        {/* Le texte visible reste dans le nom accessible (WCAG 2.5.3) : le reste est masqué. */}
                        <a
                          className="matrix-button"
                          aria-current={current ? "true" : undefined}
                          href={href.view(wsId, "comparaison", { ...params, id: String(cell.comparison_id), variant: entity })}
                        >
                          <span className="sr-only">{`${row.label} × ${entity} :`}</span> <strong>{validation}</strong>{" "}
                          <span className="sr-only">de validation, écart max</span>{" "}
                          <span className="matrix-gap">
                            {max}
                            {cell.stale && ` · v${cell.kpi_version}`}
                          </span>
                        </a>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// --- détail ------------------------------------------------------------------------------

function Detail({ ws, id, variant, labels }: { ws: Workspace; id: number; variant?: string; labels: Record<string, string> }) {
  const run = useLoad(() => api.comparison(ws.id, id), [ws.id, id]);
  if (run.kind === "loading") {
    return (
      <p className="muted" role="status">
        Chargement de la comparaison n° {id}…
      </p>
    );
  }
  if (run.kind === "error") {
    return (
      <Banner tone="bad" title={run.error.title}>
        {run.error.text}
      </Banner>
    );
  }
  const found = run.value;
  const result = found.results.find((r) => r.entity === variant) ?? found.results[0];
  const kpi = labels[found.kpi_id] ?? found.kpi_id;
  const dims = found.scope.granularity ?? (result ? Object.keys(result.cells[0]?.dims ?? {}) : []);
  const meta = [
    `Comparaison n° ${found.id}`,
    when(found.started_at),
    `v${found.kpi_version}`,
    `tolérance ${tolerance(found.tolerance_pct)}`,
    found.user_account && `par ${found.user_account}`,
    STATUSES[found.status] ?? found.status,
  ].filter(Boolean);
  return (
    <section className="card detail-card" aria-labelledby="detail-title">
      <div className="card-head">
        <h2 id="detail-title" className="section-label">
          Détail · {kpi}
          {result && ` · ${result.entity}`} · par {dims.map(dimensionLabel).join(" × ")}
        </h2>
        {result?.divergent && (
          <a
            className="detail-node"
            href={href.document(ws.id, result.variant_id, { diff: "canonique", node: result.divergent.node_id })}
          >
            Nœud divergent : <span className="mono">{result.divergent.node_id}</span>
            {result.divergent.label && ` · ${result.divergent.label}`}
          </a>
        )}
      </div>
      <p className="muted">{meta.join(" · ")}</p>
      {found.results.length > 1 && (
        <div className="detail-switch">
          <Select aria-label="Déclinaison" className="select-filter" value={result?.entity} onChange={(e) => setParams({ variant: e.target.value }, { push: true })}>
            {found.results.map((r) => (
              <option key={r.entity} value={r.entity}>
                {r.entity}
              </option>
            ))}
          </Select>
        </div>
      )}
      {found.error && (
        <Banner tone="bad" title={`Comparaison ${STATUSES[found.status] ?? found.status}`}>
          {found.error}
        </Banner>
      )}
      {!result ? (
        <p className="muted">{found.status === "cancelled" ? "Comparaison annulée : aucun résultat." : "Aucun résultat pour cette comparaison."}</p>
      ) : (
        <>
          {result.divergent && <p className="muted">Le nœud divergent est une piste tirée du diff structurel, pas une preuve.</p>}
          {result.bypass_nodes.length > 0 && (
            <p className="fact-warn">Contrôle de cardinalité contourné : {result.bypass_nodes.join(", ")}.</p>
          )}
          <div className="table-wrap">
            <table className="table detail-table">
              <thead>
                <tr>
                  {dims.map((d) => (
                    <th key={d} scope="col">
                      {dimensionLabel(d)}
                    </th>
                  ))}
                  <th scope="col">Canonique</th>
                  <th scope="col">Déclinaison {result.entity}</th>
                  <th scope="col">Écart</th>
                </tr>
              </thead>
              <tbody>
                {result.cells.map((cell) => (
                  <tr key={JSON.stringify(cell.dims)} className={cell.within_tolerance ? undefined : "is-out"}>
                    {dims.map((d) => (
                      <td key={d}>{dimension(cell.dims[d])}</td>
                    ))}
                    <td className="num">
                      <Value value={cell.canonical_value} />
                    </td>
                    <td className="num">
                      <Value value={cell.variant_value} />
                    </td>
                    <td className={`num ${cell.within_tolerance ? "tone-ok" : "tone-bad"}`}>
                      {cell.gap_pct === null ? "—" : <span title={String(cell.gap_pct)}>{gap(cell.gap_pct)}</span>}
                      {!cell.within_tolerance && " hors tolérance"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/** Arrondi à l'affichage seulement : la valeur exacte reste en infobulle (critère 6). */
function Value({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">absente</span>;
  return <span title={String(value)}>{amount(value)}</span>;
}

// --- historique --------------------------------------------------------------------------

function summary(entry: HistoryEntry): string {
  return entry.results.map((r) => `${r.entity} ${r.validation_pct === null ? "—" : percent(r.validation_pct)}`).join(" · ");
}

function RecentHistory({ ws, labels, revision }: { ws: Workspace; labels: Record<string, string>; revision: number }) {
  const recent = useLoad(() => api.history(ws.id, 3), [ws.id, revision], true);
  return (
    <section className="card history-strip" aria-labelledby="history-title">
      <h2 id="history-title" className="section-label">
        Dernières comparaisons
      </h2>
      {recent.kind === "ready" && recent.value.length === 0 && <span className="muted">Aucune comparaison dans cet espace.</span>}
      {recent.kind === "ready" && recent.value.length > 0 && (
        <ul className="history-list">
          {recent.value.map((entry) => (
            <li key={entry.id}>
              <a href={href.view(ws.id, "comparaison", { kpi: entry.kpi_id, id: String(entry.id), variant: entry.results[0]?.entity ?? "" })}>
                n° {entry.id} · {labels[entry.kpi_id] ?? entry.kpi_id}
              </a>{" "}
              <span className="muted">
                {when(entry.started_at)} · {STATUSES[entry.status] ?? entry.status}
                {entry.results.length > 0 && ` · ${summary(entry)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <a className="history-all" href={href.view(ws.id, "comparaison", { vue: "historique" })}>
        Tout voir
      </a>
    </section>
  );
}

function FullHistory({ ws, params, labels }: { ws: Workspace; params: Params; labels: Record<string, string> }) {
  const all = useLoad(() => api.history(ws.id, 500), [ws.id]);
  const entries = all.kind === "ready" ? all.value : [];
  const kpis = [...new Set(entries.map((e) => e.kpi_id))].sort();
  const users = [...new Set(entries.map((e) => e.user_account).filter((u): u is string => Boolean(u)))].sort();
  const since = params.depuis ?? "";
  const shown = entries.filter(
    (e) =>
      (!params.hkpi || e.kpi_id === params.hkpi) &&
      (!params.user || e.user_account === params.user) &&
      (!since || e.started_at.slice(0, 10) >= since),
  );
  return (
    <section className="card history-full" aria-label="Toutes les comparaisons">
      <a href={href.view(ws.id, "comparaison")}>← Retour à la comparaison</a>
      <div className="history-filters">
        <Select aria-label="KPI" className="select-filter" value={params.hkpi ?? ""} onChange={(e) => setParams({ hkpi: e.target.value }, { push: true })}>
          <option value="">Tous les KPI</option>
          {kpis.map((k) => (
            <option key={k} value={k}>
              {labels[k] ?? k}
            </option>
          ))}
        </Select>
        <Select aria-label="Utilisateur" className="select-filter" value={params.user ?? ""} onChange={(e) => setParams({ user: e.target.value }, { push: true })}>
          <option value="">Tous les utilisateurs</option>
          {users.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Select>
        <div className="field field-inline">
          <label htmlFor="history-since">Depuis le</label>
          <input id="history-since" type="date" value={since} onChange={(e) => setParams({ depuis: e.target.value }, { push: true })} />
        </div>
      </div>
      {all.kind === "loading" && (
        <p className="muted" role="status">
          Chargement de l'historique…
        </p>
      )}
      {all.kind === "error" && (
        <Banner tone="bad" title={all.error.title}>
          {all.error.text}
        </Banner>
      )}
      {all.kind === "ready" && shown.length === 0 && (
        <p className="muted">{entries.length === 0 ? "Aucune comparaison dans cet espace." : "Aucune comparaison ne correspond à ces filtres."}</p>
      )}
      {shown.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">N°</th>
                <th scope="col">Date</th>
                <th scope="col">KPI</th>
                <th scope="col">Utilisateur</th>
                <th scope="col">Statut</th>
                <th scope="col">Dans la tolérance</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.id}>
                  <th scope="row">
                    <a href={href.view(ws.id, "comparaison", { kpi: entry.kpi_id, id: String(entry.id), variant: entry.results[0]?.entity ?? "" })}>
                      n° {entry.id}
                    </a>
                  </th>
                  <td>{when(entry.started_at)}</td>
                  <td>
                    {labels[entry.kpi_id] ?? entry.kpi_id} v{entry.kpi_version}
                  </td>
                  <td>{entry.user_account ?? "—"}</td>
                  <td>{STATUSES[entry.status] ?? entry.status}</td>
                  <td>{entry.results.length === 0 ? "—" : summary(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
