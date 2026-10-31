import { useEffect, useState, type ReactNode, type RefObject } from "react";
import {
  api,
  UnreachableError,
  type ComparisonRun,
  type DiffReport,
  type DocumentSheet,
  type ExtractResult,
  type GraphLayout,
  type Implementation,
  type Version,
  type Workspace,
} from "../api";
import { Banner } from "../components/Banner";
import { DiffColumns } from "../components/DiffColumns";
import { DiffList, DiffSummary, marksOf } from "../components/DiffList";
import { GraphView } from "../components/GraphView";
import { Icon } from "../components/Icon";
import { Select } from "../components/Select";
import { ago, KIND_LABELS, longDate, percent, plural, STATUS_LABELS, tolerance } from "../format";
import { explain, type Explained } from "../messages";
import { href, setParams, type Params } from "../router";

// Fiche d'un KPI ou d'un concept (guide 10.2, plan 0012). L'onglet ouvert et les versions
// comparées vivent dans l'adresse : `#/w/<espace>/fiche/<id>?tab=versions&base=3&other=4`.

type Tab = "definition" | "declinaisons" | "versions" | "dependances" | "implementations" | "scope";

const TABS: { id: Tab; label: string; kpiOnly?: boolean }[] = [
  { id: "definition", label: "Définition" },
  { id: "declinaisons", label: "Déclinaisons", kpiOnly: true },
  { id: "versions", label: "Versions" },
  { id: "dependances", label: "Dépendances" },
  { id: "implementations", label: "Implémentations", kpiOnly: true },
  { id: "scope", label: "Scope et comparaisons", kpiOnly: true },
];

const SEMANTICS: Record<string, string> = { calendar: "Calendrier", timezone: "Fuseau d'évaluation", currency: "Devise" };
const PLATFORMS: Record<string, string> = { databricks: "Databricks", snowflake: "Snowflake" };
const FIDELITY: Record<string, string> = { verified: "vérifiée", differs: "écarts au SQL source", skipped: "non vérifiée" };
const RUN_STATUS: Record<string, string> = {
  running: "En cours",
  done: "Terminée",
  partial: "Partielle",
  failed: "Échouée",
  cancelled: "Annulée",
};

type Load<T> = { kind: "loading" } | { kind: "ready"; value: T } | { kind: "error"; error: Explained };

