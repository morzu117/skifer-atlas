import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  api,
  UnreachableError,
  type AccessPointDraft,
  type Connection,
  type ConnectionStatus,
  type ConnectionTest,
  type KeyPair,
  type Platform,
  type Workspace,
} from "../api";
import { Banner } from "../components/Banner";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { Select } from "../components/Select";
import { canPickFile, openExternal, pickFile } from "../external";
import { explain, type Explained } from "../messages";
import { href } from "../router";

// Mes connexions (guide 10.6, plan 0016) : les points d'accès de l'espace courant et mon
// accès à chacun ; à droite, un nouveau point d'accès, connecté et testé avant d'être
// proposé. Aucun jeton n'arrive jamais ici : le serveur ne rend que des états. Seuls le
// repli Databricks par token personnel et la passphrase d'une clé Snowflake (plan 0018)
// passent par un champ masqué, vidé après l'envoi.

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
const AUTHS: Record<string, string> = { oauth: "OAuth", pat: "token personnel", sso: "SSO", keypair: "paire de clés" };
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

/** « Connecté » et son détail (« expire dans 11 j », « session OAuth », « session SSO »),
 * « Token expiré », « Jamais connecté ». */
export function accessLabel(c: Pick<Connection, "my_access" | "auth" | "expires_in_days">): {
  text: string;
  detail: string | null;
  tone: "ok" | "warn" | "none";
} {
  if (c.my_access === "connected") {
    // Une session SSO se renouvelle tant qu'Atlas s'en sert : pas d'échéance à afficher.
    if (c.auth === "sso") return { text: "Connecté", detail: "session SSO", tone: "ok" };
    if (c.expires_in_days !== null) return { text: "Connecté", detail: `expire dans ${c.expires_in_days} j`, tone: "ok" };
    const detail = c.auth === "oauth" ? "session OAuth" : c.auth === "keypair" ? "paire de clés" : "token personnel";
    return { text: "Connecté", detail, tone: "ok" };
  }
  if (c.my_access === "expired") {
    const text = c.auth === "oauth" || c.auth === "sso" ? "Session expirée" : c.auth === "keypair" ? "Clé refusée" : "Token expiré";
    return { text, detail: null, tone: "warn" };
  }
  return { text: "Jamais connecté", detail: null, tone: "none" };
}

// --- flux OAuth -------------------------------------------------------------------------

type Flow =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "connected" }
  | { kind: "failed"; error: Explained };

/** Lance le flux natif (l'URL s'ouvre dans le navigateur du système ; pour le SSO
 * Snowflake, c'est Atlas qui l'ouvre et il n'y a pas d'URL), puis relit l'état jusqu'à la
 * connexion, un refus ou le délai de 5 minutes. */
