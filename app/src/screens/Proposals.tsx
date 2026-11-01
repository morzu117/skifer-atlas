import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  api,
  UnreachableError,
  type ProposalDetail,
  type ProposalGraphs,
  type ProposalItem,
  type ProposalQueue,
  type ProposalStatus,
  type Workspace,
} from "../api";
import { Banner } from "../components/Banner";
import { DiffColumns } from "../components/DiffColumns";
import { Select } from "../components/Select";
import { ago, initials, NATURES, plural } from "../format";
import { explain, type Explained } from "../messages";
import { href, setParams, type Params } from "../router";

// Propositions (guide 10.4) : la file à gauche, filtrée dans l'adresse ; à droite le détail,
// le diff deux colonnes, la justification et le fil. Les règles du décompte sont celles du
// serveur (plan 0006) : l'écran affiche ce qu'il dit, et pourquoi un bouton est grisé.

/** Prévenir la coque : le compteur « à valider » de la navigation se relit. */
export const PROPOSALS_CHANGED = "atlas:proposals-changed";

const STATUSES: { value: ProposalStatus; label: string }[] = [
  { value: "open", label: "Ouvertes" },
  { value: "merged", label: "Fusionnées" },
  { value: "closed", label: "Fermées" },
  { value: "all", label: "Toutes" },
];

const MINE = "mes-domaines";
// Une valeur vide sort de l'adresse : « Tous » a donc la sienne.
const ALL = "tous";
const CANONICAL = "canonique";

type Load<T> = { kind: "loading" } | { kind: "ready"; value: T } | { kind: "error"; error: Explained };

/** Le titre de la PR porte le libellé du document : « Revenu net — nordis-de v4 » pour une
 * variante (le KPI, puis l'entité), « Revenu net v5 » sinon. */
function labelOf(item: ProposalItem): string {
  return item.title.replace(/ v\d+$/, "").split(" — ")[0];
}

function heading(item: ProposalItem): string {
  const label = labelOf(item);
  if (item.document_kind === "variant") {
    return item.nature === "from_scratch"
      ? `Variante from scratch de ${label} — ${item.entity}`
      : `Surcharge sur ${label} — ${item.entity}`;
  }
  if (item.document_kind === "kpi" || item.document_kind === "concept") {
    return item.base_version === null ? `Nouveau document : ${label}` : `Nouvelle version de ${label} (v${item.version})`;
  }
  return item.title;
}

function kindWord(item: ProposalItem): string {
  if (item.document_kind === "variant") return item.nature === "from_scratch" ? "Variante" : "Surcharge";
  if (item.document_kind === "kpi" || item.document_kind === "concept") return "Canonique";
  return "Espace";
}

function approvalsText(item: ProposalItem): string {
  if (item.state === "merged") return "Fusionnée";
  if (item.state === "closed") return "Fermée";
  if (!item.approvals) return "";
  const { obtained, required } = item.approvals;
  const canonical = item.mention === "Validation canonique exigée" ? " (canonique requis)" : "";
  return `Validations : ${obtained} / ${required}${canonical}${item.ready_to_merge ? " · prête à fusionner" : ""}`;
}

/** Explication du serveur quand rien ne bloque sinon le nombre de validations. */
const counted = (item: ProposalItem) => `${item.approvals?.obtained ?? 0} validation(s) sur ${item.approvals?.required ?? 0}.`;

function names(nodes: { node: string; label: string | null }[]): string {
  return nodes.map((n) => (n.label ? `« ${n.label} » (${n.node})` : `« ${n.node} »`)).join(", ");
}

function and(values: string[]): string {
  return values.length < 2 ? values.join("") : `${values.slice(0, -1).join(", ")} et ${values[values.length - 1]}`;
}