/** Charge une ressource à chaque changement de `deps` ; ignore une réponse périmée. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Load<T> {
  const [state, setState] = useState<Load<T>>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
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

function Failure({ error }: { error: Explained }) {
  return (
    <Banner tone="bad" title={error.title}>
      {error.text}
    </Banner>
  );
}

function Pending({ children }: { children: ReactNode }) {
  return (
    <p className="muted" role="status">
      {children}
    </p>
  );
}

export function Fiche({
  ws,
  id,
  params,
  heading,
}: {
  ws: Workspace;
  id: string;
  params: Params;
  heading: RefObject<HTMLHeadingElement>;
}) {
  const sheet = useLoad(() => api.sheet(ws.id, id), [ws.id, id]);
  // Le titre définitif remplace celui du chargement, qui avait le focus : il le reprend.
  useEffect(() => {
    if (sheet.kind === "ready" && document.activeElement === document.body) heading.current?.focus();
  }, [sheet.kind, heading]);
  const back = (
    <a className="back" href={href.view(ws.id, "catalogue", { sel: id })}>
      <Icon name="back" className="icon-sm" />
      Catalogue
    </a>
  );

  if (sheet.kind !== "ready") {
    return (
      <>
        {back}
        <h1 ref={heading} tabIndex={-1}>
          {sheet.kind === "loading" ? "Fiche" : "Fiche introuvable"}
        </h1>
        {sheet.kind === "loading" ? <Pending>Chargement de la fiche…</Pending> : <Failure error={sheet.error} />}
      </>
    );
  }

  const doc = sheet.value;
  const kpi = doc.kind === "kpi";
  const tabs = TABS.filter((tab) => kpi || !tab.kpiOnly);
  const tab = tabs.find((t) => t.id === params.tab)?.id ?? "definition";
  const counts: Partial<Record<Tab, number>> = { declinaisons: doc.variants.length, versions: doc.version_count };

  return (
    <>
      {back}
      <FicheHeader ws={ws} doc={doc} heading={heading} />
      <nav aria-label="Onglets de la fiche" className="tabs">
        {tabs.map((t) => (
          <a
            key={t.id}
            className="tab"
            href={href.document(ws.id, id, t.id === "definition" ? {} : { tab: t.id })}
            aria-current={t.id === tab ? "page" : undefined}
          >
            {t.label}
            {counts[t.id] !== undefined && <span className="tab-count">{counts[t.id]}</span>}
          </a>
        ))}
      </nav>
      {tab === "definition" && <Definition ws={ws} doc={doc} />}
      {tab === "definition" && doc.kind === "variant" && <AgainstCanonical ws={ws} doc={doc} params={params} />}
      {tab === "declinaisons" && <Variants doc={doc} />}
      {tab === "versions" && <Versions ws={ws} doc={doc} params={params} />}
      {tab === "dependances" && <Dependencies ws={ws} doc={doc} />}
      {tab === "implementations" && <Implementations ws={ws} doc={doc} />}
      {tab === "scope" && <ScopeAndComparisons ws={ws} doc={doc} />}
    </>
  );
}

function FicheHeader({ ws, doc, heading }: { ws: Workspace; doc: DocumentSheet; heading: RefObject<HTMLHeadingElement> }) {
  const status =
    doc.status === "validated" && doc.validated_at
      ? `validée le ${longDate(doc.validated_at)}`
      : (STATUS_LABELS[doc.status] ?? doc.status);
  const meta = [
    `Propriétaire : ${doc.owner_name ?? doc.owner ?? "—"}`,
    doc.validators_required !== null && `Validateurs : ${doc.validators_required} requis (canonique)`,
    doc.synonyms.length > 0 && `Synonymes : ${doc.synonyms.join(", ")}`,
  ].filter(Boolean);
  return (
    <div className="fiche-head">
      <div className="fiche-title">
        <div className="fiche-badges">
          <h1 ref={heading} tabIndex={-1}>
            {doc.label}
          </h1>
          <span className={`type type-${doc.kind}`}>{KIND_LABELS[doc.kind] ?? doc.kind}</span>
          {doc.domain && <span className="badge badge-pale">{doc.domain_label ?? doc.domain}</span>}
          {doc.version !== null && (
            <span className="badge badge-neutral">
              v{doc.version} · {status}
            </span>
          )}
        </div>
        <p className="muted">{meta.join(" · ")}</p>
      </div>
      <div className="fiche-actions">
        {doc.kind === "kpi" && (
          <a className="btn btn-secondary" href={href.view(ws.id, "comparaison", { kpi: doc.id })}>
            Lancer une comparaison
          </a>
        )}
        {ws.role !== "lecteur" && (
          <a className="btn btn-primary" href={href.editor(ws.id, { from: doc.id })}>
            Proposer une modification
          </a>
        )}
      </div>
    </div>
  );
}

function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="tab-panel" aria-labelledby="tab-panel-title">
      <div className="panel-head">
        <h2 id="tab-panel-title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function ModeBadge({ mode, count }: { mode: string; count: number }) {
  return mode === "from_scratch" ? (
    <span className="badge badge-warn">From scratch · candidate</span>
  ) : (
    <span className="badge badge-pale">Surcharge · {count}</span>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span>
        <span className="legend-swatch swatch-variation" aria-hidden="true" />
        Point de variation déclaré
      </span>
      <span>
        <span className="legend-swatch family-ref" aria-hidden="true" />
        Référence à un KPI
      </span>
      <span>
        <span className="legend-swatch swatch-output" aria-hidden="true" />
        Résultat
      </span>
    </div>
  );
}

function Definition({ ws, doc }: { ws: Workspace; doc: DocumentSheet }) {
  const kpi = doc.kind === "kpi";
  const title = kpi ? "Graphe canonique (lecture seule)" : "Graphe (lecture seule)";
  return (
    <Panel title={doc.has_graph ? title : "Définition"} aside={doc.has_graph ? <Legend /> : undefined}>
      {doc.description && <p className="fiche-text">{doc.description}</p>}
      {doc.has_graph && <Graph ws={ws} id={doc.id} label={`Graphe de ${doc.label}`} />}
      <div className="cards">
        {kpi ? (
          <div className="card">
            <span className="section-label">Sémantique déclarée</span>
            <dl className="facts">
              {doc.semantics.map((s) => (
                <div key={s.key}>
                  <dt>{SEMANTICS[s.key] ?? s.key}</dt>
                  <dd>
                    {s.value}
                    {s.variation && " (variation)"}
                  </dd>
                </div>
              ))}
              <div>
                <dt>Arrondi</dt>
                <dd>À la restitution</dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="card">
            <span className="section-label">Entité</span>
            <dl className="facts">
              <div>
                <dt>Clé</dt>
                <dd className="mono">{doc.entity?.key?.join(", ") ?? "—"}</dd>
              </div>
              {(doc.entity?.attributes ?? []).map((a) => (
                <div key={a.name}>
                  <dt className="mono">{a.name}</dt>
                  <dd>{a.type}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {kpi && (
          <div className="card">
            <span className="section-label">Déclinaisons</span>
            {doc.variants.length === 0 ? (
              <p className="muted">Aucune déclinaison.</p>
            ) : (
              <ul className="card-list">
                {doc.variants.map((v) => (
                  <li key={v.id}>
                    <strong>{v.entity}</strong>
                    <ModeBadge mode={v.mode} count={v.override_count} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="card">
          <span className="section-label">Dépendances (tous domaines)</span>
          <DependencyFacts doc={doc} />
          <Impact count={doc.dependencies.impact} />
        </div>
      </div>
    </Panel>
  );
}

/** Une déclinaison face à son canonique (0015) : `?diff=canonique&node=n02` ouvre le diff
 * avec le nœud entouré, depuis « Nœud divergent » de la comparaison. */
