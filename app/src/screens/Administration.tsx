import { useEffect, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import {
  api,
  ApiError,
  UnreachableError,
  type AdminSaved,
  type AdminState,
  type Governance,
  type GovernanceDomain,
  type GovernanceMember,
  type Levels,
  type Role,
  type Workspace,
} from "../api";
import { Banner } from "../components/Banner";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { Select } from "../components/Select";
import { ago, plural, slugify } from "../format";
import { explain, type Explained } from "../messages";
import { href } from "../router";

// Administration (guide 10.7, plan 0017) : le référent de l'espace modifie la gouvernance
// sur une copie locale ; « Enregistrer » en fait une proposition sur governance.yaml, que
// le serveur fusionne aussitôt si personne d'autre ne peut la relire (ADR 0008). Aucun
// token ici : les plateformes autorisées ne sont que des noms.

export const ROLES: Record<Role, string> = {
  referent: "Référent",
  validateur: "Validateur",
  contributeur: "Contributeur",
  lecteur: "Lecteur",
};
const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/;
const DOMAIN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const NO_REVIEW = "Fusionnée sans revue : aucun autre compte habilité";

/** Référents d'un domaine : ceux qu'il nomme, et les membres référents de ce domaine. */
export function domainReferents(g: Governance, id: string): string[] {
  const domain = g.domains.find((d) => d.id === id);
  const byRole = g.members.filter((m) => m.roles.some((r) => r.role === "referent" && r.domains.includes(id))).map((m) => m.account);
  return [...new Set([...(domain?.referents ?? []), ...byRole])];
}

function domainValidators(g: Governance, id: string): string[] {
  const domain = g.domains.find((d) => d.id === id);
  const byRole = g.members.filter((m) => m.roles.some((r) => r.role === "validateur" && r.domains.includes(id))).map((m) => m.account);
  return [...new Set([...(domain?.validators ?? []), ...byRole])];
}

/** Rôle le plus élevé d'un membre, comme le serveur (`role_of`). */
export function mainRole(g: Governance, m: GovernanceMember): Role {
  const order: Role[] = ["referent", "validateur", "contributeur", "lecteur"];
  const held = new Set<Role>(m.roles.map((r) => r.role));
  if (g.domains.some((d) => d.referents.includes(m.account))) held.add("referent");
  if (g.domains.some((d) => d.validators.includes(m.account))) held.add("validateur");
  return order.find((r) => held.has(r)) ?? "lecteur";
}

function memberDomains(g: Governance, m: GovernanceMember): string {
  if (m.roles.some((r) => r.domains.length === 0 && r.role !== "lecteur")) return "Tout l'espace";
  const ids = new Set([
    ...m.roles.flatMap((r) => r.domains),
    ...g.domains.filter((d) => d.referents.includes(m.account) || d.validators.includes(m.account)).map((d) => d.id),
  ]);
  const labels = g.domains.filter((d) => ids.has(d.id)).map((d) => d.label);
  return labels.length ? labels.join(", ") : "—";
}

const names = (g: Governance, accounts: string[]) => accounts.map((a) => g.members.find((m) => m.account === a)?.name ?? a).join(", ");
const levelsText = (l: Levels) => `canonique ${l.canonical} · déclinaisons ${l.variants}`;

/** Un nombre de validateurs : entier, au moins 1 (brief 5.2). */
function levelError(value: string): string | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? undefined : "Au moins 1.";
}

type Load = { kind: "loading" } | { kind: "ready"; state: AdminState } | { kind: "error"; error: Explained; forbidden: boolean };

