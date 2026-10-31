import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  api,
  UnreachableError,
  type AccessPointDraft,
  type Connection,
  type ConnectionStatus,
  type ConnectionTest,
  type Platform,
  type Workspace,
} from "../api";
import { Banner } from "../components/Banner";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { Select } from "../components/Select";
import { openExternal } from "../external";
import { explain, type Explained } from "../messages";
import { href } from "../router";

// Mes connexions (guide 10.6, plan 0016) : les points d'accès de l'espace courant et mon
// accès à chacun ; à droite, un nouveau point d'accès, connecté et testé avant d'être
// proposé. Aucun jeton n'arrive jamais ici : le serveur ne rend que des états. Seul le
// repli Databricks par token personnel passe par un champ masqué, vidé après l'envoi.

/** Relecture de l'état pendant un flux OAuth, et délai au-delà duquel on abandonne. */
export const OAUTH_POLL_MS = 1000;
export const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

const PLATFORMS: Record<string, string> = {
  databricks: "Databricks",
  snowflake: "Snowflake",
  bigquery: "BigQuery",
  fabric: "Microsoft Fabric",
  redshift: "Redshift",
  duckdb: "DuckDB",
};
const AUTHS: Record<string, string> = { oauth: "OAuth", pat: "token personnel" };
const PREFIXES: Record<string, string> = { databricks: "dbx", snowflake: "snow", bigquery: "bq", fabric: "fab", redshift: "rs" };

type Load<T> = { kind: "loading" } | { kind: "ready"; value: T } | { kind: "error"; error: Explained };

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

const platformLabel = (id: string) => PLATFORMS[id] ?? id;

/** « Connecté » et son détail (« expire dans 11 j », « session OAuth »), « Token expiré »,
 * « Jamais connecté ». */
export function accessLabel(c: Pick<Connection, "my_access" | "auth" | "expires_in_days">): {
  text: string;
  detail: string | null;
  tone: "ok" | "warn" | "none";
} {
  if (c.my_access === "connected") {
    if (c.expires_in_days !== null) return { text: "Connecté", detail: `expire dans ${c.expires_in_days} j`, tone: "ok" };
    return { text: "Connecté", detail: c.auth === "oauth" ? "session OAuth" : "token personnel", tone: "ok" };
  }
  if (c.my_access === "expired") return { text: c.auth === "oauth" ? "Session expirée" : "Token expiré", detail: null, tone: "warn" };
  return { text: "Jamais connecté", detail: null, tone: "none" };
}

// --- flux OAuth -------------------------------------------------------------------------

type Flow =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "connected" }
  | { kind: "failed"; error: Explained };

/** Lance le flux natif (l'URL s'ouvre dans le navigateur du système), puis relit l'état
 * jusqu'à la connexion, un refus ou le délai de 5 minutes. */