export function Proposals({ ws, params, heading: title }: { ws: Workspace; params: Params; heading: RefObject<HTMLHeadingElement> }) {
  const status = (STATUSES.find((s) => s.value === params.status)?.value ?? "open") as ProposalStatus;
  const [queue, setQueue] = useState<Load<ProposalQueue>>({ kind: "loading" });
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<{ title: string; text: string; link?: { href: string; label: string } } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .proposalQueue(ws.id, status)
      .then((value) => alive && setQueue({ kind: "ready", value }))
      .catch((reason) => {
        // Serveur injoignable : le bandeau de la coque suffit.
        if (alive && !(reason instanceof UnreachableError)) setQueue({ kind: "error", error: explain(reason) });
      });
    return () => {
      alive = false;
    };
  }, [ws.id, status, revision]);

  const ready = queue.kind === "ready" ? queue.value : null;
  // « Mes domaines » par défaut pour un validateur ; « Tous » pour les autres comptes.
  const domain = params.domain || (ready && ready.review_domains.length > 0 ? MINE : ALL);
  const entity = params.entity ?? "";
  const items = (ready?.items ?? []).filter(
    (item) =>
      (domain === ALL || (domain === MINE ? ready!.review_domains.includes(item.domain ?? "") : item.domain === domain)) &&
      (entity === "" || (entity === CANONICAL ? item.entity === null : item.entity === entity)),
  );
  const selected = items.find((item) => String(item.id) === params.n) ?? items[0] ?? null;
  const name = (account: string) => ready?.members[account] ?? account;
  const domainLabel = (id: string | null) => ready?.domains.find((d) => d.id === id)?.label ?? id ?? "";

  const changed = (after?: typeof notice) => {
    setRevision((n) => n + 1);
    if (after !== undefined) setNotice(after);
    window.dispatchEvent(new Event(PROPOSALS_CHANGED));
  };

  return (
    <div className="proposals">
      <section className="queue" aria-labelledby="queue-title">
        <div className="queue-head">
          <h1 id="queue-title" ref={title} tabIndex={-1}>
            Propositions
          </h1>
          <div className="queue-filters">
            <Select
              aria-label="Domaine"
              className="select-filter"
              value={domain}
              onChange={(event) => setParams({ domain: event.target.value, n: "" }, { push: true })}
            >
              {ready && ready.review_domains.length > 0 && <option value={MINE}>Mes domaines</option>}
              <option value={ALL}>Tous les domaines</option>
              {ready?.domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Statut"
              className="select-filter"
              value={status}
              onChange={(event) => setParams({ status: event.target.value, n: "" }, { push: true })}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Entité"
              className="select-filter"
              value={entity}
              onChange={(event) => setParams({ entity: event.target.value, n: "" }, { push: true })}
            >
              <option value="">Toutes entités</option>
              <option value={CANONICAL}>Canonique</option>
              {ready?.entities.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {queue.kind === "loading" && (
          <p className="queue-empty muted" role="status">
            Chargement des propositions…
          </p>
        )}
        {queue.kind === "error" && (
          <Banner tone="bad" title={queue.error.title}>
            {queue.error.text}
          </Banner>
        )}
        {ready && items.length === 0 && (
          <p className="queue-empty muted">
            {ready.items.length === 0 ? "Aucune proposition." : "Aucune proposition ne correspond à ces filtres."}
          </p>
        )}
        {items.length > 0 && (
          <ul className="queue-list" aria-label="File des propositions">
            {items.map((item) => {
              const nature = NATURES[item.nature] ?? { label: item.nature, tone: "badge-neutral" };
              const current = selected?.id === item.id;
              return (
                <li key={item.id}>
                  <a
                    className={`queue-item${current ? " is-selected" : ""}`}
                    aria-current={current ? "true" : undefined}
                    href={href.view(ws.id, "propositions", { ...params, n: String(item.id) })}
                    onClick={() => setNotice(null)}
                  >
                    <span className="queue-item-head">
                      <span className="queue-item-title">
                        {labelOf(item)} · {item.entity ?? `canonique${item.version ? ` v${item.version}` : ""}`}
                      </span>
                      <span className={`badge ${nature.tone}`}>{nature.label}</span>
                    </span>
                    <span className="queue-item-meta">
                      {[kindWord(item), domainLabel(item.domain), `par ${name(item.author)}`, ago(item.created_at)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className="queue-item-count">{approvalsText(item)}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="proposal" aria-label="Proposition sélectionnée">
        {notice && (
          <Banner
            tone="info"
            title={notice.title}
            action={
              notice.link && (
                <a className="btn btn-neutral" href={notice.link.href}>
                  {notice.link.label}
                </a>
              )
            }
          >
            {notice.text}
          </Banner>
        )}
        {selected ? (
          <Detail key={selected.id} ws={ws} item={selected} revision={revision} name={name} domainLabel={domainLabel} onChanged={changed} />
        ) : (
          ready && !notice && <p className="muted">Sélectionner une proposition dans la file.</p>
        )}
      </section>
    </div>
  );
}

function Detail({
  ws,
  item,
  revision,
  name,
  domainLabel,
  onChanged,
}: {
  ws: Workspace;
  item: ProposalItem;
  revision: number;
  name: (account: string) => string;
  domainLabel: (id: string | null) => string;
  onChanged: (notice?: { title: string; text: string; link?: { href: string; label: string } } | null) => void;
}) {
  const [detail, setDetail] = useState<Load<ProposalDetail>>({ kind: "loading" });
  const [graphs, setGraphs] = useState<Load<ProposalGraphs>>({ kind: "loading" });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Explained | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .proposal(ws.id, item.id)
      .then((value) => alive && setDetail({ kind: "ready", value }))
      .catch((reason) => alive && setDetail({ kind: "error", error: explain(reason) }));
    return () => {
      alive = false;
    };
  }, [ws.id, item.id, revision]);

  useEffect(() => {
    let alive = true;
    api
      .proposalGraphs(ws.id, item.id)
      .then((value) => alive && setGraphs({ kind: "ready", value }))
      .catch((reason) => alive && setGraphs({ kind: "error", error: explain(reason) }));
    return () => {
      alive = false;
    };
  }, [ws.id, item.id]);

  const found = detail.kind === "ready" ? detail.value : null;
  const viewer = found?.viewer;
  const shown = found ?? item;
  const approvals = shown.approvals;
  const tipId = useId();

  async function act(run: () => Promise<unknown>, after?: Parameters<typeof onChanged>[0]) {
    setBusy(true);
    setFailure(null);
    try {
      await run();
      onChanged(after);
      return true;
    } catch (reason) {
      setFailure(explain(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const approve = () => {
    if (!viewer?.can_review || busy) return;
    void act(() => api.review(ws.id, item.id, "approve"));
  };

  const onMerge = () => {
    void act(() => api.merge(ws.id, item.id), {
      title: `Proposition n° ${item.id} fusionnée`,
      text: `${labelOf(item)}${item.entity ? ` — ${item.entity}` : ""} passe en v${item.version} sur la branche principale.`,
      link: { href: href.document(ws.id, item.document_id), label: "Voir la fiche" },
    });
  };

  const open = shown.state === "open";
  const fiche = item.base_version !== null || item.state === "merged";
  return (
    <article className="proposal-body">
      <header className="proposal-head">
        <div className="proposal-title">
          <h2>{heading(item)}</h2>
          <span className="muted">
            Proposée par {name(item.author)} · {item.base_version === null ? "nouveau document" : `basée sur la v${item.base_version}`}
            {item.domain && ` · ${domainLabel(item.domain)}`} · branche Git <span className="mono">{item.branch}</span>
            {fiche && (
              <>
                {" · "}
                <a href={href.document(ws.id, item.document_id)}>Voir la fiche</a>
              </>
            )}
          </span>
        </div>
        {open && viewer && (
          <div className="proposal-actions">
            {!shown.ready_to_merge && (
              <button
                type="button"
                className="btn btn-warn-outline"
                aria-disabled={!viewer.can_review || undefined}
                aria-describedby={viewer.can_review ? undefined : tipId}
                onClick={() => viewer.can_review && setAsking(true)}
              >
                Demander des changements
              </button>
            )}
            {viewer.can_merge ? (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={onMerge}>
                {busy ? "Fusion…" : "Fusionner"}
              </button>
            ) : (
              <span className="has-tip">
                <button
                  type="button"
                  className="btn btn-primary"
                  aria-disabled={!viewer.can_review || busy || undefined}
                  aria-describedby={viewer.can_review ? undefined : tipId}
                  onClick={approve}
                >
                  Approuver ({approvals?.obtained ?? 0} / {approvals?.required ?? 0})
                </button>
                {viewer.review_reason && (
                  <span id={tipId} role="tooltip" className="tip">
                    {viewer.review_reason}
                  </span>
                )}
              </span>
            )}
          </div>
        )}
        {!open && <span className="badge badge-neutral">{shown.state === "merged" ? "Fusionnée" : "Fermée"}</span>}
      </header>

      {/* Le simple décompte est déjà sur le bouton ; reste ce qui bloque autrement. */}
      {open && shown.explanation && !shown.ready_to_merge && shown.explanation !== counted(shown) && (
        <p className="proposal-status muted">{shown.explanation}</p>
      )}
      {/* Seul habilité (ADR 0008) : la fusion se fait sans revue, et la proposition le dit. */}
      {open && shown.merge_mode === "no_other_eligible" && shown.mention && <p className="proposal-status muted">{shown.mention}</p>}
      {failure && (
        <Banner tone="bad" title={failure.title}>
          {failure.text}
        </Banner>
      )}
      {asking && viewer?.can_review && (
        <ChangesForm
          busy={busy}
          onCancel={() => setAsking(false)}
          onSend={async (body) => {
            if (await act(() => api.review(ws.id, item.id, "request_changes", body))) setAsking(false);
          }}
        />
      )}

      {graphs.kind === "ready" && graphs.value.undeclared.length > 0 && (
        <Banner tone="warn" title="Surcharge hors des points de variation déclarés">
          {graphs.value.undeclared.length > 1 ? "Les éléments " : "L'élément "}
          {names(graphs.value.undeclared)} {graphs.value.undeclared.length > 1 ? "ne sont pas déclarés" : "n'est pas déclaré"}{" "}
          surchargeable{graphs.value.undeclared.length > 1 ? "s" : ""}. La validation de niveau canonique s'applique (
          {plural(approvals?.required ?? 0, "validateur")}).
          {graphs.value.recurring.map((r) => (
            <span key={r.node}>
              {" "}
              {and(r.entities)} surchargent tous {r.node} hors des points déclarés : envisager d'ajouter un point de
              variation au canonique.
            </span>
          ))}
        </Banner>
      )}

      <Graphs load={graphs} />

      <div className="proposal-cards">
        <section className="card proposal-card" aria-labelledby={`${tipId}-why`}>
          <h3 id={`${tipId}-why`} className="section-label">
            Justification de l'auteur
          </h3>
          <p className="fiche-text">{found?.justification || "—"}</p>
        </section>
        <Thread
          detail={found}
          name={name}
          busy={busy}
          onSend={(body) => act(() => api.comment(ws.id, item.id, body))}
        />
      </div>
    </article>
  );
}

function Graphs({ load }: { load: Load<ProposalGraphs> }) {
  if (load.kind === "loading") {
    return (
      <p className="muted" role="status">
        Préparation du diff…
      </p>
    );
  }
  if (load.kind === "error") {
    return (
      <Banner tone="bad" title={load.error.title}>
        {load.error.text}
      </Banner>
    );
  }
  const { base, proposed, report } = load.value;
  if (!proposed) return <p className="muted">Pas de graphe à comparer pour cette proposition.</p>;
  return <DiffColumns base={base} other={proposed} report={report} label="Diff de la proposition" />;
}

function ChangesForm({ busy, onCancel, onSend }: { busy: boolean; onCancel: () => void; onSend: (body: string) => void }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState(false);
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) {
      setError(true);
      field.current?.focus();
      return;
    }
    onSend(body.trim());
  };
  return (
    <form className="card form changes-form" onSubmit={submit} noValidate aria-label="Demander des changements">
      <div className="field">
        <label htmlFor={id}>
          Ce qui doit changer<span className="required"> requis</span>
        </label>
        <textarea
          id={id}
          ref={field}
          rows={3}
          value={body}
          aria-invalid={error || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            setBody(event.target.value);
            setError(false);
          }}
        />
        {error && (
          <span id={`${id}-error`} className="field-error">
            Expliquer ce qui doit changer : la demande part avec ce commentaire.
          </span>
        )}
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-warn-outline" disabled={busy}>
          Envoyer la demande
        </button>
        <button type="button" className="btn btn-neutral" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}

const REVIEWS: Record<string, string> = {
  approved: "a approuvé",
  changes_requested: "demande des changements",
  commented: "a commenté",
};

function Thread({
  detail,
  name,
  busy,
  onSend,
}: {
  detail: ProposalDetail | null;
  name: (account: string) => string;
  busy: boolean;
  onSend: (body: string) => Promise<boolean>;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState(false);
  const id = useId();

  // Commentaires et revues, dans l'ordre chronologique.
  const entries = [
    ...(detail?.comments ?? []).map((c) => ({ account: c.account, at: c.created_at, body: c.body, action: null as string | null })),
    ...(detail?.reviews ?? []).map((r) => ({ account: r.account, at: r.submitted_at, body: r.body, action: REVIEWS[r.state] ?? r.state })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) {
      setError(true);
      return;
    }
    if (await onSend(body.trim())) setBody("");
  };

  return (
    <section className="card proposal-card" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="section-label">
        Commentaires
      </h3>
      {entries.length === 0 && <p className="muted">Aucun commentaire.</p>}
      {entries.length > 0 && (
        <ol className="thread">
          {entries.map((entry, index) => (
            <li key={index} className="thread-item">
              <span className="avatar-xs" aria-hidden="true">
                {initials(name(entry.account))}
              </span>
              <span className="thread-text">
                <span>
                  <strong>{name(entry.account)}</strong>
                  {entry.action && ` ${entry.action}`} <span className="muted">· {ago(entry.at)}</span>
                </span>
                {entry.body && <span>{entry.body}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      <form className="thread-reply" onSubmit={submit} noValidate>
        <label htmlFor={id}>Répondre</label>
        <textarea
          id={id}
          rows={2}
          placeholder="Votre commentaire…"
          value={body}
          aria-invalid={error || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            setBody(event.target.value);
            setError(false);
          }}
        />
        {error && (
          <span id={`${id}-error`} className="field-error">
            Écrire un commentaire avant d'envoyer.
          </span>
        )}
        <button type="submit" className="btn btn-neutral" disabled={busy}>
          Envoyer
        </button>
      </form>
    </section>
  );
}