function AgainstCanonical({ ws, doc, params }: { ws: Workspace; doc: DocumentSheet; params: Params }) {
  const open = params.diff === "canonique";
  return (
    <section className="tab-panel" aria-labelledby="against-canonical">
      <div className="panel-head">
        <h2 id="against-canonical">Écarts au canonique</h2>
        {!open && (
          <a className="btn btn-secondary" href={href.document(ws.id, doc.id, { diff: "canonique" })}>
            Comparer au canonique
          </a>
        )}
      </div>
      {open && <CanonicalDiffView ws={ws} doc={doc} node={params.node} />}
    </section>
  );
}

function CanonicalDiffView({ ws, doc, node }: { ws: Workspace; doc: DocumentSheet; node?: string }) {
  const found = useLoad(() => api.canonicalDiff(ws.id, doc.id), [ws.id, doc.id]);
  if (found.kind === "loading") return <Pending>Préparation du diff…</Pending>;
  if (found.kind === "error") return <Failure error={found.error} />;
  const { base, other, report } = found.value;
  const title = node && (other.nodes.find((n) => n.id === node) ?? base.nodes.find((n) => n.id === node))?.title;
  return (
    <>
      {node && (
        <p className="fiche-text">
          Nœud sélectionné : <span className="mono">{node}</span>
          {title && ` · ${title}`}
        </p>
      )}
      <DiffColumns base={base} other={other} report={report} label={`Diff de ${doc.label} au canonique`} selected={node} />
    </>
  );
}

function names(items: DocumentSheet["dependencies"]["references"]) {
  if (items.length === 0) return "—";
  return items.map((d) => `${d.label ?? d.id}${d.domain_label ? ` (${d.domain_label})` : ""}`).join(" · ");
}

function DependencyFacts({ doc }: { doc: DocumentSheet }) {
  return (
    <dl className="facts facts-stacked">
      <div>
        <dt>Références</dt>
        <dd>{names(doc.dependencies.references)}</dd>
      </div>
      <div>
        <dt>Référencé par</dt>
        <dd>{names(doc.dependencies.referenced_by)}</dd>
      </div>
    </dl>
  );
}

function Impact({ count }: { count: number }) {
  return count > 0 ? (
    <p className="fact-warn">Une nouvelle version touchera {plural(count, "document")}.</p>
  ) : (
    <p className="muted">Aucun document n'en dépend.</p>
  );
}