function useOAuth(start: () => Promise<{ authorize_url: string }>, read: () => Promise<ConnectionStatus>, onConnected: () => void) {
  const [flow, setFlow] = useState<Flow>({ kind: "idle" });
  const latest = useRef({ read, onConnected });
  latest.current = { read, onConnected };

  useEffect(() => {
    if (flow.kind !== "waiting") return;
    const started = Date.now();
    let alive = true;
    const timer = setInterval(async () => {
      if (Date.now() - started > OAUTH_TIMEOUT_MS) {
        setFlow({ kind: "failed", error: { title: "Délai dépassé", text: "La connexion n'a pas abouti en 5 minutes : réessayer." } });
        return;
      }
      try {
        const state = await latest.current.read();
        if (!alive) return;
        if (state.flow?.status === "connected") {
          setFlow({ kind: "connected" });
          latest.current.onConnected();
        } else if (state.flow?.status === "failed" || state.flow?.status === "expired") {
          setFlow({ kind: "failed", error: { title: "Connexion échouée", text: state.flow.error ?? "La plateforme a refusé la connexion." } });
        }
      } catch {
        // la prochaine relecture dira
      }
    }, OAUTH_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [flow.kind]);

  async function connect() {
    try {
      const { authorize_url } = await start();
      await openExternal(authorize_url);
      setFlow({ kind: "waiting" });
    } catch (reason) {
      setFlow({ kind: "failed", error: explain(reason) });
    }
  }

  return { flow, connect, reset: () => setFlow({ kind: "idle" }) };
}

/** Repli Databricks (décision Q10) : seulement après un échec de l'OAuth, un champ masqué
 * à usage unique, envoyé droit au coffre puis vidé. */
function PersonalToken({ ws, point, onSaved }: { ws: Workspace; point: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [failure, setFailure] = useState<Explained | null>(null);
  const id = `pat-${point}`;

  async function save(event: FormEvent) {
    event.preventDefault();
    const token = value;
    setValue(""); // le champ ne garde rien, quoi qu'il arrive
    try {
      await api.personalToken(ws.id, point, token);
      setOpen(false);
      onSaved();
    } catch (reason) {
      setFailure(explain(reason));
    }
  }

  if (!open) {
    return (
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        Utiliser un token personnel
      </button>
    );
  }
  return (
    <form className="pat-form" onSubmit={(event) => void save(event)}>
      <label htmlFor={id}>Token personnel Databricks</label>
      <input
        id={id}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-describedby={`${id}-hint`}
      />
      <span id={`${id}-hint`} className="field-hint">
        Envoyé une seule fois au coffre de ce poste, jamais affiché ni enregistré ailleurs.
      </span>
      <div className="pat-actions">
        <button type="submit" className="btn btn-secondary btn-sm" disabled={!value.trim()}>
          Ranger dans le coffre
        </button>
        <button type="button" className="btn btn-neutral btn-sm" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
      {failure && <span className="field-error">{failure.text}</span>}
    </form>
  );
}

function testMessage(result: ConnectionTest): { text: string; tone: "ok" | "bad" } {
  if (result.ok) return { text: `Connexion OK · ${result.latency_ms} ms`, tone: "ok" };
  return { text: result.error?.message ?? "La connexion a échoué.", tone: "bad" };
}

// --- écran ------------------------------------------------------------------------------

export function Connections({ ws, heading }: { ws: Workspace; heading: RefObject<HTMLHeadingElement> }) {
  const [revision, setRevision] = useState(0);
  const list = useLoad(() => api.connections(ws.id), [ws.id, revision], true);
  const platforms = useLoad(() => api.platforms(ws.id), [ws.id]);
  const panel = useRef<HTMLElement>(null);
  const canDeclare = ws.role !== "lecteur";
  const reload = () => setRevision((n) => n + 1);

  const openPanel = () => {
    panel.current?.scrollIntoView?.({ block: "nearest" });
    panel.current?.querySelector<HTMLElement>("select, input")?.focus();
  };

  return (
    <>
      <div className="main-head connections-head">
        <div className="main-title">
          <h1 ref={heading} tabIndex={-1}>
            Mes connexions
          </h1>
          <span className="muted">Espace {ws.name} · vos tokens sont chiffrés sur cette machine, jamais sur un serveur ni dans Git.</span>
        </div>
        {canDeclare && (
          <button type="button" className="btn btn-primary" onClick={openPanel}>
            <Icon name="plus" className="icon-sm" />
            Ajouter un point d'accès
          </button>
        )}
      </div>
      <div className="connections">
        <div className="connections-list">
          {list.kind === "loading" && (
            <p className="muted" role="status">
              Chargement des points d'accès…
            </p>
          )}
          {list.kind === "error" && (
            <Banner tone="bad" title={list.error.title}>
              {list.error.text}
            </Banner>
          )}
          {list.kind === "ready" && list.value.length === 0 && (
            <div className="placeholder">
              L'espace <strong>{ws.name}</strong> ne déclare encore aucun point d'accès.
              {canDeclare && " Ajoutez celui de votre entité : il sera proposé au référent de l'espace."}
            </div>
          )}
          {list.kind === "ready" && list.value.length > 0 && (
            <div className="table-wrap">
              <table className="table connections-table" aria-label="Points d'accès de l'espace">
                <thead>
                  <tr>
                    <th scope="col">Plateforme</th>
                    <th scope="col">Schéma</th>
                    <th scope="col">Propriétaire</th>
                    <th scope="col">Fraîcheur</th>
                    <th scope="col">Mon accès</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.value.map((c) => (
                    <Row key={`${ws.id}/${c.access_point}`} ws={ws} connection={c} onChanged={reload} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {canDeclare && (
          <NewAccessPoint
            panelRef={panel}
            ws={ws}
            platforms={platforms.kind === "ready" ? platforms.value : []}
            taken={list.kind === "ready" ? list.value.map((c) => c.access_point) : []}
            onDeclared={reload}
          />
        )}
      </div>
    </>
  );
}

function Row({ ws, connection: c, onChanged }: { ws: Workspace; connection: Connection; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const oauth = useOAuth(
    () => api.authorize(ws.id, c.access_point),
    () => api.connectionStatus(ws.id, c.access_point),
    () => {
      setMessage(null);
      onChanged();
    },
  );
  const access = accessLabel(c);
  const name = platformLabel(c.platform);
  const label = `${name} · ${c.access_point}`;

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(testMessage(await api.testConnection(ws.id, c.access_point)));
    } catch (reason) {
      setMessage({ text: explain(reason).text, tone: "bad" });
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setMessage(null);
    try {
      const done = await api.revokeConnection(ws.id, c.access_point);
      oauth.reset();
      setMessage({ text: done.remote_revoked ? `Accès révoqué, ici et chez ${name}.` : "Accès retiré du coffre.", tone: "ok" });
      onChanged();
    } catch (reason) {
      setMessage({ text: explain(reason).text, tone: "bad" });
    } finally {
      setBusy(false);
    }
  }

  let actions;
  if (!c.allowed) {
    actions = <span className="muted">Plateforme retirée par le référent</span>;
  } else if (!c.supported) {
    actions = <span className="muted">Bientôt dans Atlas</span>;
  } else if (oauth.flow.kind === "waiting") {
    actions = (
      <span className="muted" role="status">
        Terminez la connexion dans le navigateur…
      </span>
    );
  } else if (c.my_access === "connected") {
    actions = (
      <>
        <button type="button" className="btn btn-neutral btn-sm" aria-label={`Tester ${label}`} disabled={busy} onClick={() => void test()}>
          Tester
        </button>
        <button type="button" className="btn btn-danger btn-sm" aria-label={`Révoquer ${label}`} disabled={busy} onClick={() => void revoke()}>
          Révoquer
        </button>
      </>
    );
  } else {
    const again = c.my_access === "expired";
    actions = (
      <button
        type="button"
        className={`btn btn-sm ${again ? "btn-primary" : "btn-secondary"}`}
        aria-label={`${again ? "Reconnecter" : "Se connecter à"} ${label}`}
        onClick={() => void oauth.connect()}
      >
        {again ? "Reconnecter" : "Se connecter"}
      </button>
    );
  }

  return (
    <tr>
      <td>
        <strong>{name}</strong>
        <span className="connections-sub">
          {c.entity ?? "Groupe"} · {c.auth ? AUTHS[c.auth] : c.supported ? "OAuth" : "bientôt"}
        </span>
      </td>
      <td className="mono">{c.schema ?? "—"}</td>
      <td>{c.owner_name ?? c.owner}</td>
      <td>{c.freshness ?? "—"}</td>
      <td>
        <span className={`convergence tone-${access.tone}`}>
          <span className="dot" aria-hidden="true" />
          {access.text}
        </span>
        {access.detail && (
          <span className="connections-sub connections-detail">
            <span className="sr-only"> · </span>
            {access.detail}
          </span>
        )}
      </td>
      <td>
        <div className="connections-actions">{actions}</div>
        {message && (
          <span className={`connections-message tone-${message.tone}`} role="status">
            {message.text}
          </span>
        )}
        {oauth.flow.kind === "failed" && (
          <div className="connections-failure">
            <span className="field-error" role="alert">
              {oauth.flow.error.title} : {oauth.flow.error.text}
            </span>
            {c.platform === "databricks" && <PersonalToken ws={ws} point={c.access_point} onSaved={onChanged} />}
          </div>
        )}
      </td>
    </tr>
  );
}

// --- nouveau point d'accès ----------------------------------------------------------------

type Draft = { platform: string; id: string; host: string; warehouse: string; schema: string; entity: string; freshness: string };

/** Identifiant proposé : préfixe de la plateforme et suffixe de l'entité (dbx-fr). */
export function suggestedId(platform: string, entity: string): string {
  const prefix = PREFIXES[platform] ?? platform.slice(0, 4);
  const suffix = entity ? (entity.split("-").at(-1) ?? entity) : "groupe";
  return `${prefix}-${suffix}`;
}

/** Le brouillon tel que le serveur l'attend : https par défaut, champs vides omis. */
export function toAccessPoint(draft: Draft, owner: string): AccessPointDraft {
  const host = draft.host.trim();
  const point: AccessPointDraft = {
    id: draft.id.trim(),
    platform: draft.platform,
    host: host && !/^https?:\/\//.test(host) ? `https://${host}` : host,
    owner,
  };
  const warehouse = draft.warehouse.trim();
  if (draft.platform === "databricks" && warehouse) {
    if (warehouse.startsWith("/")) point.http_path = warehouse;
    else point.warehouse_id = warehouse;
  }
  if (draft.schema.trim()) point.schema = draft.schema.trim();
  if (draft.entity) point.entity = draft.entity;
  if (draft.freshness.trim()) point.freshness = draft.freshness.trim();
  return point;
}

function NewAccessPoint({
  panelRef,
  ws,
  platforms,
  taken,
  onDeclared,
}: {
  panelRef: RefObject<HTMLElement>;
  ws: Workspace;
  platforms: Platform[];
  taken: string[];
  onDeclared: () => void;
}) {
  const first = platforms.find((p) => p.supported)?.id ?? platforms[0]?.id ?? "";
  // Par défaut, la première entité dont le point d'accès n'est pas encore déclaré.
  const free = ws.entities.find((e) => !taken.includes(suggestedId(first, e)));
  const [draft, setDraft] = useState<Draft>({ platform: "", id: "", host: "", warehouse: "", schema: "", entity: "", freshness: "" });
  const [entityTouched, setEntityTouched] = useState(false);
  const [idTouched, setIdTouched] = useState(false);
  const [test, setTest] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const [failure, setFailure] = useState<Explained | null>(null);
  const [justification, setJustification] = useState("");
  const [declared, setDeclared] = useState<{ id: number; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const platform = draft.platform || first;
  const entity = entityTouched ? draft.entity : (free ?? ws.entities[0] ?? "");
  const id = idTouched ? draft.id : suggestedId(platform, entity);
  const point = toAccessPoint({ ...draft, platform, entity, id }, ws.account);
  const supported = platforms.find((p) => p.id === platform)?.supported ?? false;
  const oauth = useOAuth(
    () => api.authorizeDraft(ws.id, point),
    () => api.draftStatus(ws.id, point),
    () => setTest(null),
  );

  const set = (key: keyof Draft) => (event: { target: { value: string } }) => {
    if (key === "entity") setEntityTouched(true);
    setDraft({ ...draft, platform, entity, [key]: event.target.value });
    setTest(null);
    setFailure(null);
    setDeclared(null);
    if (oauth.flow.kind !== "waiting") oauth.reset();
  };

  async function runTest() {
    setBusy(true);
    setTest(null);
    setFailure(null);
    try {
      setTest(testMessage(await api.testDraft(ws.id, point)));
    } catch (reason) {
      setFailure(explain(reason));
    } finally {
      setBusy(false);
    }
  }

  async function declare(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      setDeclared(await api.declareAccessPoint(ws.id, point, justification.trim()));
      setJustification("");
      onDeclared();
    } catch (reason) {
      setFailure(explain(reason));
    } finally {
      setBusy(false);
    }
  }

  const connected = oauth.flow.kind === "connected";
  return (
    <aside ref={panelRef} className="card connections-panel" aria-labelledby="new-access-point">
      <h2 id="new-access-point" className="section-label">
        Nouveau point d'accès
      </h2>
      <form className="form connections-form" onSubmit={(event) => void declare(event)}>
        <Field label="Plateforme (autorisées par le référent)" id="ap-platform">
          <Select value={platform} onChange={set("platform")}>
            {platforms.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.supported}>
                {p.label}
                {p.supported ? "" : " (bientôt)"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Entité" id="ap-entity">
          <Select value={entity} onChange={set("entity")}>
            {ws.entities.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
            <option value="">Tout le groupe</option>
          </Select>
        </Field>
        <Field label="Identifiant" id="ap-id" hint="Nom du point d'accès dans access_points.yaml.">
          <input
            className="mono"
            value={id}
            onChange={(event) => {
              setIdTouched(true);
              set("id")(event);
            }}
          />
        </Field>
        <Field label="Hôte" id="ap-host">
          <input placeholder="adb-xxxx.azuredatabricks.net" value={draft.host} onChange={set("host")} />
        </Field>
        {platform === "databricks" && (
          <Field label="SQL warehouse" id="ap-warehouse" hint="Identifiant, ou chemin HTTP /sql/1.0/warehouses/…">
            <input className="mono" value={draft.warehouse} onChange={set("warehouse")} />
          </Field>
        )}
        <Field label="Schéma" id="ap-schema">
          <input className="mono" placeholder="catalogue.schema" value={draft.schema} onChange={set("schema")} />
        </Field>
        <Field label="Fraîcheur" id="ap-freshness">
          <input placeholder="Quotidienne · 06:10" value={draft.freshness} onChange={set("freshness")} />
        </Field>

        <button type="button" className="btn btn-primary" disabled={!supported || oauth.flow.kind === "waiting"} onClick={() => void oauth.connect()}>
          {connected ? "Reconnecter avec OAuth" : "S'authentifier avec OAuth"}
        </button>
        <button type="button" className="btn btn-secondary" disabled={!supported || busy} onClick={() => void runTest()}>
          Tester la connexion
        </button>
        {oauth.flow.kind === "waiting" && (
          <p className="muted" role="status">
            Terminez la connexion dans le navigateur : l'état se met à jour ici.
          </p>
        )}
        {connected && (
          <p className="tone-ok" role="status">
            Connecté : le token est rangé dans votre coffre, sous {id}.
          </p>
        )}
        {oauth.flow.kind === "failed" && (
          <div className="connections-failure">
            <span className="field-error" role="alert">
              {oauth.flow.error.title} : {oauth.flow.error.text}
            </span>
          </div>
        )}
        {test && (
          <p className={`tone-${test.tone}`} role="status">
            {test.text}
          </p>
        )}
        {failure && (
          <Banner tone="bad" title={failure.title}>
            {failure.text}
          </Banner>
        )}
        <p className="field-hint">
          L'authentification passe par le flux natif de la plateforme. Le token obtenu est rangé dans votre coffre local, sous l'espace {ws.name}.
        </p>

        <div className="field">
          <label htmlFor="ap-justification">Justification</label>
          <textarea id="ap-justification" rows={2} value={justification} onChange={(event) => setJustification(event.target.value)} />
        </div>
        <button type="submit" className="btn btn-neutral" disabled={busy || !justification.trim()}>
          Proposer le point d'accès
        </button>
        <p className="field-hint">La déclaration passe par une proposition sur access_points.yaml, validée par un référent d'espace.</p>
        {declared && (
          <p className="tone-ok" role="status">
            Proposition n° {declared.id} ouverte.{" "}
            <a href={href.view(ws.id, "propositions", { n: String(declared.id), status: "open", domain: "tous" })}>Voir la proposition</a>
          </p>
        )}
      </form>
    </aside>
  );
}