function useOAuth(
  start: (user?: string) => Promise<{ authorize_url: string | null }>,
  read: () => Promise<ConnectionStatus>,
  onConnected: () => void,
) {
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

  async function connect(user?: string) {
    try {
      const { authorize_url } = await start(user);
      if (authorize_url) await openExternal(authorize_url);
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

/** Connexion Snowflake (plan 0018) : l'identifiant, puis le SSO (le navigateur s'ouvre)
 * ou la paire de clés (chemin du fichier, passphrase masquée envoyée au coffre puis
 * vidée). Dans le panneau, ce n'est pas un formulaire : il est déjà dans celui de la
 * déclaration. */
function SnowflakeLogin({
  id,
  mode,
  login,
  keyFile,
  asForm,
  disabled,
  onSso,
  onKeyPair,
  onCancel,
}: {
  id: string;
  mode: "sso" | "keypair";
  login: string | null;
  keyFile: string | null;
  asForm: boolean;
  disabled?: boolean;
  onSso: (user: string) => void;
  onKeyPair: (keyPair: KeyPair) => Promise<void>;
  onCancel?: () => void;
}) {
  const [user, setUser] = useState(login ?? "");
  const [path, setPath] = useState(keyFile ?? "");
  const [passphrase, setPassphrase] = useState("");
  const [failure, setFailure] = useState<Explained | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = user.trim() !== "" && (mode === "sso" || path.trim() !== "");

  async function submit() {
    setFailure(null);
    if (mode === "sso") {
      onSso(user.trim());
      return;
    }
    const secret = passphrase;
    setPassphrase(""); // le champ ne garde rien, quoi qu'il arrive
    setBusy(true);
    try {
      await onKeyPair({ user: user.trim(), private_key_file: path.trim(), ...(secret ? { passphrase: secret } : {}) });
    } catch (reason) {
      setFailure(explain(reason));
    } finally {
      setBusy(false);
    }
  }

  async function choose() {
    try {
      const chosen = await pickFile("Fichier de clé privée Snowflake");
      if (chosen) setPath(chosen);
    } catch (reason) {
      setFailure(explain(reason));
    }
  }

  const fields = (
    <>
      <label htmlFor={`${id}-user`}>Identifiant Snowflake</label>
      <input id={`${id}-user`} autoComplete="username" spellCheck={false} value={user} onChange={(event) => setUser(event.target.value)} />
      {mode === "keypair" && (
        <>
          <label htmlFor={`${id}-key`}>Fichier de clé privée</label>
          <div className="key-file">
            <input
              id={`${id}-key`}
              className="mono"
              spellCheck={false}
              placeholder="/Users/…/rsa_key.p8"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              aria-describedby={`${id}-key-hint`}
            />
            {canPickFile() && (
              <button type="button" className="btn btn-neutral btn-sm" onClick={() => void choose()}>
                Choisir…
              </button>
            )}
          </div>
          <span id={`${id}-key-hint`} className="field-hint">
            Chemin absolu. La clé reste où elle est : Atlas la relit à chaque connexion, sans la copier.
          </span>
          <label htmlFor={`${id}-passphrase`}>Passphrase (si la clé est chiffrée)</label>
          <input
            id={`${id}-passphrase`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            aria-describedby={`${id}-passphrase-hint`}
          />
          <span id={`${id}-passphrase-hint`} className="field-hint">
            Envoyée une seule fois au coffre de ce poste, jamais affichée ni enregistrée ailleurs.
          </span>
        </>
      )}
      <div className="pat-actions">
        <button
          type={asForm ? "submit" : "button"}
          className={`btn btn-sm ${asForm ? "btn-secondary" : "btn-primary"}`}
          disabled={!ready || busy || disabled}
          onClick={asForm ? undefined : () => void submit()}
        >
          {mode === "sso" ? "Ouvrir le SSO" : "Ranger dans le coffre"}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-neutral btn-sm" onClick={onCancel}>
            Annuler
          </button>
        )}
      </div>
      {failure && (
        <span className="field-error" role="alert">
          {failure.text}
        </span>
      )}
    </>
  );
  if (!asForm) return <div className="pat-form snowflake-login">{fields}</div>;
  return (
    <form
      className="pat-form snowflake-login"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {fields}
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
  const [loginOpen, setLoginOpen] = useState(false);
  const oauth = useOAuth(
    (user) => api.authorize(ws.id, c.access_point, user),
    () => api.connectionStatus(ws.id, c.access_point),
    () => {
      setMessage(null);
      onChanged();
    },
  );
  const snowflake = c.platform === "snowflake";
  const mode = c.auth_mode === "keypair" ? "keypair" : "sso";
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
  } else if (loginOpen) {
    actions = (
      <SnowflakeLogin
        id={`sf-${c.access_point}`}
        mode={mode}
        login={c.login}
        keyFile={c.private_key_file}
        asForm
        onSso={(user) => {
          setLoginOpen(false);
          void oauth.connect(user);
        }}
        onKeyPair={async (keyPair) => {
          await api.keyPair(ws.id, c.access_point, keyPair);
          setLoginOpen(false);
          setMessage({ text: "Clé enregistrée : la passphrase est dans le coffre de ce poste.", tone: "ok" });
          onChanged();
        }}
        onCancel={() => setLoginOpen(false)}
      />
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
        onClick={() => {
          setMessage(null);
          if (snowflake) setLoginOpen(true);
          else void oauth.connect();
        }}
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
          {c.entity ?? "Groupe"} · {c.auth ? AUTHS[c.auth] : c.supported ? AUTHS[c.auth_mode ?? "oauth"] : "bientôt"}
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

type Draft = {
  platform: string;
  id: string;
  host: string;
  warehouse: string;
  schema: string;
  entity: string;
  freshness: string;
  /** Snowflake (plan 0018) : rôle, mode d'authentification, compte si l'hôte ne le dit pas. */
  role: string;
  auth: "sso" | "keypair";
  account: string;
};

const EMPTY_DRAFT: Draft = { platform: "", id: "", host: "", warehouse: "", schema: "", entity: "", freshness: "", role: "", auth: "sso", account: "" };

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
  if (draft.platform === "snowflake") {
    if (warehouse) point.warehouse = warehouse;
    if (draft.role.trim()) point.role = draft.role.trim();
    point.auth = draft.auth;
    if (draft.account.trim()) point.account = draft.account.trim();
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
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [keyStored, setKeyStored] = useState(false);
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
    (user) => api.authorizeDraft(ws.id, point, user),
    () => api.draftStatus(ws.id, point),
    () => setTest(null),
  );
  const snowflake = platform === "snowflake";

  const set = (key: keyof Draft) => (event: { target: { value: string } }) => {
    if (key === "entity") setEntityTouched(true);
    setDraft({ ...draft, platform, entity, [key]: event.target.value });
    setTest(null);
    setFailure(null);
    setDeclared(null);
    setKeyStored(false);
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

  const connected = oauth.flow.kind === "connected" || keyStored;
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
          <input
            placeholder={snowflake ? "xy12345.eu-west-1.snowflakecomputing.com" : "adb-xxxx.azuredatabricks.net"}
            value={draft.host}
            onChange={set("host")}
          />
        </Field>
        {platform === "databricks" && (
          <Field label="SQL warehouse" id="ap-warehouse" hint="Identifiant, ou chemin HTTP /sql/1.0/warehouses/…">
            <input className="mono" value={draft.warehouse} onChange={set("warehouse")} />
          </Field>
        )}
        {snowflake && (
          <>
            <Field label="Compte" id="ap-account" hint="Seulement si l'hôte n'est pas en …snowflakecomputing.com.">
              <input className="mono" value={draft.account} onChange={set("account")} />
            </Field>
            <Field label="Entrepôt" id="ap-warehouse" hint="Sinon, l'entrepôt par défaut de votre utilisateur.">
              <input className="mono" placeholder="WH_FINANCE" value={draft.warehouse} onChange={set("warehouse")} />
            </Field>
            <Field label="Rôle" id="ap-role">
              <input className="mono" value={draft.role} onChange={set("role")} />
            </Field>
            <Field label="Authentification" id="ap-auth">
              <Select value={draft.auth} onChange={set("auth")}>
                <option value="sso">SSO de l'entreprise</option>
                <option value="keypair">Paire de clés</option>
              </Select>
            </Field>
          </>
        )}
        <Field label="Schéma" id="ap-schema">
          <input className="mono" placeholder={snowflake ? "BASE.SCHEMA" : "catalogue.schema"} value={draft.schema} onChange={set("schema")} />
        </Field>
        <Field label="Fraîcheur" id="ap-freshness">
          <input placeholder="Quotidienne · 06:10" value={draft.freshness} onChange={set("freshness")} />
        </Field>

        {snowflake ? (
          <SnowflakeLogin
            key={`${id}/${draft.auth}`}
            id="ap-snowflake"
            mode={draft.auth}
            login={null}
            keyFile={null}
            asForm={false}
            disabled={!supported || oauth.flow.kind === "waiting"}
            onSso={(user) => void oauth.connect(user)}
            onKeyPair={async (keyPair) => {
              await api.keyPairDraft(ws.id, point, keyPair);
              setTest(null);
              setKeyStored(true);
            }}
          />
        ) : (
          <button type="button" className="btn btn-primary" disabled={!supported || oauth.flow.kind === "waiting"} onClick={() => void oauth.connect()}>
            {connected ? "Reconnecter avec OAuth" : "S'authentifier avec OAuth"}
          </button>
        )}
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
            {keyStored
              ? `Clé enregistrée : la passphrase est dans votre coffre, sous ${id}.`
              : snowflake
                ? `Connecté : la session SSO est rangée dans votre coffre, sous ${id}.`
                : `Connecté : le token est rangé dans votre coffre, sous ${id}.`}
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