function Graph({ ws, id, label }: { ws: Workspace; id: string; label: string }) {
  const layout = useLoad(() => api.layout(ws.id, id), [ws.id, id]);
  if (layout.kind === "loading") return <Pending>Chargement du graphe…</Pending>;
  if (layout.kind === "error") return <Failure error={layout.error} />;
  return <GraphView layout={layout.value} label={label} />;
}

function Variants({ doc }: { doc: DocumentSheet }) {
  return (
    <Panel title="Déclinaisons">
      {doc.variants.length === 0 ? (
        <p className="muted">Ce KPI n'a pas de déclinaison : toutes les entités suivent le canonique.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Entité</th>
                <th scope="col">Mode</th>
                <th scope="col">Surcharges</th>
                <th scope="col">Justification</th>
                <th scope="col">Candidate à la convergence</th>
              </tr>
            </thead>
            <tbody>
              {doc.variants.map((v) => (
                <tr key={v.id}>
                  <th scope="row">{v.entity}</th>
                  <td>
                    <ModeBadge mode={v.mode} count={v.override_count} />
                  </td>
                  <td>
                    {v.mode === "from_scratch"
                      ? "—"
                      : `${v.override_count}${v.undeclared_count > 0 ? `, dont ${v.undeclared_count} hors points déclarés` : ""}`}
                  </td>
                  <td>{v.justification ?? "—"}</td>
                  <td>{v.mode === "from_scratch" ? "Oui" : "Non"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Versions({ ws, doc, params }: { ws: Workspace; doc: DocumentSheet; params: Params }) {
  const versions = useLoad(() => api.versions(ws.id, doc.id), [ws.id, doc.id]);
  const list = versions.kind === "ready" ? versions.value : [];
  // Par défaut : l'avant-dernière contre la dernière.
  const wantedBase = params.base ?? String(list.at(-2)?.version ?? "");
  const wantedOther = params.other ?? String(list.at(-1)?.version ?? "");
  const [base, setBase] = useState(wantedBase);
  const [other, setOther] = useState(wantedOther);
  useEffect(() => setBase(wantedBase), [wantedBase]);
  useEffect(() => setOther(wantedOther), [wantedOther]);

  return (
    <Panel title="Versions">
      {versions.kind === "loading" && <Pending>Chargement des versions…</Pending>}
      {versions.kind === "error" && <Failure error={versions.error} />}
      {versions.kind === "ready" && list.length === 0 && (
        <p className="muted">Aucune version taguée : la première fusion d'une proposition posera la v1.</p>
      )}
      {list.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Date</th>
                <th scope="col">Auteur</th>
                <th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>
              {[...list].reverse().map((v: Version) => (
                <tr key={v.version}>
                  <th scope="row">
                    v{v.version}
                    {v.version === doc.version && <span className="muted"> · courante</span>}
                  </th>
                  <td>{longDate(v.date)}</td>
                  <td>{v.author}</td>
                  <td>{v.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length > 1 && (
        <form
          className="compare-form"
          onSubmit={(event) => {
            event.preventDefault();
            setParams({ tab: "versions", base, other }, { push: true });
          }}
        >
          <label className="filter">
            De
            <Select value={base} onChange={(event) => setBase(event.target.value)}>
              {list.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}
                </option>
              ))}
            </Select>
          </label>
          <label className="filter">
            À
            <Select value={other} onChange={(event) => setOther(event.target.value)}>
              {list.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}
                </option>
              ))}
            </Select>
          </label>
          <button className="btn btn-secondary" type="submit">
            Afficher les écarts
          </button>
        </form>
      )}
      {params.base && params.other && (
        <VersionDiff ws={ws} doc={doc} base={Number(params.base)} other={Number(params.other)} />
      )}
    </Panel>
  );
}

function VersionDiff({ ws, doc, base, other }: { ws: Workspace; doc: DocumentSheet; base: number; other: number }) {
  const found = useLoad(
    () =>
      Promise.all([
        api.versionDiff(ws.id, doc.id, base, other),
        api.layout(ws.id, doc.id, base),
        api.layout(ws.id, doc.id, other),
      ]),
    [ws.id, doc.id, base, other],
  );
  if (found.kind === "loading") return <Pending>Calcul des écarts…</Pending>;
  if (found.kind === "error") return <Failure error={found.error} />;
  const [report, before, after] = found.value;
  const marks = marksOf(report);
  return (
    <section className="diff" aria-labelledby="diff-title">
      <h3 id="diff-title">
        Écarts de v{base} à v{other}
      </h3>
      <DiffSummary report={report} />
      {!report.identical && <DiffList report={report} />}
      <GraphPair before={before} after={after} base={base} other={other} marks={marks} />
    </section>
  );
}

function GraphPair({
  before,
  after,
  base,
  other,
  marks,
}: {
  before: GraphLayout;
  after: GraphLayout;
  base: number;
  other: number;
  marks: ReturnType<typeof marksOf>;
}) {
  return (
    <div className="graph-pair">
      <span className="section-label">Version {base}</span>
      <GraphView layout={before} label={`Graphe de la version ${base}`} marks={marks.base} />
      <span className="section-label">Version {other}</span>
      <GraphView layout={after} label={`Graphe de la version ${other}`} marks={marks.other} />
    </div>
  );
}

function Dependencies({ ws, doc }: { ws: Workspace; doc: DocumentSheet }) {
  const lists = [
    { title: "Références", items: doc.dependencies.references, empty: "Ne s'appuie sur aucun autre document." },
    { title: "Référencé par", items: doc.dependencies.referenced_by, empty: "Aucun document ne le référence." },
  ];
  return (
    <Panel title="Dépendances">
      <Impact count={doc.dependencies.impact} />
      <div className="cards">
        {lists.map(({ title, items, empty }) => (
          <section key={title} className="card" aria-label={title}>
            <span className="section-label">
              {title} ({items.length})
            </span>
            {items.length === 0 ? (
              <p className="muted">{empty}</p>
            ) : (
              <ul className="card-list">
                {items.map((d) => (
                  <li key={`${d.id}-${d.kind}`}>
                    {d.found === false ? (
                      <span>{d.id} (introuvable)</span>
                    ) : (
                      <a href={href.document(ws.id, d.id)}>{d.label ?? d.id}</a>
                    )}
                    <span className="muted">
                      {[KIND_LABELS[d.document_kind ?? ""] ?? d.document_kind, d.domain_label ?? d.domain, d.version && `v${d.version}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </Panel>
  );
}

function Implementations({ ws, doc }: { ws: Workspace; doc: DocumentSheet }) {
  return (
    <Panel title="Implémentations">
      {doc.implementations.length === 0 ? (
        <p className="muted">
          Aucun fichier sous <span className="mono">implementations/{doc.id}/</span>.
        </p>
      ) : (
        doc.implementations.map((implementation) => (
          <ImplementationCard key={implementation.path} ws={ws} doc={doc} implementation={implementation} />
        ))
      )}
    </Panel>
  );
}

function ImplementationCard({ ws, doc, implementation }: { ws: Workspace; doc: DocumentSheet; implementation: Implementation }) {
  const [result, setResult] = useState<Load<ExtractResult> | null>(null);
  const run = () => {
    setResult({ kind: "loading" });
    api
      .extract(ws.id, doc.id, implementation.entity, implementation.platform)
      .then((value) => setResult({ kind: "ready", value }))
      .catch((reason) => setResult({ kind: "error", error: explain(reason) }));
  };
  const title = `${implementation.entity} · ${PLATFORMS[implementation.platform] ?? implementation.platform}`;
  return (
    <section className="card implementation" aria-label={title}>
      <div className="panel-head">
        <div className="implementation-title">
          <h3>{title}</h3>
          <span className="mono muted">{implementation.path}</span>
        </div>
        {implementation.extractable ? (
          <button className="btn btn-secondary" type="button" onClick={run} disabled={result?.kind === "loading"}>
            Extraire et comparer au canonique
          </button>
        ) : (
          <span className="muted">Plateforme sans extraction</span>
        )}
      </div>
      <pre className="code">{implementation.sql}</pre>
      <div aria-live="polite">
        {result?.kind === "loading" && <Pending>Extraction et comparaison en cours…</Pending>}
        {result?.kind === "error" && <Failure error={result.error} />}
        {result?.kind === "ready" && <Extraction result={result.value} />}
      </div>
    </section>
  );
}

function Extraction({ result }: { result: ExtractResult }) {
  return (
    <div className="extraction">
      {result.residues.map((r, index) => (
        <p key={index} className="fact-warn">
          {r.message}
        </p>
      ))}
      {result.statements.map((statement) => (
        <div key={statement.id} className="extraction-statement">
          <p>
            Requête ligne {statement.line} : brouillon <span className="mono">{statement.id}</span>, fidélité au SQL{" "}
            {FIDELITY[statement.roundtrip.status] ?? statement.roundtrip.status}.
          </p>
          {statement.residues.length > 0 && (
            <ul className="extraction-residues">
              {statement.residues.map((r, index) => (
                <li key={index}>
                  <span className={r.blocking ? "tone-bad" : "tone-warn"}>{r.blocking ? "Bloquant" : "À revoir"}</span> :{" "}
                  {r.message}
                </li>
              ))}
            </ul>
          )}
          {statement.diff ? <ExtractionDiff report={statement.diff} /> : <p className="muted">Brouillon à corriger avant de le comparer.</p>}
        </div>
      ))}
    </div>
  );
}

function ExtractionDiff({ report }: { report: DiffReport }) {
  return (
    <section className="diff" aria-label="Écarts au canonique">
      <span className="section-label">
        Écarts au canonique v{report.base.version}
      </span>
      <DiffSummary report={report} />
      {!report.identical && <DiffList report={report} />}
    </section>
  );
}

function ScopeAndComparisons({ ws, doc }: { ws: Workspace; doc: DocumentSheet }) {
  const runs = useLoad(() => api.comparisons(ws.id, doc.id, 3), [ws.id, doc.id]);
  const own = doc.tolerance?.percent;
  return (
    <Panel title="Scope et comparaisons">
      <div className="cards">
        <div className="card">
          <span className="section-label">Tolérance</span>
          <p>
            {own !== undefined
              ? `${tolerance(own)} (propre au KPI)`
              : doc.workspace_tolerance
                ? `${tolerance(doc.workspace_tolerance.percent)} (défaut de l'espace)`
                : "—"}
          </p>
        </div>
      </div>
      <h3>Scopes déclarés</h3>
      {doc.scopes.length === 0 ? (
        <p className="muted">Aucun scope déclaré : une comparaison porte alors sur toute la période disponible.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Scope</th>
                <th scope="col">Période</th>
                <th scope="col">Granularité</th>
              </tr>
            </thead>
            <tbody>
              {doc.scopes.map((scope) => (
                <tr key={scope.id}>
                  <th scope="row" className="mono">
                    {scope.id}
                  </th>
                  <td>
                    {scope.period?.calendar_period ??
                      ([scope.period?.from, scope.period?.to].filter(Boolean).join(" → ") || "—")}
                  </td>
                  <td>{scope.granularity?.join(", ") ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>Dernières comparaisons</h3>
      {runs.kind === "loading" && <Pending>Chargement des comparaisons…</Pending>}
      {runs.kind === "error" && <Failure error={runs.error} />}
      {runs.kind === "ready" && runs.value.length === 0 && <p className="muted">Aucune comparaison chiffrée pour ce KPI.</p>}
      {runs.kind === "ready" && runs.value.length > 0 && <Runs runs={runs.value} />}
    </Panel>
  );
}

function Runs({ runs }: { runs: ComparisonRun[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">N°</th>
            <th scope="col">Date</th>
            <th scope="col">Version</th>
            <th scope="col">Statut</th>
            <th scope="col">Dans la tolérance</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <th scope="row">{run.id}</th>
              <td>{ago(run.finished_at ?? run.started_at)}</td>
              <td>v{run.kpi_version}</td>
              <td>{RUN_STATUS[run.status] ?? run.status}</td>
              <td>
                {run.results.length === 0
                  ? "—"
                  : run.results
                      .map((r) => `${r.entity} ${r.validation_pct === null ? "—" : percent(r.validation_pct)}`)
                      .join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