export function Administration({ ws, heading }: { ws: Workspace; heading: RefObject<HTMLHeadingElement> }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [revision, setRevision] = useState(0);
  // Gardé ici : la fusion relit les paramètres, ce qui remonte le formulaire.
  const [saved, setSaved] = useState<AdminSaved | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .admin(ws.id)
      .then((state) => alive && setLoad({ kind: "ready", state }))
      .catch((reason) => {
        if (!alive || reason instanceof UnreachableError) return;
        setLoad({ kind: "error", error: explain(reason), forbidden: reason instanceof ApiError && reason.status === 403 });
      });
    return () => {
      alive = false;
    };
  }, [ws.id, revision]);

  return (
    <>
      <div className="main-head">
        <div className="main-title">
          <h1 ref={heading} tabIndex={-1}>
            Administration — {ws.name}
          </h1>
          <span className="muted">Réservée au référent d'annuaire. Les tokens d'accès ne sont jamais gérés ici.</span>
        </div>
      </div>
      {load.kind === "loading" && (
        <p className="muted" role="status">
          Chargement des paramètres…
        </p>
      )}
      {load.kind === "error" && (
        <Banner tone="bad" title={load.forbidden ? "Réservée aux référents de l'espace" : load.error.title}>
          {load.forbidden ? "Seul un référent de l'espace, sans restriction de domaine, modifie ses paramètres." : load.error.text}
        </Banner>
      )}
      {load.kind === "ready" && (
        <Settings
          key={load.state.base_digest}
          ws={ws}
          initial={load.state}
          saved={saved}
          setSaved={setSaved}
          onReload={() => setRevision((n) => n + 1)}
        />
      )}
    </>
  );
}

type Editing = { kind: "domain"; id: string | null } | { kind: "member"; account: string | null } | null;

function Settings({
  ws,
  initial,
  saved,
  setSaved,
  onReload,
}: {
  ws: Workspace;
  initial: AdminState;
  saved: AdminSaved | null;
  setSaved: (saved: AdminSaved | null) => void;
  onReload: () => void;
}) {
  const [draft, setDraft] = useState<Governance>(initial.governance);
  const [levels, setLevels] = useState({
    canonical: String(initial.governance.validators_required.canonical),
    variants: String(initial.governance.validators_required.variants),
  });
  const [repository, setRepository] = useState(initial.repository);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ error: Explained; issues: string[]; stale: boolean } | null>(null);

  const levelErrors = { canonical: levelError(levels.canonical), variants: levelError(levels.variants) };
  const proposed: Governance = {
    ...draft,
    validators_required: { canonical: Number(levels.canonical), variants: Number(levels.variants) },
  };
  const dirty = JSON.stringify(proposed) !== JSON.stringify(initial.governance);
  const referents = draft.members.filter((m) => m.roles.some((r) => r.role === "referent" && r.domains.length === 0)).length;
  const alone = initial.single_referent;

  function change(next: Governance) {
    setDraft(next);
    setSaved(null);
    setFailure(null);
  }

  function cancel() {
    setDraft(initial.governance);
    setLevels({ canonical: String(initial.governance.validators_required.canonical), variants: String(initial.governance.validators_required.variants) });
    setEditing(null);
    setFailure(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const result = await api.saveGovernance(ws.id, proposed, initial.base_digest);
      setSaved(result);
      if (result.merged) onReload();
    } catch (reason) {
      const issues = reason instanceof ApiError ? (reason.issues as { message?: string }[]).map((i) => i.message ?? "").filter(Boolean) : [];
      setFailure({ error: explain(reason), issues, stale: reason instanceof ApiError && reason.code === "stale_base" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin" onSubmit={(event) => void save(event)} noValidate>
      {alone && (
        <Banner tone="warn" title="Vous êtes le seul référent de l'espace">
          Vos modifications de la gouvernance sont fusionnées sans revue, avec la mention « {NO_REVIEW} ». Un deuxième référent, ajouté
          dans Utilisateurs et rôles, les fera relire.
        </Banner>
      )}
      <div className="admin-grid">
        <Section title="Domaines métier" id="admin-domains" action={editing === null && <AddButton label="Domaine" onClick={() => setEditing({ kind: "domain", id: null })} />}>
          <ul className="admin-list">
            {draft.domains.map((d) =>
              editing?.kind === "domain" && editing.id === d.id ? (
                <li key={d.id}>
                  <DomainForm
                    g={draft}
                    domain={d}
                    documents={initial.document_counts[d.id] ?? 0}
                    onApply={(next) => (change(replaceDomain(draft, d.id, next)), setEditing(null))}
                    onRemove={() => (change(withoutDomain(draft, d.id)), setEditing(null))}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li key={d.id} className="admin-row">
                  <DomainSummary g={draft} domain={d} kpis={initial.kpi_counts[d.id] ?? 0} />
                  {editing === null && (
                    <button type="button" className="btn btn-neutral btn-sm" aria-label={`Modifier le domaine ${d.label}`} onClick={() => setEditing({ kind: "domain", id: d.id })}>
                      Modifier
                    </button>
                  )}
                </li>
              ),
            )}
            {editing?.kind === "domain" && editing.id === null && (
              <li>
                <DomainForm g={draft} domain={null} onApply={(next) => (change({ ...draft, domains: [...draft.domains, next] }), setEditing(null))} onCancel={() => setEditing(null)} />
              </li>
            )}
          </ul>
          <span className="field-hint">Le canonique reste unique dans l'espace : un domaine organise, il ne cloisonne pas.</span>
        </Section>

        <Section title="Validateurs requis" id="admin-validators">
          <div className="admin-pair">
            <Field label="Canonique (min 1)" id="admin-canonical" error={levelErrors.canonical}>
              <input type="number" min={1} step={1} value={levels.canonical} onChange={(e) => (setLevels({ ...levels, canonical: e.target.value }), setSaved(null))} />
            </Field>
            <Field label="Déclinaisons (min 1)" id="admin-variants" error={levelErrors.variants}>
              <input type="number" min={1} step={1} value={levels.variants} onChange={(e) => (setLevels({ ...levels, variants: e.target.value }), setSaved(null))} />
            </Field>
          </div>
          <div className="admin-overrides">
            <span className="muted">Surcharges par domaine</span>
            {draft.domains.filter((d) => d.validators_required).length === 0 ? (
              <span className="field-hint">Aucune : « Modifier » sur un domaine pour en définir une.</span>
            ) : (
              <ul className="admin-list">
                {draft.domains
                  .filter((d) => d.validators_required)
                  .map((d) => (
                    <li key={d.id} className="admin-override">
                      <strong>{d.label}</strong>
                      <span>{levelsText(d.validators_required!)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
          <span className="field-hint">Une surcharge hors des points déclarés exige toujours le nombre canonique.</span>
        </Section>

        <Section title="Utilisateurs et rôles" id="admin-members" action={editing === null && <AddButton label="Inviter" onClick={() => setEditing({ kind: "member", account: null })} />}>
          {editing?.kind === "member" ? (
            <MemberForm
              g={draft}
              ws={ws}
              member={editing.account === null ? null : (draft.members.find((m) => m.account === editing.account) ?? null)}
              onApply={(next) => {
                const members = editing.account === null ? [...draft.members, next] : draft.members.map((m) => (m.account === editing.account ? next : m));
                change({ ...draft, members });
                setEditing(null);
              }}
              onRemove={(account) => (change(withoutMember(draft, account)), setEditing(null))}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div className="table-wrap">
              <table className="table table-dense admin-table" aria-label="Utilisateurs et rôles">
                <thead>
                  <tr>
                    <th scope="col">Nom</th>
                    <th scope="col">Entité</th>
                    <th scope="col">Rôle</th>
                    <th scope="col">Domaines</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {draft.members.map((m) => (
                    <tr key={m.account}>
                      <td>
                        <strong>{m.name}</strong>
                        <span className="admin-sub mono">{m.account}</span>
                      </td>
                      <td>{entityLabel(m.entity)}</td>
                      <td>{ROLES[mainRole(draft, m)]}</td>
                      <td>{memberDomains(draft, m)}</td>
                      <td>
                        {editing === null && (
                          <button type="button" className="link-button" aria-label={`Modifier ${m.name}`} onClick={() => setEditing({ kind: "member", account: m.account })}>
                            Modifier
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <div className="admin-stack">
          <Section title="Dépôt Git de l'espace" id="admin-repository">
            <Repository
              ws={ws}
              repository={repository}
              codeOwners={referents >= 2}
              onSynced={(next) => {
                setRepository(next);
                if (!dirty) onReload(); // relit la gouvernance si rien n'est en cours
              }}
            />
          </Section>
          <Section title="Plateformes autorisées" id="admin-platforms">
            <fieldset className="admin-platforms">
              <legend className="sr-only">Plateformes autorisées</legend>
              {initial.platforms.map((p) => {
                const checked = draft.allowed_platforms.includes(p.id);
                return (
                  <div key={p.id} className="admin-platform">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-describedby={`platform-${p.id}-auth`}
                        onChange={() =>
                          change({
                            ...draft,
                            allowed_platforms: checked
                              ? draft.allowed_platforms.filter((id) => id !== p.id)
                              : [...draft.allowed_platforms, p.id].sort((a, b) => order(initial, a) - order(initial, b)),
                          })
                        }
                      />
                      {p.label}
                    </label>
                    <span id={`platform-${p.id}-auth`} className="muted">
                      {p.auth}
                    </span>
                  </div>
                );
              })}
            </fieldset>
            <span className="field-hint">Les tokens restent dans le coffre personnel de chaque utilisateur.</span>
          </Section>
        </div>
      </div>

      {failure && (
        <Banner
          tone="bad"
          title={failure.error.title}
          action={
            failure.stale ? (
              <button type="button" className="btn btn-neutral btn-sm" onClick={onReload}>
                Relire les paramètres
              </button>
            ) : undefined
          }
        >
          {failure.error.text}
          {failure.issues.length > 0 && (
            <ul className="admin-issues">
              {failure.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </Banner>
      )}
      {saved && (
        <p className="tone-ok admin-saved" role="status">
          {saved.merged ? `Paramètres enregistrés : proposition n° ${saved.id} fusionnée sans revue.` : `Proposition n° ${saved.id} ouverte : elle attend la revue d'un autre référent.`}{" "}
          <a href={href.view(ws.id, "propositions", { n: String(saved.id), status: saved.merged ? "merged" : "open", domain: "tous" })}>Voir la proposition</a>
        </p>
      )}
      <div className="admin-actions">
        {editing !== null && <span className="field-hint">Appliquez ou annulez la modification en cours.</span>}
        <button type="button" className="btn btn-neutral" disabled={!dirty || busy} onClick={cancel}>
          Annuler
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!dirty || busy || editing !== null || saved !== null || Boolean(levelErrors.canonical || levelErrors.variants)}
        >
          {alone ? "Enregistrer et fusionner" : "Enregistrer et créer la proposition"}
        </button>
      </div>
    </form>
  );
}

const order = (state: AdminState, id: string) => {
  const found = state.platforms.findIndex((p) => p.id === id);
  return found < 0 ? state.platforms.length : found;
};

const entityLabel = (entity: string | null) => (!entity || entity === "groupe" ? "Groupe" : entity);

function replaceDomain(g: Governance, id: string, next: GovernanceDomain): Governance {
  return { ...g, domains: g.domains.map((d) => (d.id === id ? next : d)) };
}

/** Retire un membre, et son nom des référents et validateurs des domaines. */
export function withoutMember(g: Governance, account: string): Governance {
  return {
    ...g,
    members: g.members.filter((m) => m.account !== account),
    domains: g.domains.map((d) => ({ ...d, referents: d.referents.filter((a) => a !== account), validators: d.validators.filter((a) => a !== account) })),
  };
}

/** Retire un domaine. Un rôle limité à ce seul domaine disparaît : il ne s'élargit jamais à
 *  tout l'espace (une liste de domaines vide veut dire « tout l'espace »). Un membre sans
 *  rôle restant devient lecteur. */
export function withoutDomain(g: Governance, id: string): Governance {
  return {
    ...g,
    domains: g.domains.filter((d) => d.id !== id),
    members: g.members.map((m) => {
      if (!m.roles.some((r) => r.domains.includes(id))) return m;
      const roles = m.roles.flatMap((r) => {
        if (!r.domains.includes(id)) return [r];
        const domains = r.domains.filter((x) => x !== id);
        return domains.length > 0 ? [{ ...r, domains }] : [];
      });
      return { ...m, roles: roles.length > 0 ? roles : [{ role: "lecteur" as Role, domains: [] }] };
    }),
  };
}

const isSpaceReferent = (m: GovernanceMember) => m.roles.some((r) => r.role === "referent" && r.domains.length === 0);

function Section({ title, id, action, children }: { title: string; id: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card admin-section" aria-labelledby={id}>
      <div className="card-head">
        <h2 id={id} className="section-label">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={onClick}>
      <Icon name="plus" className="icon-sm" />
      {label}
    </button>
  );
}

function DomainSummary({ g, domain, kpis }: { g: Governance; domain: GovernanceDomain; kpis: number }) {
  const referents = domainReferents(g, domain.id);
  const validators = domainValidators(g, domain.id).length;
  return (
    <>
      <strong>{domain.label}</strong>
      {referents.length === 0 ? (
        <span className="tone-warn admin-warn">
          <Icon name="alert" className="icon-sm" />
          Aucun référent · {plural(kpis, "KPI", "KPI")}
        </span>
      ) : (
        <span className="muted">
          {referents.length > 1 ? "Référents" : "Référent"} {names(g, referents)} · {plural(validators, "validateur")} · {plural(kpis, "KPI", "KPI")}
        </span>
      )}
    </>
  );
}

/** Cases à cocher parmi les membres de l'espace. */
function Members({ legend, g, value, onChange }: { legend: string; g: Governance; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <fieldset className="admin-checks">
      <legend>{legend}</legend>
      <div className="checks">
        {g.members.map((m) => (
          <label key={m.account} className="check">
            <input
              type="checkbox"
              checked={value.includes(m.account)}
              onChange={(e) => onChange(e.target.checked ? [...value, m.account] : value.filter((a) => a !== m.account))}
            />
            {m.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function DomainForm({
  g,
  domain,
  documents = 0,
  onApply,
  onRemove,
  onCancel,
}: {
  g: Governance;
  domain: GovernanceDomain | null;
  documents?: number;
  onApply: (next: GovernanceDomain) => void;
  onRemove?: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(domain?.label ?? "");
  const [id, setId] = useState(domain?.id ?? "");
  const [idTouched, setIdTouched] = useState(false);
  const [referents, setReferents] = useState(domain?.referents ?? []);
  const [validators, setValidators] = useState(domain?.validators ?? []);
  const [override, setOverride] = useState(domain?.validators_required !== null && domain?.validators_required !== undefined);
  const [levels, setLevels] = useState({
    canonical: String(domain?.validators_required?.canonical ?? g.validators_required.canonical),
    variants: String(domain?.validators_required?.variants ?? g.validators_required.variants),
  });
  const [submitted, setSubmitted] = useState(false);
  const effectiveId = domain ? domain.id : idTouched ? id : slugify(label);
  const prefix = domain ? `domain-${domain.id}` : "domain-new";

  const errors = {
    label: label.trim() ? undefined : "Le libellé est requis.",
    id: domain
      ? undefined
      : !DOMAIN.test(effectiveId)
        ? "Minuscules, chiffres et tirets, 2 caractères au moins."
        : g.domains.some((d) => d.id === effectiveId)
          ? "Un domaine porte déjà cet identifiant."
          : undefined,
    canonical: override ? levelError(levels.canonical) : undefined,
    variants: override ? levelError(levels.variants) : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);

  function apply() {
    setSubmitted(true);
    if (!valid) return;
    onApply({
      id: effectiveId,
      label: label.trim(),
      referents,
      validators,
      validators_required: override ? { canonical: Number(levels.canonical), variants: Number(levels.variants) } : null,
    });
  }

  const shown = (error: string | undefined) => (submitted ? error : undefined);
  return (
    <div className="admin-subform" role="group" aria-label={domain ? `Domaine ${domain.label}` : "Nouveau domaine"}>
      <Field label="Libellé" id={`${prefix}-label`} required error={shown(errors.label)}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      {domain ? (
        <span className="field-hint">
          Identifiant <span className="mono">{domain.id}</span> : il ne change pas, les documents y font référence.
        </span>
      ) : (
        <Field label="Identifiant" id={`${prefix}-id`} required error={shown(errors.id)} hint="Ne change plus ensuite : les documents y font référence.">
          <input
            className="mono"
            value={effectiveId}
            onChange={(e) => {
              setIdTouched(true);
              setId(e.target.value);
            }}
          />
        </Field>
      )}
      <Members legend="Référents" g={g} value={referents} onChange={setReferents} />
      <Members legend="Validateurs" g={g} value={validators} onChange={setValidators} />
      <label className="check">
        <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
        Nombre de validateurs propre au domaine
      </label>
      {override && (
        <div className="admin-pair">
          <Field label="Canonique (min 1)" id={`${prefix}-canonical`} error={shown(errors.canonical)}>
            <input type="number" min={1} step={1} value={levels.canonical} onChange={(e) => setLevels({ ...levels, canonical: e.target.value })} />
          </Field>
          <Field label="Déclinaisons (min 1)" id={`${prefix}-variants`} error={shown(errors.variants)}>
            <input type="number" min={1} step={1} value={levels.variants} onChange={(e) => setLevels({ ...levels, variants: e.target.value })} />
          </Field>
        </div>
      )}
      <div className="admin-subform-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={apply}>
          {domain ? "Appliquer" : "Ajouter le domaine"}
        </button>
        <button type="button" className="btn btn-neutral btn-sm" onClick={onCancel}>
          Annuler
        </button>
        {domain && onRemove && (
          <button type="button" className="btn btn-danger btn-sm" disabled={documents > 0} aria-describedby={`${prefix}-remove-hint`} onClick={onRemove}>
            Retirer le domaine
          </button>
        )}
      </div>
      {domain && onRemove && (
        <span id={`${prefix}-remove-hint`} className="field-hint">
          {documents > 0
            ? `${plural(documents, "document rattaché", "documents rattachés")} : les rattacher à un autre domaine avant de le retirer.`
            : "Les rôles limités à ce domaine sont retirés à leurs membres."}
        </span>
      )}
    </div>
  );
}

function MemberForm({
  g,
  ws,
  member,
  onApply,
  onRemove,
  onCancel,
}: {
  g: Governance;
  ws: Workspace;
  member: GovernanceMember | null;
  onApply: (next: GovernanceMember) => void;
  onRemove: (account: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(member?.name ?? "");
  const [account, setAccount] = useState(member?.account ?? "");
  const [entity, setEntity] = useState(member?.entity ?? "groupe");
  const [roles, setRoles] = useState<{ role: Role; domains: string[] }[]>(
    member && member.roles.length > 0 ? member.roles.map((r) => ({ role: r.role, domains: [...r.domains] })) : [{ role: "contributeur", domains: [] }],
  );
  const [submitted, setSubmitted] = useState(false);
  const entities = [...new Set(["groupe", ...ws.entities, ...(member?.entity ? [member.entity] : [])])];
  const prefix = member ? `member-${member.account}` : "member-new";
  const several = roles.length > 1;
  // Dernier référent de l'espace : le retirer laisserait l'espace sans administration.
  const lastReferent = member !== null && isSpaceReferent(member) && g.members.filter(isSpaceReferent).length === 1;

  const errors = {
    name: name.trim() ? undefined : "Le nom est requis.",
    account: member
      ? undefined
      : !ACCOUNT.test(account.trim())
        ? "Le compte de la personne sur l'hébergeur (lettres, chiffres, . _ -)."
        : g.members.some((m) => m.account === account.trim())
          ? "Ce compte est déjà membre de l'espace."
          : undefined,
  };
  const roleErrors = roles.map((r, i) => (roles.findIndex((o) => o.role === r.role) < i ? "Ce rôle figure déjà : regroupez ses domaines." : undefined));

  function setRole(index: number, next: { role: Role; domains: string[] }) {
    setRoles(roles.map((r, i) => (i === index ? next : r)));
  }

  function apply() {
    setSubmitted(true);
    if (errors.name || errors.account || roleErrors.some(Boolean)) return;
    onApply({
      account: member?.account ?? account.trim(),
      name: name.trim(),
      entity: entity || null,
      roles: roles.map((r) => ({ role: r.role, domains: r.role === "lecteur" ? [] : r.domains })),
    });
  }

  const shown = (error: string | undefined) => (submitted ? error : undefined);
  return (
    <div className="admin-subform" role="group" aria-label={member ? `Membre ${member.name}` : "Nouveau membre"}>
      <Field label="Nom" id={`${prefix}-name`} required error={shown(errors.name)}>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {member ? (
        <span className="field-hint">
          Compte <span className="mono">{member.account}</span>
        </span>
      ) : (
        <Field label="Compte sur l'hébergeur Git" id={`${prefix}-account`} required error={shown(errors.account)}>
          <input className="mono" autoComplete="off" spellCheck={false} value={account} onChange={(e) => setAccount(e.target.value)} />
        </Field>
      )}
      <Field label="Entité" id={`${prefix}-entity`}>
        <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
          {entities.map((e) => (
            <option key={e} value={e}>
              {entityLabel(e)}
            </option>
          ))}
        </Select>
      </Field>
      {roles.map((r, index) => {
        const label = several ? `Rôle ${index + 1}` : "Rôle";
        return (
          <div key={index} className="admin-role" role="group" aria-label={label}>
            <Field label={label} id={`${prefix}-role-${index}`} error={shown(roleErrors[index])}>
              <Select value={r.role} onChange={(e) => setRole(index, { ...r, role: e.target.value as Role })}>
                {(Object.keys(ROLES) as Role[]).map((role) => (
                  <option key={role} value={role}>
                    {ROLES[role]}
                  </option>
                ))}
              </Select>
            </Field>
            {r.role !== "lecteur" && (
              <fieldset className="admin-checks">
                <legend>{several ? `Domaines du rôle ${index + 1} (aucun : tout l'espace)` : "Domaines (aucun : tout l'espace)"}</legend>
                <div className="checks">
                  {g.domains.map((d) => (
                    <label key={d.id} className="check">
                      <input
                        type="checkbox"
                        checked={r.domains.includes(d.id)}
                        onChange={(e) => setRole(index, { ...r, domains: e.target.checked ? [...r.domains, d.id] : r.domains.filter((x) => x !== d.id) })}
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {several && (
              <button type="button" className="link-button" onClick={() => setRoles(roles.filter((_, i) => i !== index))}>
                Retirer le rôle {index + 1}
              </button>
            )}
          </div>
        );
      })}
      {roles.length < Object.keys(ROLES).length && (
        <button type="button" className="link-button" onClick={() => setRoles([...roles, { role: (Object.keys(ROLES) as Role[]).find((x) => !roles.some((r) => r.role === x)) ?? "lecteur", domains: [] }])}>
          + Ajouter un rôle
        </button>
      )}
      {!member && <span className="field-hint">Atlas ajoute la personne à governance.yaml ; l'accès au dépôt se donne sur l'hébergeur.</span>}
      <div className="admin-subform-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={apply}>
          {member ? "Appliquer" : "Ajouter le membre"}
        </button>
        <button type="button" className="btn btn-neutral btn-sm" onClick={onCancel}>
          Annuler
        </button>
        {member && (
          <button type="button" className="btn btn-danger btn-sm" disabled={lastReferent} aria-describedby={`${prefix}-remove-hint`} onClick={() => onRemove(member.account)}>
            Retirer de l'espace
          </button>
        )}
      </div>
      {member && (
        <span id={`${prefix}-remove-hint`} className="field-hint">
          {lastReferent
            ? "Seul référent de l'espace : nommez-en un autre avant de le retirer."
            : member.account === ws.account
              ? "Vous retirer vous ôtera l'administration de l'espace une fois la proposition fusionnée."
              : "L'accès au dépôt se retire sur l'hébergeur."}
        </span>
      )}
    </div>
  );
}

function Repository({
  ws,
  repository,
  codeOwners,
  onSynced,
}: {
  ws: Workspace;
  repository: AdminState["repository"];
  codeOwners: boolean;
  onSynced: (next: AdminState["repository"]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "bad" | "warn" } | null>(null);

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.sync(ws.id);
      const warning = result.warnings[0]?.message;
      setMessage(
        warning
          ? { text: warning, tone: "warn" }
          : { text: result.reindexed ? "Synchronisé · index reconstruit." : "Déjà à jour avec le dépôt distant.", tone: "ok" },
      );
      onSynced({ ...repository, synced_at: result.synced_at, index_fresh: true });
    } catch (reason) {
      setMessage({ text: explain(reason).text, tone: "bad" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <dl className="facts admin-facts">
        <div>
          <dt>URL</dt>
          <dd className="mono">{repository.url || "Pas encore de dépôt distant"}</dd>
        </div>
        <div>
          <dt>Branche principale</dt>
          <dd className="mono">{repository.main_branch}</dd>
        </div>
        <div>
          <dt>Dernière synchronisation</dt>
          <dd className={repository.index_fresh ? "tone-ok" : "tone-warn"}>
            {repository.synced_at ? ago(repository.synced_at) : "jamais"} · {repository.index_fresh ? "index à jour" : "index à reconstruire"}
          </dd>
        </div>
      </dl>
      {repository.url && (
        <button type="button" className="btn btn-neutral btn-sm" disabled={busy} onClick={() => void sync()}>
          {busy ? "Synchronisation…" : "Synchroniser"}
        </button>
      )}
      {message && (
        <span className={`tone-${message.tone} admin-message`} role="status">
          {message.text}
        </span>
      )}
      {codeOwners && (
        <span className="field-hint">
          Sur l'hébergeur, activez la règle de branche « Require review from Code Owners » sur{" "}
          <span className="mono">{repository.main_branch}</span> : une fusion faite hors d'Atlas ne contourne plus les validateurs.
        </span>
      )}
    </>
  );
}
